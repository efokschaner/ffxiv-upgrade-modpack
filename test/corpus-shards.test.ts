import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shardOf } from "./helpers/corpus-shards";

// shardOf reads on-disk sizes, so create real files of known sizes.
function makeFiles(sizes: number[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "shard-"));
  return sizes.map((s, i) => {
    const p = join(dir, `pack${i}.bin`);
    writeFileSync(p, new Uint8Array(s));
    return p;
  });
}

describe("shardOf", () => {
  it("partitions every input into exactly one shard (union = inputs, no dupes)", () => {
    const files = makeFiles([10, 20, 30, 40, 50, 60, 70]);
    const all = new Set<string>();
    let count = 0;
    for (let i = 0; i < 4; i++) for (const p of shardOf(files, 4, i)) { all.add(p); count++; }
    expect(count).toBe(files.length);          // no pack placed twice
    expect(all).toEqual(new Set(files));       // every pack placed
  });

  it("is deterministic (same inputs → same split)", () => {
    const files = makeFiles([5, 9, 1, 7, 3, 8, 2, 6]);
    for (let i = 0; i < 4; i++) expect(shardOf(files, 4, i)).toEqual(shardOf(files, 4, i));
  });

  it("balances by size — the largest packs land in different shards", () => {
    const files = makeFiles([100, 90, 80, 1, 1, 1]); // 3 big + 3 tiny
    const big = new Set(files.slice(0, 3));
    const shardsWithBig = [0, 1, 2].map((i) => shardOf(files, 3, i).filter((p) => big.has(p)).length);
    expect(shardsWithBig).toEqual([1, 1, 1]);  // one big pack per shard, not clustered
  });

  it("returns an empty array for a shard index with no packs", () => {
    const files = makeFiles([10, 20]);
    expect(shardOf(files, 8, 7)).toEqual([]);   // more shards than packs
  });
});
