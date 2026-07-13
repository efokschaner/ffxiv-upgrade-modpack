import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModpack } from "../../src/index";
import {
  allFiles,
  FileStorageType,
  type ModpackFile,
} from "../../src/model/modpack";
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";
import type { XivMtrl } from "../../src/mtrl/types";
import { decodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { bytesEqual } from "./compare";

/** A ModpackFile narrowed to the always-has-bytes SqPackCompressed variant. */
type SqPackCompressedFile = Extract<
  ModpackFile,
  { storage: FileStorageType.SqPackCompressed }
>;

function mtrlFiles(path: string): SqPackCompressedFile[] {
  const data = loadModpack(basename(path), new Uint8Array(readFileSync(path)));
  return allFiles(data).filter(
    (f): f is SqPackCompressedFile =>
      f.storage === FileStorageType.SqPackCompressed &&
      f.gamePath.toLowerCase().endsWith(".mtrl"),
  );
}

// A stable key for a parsed model, masking the additionalData[0] 0x08 dye flag that serialize
// deterministically toggles (design §5.3). Two models with the same key carry identical semantic
// content — textures, samplers, colorset halves, shader keys/constants. Comparing the key of
// parse(original) vs parse(reserialized) proves a normalized (non-byte-exact) round-trip did not
// drop or alter any content, catching a deterministic data-loss regression that a byte-level
// idempotency check alone could miss.
function modelKey(m: XivMtrl): string {
  const additionalData = Array.from(m.additionalData);
  if (additionalData.length > 0) additionalData[0]! &= ~0x08 & 0xff;
  return JSON.stringify({
    ...m,
    additionalData,
    colorSetDyeData: Array.from(m.colorSetDyeData),
  });
}

// Correctness gate for the MTRL codec over real SE/TexTools materials.
// Canonical inputs round-trip byte-identical: serializeMtrl(parseMtrl(x)) === x.
// Non-canonical inputs do NOT round-trip byte-identical, and that is expected (design spec §7):
// serializeMtrl faithfully reproduces C#'s Mtrl.XivMtrlToUncompressedMtrl, which normalizes such
// files exactly as we do — string block re-padded to 4 (§5.1), shader-constant data size recomputed
// with zero-filled overflow constants (§6.4/§8), stale 0x08 dye flag cleared when no dye (§5.3).
// For these we require the normalization to be BOTH: (1) a STABLE fixed point — re-round-tripping
// our own output reproduces it byte-for-byte; and (2) SEMANTICALLY LOSSLESS — parse(original) and
// parse(reserialized) are the same model modulo the 0x08 dye flag (see modelKey). A non-fixed-point
// (unstable) or content-changing (semantic-break) result is a real codec bug and fails the test.
export function registerMtrlChecks(pack: string): void {
  const name = basename(pack);
  describe(`mtrl corpus: ${name}`, () => {
    it(`round-trips or faithfully normalizes every .mtrl in ${name}`, () => {
      const files = mtrlFiles(pack);
      let exact = 0;
      let normalized = 0;
      const unstable: string[] = [];
      const semanticBreaks: string[] = [];
      for (const f of files) {
        // SqPackCompressed (filtered by mtrlFiles above) always carries bytes; only a PMP
        // RawUncompressed entry can be absent (absent-file design spec §3.1).
        const decoded = decodeSqPackFile(f.data);
        if (decoded.type !== SqPackType.Standard) continue; // materials are Type 2
        const re = serializeMtrl(parseMtrl(decoded.data, f.gamePath));
        if (bytesEqual(re, decoded.data)) {
          exact++;
          continue;
        }
        const re2 = serializeMtrl(parseMtrl(re, f.gamePath));
        if (!bytesEqual(re2, re)) {
          unstable.push(
            `${f.gamePath} (${decoded.data.length}->${re.length}->${re2.length})`,
          );
          continue;
        }
        if (
          modelKey(parseMtrl(decoded.data, f.gamePath)) !==
          modelKey(parseMtrl(re, f.gamePath))
        ) {
          semanticBreaks.push(
            `${f.gamePath} (${decoded.data.length}->${re.length})`,
          );
          continue;
        }
        normalized++;
      }
      const total =
        exact + normalized + unstable.length + semanticBreaks.length;
      console.log(
        `[mtrl] ${name}: ${exact} exact, ${normalized} normalized, ` +
          `${unstable.length} unstable, ${semanticBreaks.length} semantic-break (of ${total})`,
      );
      if (unstable.length || semanticBreaks.length) {
        expect.fail(
          `mtrl round-trip failures in ${name} — unstable (not a fixed point): ` +
            `[${unstable.join(", ")}]; semantic-break (content changed beyond the dye flag): ` +
            `[${semanticBreaks.join(", ")}]`,
        );
      }
    }, 1_200_000);
  });
}
