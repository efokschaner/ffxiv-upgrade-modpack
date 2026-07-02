import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Matches the parallel shard files, test/corpus-shard.NN.test.ts. */
const SHARD_FILE_RE = /^corpus-shard\.\d+\.test\.ts$/;

// Number of parallel shard files, DERIVED from the files on disk (test/corpus-shard.NN.test.ts) so it
// can never drift from them — the files are the single source of truth for parallelism. To change the
// parallelism, add or remove a shard file (copy one and bump its index); there is no constant to keep
// in sync. Vitest runs test FILES in parallel across a worker pool auto-sized to the host's CPUs, but
// tests WITHIN a file run serially, so packs are split across these files to use multiple cores. The
// pool adapts to the host automatically (override with --maxWorkers); the file count is only the
// ceiling. The starting set is 16 files: wall-clock is floored by the single heaviest pack (a pack
// can't be split across workers), and 16 balanced shards comfortably reach that floor on a typical
// multi-core host while throttling down gracefully on fewer cores. The corpus-shards.test.ts meta-test
// (Task 4) enforces that the files' indices are contiguous 0..SHARD_COUNT-1 and each shard file calls
// registerCorpusShard with its own index.
export const SHARD_COUNT: number =
  readdirSync(join(__dirname, "..")).filter((f) => SHARD_FILE_RE.test(f)).length;

/**
 * Deterministically assign `inputs` to `shardCount` balanced buckets and return bucket `shardIndex`.
 * Longest-processing-time bin-packing by on-disk size (a good proxy for decode+encode+round-trip
 * cost): sort packs largest-first, greedily place each into the currently-lightest bucket. Keeps the
 * few huge packs in different shards instead of colliding. Deterministic, so every shard file
 * computes the same split and takes its own slice.
 */
export function shardOf(inputs: string[], shardCount: number, shardIndex: number): string[] {
  const sized = inputs.map((path) => ({ path, size: statSync(path).size }));
  // size desc, path tiebreak so equal-size packs get a stable, deterministic order.
  sized.sort((a, b) => b.size - a.size || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const buckets: string[][] = Array.from({ length: shardCount }, () => []);
  const loads: number[] = new Array(shardCount).fill(0);
  for (const { path, size } of sized) {
    let min = 0;
    for (let i = 1; i < shardCount; i++) if (loads[i]! < loads[min]!) min = i;
    buckets[min]!.push(path);
    loads[min]! += size;
  }
  return buckets[shardIndex] ?? [];
}
