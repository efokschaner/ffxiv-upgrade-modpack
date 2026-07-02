# Oracle /unwrap Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache ConsoleTools `/unwrap` outputs across test runs, keyed by a content hash of the input entry, so warm corpus runs skip the ~65s of `.NET` process spawns.

**Architecture:** `/unwrap(entry) → decompressed bytes` is a pure, deterministic function of the entry bytes. Add a content-addressed disk cache in `test/helpers/oracle.ts`: on lookup, hash the entry (`sha256`), return the cached output if present; otherwise, if ConsoleTools is available, spawn it once, store the output under the hash, and return it; if unavailable and uncached, return `null` so the caller skips that entry. `test/sqpack-corpus.test.ts` is rewired to go through this cache instead of spawning directly. The cache lives under the already-gitignored `test/corpus/` tree, so nothing is committed.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest 1.6, Node built-ins only (`node:crypto`, `node:fs`, `node:os`, `node:path`). No new dependencies.

## Global Constraints

- **No new dependencies.** Use Node built-ins only (`node:crypto` for `sha256`). If a dependency were ever needed, install from the frozen lockfile with a 7-day minimum package age (`--min-release-age`); this plan needs none.
- **No per-file license headers.** Consolidated to the repo root (see commit `a144bd2`). Do not add GPL headers to new files.
- **Content-addressed keys only.** The cache key is `sha256(entry)`. Never key on pack name or `gamePath` — a pack may hold the same `gamePath` in multiple options with different payloads, and only a content hash self-invalidates when the reader changes its slicing.
- **Cache location:** `test/corpus/.oracle-cache/`. This is inside the gitignored `/test/corpus/` path (`.gitignore:20`), so it is never committed; no `.gitignore` change is required.
- **Windows / PowerShell** dev environment. Commands below are shown for PowerShell.
- **Preserve existing coverage.** The rewired corpus test must cross-check the same samples it does today (the `ORACLE_CAP_PER_TYPE = 3` cap stays in the core tasks; Task 4 is an optional, separate coverage bump).

---

## File Structure

- `test/helpers/oracle.ts` (modify) — add the content-addressed cache primitives (`oracleKey`, `oracleCacheGet`, `oracleCachePut`) and the cached wrapper `unwrapCached`. Keep the existing `unwrap(src, dest)` exported unchanged (`sqpack-oracle-wiring.test.ts` asserts it stays a function).
- `test/oracle-cache.test.ts` (create) — fast, oracle-free unit tests for the cache primitives and `unwrapCached`'s cache/skip logic, using an injectable `produce` callback and a temp cache dir.
- `test/sqpack-corpus.test.ts` (modify) — replace the manual `writeFileSync` + `unwrap` + `readFileSync` dance in the `/unwrap` test with a single `unwrapCached(f.data)` call; handle per-entry cache misses gracefully.

---

## Task 1: Cache primitives in `oracle.ts`

Add three pure-ish helpers: a content hash key, a cache reader, and a cache writer (atomic via temp-file + rename). These are oracle-free and fully unit-testable.

**Files:**
- Modify: `test/helpers/oracle.ts`
- Test: `test/oracle-cache.test.ts` (create)

**Interfaces:**
- Consumes: nothing new (Node built-ins).
- Produces:
  - `oracleKey(entry: Uint8Array): string` — lowercase hex `sha256` of the entry bytes.
  - `oracleCacheGet(key: string, dir?: string): Uint8Array | null` — returns the cached bytes for `key`, or `null` on miss. `dir` defaults to `DEFAULT_ORACLE_CACHE`.
  - `oracleCachePut(key: string, data: Uint8Array, dir?: string): void` — writes `data` under `key` atomically (temp file then `renameSync`); creates `dir` if missing.
  - `DEFAULT_ORACLE_CACHE: string` — `join(__dirname, "..", "corpus", ".oracle-cache")`.

- [ ] **Step 1: Write the failing test**

Create `test/oracle-cache.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oracleKey, oracleCacheGet, oracleCachePut } from "./helpers/oracle";

describe("oracle cache primitives", () => {
  it("oracleKey is a stable 64-char hex sha256 that differs by content", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    const c = new Uint8Array([1, 2, 4]);
    expect(oracleKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(oracleKey(a)).toBe(oracleKey(b));
    expect(oracleKey(a)).not.toBe(oracleKey(c));
  });

  it("get returns null on miss and the exact bytes after put", () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-"));
    const key = "deadbeef";
    expect(oracleCacheGet(key, dir)).toBeNull();
    const data = new Uint8Array([9, 8, 7, 6]);
    oracleCachePut(key, data, dir);
    const got = oracleCacheGet(key, dir);
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual([9, 8, 7, 6]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/oracle-cache.test.ts`
Expected: FAIL — `oracleKey`/`oracleCacheGet`/`oracleCachePut` are not exported from `./helpers/oracle`.

- [ ] **Step 3: Write minimal implementation**

In `test/helpers/oracle.ts`, extend the imports and add the primitives. Change the top imports from:

```ts
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";
```

to:

```ts
import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
```

Then add, near the other path constants (after `GOLDEN_UPGRADE`):

```ts
/** Content-addressed cache of ConsoleTools /unwrap outputs. Lives inside the gitignored
 * test/corpus/ tree (see .gitignore) so it is never committed. Keyed by sha256(entry). */
const DEFAULT_ORACLE_CACHE = join(__dirname, "..", "corpus", ".oracle-cache");

/** Lowercase hex sha256 of an entry blob. Same input ⇒ same key, so identical payloads
 * (common across multi-option packs) dedupe to one cache file and one ConsoleTools call. */
export function oracleKey(entry: Uint8Array): string {
  return createHash("sha256").update(entry).digest("hex");
}

/** Cached /unwrap output for `key`, or null on miss. */
export function oracleCacheGet(key: string, dir: string = DEFAULT_ORACLE_CACHE): Uint8Array | null {
  const p = join(dir, `${key}.bin`);
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
}

/** Store `data` under `key`, atomically (temp file + rename) so an interrupted run never
 * leaves a half-written cache entry that a later run would trust. */
export function oracleCachePut(key: string, data: Uint8Array, dir: string = DEFAULT_ORACLE_CACHE): void {
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, `${key}.bin`);
  const tmpPath = join(dir, `${key}.bin.tmp`);
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, finalPath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/oracle-cache.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```powershell
git add test/helpers/oracle.ts test/oracle-cache.test.ts
git commit -m "feat(oracle): content-addressed cache primitives for /unwrap"
```

---

## Task 2: `unwrapCached` wrapper in `oracle.ts`

Add the cached wrapper the corpus test will call. It reads the cache first; on a miss it spawns ConsoleTools (when available) and stores the result; on a miss with no oracle it returns `null`. The oracle availability and the spawn are injectable so the branch logic is unit-testable without TexTools installed.

**Files:**
- Modify: `test/helpers/oracle.ts`
- Test: `test/oracle-cache.test.ts`

**Interfaces:**
- Consumes: `oracleKey`, `oracleCacheGet`, `oracleCachePut`, `DEFAULT_ORACLE_CACHE` (Task 1); existing `unwrap(src, dest)` and `oracleAvailable()`.
- Produces:
  - `unwrapCached(entry, opts?): Uint8Array | null` where
    `opts: { dir?: string; available?: boolean; produce?: (entry: Uint8Array) => Uint8Array }`.
    Returns the unwrapped bytes (from cache or freshly produced), or `null` when the entry is uncached and no producer is available. Defaults: `dir = DEFAULT_ORACLE_CACHE`, `available = oracleAvailable()`, `produce = unwrapViaConsoleTools`.

- [ ] **Step 1: Write the failing test**

Append to `test/oracle-cache.test.ts`:

```ts
import { unwrapCached } from "./helpers/oracle";

describe("unwrapCached", () => {
  it("returns null on a cache miss when no oracle is available", () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-"));
    const entry = new Uint8Array([1, 1, 2, 3, 5]);
    expect(unwrapCached(entry, { dir, available: false })).toBeNull();
  });

  it("produces once on miss, stores it, then serves from cache without re-producing", () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-"));
    const entry = new Uint8Array([10, 20, 30]);
    const out = new Uint8Array([42, 42]);
    let calls = 0;
    const produce = () => { calls++; return out; };

    const first = unwrapCached(entry, { dir, available: true, produce });
    expect(Array.from(first!)).toEqual([42, 42]);
    expect(calls).toBe(1);

    // Second call: cache hit, producer must NOT run again (even if still "available").
    const second = unwrapCached(entry, { dir, available: true, produce });
    expect(Array.from(second!)).toEqual([42, 42]);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/oracle-cache.test.ts`
Expected: FAIL — `unwrapCached` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `test/helpers/oracle.ts`, add imports for the temp-file dance (extend the `node:fs` import to include `mkdtempSync` and add `tmpdir`), then add the internal producer and the wrapper. Update the `node:fs` import line to:

```ts
import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, renameSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
```

Add near the existing `unwrap` definition:

```ts
/** Per-process scratch dir for the /unwrap file dance. Each Vitest worker imports this module
 * separately, so each gets its own dir — no cross-worker collision. Created lazily. */
let ORACLE_TMP: string | null = null;
function oracleTmpDir(): string {
  if (ORACLE_TMP === null) ORACLE_TMP = mkdtempSync(join(tmpdir(), "oracle-"));
  return ORACLE_TMP;
}

/** Run the real ConsoleTools /unwrap on an in-memory entry, returning the raw bytes. */
function unwrapViaConsoleTools(entry: Uint8Array): Uint8Array {
  const dir = oracleTmpDir();
  const inPath = join(dir, "entry.bin");
  const outPath = join(dir, "unwrapped.bin");
  writeFileSync(inPath, entry);
  unwrap(inPath, outPath);
  return new Uint8Array(readFileSync(outPath));
}

/**
 * Cached /unwrap: returns the decompressed bytes for `entry`, spawning ConsoleTools at most
 * once per distinct entry across all runs. Cache hits skip the process spawn entirely (~436ms
 * each). Returns null only when the entry is uncached AND no producer is available (no TexTools),
 * so callers can skip that sample. `opts.available`/`opts.produce` exist for unit testing.
 */
export function unwrapCached(
  entry: Uint8Array,
  opts: { dir?: string; available?: boolean; produce?: (entry: Uint8Array) => Uint8Array } = {},
): Uint8Array | null {
  const dir = opts.dir ?? DEFAULT_ORACLE_CACHE;
  const key = oracleKey(entry);
  const hit = oracleCacheGet(key, dir);
  if (hit !== null) return hit;
  const available = opts.available ?? oracleAvailable();
  if (!available) return null;
  const produce = opts.produce ?? unwrapViaConsoleTools;
  const out = produce(entry);
  oracleCachePut(key, out, dir);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/oracle-cache.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```powershell
git add test/helpers/oracle.ts test/oracle-cache.test.ts
git commit -m "feat(oracle): unwrapCached wrapper with populate-on-miss + skip-when-unavailable"
```

---

## Task 3: Rewire `sqpack-corpus.test.ts` through the cache

Replace the manual temp-file `/unwrap` in the corpus cross-check with `unwrapCached(f.data)`. Keep the exact same sampling (`ORACLE_CAP_PER_TYPE = 3`). Handle a per-entry `null` (no oracle + cache miss) by skipping that sample and logging the count, so the test is meaningful whether it runs cold (populating), warm (cache), or on a machine with neither.

**Files:**
- Modify: `test/sqpack-corpus.test.ts`

**Interfaces:**
- Consumes: `unwrapCached` (Task 2), `corpusInputs` (existing).
- Produces: nothing new.

- [ ] **Step 1: Update imports**

At the top of `test/sqpack-corpus.test.ts`, change:

```ts
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
```

to (drop the now-unused `writeFileSync`, `mkdtempSync`, `tmpdir`, and `join`; keep `readFileSync` and `basename`):

```ts
import { readFileSync } from "node:fs";
import { basename } from "node:path";
```

And change:

```ts
import { oracleAvailable, corpusInputs, unwrap } from "./helpers/oracle";
```

to (drop `oracleAvailable` and `unwrap`, add `unwrapCached`):

```ts
import { corpusInputs, unwrapCached } from "./helpers/oracle";
```

- [ ] **Step 2: Remove the per-describe temp dir**

Inside the `describe.skipIf(inputs.length === 0)("sqpack corpus", () => { ... })` body, delete this line (it was only used by the old `/unwrap` I/O):

```ts
  const tmp = mkdtempSync(join(tmpdir(), "sqpack-"));
```

- [ ] **Step 3: Replace the `/unwrap` test body**

Replace the entire third `it` block. Change from:

```ts
    it.skipIf(!oracleAvailable())(`matches /unwrap for a bounded Type 2/3 sample in ${name}`, () => {
      const files = compressedFiles(path);
      const legacyTex: string[] = [];
      const testedByType = new Map<number, number>();
      for (const f of files) {
        const decoded = decodeTolerant(f, legacyTex);
        if (decoded === null || decoded.type === SqPackType.Texture) continue; // /unwrap doesn't decompress Type 4
        if ((testedByType.get(decoded.type) ?? 0) >= ORACLE_CAP_PER_TYPE) continue;
        const inPath = join(tmp, "entry.bin");
        const outPath = join(tmp, "unwrapped.bin");
        writeFileSync(inPath, f.data);
        unwrap(inPath, outPath);
        expect(bytesEqual(decoded.data, new Uint8Array(readFileSync(outPath)))).toBe(true);
        testedByType.set(decoded.type, (testedByType.get(decoded.type) ?? 0) + 1);
      }
      for (const [type, tested] of testedByType) {
        console.log(`[/unwrap] ${name}: type ${type} cross-checked ${tested}`);
      }
    }, 1_200_000);
```

to:

```ts
    it(`matches /unwrap for a bounded Type 2/3 sample in ${name}`, () => {
      const files = compressedFiles(path);
      const legacyTex: string[] = [];
      const testedByType = new Map<number, number>();
      let skipped = 0;
      for (const f of files) {
        const decoded = decodeTolerant(f, legacyTex);
        if (decoded === null || decoded.type === SqPackType.Texture) continue; // /unwrap doesn't decompress Type 4
        if ((testedByType.get(decoded.type) ?? 0) >= ORACLE_CAP_PER_TYPE) continue;
        // Content-addressed cache: a cache hit skips the ConsoleTools spawn (~436ms) entirely.
        // null ⇒ uncached AND no oracle to generate it (e.g. TexTools not installed) ⇒ skip sample.
        const oracleOut = unwrapCached(f.data);
        if (oracleOut === null) { skipped++; continue; }
        expect(bytesEqual(decoded.data, oracleOut)).toBe(true);
        testedByType.set(decoded.type, (testedByType.get(decoded.type) ?? 0) + 1);
      }
      for (const [type, tested] of testedByType) {
        console.log(`[/unwrap] ${name}: type ${type} cross-checked ${tested}`);
      }
      if (skipped) console.log(`[/unwrap] ${name}: ${skipped} sample(s) skipped (no oracle + cache miss)`);
    }, 1_200_000);
```

- [ ] **Step 4: Verify types and the fast unit tests still pass**

Run: `npm run typecheck`
Expected: no errors (confirms no dangling references to the removed imports/`tmp`).

Run: `npx vitest run test/oracle-cache.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Cold run — populate the cache and confirm correctness**

Run (this spawns ConsoleTools on misses and writes the cache):

```powershell
npx vitest run test/sqpack-corpus.test.ts
```

Expected: PASS. `test/corpus/.oracle-cache/` now contains `<sha256>.bin` files. Confirm it populated:

```powershell
(Get-ChildItem test\corpus\.oracle-cache -Filter *.bin | Measure-Object).Count
```

Expected: a non-zero count (roughly the number of distinct sampled Type 2/3 entries; ~140 on the reference 32-pack corpus, fewer if identical payloads deduped).

- [ ] **Step 6: Warm run — confirm the speedup**

Run and time it:

```powershell
$sw=[System.Diagnostics.Stopwatch]::StartNew(); npx vitest run test/sqpack-corpus.test.ts 2>&1 | Out-Null; $sw.Stop(); "warm: $($sw.Elapsed.TotalSeconds)s"
```

Expected: PASS, and the wall-clock is materially lower than the cold run — the `/unwrap` cross-check portion (~94s of the file previously) drops to cache reads. No ConsoleTools processes are spawned on this run.

- [ ] **Step 7: Commit**

```powershell
git add test/sqpack-corpus.test.ts
git commit -m "perf(test): route corpus /unwrap cross-check through content-addressed cache"
```

---

## Task 4 (OPTIONAL): Raise oracle coverage now that warm runs are cheap

With caching, the marginal cost of an already-cached cross-check is a disk read, so the `ORACLE_CAP_PER_TYPE` cap now only bounds *cold-generation* cost. Optionally raise it to cross-check every Type 2/3 entry. This makes the *first* run after a corpus change slower (more spawns to populate) but every subsequent run stays fast, at strictly higher coverage. Skip this task if you prefer to keep first-run cost bounded.

**Files:**
- Modify: `test/sqpack-corpus.test.ts`

**Interfaces:** unchanged.

- [ ] **Step 1: Remove the per-type oracle cap**

In the `/unwrap` test body from Task 3, delete this line:

```ts
        if ((testedByType.get(decoded.type) ?? 0) >= ORACLE_CAP_PER_TYPE) continue;
```

Then remove the now-unused constant near the top of the file:

```ts
const ORACLE_CAP_PER_TYPE = 3;  // /unwrap cross-check cap per type per pack
```

(Leave `SELF_CAP_PER_TYPE` untouched — it caps the CPU-bound re-encode, which is not cached.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors (no remaining references to `ORACLE_CAP_PER_TYPE`).

- [ ] **Step 3: Cold run to populate the widened set, then confirm warm speed**

```powershell
npx vitest run test/sqpack-corpus.test.ts
$sw=[System.Diagnostics.Stopwatch]::StartNew(); npx vitest run test/sqpack-corpus.test.ts 2>&1 | Out-Null; $sw.Stop(); "warm: $($sw.Elapsed.TotalSeconds)s"
```

Expected: both PASS; the warm run is still fast (all cross-checks served from cache) while cross-checking every Type 2/3 entry rather than 3 per type per pack.

- [ ] **Step 4: Commit**

```powershell
git add test/sqpack-corpus.test.ts
git commit -m "test(oracle): cross-check every Type 2/3 entry (cache makes warm runs cheap)"
```

---

## Notes & Operational Guidance

- **Invalidation is automatic.** The key is `sha256(entry)`. If the reader ever slices entries differently, the bytes change, the key changes, and stale outputs are simply never read (cold misses regenerate them where TexTools is present). Changing your *codec* (`decodeSqPackFile`) does **not** invalidate the cache — that is intended: the cached ConsoleTools output stays as independent ground truth to compare your new decode against.
- **Clearing the cache** (if ever desired): `Remove-Item -Recurse -Force test\corpus\.oracle-cache`. Orphaned entries from an old reader are harmless (just disk); this only reclaims space or forces full regeneration.
- **Not committed.** The cache is under the gitignored `/test/corpus/` path, matching the corpus itself (user-provided, local-only). No `.gitignore` edit is needed; do not commit `.oracle-cache`.
- **Out of scope:** the `/wrap` + `/extract` bridge in `test/sqpack-type4-oracle.test.ts` is game-version-sensitive (it extracts from the installed game), so it is intentionally not cached here.

---

## Self-Review

- **Requirement coverage:** cache keyed by content hash (Task 1); populate-on-miss / skip-when-unavailable (Task 2); corpus test rewired with identical sampling (Task 3); optional coverage bump kept separate (Task 4); gitignored location and no-new-deps honored (Global Constraints). ✓
- **Placeholders:** none — every code and command step is concrete. ✓
- **Type consistency:** `oracleKey`/`oracleCacheGet`/`oracleCachePut`/`DEFAULT_ORACLE_CACHE`/`unwrapCached` names and signatures are identical across Tasks 1–3; `unwrapCached` returns `Uint8Array | null` and callers handle `null`. The existing `unwrap(src, dest)` remains exported for `sqpack-oracle-wiring.test.ts`. ✓
