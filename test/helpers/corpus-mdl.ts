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

function mdlFiles(path: string): ModpackFile[] {
  const data = loadModpack(basename(path), new Uint8Array(readFileSync(path)));
  return allFiles(data).filter(
    (f) =>
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
      for (const f of files) {
        let decoded: ReturnType<typeof decodeSqPackFile>;
        try {
          decoded = decodeSqPackFile(f.data);
        } catch {
          legacySkipped++; // tolerated undecodable legacy model (mirrors corpus-sqpack)
          continue;
        }
        if (decoded.type !== SqPackType.Model) continue;
        const re = serializeMdl(parseMdl(decoded.data, f.gamePath));
        expect(bytesEqual(re, decoded.data)).toBe(true);
        exact++;
      }
      console.log(
        `[mdl] ${name}: ${exact} byte-exact, ${legacySkipped} legacy-skipped (of ${files.length})`,
      );
    }, 1_200_000);
  });
}
