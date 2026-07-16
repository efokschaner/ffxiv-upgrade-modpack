import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allFiles, FileStorageType } from "../../src/model/modpack";
import { decodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { loadRawModpack } from "./load-raw";

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
    // Raw (no load-fix) read: these are the pack's ORIGINAL models to test our normalizer/serializer
    // against, not loadModpack's already-FixOldModel-normalized output — see loadRawModpack.
    const data = loadRawModpack(
      name,
      new Uint8Array(readFileSync(join(INPUTS, name))),
    );
    for (const { gamePath, file } of allFiles(data)) {
      if (file.storage !== FileStorageType.SqPackCompressed) continue;
      if (!gamePath.toLowerCase().endsWith(".mdl")) continue;
      let decoded: ReturnType<typeof decodeSqPackFile>;
      try {
        // SqPackCompressed (narrowed by the storage check above) always carries bytes; only a PMP
        // RawUncompressed entry can be absent (absent-file design spec §3.1).
        decoded = decodeSqPackFile(file.data);
      } catch {
        continue; // tolerated undecodable legacy model (mirrors corpus-mdl)
      }
      if (decoded.type !== SqPackType.Model) continue;
      yield { pack: name, gamePath, bytes: decoded.data };
    }
  }
}

/** The first decodable Model .mdl in the corpus (throws if none). */
export function firstCorpusModel(): CorpusModel {
  for (const m of corpusModels()) return m;
  throw new Error("no decodable Model .mdl found in test/corpus/real");
}
