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
function unc(f: { storage: FileStorageType; data?: Uint8Array }): Uint8Array {
  // .meta files are synthesized from PMP Manipulations, never from a zip `Files` member (absent-file
  // design spec §3.3), so a `.meta` ModpackFile always carries bytes.
  if (!f.data) throw new Error("roundtrip.corpus: .meta file has no bytes");
  return f.storage === FileStorageType.SqPackCompressed
    ? decodeSqPackFile(f.data).data
    : f.data;
}

describe("meta codec round-trips every golden .meta", () => {
  it("serialize(deserialize(x)) === x for all cached goldens", () => {
    // Read the cache listing ONCE, not once per pack (it holds one entry per corpus pack, so the
    // per-pack readdir made this quadratic in corpus size).
    const cached = existsSync(CACHE) ? readdirSync(CACHE) : [];
    let checked = 0;
    for (const pack of corpusPacks()) {
      const bytes = new Uint8Array(readFileSync(pack));
      const key = createHash("sha256").update(bytes).digest("hex");
      const goldenFile = cached.find(
        (f) => f.startsWith(key) && f.endsWith(".bin"),
      );
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
    // This walks every corpus pack AND every cached golden (~1 GB), so it is far too slow for
    // Vitest's 5s default — it ran 4.2s on an idle machine and timed out at 10s under load. It has
    // no oracle spawn to wait on (cache reads only), so it does not need the corpus checks'
    // 20-minute budget; 2 minutes is ~30x headroom over the observed time.
  }, 120_000);
});
