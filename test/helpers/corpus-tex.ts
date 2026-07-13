import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModpack } from "../../src/index";
import {
  allFiles,
  FileStorageType,
  type ModpackFile,
} from "../../src/model/modpack";
import { decodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { decodeToRgba } from "../../src/tex/decode";
import { parseTex, serializeTex } from "../../src/tex/tex";
import { texLayers } from "../../src/tex/types";
import { bytesEqual } from "./compare";

// At most this many textures per distinct XivTexFormat per pack get their top mip decoded to RGBA.
// The round-trip gate below already touches every decodable .tex; this bounded sample exercises the
// real pixel decoders (esp. BC7 modes 0-5/7, which have no runtime test yet) on real data without
// paying to decode every large texture in the corpus.
const DECODE_SAMPLE_CAP_PER_FORMAT = 2;

function texFiles(path: string): ModpackFile[] {
  const data = loadModpack(basename(path), new Uint8Array(readFileSync(path)));
  return allFiles(data).filter(
    (f) =>
      f.storage === FileStorageType.SqPackCompressed &&
      f.gamePath.toLowerCase().endsWith(".tex"),
  );
}

// Correctness gate for the TEX codec over real SE/TexTools textures. The retained-header model
// (design spec §2) makes serializeTex(parseTex(x)) === x UNCONDITIONALLY byte-exact for any decodable
// .tex — no normalization branch (unlike mtrl). We skip ONLY textures whose SQPack Type-4 decode
// fails: a few legacy textures were imported with improper block spacing and are undecodable by the
// reference block-recovery heuristic too (see corpus-sqpack.ts decodeTolerant). Any decodable .tex
// that does not round-trip byte-exact is a hard failure.
//
// Alongside the round-trip gate, a bounded per-format sample of the SAME textures gets its top mip
// decoded to RGBA via decodeToRgba, to exercise the real pixel decoders on real data. A throw whose
// message matches /unsupported/i is a deferred format (e.g. X8R8G8B8) and is tolerated; any other
// throw is a decoder bug on a supported format and is a hard failure.
export function registerTexChecks(pack: string): void {
  const name = basename(pack);
  describe(`tex corpus: ${name}`, () => {
    it(`serializeTex(parseTex(x)) === x for every decodable .tex in ${name}, plus a bounded decode smoke`, () => {
      const files = texFiles(pack);
      let exact = 0;
      let legacySkipped = 0;
      let decodeSmoked = 0;
      let unsupportedFormat = 0;
      const decodeSampleCount = new Map<number, number>();
      for (const f of files) {
        let decoded: ReturnType<typeof decodeSqPackFile>;
        try {
          // SqPackCompressed (filtered by texFiles above) always carries bytes; only a PMP
          // RawUncompressed entry can be absent (absent-file design spec §3.1).
          decoded = decodeSqPackFile(f.data!);
        } catch {
          legacySkipped++; // tolerated undecodable legacy texture (mirrors corpus-sqpack)
          continue;
        }
        if (decoded.type !== SqPackType.Texture) continue;
        const parsed = parseTex(decoded.data, f.gamePath);
        const re = serializeTex(parsed);
        expect(bytesEqual(re, decoded.data)).toBe(true);
        exact++;

        const sampled = decodeSampleCount.get(parsed.format) ?? 0;
        if (sampled >= DECODE_SAMPLE_CAP_PER_FORMAT) continue;
        decodeSampleCount.set(parsed.format, sampled + 1);
        // TODO(oracle-stage): this smoke asserts output LENGTH only, so a decoder that produced wrong
        // pixels of the right size would pass (esp. BC7 modes 0-5/7, which have no known-answer unit
        // test). Close with per-mode golden fixtures when the transforms/oracle stage lands (PR #5 #2).
        try {
          const rgba = decodeToRgba(parsed);
          expect(rgba.length).toBe(
            parsed.width * parsed.height * texLayers(parsed) * 4,
          );
          decodeSmoked++;
        } catch (err) {
          const message = (err as Error).message;
          if (/unsupported/i.test(message)) {
            unsupportedFormat++; // deferred format (e.g. X8R8G8B8), not a decoder bug
            continue;
          }
          expect.fail(
            `decode smoke failed for ${f.gamePath} (format ${parsed.format}): ${message}`,
          );
        }
      }
      console.log(
        `[tex] ${name}: ${exact} byte-exact, ${decodeSmoked} decode-smoked, ` +
          `${unsupportedFormat} unsupported-format, ${legacySkipped} legacy-skipped (of ${files.length})`,
      );
    }, 1_200_000);
  });
}
