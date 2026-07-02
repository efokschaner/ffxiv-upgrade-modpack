# Corpus Test Parallelization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parallelize the corpus test suite across CPU cores by splitting the packs into N shard files, taking the full warm suite from ~111s to ~15–20s.

**Architecture:** Vitest parallelizes across test *files* (worker pool auto-sized to host CPUs) but runs tests *within* a file serially. Today all corpus checks live in four monolithic files (`sqpack-corpus`, `golden`, `pmp-manifest`, `mtrl-corpus`) that each loop over every pack on one core. We extract each file's per-pack logic into shared registration helpers, then create `SHARD_COUNT` thin shard files (`test/corpus-shard.NN.test.ts`), each running a balanced slice of packs through *all* the corpus checks. Vitest's pool spreads the shard files over the cores automatically. A prerequisite cache fix makes the oracle `/unwrap` cache safe for concurrent writers.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest 1.6, Node built-ins only. No new dependencies.

## Global Constraints

- **Behavior-preserving.** Every assertion, comment, timeout, and console.log tag that exists today must survive the move **verbatim** — only *where* the code lives and *how the packs are distributed* changes. The set of checks run per pack is identical.
- **No new dependencies.** Node built-ins only (`node:fs`, `node:path`, `node:crypto`).
- **No per-file license headers** (consolidated to repo root; see commit `a144bd2`).
- **`src/` must NOT change.** Only files under `test/` change.
- **Fail-on-absent policy preserved.** Corpus-dependent shards must still FAIL (not skip) when the corpus is empty, via `assertCorpusPresent`. The `/unwrap` throw-on-null and the `.pmp`-required guard are preserved.
- **Adaptivity model:** leave Vitest's worker pool auto-sizing (do NOT hard-cap `maxWorkers`) so parallelism scales to the host's CPUs. `SHARD_COUNT` is DERIVED from the number of `corpus-shard.NN.test.ts` files on disk (the files are the single source of truth — add/remove a file to change the ceiling), and a meta-test enforces the files stay consistent. It is a ceiling on parallelism, not host-derived.
- **Oracle cache correctness:** the content-addressed `/unwrap` cache must stay correct under concurrent writers (multiple shard files may write it at once). Cache keys remain `sha256(entry)`; the cache lives under gitignored `test/corpus/`.
- **TypeScript strict / `noUncheckedIndexedAccess`** — `npm run typecheck` clean.
- **Windows / PowerShell** dev environment; corpus runs need an explicit large timeout (well past the 120s PowerShell default).

---

## File Structure

**New helper modules** (plain `.ts` under `test/helpers/`; they call Vitest's `describe`/`it`/`beforeAll`/`afterAll` during a test file's collection):
- `test/helpers/corpus-shards.ts` — `SHARD_COUNT` (derived from the on-disk shard-file count), `shardOf()` (balanced deterministic pack assignment), and `registerCorpusShard()` (registers all checks for a shard's packs).
- `test/helpers/corpus-sqpack.ts` — `registerSqpackChecks(pack)` + the sqpack decode/round-trip/unwrap helpers moved from `sqpack-corpus.test.ts`.
- `test/helpers/corpus-golden.ts` — `registerGoldenCheck(pack)` (reader→writer→reader byte-identical round-trip).
- `test/helpers/corpus-mtrl.ts` — `registerMtrlChecks(pack)` + mtrl helpers.
- `test/helpers/corpus-pmp.ts` — `registerPmpManifestChecks(pack)` (`.pmp` manifest fidelity).

**Modified:**
- `test/helpers/compare.ts` — export the existing private `bytesEqual` for reuse (removes 3 duplicate copies).
- `test/helpers/oracle.ts` — make `oracleCachePut`'s temp filename unique-per-writer; correct the now-stale concurrency comments.

**New shard files:** `test/corpus-shard.00.test.ts` … `test/corpus-shard.15.test.ts` (16 files), each two lines: `registerCorpusShard(N)`. These files ARE the parallelism config (`SHARD_COUNT` counts them); a meta-test in `corpus-shards.test.ts` keeps them consistent.

**Deleted:** `test/sqpack-corpus.test.ts`, `test/mtrl-corpus.test.ts`, `test/golden.test.ts` (all corpus-only; their logic + doc comments move into helpers).

**Trimmed:** `test/pmp-manifest.test.ts` — keep only the synthetic (non-corpus) `pmp manifest fidelity` test; its corpus round-trip block moves to the shard.

---

## Task 1: Make the oracle cache safe for concurrent writers

Parallel shards mean multiple workers may call `oracleCachePut` at once. Its temp filename is currently the *deterministic* `${key}.bin.tmp` — two workers writing the same key would race on that one temp path (one `renameSync` then throws ENOENT for the other). Give each write a unique temp name.

**Files:**
- Modify: `test/helpers/oracle.ts`
- Test: `test/oracle-cache.test.ts`

**Interfaces:**
- Consumes: existing `oracleKey`, `oracleCacheGet`, `oracleCachePut`, `DEFAULT_ORACLE_CACHE`.
- Produces: no signature changes — `oracleCachePut(key, data, dir?)` behaves identically, just concurrency-safe internally.

- [ ] **Step 1: Write the failing test**

Append to `test/oracle-cache.test.ts`:

```ts
import { readdirSync } from "node:fs";

describe("oracleCachePut concurrency-safety", () => {
  it("repeated puts for the same key leave one .bin and no .tmp residue", () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-"));
    const key = "abc123";
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    for (let i = 0; i < 5; i++) oracleCachePut(key, data, dir);
    const files = readdirSync(dir);
    expect(files).toEqual([`${key}.bin`]);            // exactly one file, no leftover .tmp
    expect(Array.from(oracleCacheGet(key, dir)!)).toEqual([1, 2, 3, 4, 5]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/oracle-cache.test.ts -t "concurrency-safety"`
Expected: FAIL — the current fixed `${key}.bin.tmp` leaves no residue on sequential calls, so this specific assertion may actually pass; the REAL failure this guards is a race. To force a meaningful RED, first confirm the current implementation still uses a fixed temp name by reading `oracleCachePut`. If the sequential test passes as-is, that is acceptable — proceed to Step 3 to make the temp name unique (the test then also guards against a future regression that leaves `.tmp` residue). Note in your report that this test is a residue/uniqueness guard, not a true race reproduction.

- [ ] **Step 3: Make the temp name unique per writer**

In `test/helpers/oracle.ts`, add `randomUUID` to the `node:crypto` import:

```ts
import { createHash } from "node:crypto";
```
→
```ts
import { createHash, randomUUID } from "node:crypto";
```

Then change `oracleCachePut`'s temp path and comment. Current:

```ts
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, `${key}.bin`);
  // Deterministic temp name is safe here ONLY because payloads are content-addressed: any two
  // writers for the same key produce byte-identical data, so a race can't corrupt the result.
  const tmpPath = join(dir, `${key}.bin.tmp`);
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, finalPath);
```
→
```ts
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, `${key}.bin`);
  // Unique temp name per writer so concurrent shard workers writing the same key never race on a
  // shared temp path (each does its own write + atomic rename; last rename wins with identical bytes).
  const tmpPath = join(dir, `${key}.${randomUUID()}.tmp`);
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, finalPath);
```

- [ ] **Step 4: Correct the stale concurrency comment on `unwrapCached`**

In `test/helpers/oracle.ts`, the `unwrapCached` JSDoc currently ends with a now-false claim. Change:

```ts
 * No cross-worker write contention on DEFAULT_ORACLE_CACHE: only sqpack-corpus.test.ts writes it,
 * and Vitest executes tests within a single file sequentially.
```
→
```ts
 * DEFAULT_ORACLE_CACHE is written concurrently by parallel corpus shard workers; oracleCachePut is
 * concurrency-safe (content-addressed keys + unique per-writer temp name + atomic rename).
```

Also update the `unwrapCached` doc's mention of the "sole caller, sqpack-corpus.test.ts" — the caller is now `registerSqpackChecks` (helper). Change:

```ts
 * leaving it to the caller to decide how to handle an unverifiable sample (the sole caller,
 * sqpack-corpus.test.ts, fails loudly per the fail-on-unavailable policy). `opts.available`/
```
→
```ts
 * leaving it to the caller to decide how to handle an unverifiable sample (registerSqpackChecks
 * fails loudly per the fail-on-unavailable policy). `opts.available`/
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run test/oracle-cache.test.ts`
Expected: PASS (all cache tests, including the new residue guard).

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add test/helpers/oracle.ts test/oracle-cache.test.ts
git commit -m "fix(oracle): unique per-writer cache temp name for concurrent shard writers"
```

---

## Task 2: Sharding primitive — `shardOf` + `SHARD_COUNT`

A pure, deterministic, balanced pack-to-shard assignment. TDD it in isolation before any wiring.

**Files:**
- Create: `test/helpers/corpus-shards.ts`
- Test: `test/corpus-shards.test.ts` (create)

**Interfaces:**
- Produces:
  - `SHARD_COUNT: number` — DERIVED at module load from the count of `test/corpus-shard.NN.test.ts` files on disk (0 until Task 4 creates them). The files are the single source of truth; there is no hardcoded constant.
  - `shardOf(inputs: string[], shardCount: number, shardIndex: number): string[]` — returns the deterministic balanced slice of `inputs` for `shardIndex`. Every input appears in exactly one shard; union over all indices = `inputs`.
  - (`registerCorpusShard` is added later, in Task 4.)

- [ ] **Step 1: Write the failing test**

Create `test/corpus-shards.test.ts`:

```ts
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
```

(`SHARD_COUNT` is derived from the shard files on disk, of which there are none yet at this task, so it is deliberately not asserted here — the shard-file/`SHARD_COUNT` consistency is validated by a meta-test in Task 4, once the shard files exist.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/corpus-shards.test.ts`
Expected: FAIL — `./helpers/corpus-shards` does not exist.

- [ ] **Step 3: Implement `corpus-shards.ts`**

Create `test/helpers/corpus-shards.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/corpus-shards.test.ts`
Expected: PASS (4 tests). (`SHARD_COUNT` is 0 here since no shard files exist yet — that is fine and untested at this task.)

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```powershell
git add test/helpers/corpus-shards.ts test/corpus-shards.test.ts
git commit -m "test(corpus): add deterministic balanced shardOf primitive"
```

---

## Task 3: Extract per-pack checks into helpers; delegate from the existing files

Move each corpus file's per-pack logic into a shared registration helper, then rewire the existing four files to loop-and-delegate. Still four files, still serial, still the same tests — a pure behavior-preserving refactor that proves the extraction is faithful (green suite) before parallelism is switched on in Task 4.

**Files:**
- Modify: `test/helpers/compare.ts` (export `bytesEqual`)
- Create: `test/helpers/corpus-sqpack.ts`, `test/helpers/corpus-golden.ts`, `test/helpers/corpus-mtrl.ts`, `test/helpers/corpus-pmp.ts`
- Modify: `test/sqpack-corpus.test.ts`, `test/golden.test.ts`, `test/mtrl-corpus.test.ts`, `test/pmp-manifest.test.ts`

**Interfaces:**
- Consumes: `corpusInputs`, `assertCorpusPresent`, `unwrapCached` (`./oracle`); `bytesEqual`, `structurallyEqual`, `compareInnerFilesByteIdentical` (`./compare`); `loadModpack`, `writeModpack`, `ModpackFormat`, `allFiles`, `FileStorageType`, `ModpackFile`, `decodeSqPackFile`, `encodeSqPackFile`, `SqPackType`, `DecodedFile`, `texMipSizes`, `parseMtrl`, `serializeMtrl`, `XivMtrl` (`../../src/...`); `readPmp`, `writePmp`, `readZip` (`../../src/...`).
- Produces:
  - `registerSqpackChecks(pack: string): void`
  - `registerGoldenCheck(pack: string): void`
  - `registerMtrlChecks(pack: string): void`
  - `registerPmpManifestChecks(pack: string): void`
  - `bytesEqual(a: Uint8Array, b: Uint8Array): boolean` (now exported from `compare.ts`)

- [ ] **Step 1: Export `bytesEqual` from `compare.ts`**

In `test/helpers/compare.ts`, change:

```ts
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
```
→
```ts
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
```

- [ ] **Step 2: Create `test/helpers/corpus-golden.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { compareInnerFilesByteIdentical } from "./compare";
import { loadModpack, writeModpack, ModpackFormat } from "../../src/index";

// Layer-1 corpus check (moved from the former golden.test.ts).
//
// IMPORTANT — why this is a SELF round-trip, NOT a ConsoleTools /resave diff: /resave is a
// TRANSFORMING op (it decompresses, re-compresses with a different block layout, and normalizes
// .mdl files), so it does not preserve opaque SQPack payloads — a byte-comparison against /resave
// can never pass. The valid layer-1 assertion is a pure round-trip through OUR reader/writer:
// load → write(same format) → load must yield byte-identical inner files.
//
// KNOWN BLIND SPOT: both sides flow through the SAME reader, so a reader that mis-slices real
// SQPack ModOffset/ModSize would corrupt both sides identically and still pass. PMP manifest
// fidelity IS independently validated against the original on-disk JSON in registerPmpManifestChecks.
//
// DEFERRED: a ConsoleTools /resave (and /upgrade) DECOMPRESSED-content differential — needs the
// codec to compare decompressed inner files (raw compressed bytes never match after /resave).

/** Register the reader→writer→reader byte-identical round-trip for one pack. */
export function registerGoldenCheck(pack: string): void {
  describe(`golden round-trip: ${basename(pack)}`, () => {
    it("our reader→writer→reader preserves every inner file byte-for-byte", () => {
      const name = basename(pack);
      const data = loadModpack(name, readFileSync(pack));
      const target = data.sourceFormat === ModpackFormat.Pmp ? "pmp" : "ttmp2";
      const rewritten = writeModpack(data, target);
      const reread = loadModpack(target === "pmp" ? "x.pmp" : "x.ttmp2", rewritten);
      const result = compareInnerFilesByteIdentical(data, reread);
      if (!result.ok) console.error("mismatched files:", result.mismatches);
      expect(result.ok).toBe(true);
    }, 1_200_000);
  });
}
```

- [ ] **Step 3: Create `test/helpers/corpus-pmp.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { readPmp, writePmp } from "../../src/container/pmp";
import { readZip } from "../../src/zip/zip";
import { structurallyEqual } from "./compare";

const dec = new TextDecoder();
const manifestNames = (z: Map<string, Uint8Array>) =>
  [...z.keys()].filter((k) => /^group_\d+.*\.json$/i.test(k)).sort();

/** Register the PMP manifest-fidelity round-trip for one .pmp pack (re-emit every manifest JSON
 * structurally unchanged). Independently validates PMP fidelity against the original on-disk JSON. */
export function registerPmpManifestChecks(pack: string): void {
  describe(`pmp manifest round-trip: ${basename(pack)}`, () => {
    it("re-emits every manifest JSON structurally unchanged", () => {
      const inZ = readZip(readFileSync(pack));
      const outZ = readZip(writePmp(readPmp(readFileSync(pack))));
      for (const fixed of ["meta.json", "default_mod.json"]) {
        const a = JSON.parse(dec.decode(inZ.get(fixed)!));
        const b = JSON.parse(dec.decode(outZ.get(fixed)!));
        expect(structurallyEqual(a, b), `${fixed} differs`).toBe(true);
      }
      const inG = manifestNames(inZ);
      const outG = manifestNames(outZ);
      expect(outG.length).toBe(inG.length);
      for (let i = 0; i < inG.length; i++) {
        const a = JSON.parse(dec.decode(inZ.get(inG[i]!)!));
        const b = JSON.parse(dec.decode(outZ.get(outG[i]!)!));
        expect(structurallyEqual(a, b), `${inG[i]} vs ${outG[i]} differ`).toBe(true);
      }
    }, 600_000);
  });
}
```

- [ ] **Step 4: Create `test/helpers/corpus-mtrl.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadModpack } from "../../src/index";
import { allFiles, FileStorageType, type ModpackFile } from "../../src/model/modpack";
import { decodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";
import type { XivMtrl } from "../../src/mtrl/types";
import { bytesEqual } from "./compare";

function mtrlFiles(path: string): ModpackFile[] {
  const data = loadModpack(basename(path), new Uint8Array(readFileSync(path)));
  return allFiles(data).filter(
    (f) => f.storage === FileStorageType.SqPackCompressed && f.gamePath.toLowerCase().endsWith(".mtrl"),
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
  return JSON.stringify({ ...m, additionalData, colorSetDyeData: Array.from(m.colorSetDyeData) });
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
        const decoded = decodeSqPackFile(f.data);
        if (decoded.type !== SqPackType.Standard) continue; // materials are Type 2
        const re = serializeMtrl(parseMtrl(decoded.data, f.gamePath));
        if (bytesEqual(re, decoded.data)) {
          exact++;
          continue;
        }
        const re2 = serializeMtrl(parseMtrl(re, f.gamePath));
        if (!bytesEqual(re2, re)) {
          unstable.push(`${f.gamePath} (${decoded.data.length}->${re.length}->${re2.length})`);
          continue;
        }
        if (modelKey(parseMtrl(decoded.data, f.gamePath)) !== modelKey(parseMtrl(re, f.gamePath))) {
          semanticBreaks.push(`${f.gamePath} (${decoded.data.length}->${re.length})`);
          continue;
        }
        normalized++;
      }
      const total = exact + normalized + unstable.length + semanticBreaks.length;
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
```

- [ ] **Step 5: Create `test/helpers/corpus-sqpack.ts`**

Move the sqpack helpers and the deduped per-pack `describe` verbatim (import `bytesEqual` from `./compare`; use `unwrapCached` from `./oracle`):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadModpack } from "../../src/index";
import { allFiles, FileStorageType, type ModpackFile } from "../../src/model/modpack";
import { decodeSqPackFile, encodeSqPackFile, SqPackType, type DecodedFile } from "../../src/sqpack/sqpack";
import { texMipSizes } from "../../src/sqpack/type4";
import { unwrapCached } from "./oracle";
import { bytesEqual } from "./compare";

const TEX_HEADER_SIZE = 80;

/** Canonical decompressed length of a Type-4 tex: 80-byte header + sum of formula-derived mip sizes. */
function canonicalTexLength(decoded: Uint8Array): number {
  const dv = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  const format = dv.getUint32(4, true);
  const width = dv.getUint16(8, true);
  const height = dv.getUint16(10, true);
  const mipCount = decoded[14]! & 0xf;
  const sizes = texMipSizes(format, width, height).slice(0, mipCount);
  return TEX_HEADER_SIZE + sizes.reduce((a, b) => a + b, 0);
}

const SELF_CAP_PER_TYPE = 25;   // full round-trip cap per SqPack type per pack

/** True when one buffer is a byte-exact prefix of the other (they differ only in trailing bytes). */
function isPrefixRelation(a: Uint8Array, b: Uint8Array): boolean {
  const m = Math.min(a.length, b.length);
  for (let i = 0; i < m; i++) if (a[i] !== b[i]) return false;
  return true;
}

function compressedFiles(path: string): ModpackFile[] {
  const data = loadModpack(basename(path), new Uint8Array(readFileSync(path)));
  return allFiles(data).filter((f) => f.storage === FileStorageType.SqPackCompressed);
}

/** The SQPack entry type is the int32 at offset 4 — readable without decompressing. */
function entryType(f: ModpackFile): number {
  return new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getInt32(4, true);
}

/**
 * Decode a file, tolerating ONLY Type-4 (texture) decode failures. A tiny number of legacy textures
 * (imported by old TexTools with improper block spacing) trip the skip/rewind block-recovery heuristic;
 * our reader ports that heuristic faithfully from Dat.cs, so those files are undecodable by the reference
 * algorithm too. We log and tolerate them for Type 4, but any Type-2/3 decode failure is a hard error.
 */
function decodeTolerant(f: ModpackFile, legacyTex: string[]): DecodedFile | null {
  try {
    return decodeSqPackFile(f.data);
  } catch (err) {
    if (entryType(f) === SqPackType.Texture) {
      legacyTex.push(`${f.gamePath} (${(err as Error).message})`);
      return null;
    }
    throw err; // Type 2/3 must always decode.
  }
}

/** One compressed inner file paired with its tolerant decode result — d is null iff a tolerated Type-4 failure. */
interface PackEntry {
  f: ModpackFile;
  d: DecodedFile | null;
}

/** Register the three sqpack checks (decode-all, self round-trip, /unwrap oracle cross-check) for one
 * pack. The pack is read + parsed + decoded ONCE in beforeAll and shared by the three its; afterAll
 * releases the decoded data so per-worker memory stays at ~one pack. */
export function registerSqpackChecks(pack: string): void {
  const name = basename(pack);
  describe(`sqpack corpus: ${name}`, () => {
    let entries: PackEntry[] = [];
    const legacyTex: string[] = [];

    beforeAll(() => {
      entries = compressedFiles(pack).map((f) => ({ f, d: decodeTolerant(f, legacyTex) }));
    }, 1_200_000);

    afterAll(() => {
      entries = [];
    });

    it(`decodes every compressed inner file in ${name}`, () => {
      let decoded = 0;
      for (const { d } of entries) {
        if (d === null) continue;
        expect(d.data.length).toBeGreaterThan(0);
        decoded++;
      }
      console.log(`[decode-all] ${name}: ${decoded}/${entries.length} decoded` +
        (legacyTex.length ? `; ${legacyTex.length} legacy Type-4 tolerated: ${legacyTex.join(", ")}` : ""));
    }, 1_200_000);

    it(`self round-trips a bounded sample per type in ${name}`, () => {
      const canonicalized: string[] = [];
      const testedByType = new Map<number, number>();
      const totalByType = new Map<number, number>();
      for (const { f, d: first } of entries) {
        if (first === null) continue;
        totalByType.set(first.type, (totalByType.get(first.type) ?? 0) + 1);
        if ((testedByType.get(first.type) ?? 0) >= SELF_CAP_PER_TYPE) continue;
        const second = decodeSqPackFile(encodeSqPackFile(first.data, first.type));
        if (!bytesEqual(first.data, second.data)) {
          // Type 4 encode re-derives mip sizes from the canonical formula (exactly as SE's
          // Tex.CompressTexFile does), so a texture whose stored mip tail is non-canonical is
          // canonicalized on re-encode — SE is non-idempotent here too. Tolerate ONLY when BOTH:
          // (1) one output is a byte-exact prefix of the other (content matches, differs only in the
          // trailing tail), AND (2) the re-decoded length equals the canonical formula-derived length.
          // (2) proves the difference is exactly mip-tail canonicalization and rules out an arbitrary
          // Type-4 encode truncation bug (which prefix-relation alone would mask). Any mid-content
          // divergence, a non-canonical re-decoded length, or any Type-2/3 mismatch is a hard failure.
          if (
            first.type === SqPackType.Texture &&
            isPrefixRelation(first.data, second.data) &&
            second.data.length === canonicalTexLength(second.data)
          ) {
            canonicalized.push(`${f.gamePath} (${first.data.length}->${second.data.length})`);
            testedByType.set(first.type, (testedByType.get(first.type) ?? 0) + 1);
            continue;
          }
          expect.fail(`self round-trip mismatch (type ${first.type}) for ${f.gamePath}: ` +
            `${first.data.length} vs ${second.data.length} bytes`);
        }
        testedByType.set(first.type, (testedByType.get(first.type) ?? 0) + 1);
      }
      for (const [type, total] of totalByType) {
        console.log(`[self round-trip] ${name}: type ${type} tested ${testedByType.get(type) ?? 0}/${total}`);
      }
      if (canonicalized.length) {
        console.log(`[self round-trip] ${name}: ${canonicalized.length} Type-4 mip-canonicalized (trailing-byte only): ${canonicalized.join(", ")}`);
      }
    }, 1_200_000);

    it(`matches /unwrap for every Type 2/3 entry in ${name}`, () => {
      const testedByType = new Map<number, number>();
      for (const { f, d: decoded } of entries) {
        if (decoded === null || decoded.type === SqPackType.Texture) continue; // /unwrap doesn't decompress Type 4
        // Content-addressed cache: a cache hit skips the ConsoleTools spawn (~436ms) entirely.
        // Policy: fail (don't skip) when we cannot verify — a null means the oracle output is neither
        // cached nor generable (TexTools absent), so we cannot cross-check and must fail loudly.
        const oracleOut = unwrapCached(f.data);
        if (oracleOut === null) {
          throw new Error(
            `cannot cross-check ${f.gamePath}: no cached /unwrap output and ConsoleTools unavailable`,
          );
        }
        expect(bytesEqual(decoded.data, oracleOut)).toBe(true);
        testedByType.set(decoded.type, (testedByType.get(decoded.type) ?? 0) + 1);
      }
      for (const [type, tested] of testedByType) {
        console.log(`[/unwrap] ${name}: type ${type} cross-checked ${tested}`);
      }
    }, 1_200_000);
  });
}
```

- [ ] **Step 6: Rewire the four existing files to delegate (still serial)**

Replace `test/sqpack-corpus.test.ts` ENTIRELY with:

```ts
import { describe, it } from "vitest";
import { corpusInputs, assertCorpusPresent } from "./helpers/oracle";
import { registerSqpackChecks } from "./helpers/corpus-sqpack";

const inputs = corpusInputs();

describe("sqpack corpus", () => {
  it("requires the local corpus (fails if test/corpus/inputs is empty)", () => {
    assertCorpusPresent(inputs);
  });
  for (const pack of inputs) registerSqpackChecks(pack);
});
```

Replace `test/mtrl-corpus.test.ts` ENTIRELY with:

```ts
import { describe, it } from "vitest";
import { corpusInputs, assertCorpusPresent } from "./helpers/oracle";
import { registerMtrlChecks } from "./helpers/corpus-mtrl";

const inputs = corpusInputs();

describe("mtrl corpus", () => {
  it("requires the local corpus (fails if test/corpus/inputs is empty)", () => {
    assertCorpusPresent(inputs);
  });
  for (const pack of inputs) registerMtrlChecks(pack);
});
```

Replace `test/golden.test.ts` ENTIRELY with:

```ts
import { describe, it } from "vitest";
import { corpusInputs, assertCorpusPresent } from "./helpers/oracle";
import { registerGoldenCheck } from "./helpers/corpus-golden";

const inputs = corpusInputs();

describe("corpus round-trip", () => {
  it("requires the local corpus (fails if test/corpus/inputs is empty)", () => {
    assertCorpusPresent(inputs);
  });
  for (const pack of inputs) registerGoldenCheck(pack);
});
```

In `test/pmp-manifest.test.ts`, replace ONLY the corpus `describe` block (the one titled `"pmp manifest round-trip (corpus)"`, from that `describe(` through its closing `});`) with a delegating version, and update the imports. The imports become:

```ts
import { describe, it, expect } from "vitest";
import { readPmp, writePmp } from "../src/container/pmp";
import { readZip, writeZip } from "../src/zip/zip";
import { corpusInputs, assertCorpusPresent } from "./helpers/oracle";
import { registerPmpManifestChecks } from "./helpers/corpus-pmp";
```
(`structurallyEqual` import is removed — it's now only used inside `corpus-pmp.ts`. Keep `enc`/`dec`, `makeImcPmp`, and the synthetic `describe("pmp manifest fidelity (Imc/Combining extras)")` block exactly as-is.)

Replace the corpus block with:

```ts
describe("pmp manifest round-trip (corpus)", () => {
  const pmps = corpusInputs().filter((p) => p.toLowerCase().endsWith(".pmp"));

  it("requires .pmp packs in the local corpus (fails if none present)", () => {
    assertCorpusPresent(pmps, ".pmp corpus inputs");
  });

  for (const pack of pmps) registerPmpManifestChecks(pack);
});
```

- [ ] **Step 7: Typecheck + full suite (behavior preserved, no perf change yet)**

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run` (timeout 300000)
Expected: same overall result as before — `241 passed | 1 skipped` (or a count that differs ONLY because per-pack checks are now nested under `... : <pack>` describes; the pass/skip status must be all-green). Confirm the per-pack console.log tags still appear once per pack: `[decode-all]`, `[self round-trip]`, `[/unwrap]`, `[mtrl]` for all 32 packs. Wall-clock stays ~111s (no parallelism yet).

- [ ] **Step 8: Commit**

```powershell
git add test/helpers/compare.ts test/helpers/corpus-sqpack.ts test/helpers/corpus-golden.ts test/helpers/corpus-mtrl.ts test/helpers/corpus-pmp.ts test/sqpack-corpus.test.ts test/mtrl-corpus.test.ts test/golden.test.ts test/pmp-manifest.test.ts
git commit -m "refactor(corpus): extract per-pack checks into shared registration helpers"
```

---

## Task 4: Flip to sharded parallel execution

Add `registerCorpusShard`, create the shard files, and delete/trim the monolithic corpus files. This is where the wall-clock drops.

**Files:**
- Modify: `test/helpers/corpus-shards.ts` (add `registerCorpusShard`)
- Modify: `test/corpus-shards.test.ts` (add the shard-file consistency meta-test)
- Create: `test/corpus-shard.00.test.ts` … `test/corpus-shard.15.test.ts` (16 files)
- Delete: `test/sqpack-corpus.test.ts`, `test/mtrl-corpus.test.ts`, `test/golden.test.ts`
- Modify: `test/pmp-manifest.test.ts` (remove the corpus round-trip block; keep the synthetic test)

**Interfaces:**
- Consumes: `shardOf`, `SHARD_COUNT` (Task 2); `registerSqpackChecks`, `registerGoldenCheck`, `registerMtrlChecks`, `registerPmpManifestChecks` (Task 3); `corpusInputs`, `assertCorpusPresent` (`./oracle`).
- Produces: `registerCorpusShard(shardIndex: number): void`.

- [ ] **Step 1: Add `registerCorpusShard` to `corpus-shards.ts`**

Append to `test/helpers/corpus-shards.ts` (and add the imports at the top):

```ts
import { describe, it } from "vitest";
import { corpusInputs, assertCorpusPresent } from "./oracle";
import { registerSqpackChecks } from "./corpus-sqpack";
import { registerGoldenCheck } from "./corpus-golden";
import { registerMtrlChecks } from "./corpus-mtrl";
import { registerPmpManifestChecks } from "./corpus-pmp";
```

```ts
/**
 * Register every corpus check for the packs assigned to `shardIndex`. Each test/corpus-shard.NN.test.ts
 * calls this with its index; Vitest runs those files in parallel across the worker pool. Every pack
 * runs the sqpack, golden round-trip, and mtrl checks; .pmp packs also run the manifest-fidelity check.
 * The corpus + .pmp guards run in every shard so a missing corpus fails loudly (fail-on-absent policy).
 */
export function registerCorpusShard(shardIndex: number): void {
  const inputs = corpusInputs();
  const packs = shardOf(inputs, SHARD_COUNT, shardIndex);
  describe(`corpus shard ${shardIndex}`, () => {
    it("requires the local corpus (fails if test/corpus/inputs is empty)", () => {
      assertCorpusPresent(inputs);
    });
    it("requires .pmp packs in the local corpus (fails if none present)", () => {
      assertCorpusPresent(inputs.filter((p) => p.toLowerCase().endsWith(".pmp")), ".pmp corpus inputs");
    });
    for (const pack of packs) {
      registerSqpackChecks(pack);
      registerGoldenCheck(pack);
      registerMtrlChecks(pack);
      if (pack.toLowerCase().endsWith(".pmp")) registerPmpManifestChecks(pack);
    }
  });
}
```

- [ ] **Step 2: Create the 16 shard files**

For each `N` in `00, 01, 02, …, 15`, create `test/corpus-shard.<N>.test.ts` containing exactly (with the integer index, no leading zero, in the call):

```ts
import { registerCorpusShard } from "./helpers/corpus-shards";

registerCorpusShard(0);
```

i.e. `corpus-shard.00.test.ts` → `registerCorpusShard(0)`, `corpus-shard.01.test.ts` → `registerCorpusShard(1)`, … `corpus-shard.15.test.ts` → `registerCorpusShard(15)`. Create all 16.

You can generate them in PowerShell:
```powershell
0..15 | ForEach-Object {
  $nn = '{0:D2}' -f $_
  "import { registerCorpusShard } from `"./helpers/corpus-shards`";`n`nregisterCorpusShard($_);`n" |
    Set-Content -Path "test/corpus-shard.$nn.test.ts" -NoNewline
}
```

- [ ] **Step 3: Add the shard-file consistency meta-test**

Now that the shard files exist, `SHARD_COUNT` derives to 16. Append a meta-test to `test/corpus-shards.test.ts` that makes the (unavoidable) shard-file boilerplate drift-proof: it fails loudly if the indices aren't contiguous `0..SHARD_COUNT-1`, or if any file calls `registerCorpusShard` with an index that doesn't match its own filename (the classic copy-paste-and-forget-to-bump footgun). Add these imports at the top of the file and append the `describe` block:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SHARD_COUNT } from "./helpers/corpus-shards";

describe("corpus shard files consistency", () => {
  const shardDir = __dirname; // test/
  const files = readdirSync(shardDir)
    .filter((f) => /^corpus-shard\.\d+\.test\.ts$/.test(f))
    .sort();

  it("shard files cover indices 0..SHARD_COUNT-1 with no gaps or duplicates", () => {
    expect(files.length).toBe(SHARD_COUNT);
    const indices = files
      .map((f) => Number(f.match(/^corpus-shard\.(\d+)\.test\.ts$/)![1]))
      .sort((a, b) => a - b);
    expect(indices).toEqual(Array.from({ length: SHARD_COUNT }, (_, i) => i));
  });

  it("each shard file calls registerCorpusShard with its own filename index", () => {
    for (const f of files) {
      const fileIdx = Number(f.match(/^corpus-shard\.(\d+)\.test\.ts$/)![1]);
      const src = readFileSync(join(shardDir, f), "utf8");
      const call = src.match(/registerCorpusShard\((\d+)\)/);
      expect(call, `${f} must call registerCorpusShard(<index>)`).not.toBeNull();
      expect(
        Number(call![1]),
        `${f} calls registerCorpusShard(${call![1]}) but its filename index is ${fileIdx}`,
      ).toBe(fileIdx);
    }
  });
});
```

Run: `npx vitest run test/corpus-shards.test.ts`
Expected: PASS (6 tests: the 4 `shardOf` tests + 2 consistency tests).

- [ ] **Step 4: Delete the now-empty monolithic corpus files**

```powershell
Remove-Item test/sqpack-corpus.test.ts, test/mtrl-corpus.test.ts, test/golden.test.ts
```

- [ ] **Step 5: Trim `test/pmp-manifest.test.ts` to the synthetic test only**

Remove the entire `describe("pmp manifest round-trip (corpus)", …)` block (added in Task 3 Step 6) and the now-unused imports. The file should end up as: the header imports (`describe, it, expect` from vitest; `readPmp, writePmp` from `../src/container/pmp`; `readZip, writeZip` from `../src/zip/zip`), `enc`/`dec`, `makeImcPmp`, and the single `describe("pmp manifest fidelity (Imc/Combining extras)")` block — nothing corpus-related. Remove the `corpusInputs`, `assertCorpusPresent`, and `registerPmpManifestChecks` imports.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean. (Confirms the deleted files left no dangling imports and the shard files resolve.)

- [ ] **Step 7: Baseline vs sharded wall-clock + correctness**

Record the pre-shard baseline you already know (~111s full suite). Then run sharded:

```powershell
$sw=[System.Diagnostics.Stopwatch]::StartNew(); npx vitest run 2>&1 | Tee-Object -FilePath "$env:TEMP\shard-run.log" | Select-Object -Last 6; $sw.Stop(); "SHARDED full suite: $([math]::Round($sw.Elapsed.TotalSeconds,1))s"
```
Expected:
- All green (no failures). The pass count changes (per-shard guards + nested describes) but there must be 0 failures and only the 1 pre-existing skip.
- Wall-clock materially lower — target ~15–25s (down from ~111s).
- Confirm every pack's checks ran exactly once by counting the console.log tags in the log:
```powershell
foreach ($tag in '[decode-all]','[self round-trip]','[mtrl]') {
  $n = (Select-String -Path "$env:TEMP\shard-run.log" -Pattern ([regex]::Escape($tag)) -AllMatches | Measure-Object).Count
  "$tag lines: $n"
}
```
Expected: `[decode-all]` and `[mtrl]` each appear 32 times (once per pack); `[self round-trip]` appears once per type per pack (≥32).

- [ ] **Step 8: Confirm the oracle cache is untouched (no new spawns) and it survived concurrent access**

```powershell
(Get-ChildItem test\corpus\.oracle-cache -Filter *.bin | Measure-Object).Count
(Get-ChildItem test\corpus\.oracle-cache -Filter *.tmp | Measure-Object).Count
```
Expected: `.bin` count unchanged at `691`; `.tmp` count `0` (no residue from concurrent writers). Nothing under `test/corpus/` is staged in git.

- [ ] **Step 9: Confirm adaptivity — it scales down on fewer workers**

```powershell
$sw=[System.Diagnostics.Stopwatch]::StartNew(); npx vitest run --maxWorkers=2 2>&1 | Select-Object -Last 3; $sw.Stop(); "SHARDED @ maxWorkers=2: $([math]::Round($sw.Elapsed.TotalSeconds,1))s"
```
Expected: still all green; wall-clock noticeably HIGHER than the default run (fewer workers → less parallelism) but well below the ~111s serial baseline — demonstrating the pool throttles to the available workers while the shards still parallelize what they can.

- [ ] **Step 10: Commit**

```powershell
git add test/helpers/corpus-shards.ts test/corpus-shards.test.ts test/corpus-shard.*.test.ts test/pmp-manifest.test.ts
git add -u   # stage the three deletions
git commit -m "perf(test): shard corpus checks across parallel files (~111s -> ~20s)"
```

---

## Notes

- **Adaptivity:** parallelism scales with Vitest's worker pool, which auto-sizes to host CPUs. The ceiling is the shard-file count (`SHARD_COUNT`, derived from the 16 files); the pool throttles down on fewer cores (Step 9 demonstrates this). Wall-clock is floored by the single heaviest pack (a pack can't be split across workers), which ~8 shards already reach — 16 gives headroom without codegen or host-derived shard counts.
- **Why files (and the meta-test):** Vitest's unit of parallelism is the test file, so N files are unavoidable for file-level parallelism; codegen or worker_threads-in-one-file were rejected (fragile / loses per-test reporting / still needs the same cache fix). The 16 two-line files are the minimum. Deriving `SHARD_COUNT` from them + the `corpus-shards.test.ts` meta-test make that boilerplate the single source of truth and drift-proof: to change parallelism, copy a shard file and bump its index — the meta-test fails loudly on gaps, duplicates, or an index that doesn't match its filename.
- **Memory:** N workers each hold ~one pack's decoded data (balanced sharding + the sqpack `afterAll` release keep it to one pack per worker). If a big host auto-scales to many workers and memory spikes, cap with `--maxWorkers=<n>` — a runtime flag, no code change, preserving core-adaptivity elsewhere.
- **Cache concurrency:** Task 1 makes `oracleCachePut` safe for the concurrent writers this introduces (unique temp name + atomic rename; content-addressed keys mean identical-payload races converge). On a *cold* cache, shards spawn multiple ConsoleTools processes at once — fine, just more load; a non-issue on the warm operator machine.
- **`mtrl-corpus` was included** (not just sqpack/golden/pmp) so every corpus check flows through one consistent sharded path — no corpus file left on the old monolithic pattern.

---

## Self-Review

- **Requirement coverage:** cache concurrency safety (Task 1); balanced deterministic sharding primitive with tests (Task 2); faithful extraction of all four corpus files' per-pack logic, proven green while still serial (Task 3); shard files + derived `SHARD_COUNT` + drift-proof meta-test + `registerCorpusShard` + deletion/trim of monoliths, with speedup + cache-integrity + adaptivity verification (Task 4). Fail-on-absent guards (corpus + `.pmp`) preserved in every shard. `src/` untouched; no new deps. ✓
- **Placeholder scan:** none — full file contents for all new helpers and shard files; exact edits and commands with expected output. The only "move verbatim" is Task 3's rewire of `pmp-manifest.test.ts`, which specifies exactly which block to replace and what to keep. ✓
- **Type consistency:** `registerSqpackChecks`/`registerGoldenCheck`/`registerMtrlChecks`/`registerPmpManifestChecks` all take `(pack: string): void` and are used with that signature in `registerCorpusShard`; `shardOf(inputs, shardCount, shardIndex)` and `SHARD_COUNT` match between Task 2 and Task 4; exported `bytesEqual` from `compare.ts` is consumed by `corpus-sqpack.ts` and `corpus-mtrl.ts`; `oracleCachePut` signature unchanged. ✓
