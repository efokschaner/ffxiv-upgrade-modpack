import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadModpack } from "../../src/index";
import { allFiles, FileStorageType } from "../../src/model/modpack";
import { decodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";

const INPUTS = "test/corpus/real";

export interface CorpusModel {
  pack: string;
  gamePath: string;
  bytes: Uint8Array; // decompressed runtime .mdl
}

/** Lazily yields every decodable Model .mdl (decompressed) across the local corpus packs.
 *  The repo's tests require the local corpus (gitignored, 46 packs under test/corpus/real). */
export function* corpusModels(): Generator<CorpusModel> {
  for (const name of readdirSync(INPUTS)) {
    if (!/\.(ttmp2|ttmp|pmp)$/i.test(name)) continue;
    const data = loadModpack(
      name,
      new Uint8Array(readFileSync(join(INPUTS, name))),
    );
    for (const f of allFiles(data)) {
      if (f.storage !== FileStorageType.SqPackCompressed) continue;
      if (!f.gamePath.toLowerCase().endsWith(".mdl")) continue;
      let decoded: ReturnType<typeof decodeSqPackFile>;
      try {
        decoded = decodeSqPackFile(f.data);
      } catch {
        continue; // tolerated undecodable legacy model (mirrors corpus-mdl)
      }
      if (decoded.type !== SqPackType.Model) continue;
      yield { pack: name, gamePath: f.gamePath, bytes: decoded.data };
    }
  }
}

/** The first decodable Model .mdl in the corpus (throws if none). */
export function firstCorpusModel(): CorpusModel {
  for (const m of corpusModels()) return m;
  throw new Error("no decodable Model .mdl found in test/corpus/real");
}
