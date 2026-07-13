import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModpack } from "../../src/index";
import { parseMdl, serializeMdl } from "../../src/mdl/mdl";
import {
  allFiles,
  FileStorageType,
  type ModpackFile,
} from "../../src/model/modpack";
import { decodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { bytesEqual } from "./compare";

/** A ModpackFile narrowed to the always-has-bytes SqPackCompressed variant. */
type SqPackCompressedFile = Extract<
  ModpackFile,
  { storage: FileStorageType.SqPackCompressed }
>;

function mdlFiles(path: string): SqPackCompressedFile[] {
  const data = loadModpack(basename(path), new Uint8Array(readFileSync(path)));
  return allFiles(data).filter(
    (f): f is SqPackCompressedFile =>
      f.storage === FileStorageType.SqPackCompressed &&
      f.gamePath.toLowerCase().endsWith(".mdl"),
  );
}

// Correctness gate for the MDL codec over real SE/TexTools models. serializeMdl(parseMdl(x)) === x is
// byte-exact for any decodable .mdl, and parseMdl additionally asserts its walk consumes exactly
// modelDataSize (a layout error throws). We skip ONLY models whose SQPack Type-3 decode fails (the
// same legacy files corpus-sqpack tolerates). Any decodable .mdl that does not round-trip byte-exact,
// or whose sections do not sum to modelDataSize, is a hard failure.
export function registerMdlChecks(pack: string): void {
  const name = basename(pack);
  describe(`mdl corpus: ${name}`, () => {
    it(`serializeMdl(parseMdl(x)) === x for every decodable .mdl in ${name}`, () => {
      const files = mdlFiles(pack);
      let exact = 0;
      let legacySkipped = 0;
      let trailingTotal = 0;
      for (const f of files) {
        let decoded: ReturnType<typeof decodeSqPackFile>;
        try {
          // SqPackCompressed (filtered by mdlFiles above) always carries bytes; only a PMP
          // RawUncompressed entry can be absent (absent-file design spec §3.1).
          decoded = decodeSqPackFile(f.data);
        } catch {
          legacySkipped++; // tolerated undecodable legacy model (mirrors corpus-sqpack)
          continue;
        }
        if (decoded.type !== SqPackType.Model) continue;
        const parsed = parseMdl(decoded.data, f.gamePath);
        const re = serializeMdl(parsed);
        expect(bytesEqual(re, decoded.data)).toBe(true);
        exact++;
        trailingTotal += parsed.sections.trailing.length;
      }
      console.log(
        `[mdl] ${name}: ${exact} byte-exact, ${legacySkipped} legacy-skipped, ${trailingTotal} trailing-bytes (of ${files.length})`,
      );
    }, 1_200_000);
  });
}
