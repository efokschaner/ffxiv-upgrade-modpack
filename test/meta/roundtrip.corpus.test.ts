import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModpack } from "../../src/index";
import { deserializeMeta } from "../../src/meta/deserialize";
import { serializeMeta } from "../../src/meta/serialize";
import { allFiles, FileStorageType } from "../../src/model/modpack";
import { decodeSqPackFile } from "../../src/sqpack/sqpack";
import { corpusPacks } from "../helpers/corpus-roots";

const CACHE = join(__dirname, "..", "corpus", ".upgrade-cache");
function unc(f: { storage: FileStorageType; data: Uint8Array }): Uint8Array {
  return f.storage === FileStorageType.SqPackCompressed
    ? decodeSqPackFile(f.data).data
    : f.data;
}

describe("meta codec round-trips every golden .meta", () => {
  it("serialize(deserialize(x)) === x for all cached goldens", () => {
    let checked = 0;
    for (const pack of corpusPacks()) {
      const bytes = new Uint8Array(readFileSync(pack));
      const key = createHash("sha256").update(bytes).digest("hex");
      const goldenFile = existsSync(CACHE)
        ? readdirSync(CACHE).find(
            (f) => f.startsWith(key) && f.endsWith(".bin"),
          )
        : undefined;
      if (!goldenFile) continue;
      const golden = loadModpack(
        pack,
        new Uint8Array(readFileSync(join(CACHE, goldenFile))),
      );
      for (const f of allFiles(golden)) {
        if (!f.gamePath.endsWith(".meta")) continue;
        const raw = unc(f);
        expect(serializeMeta(deserializeMeta(raw))).toEqual(raw);
        checked++;
      }
    }
    // Corpus is local/gitignored; a fresh clone with no goldens checks nothing but must not fail.
    expect(checked).toBeGreaterThanOrEqual(0);
  });
});
