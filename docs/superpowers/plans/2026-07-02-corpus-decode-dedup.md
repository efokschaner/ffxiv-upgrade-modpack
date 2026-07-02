# Corpus Decode Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decode each corpus pack once (not three times) in `test/sqpack-corpus.test.ts` by sharing the decode via a per-pack `describe` + `beforeAll`, cutting ~40–60s of redundant read/parse/decode off the warm corpus run.

**Architecture:** Today the three `it` blocks per pack each call `compressedFiles(path)` (read + `loadModpack`) and re-decode every inner file. Restructure so each pack gets its own nested `describe(name)` with a `beforeAll` that reads, parses, and decodes once into a shared `PackEntry[]` (`{ f, d }` pairs); the three `it`s consume that shared array. An `afterAll` releases the array so per-pack memory doesn't accumulate across all 32 packs. This is a pure, behavior-preserving refactor: identical assertions, identical test count (97), identical pass/normalize outcomes.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest 1.6, Node built-ins only. No new dependencies.

## Global Constraints

- **Behavior-preserving refactor.** Same assertions, same 97 tests (1 corpus guard + 3 per pack × 32 packs), same exact/normalized outcomes. Do NOT change what is asserted — only how many times decoding happens.
- **No new dependencies.** Node built-ins only.
- **No per-file license headers** (consolidated to repo root; see commit `a144bd2`).
- **`src/` must NOT change.** Only `test/sqpack-corpus.test.ts` changes.
- **Oracle cache unaffected.** The content-addressed `/unwrap` cache count must stay at its current value (691 `.bin` files) after the run — no new `ConsoleTools` spawns; the refactor must not change which entries are cross-checked.
- **Fail-on-absent policy stays.** The `assertCorpusPresent(inputs)` guard test and the `/unwrap` throw-on-null both remain exactly as they are today.
- **Memory must not regress.** Peak decoded-data memory stays at ~one pack (as today), via `afterAll` releasing each pack's `entries`. A single `beforeAll` for ALL packs would hold every pack's decoded data at once (multi-GB) — do not do that.
- **TypeScript strict / `noUncheckedIndexedAccess`** — `npm run typecheck` must be clean.
- **Windows / PowerShell** dev environment; `npx vitest` runs need an explicit large timeout (the file is CPU-bound ~100–150s, well past the 120s PowerShell default).

---

## File Structure

- `test/sqpack-corpus.test.ts` (modify — full-file replacement) — same helpers and constants; the `describe("sqpack corpus")` body changes so each pack is a nested `describe(name)` with `beforeAll` (decode once) + `afterAll` (release) + the three existing `it`s reading a shared `PackEntry[]`.

No other files change. No `src/` changes. No new test files.

---

## Task 1: Dedup per-pack decode via `beforeAll`

**Files:**
- Modify: `test/sqpack-corpus.test.ts` (full-file replacement — content below)

**Interfaces:**
- Consumes (all already exported/present, unchanged): `corpusInputs`, `unwrapCached`, `assertCorpusPresent` (`test/helpers/oracle.ts`); `loadModpack` (`src/index`); `allFiles`, `FileStorageType`, `ModpackFile` (`src/model/modpack`); `decodeSqPackFile`, `encodeSqPackFile`, `SqPackType`, `DecodedFile` (`src/sqpack/sqpack`); `texMipSizes` (`src/sqpack/type4`).
- Produces: nothing new — internal test restructure only.

- [ ] **Step 1: Capture a baseline warm timing (before any change)**

The cache is already warm (691 `.bin` files), so this is a fair before-measurement.

Run:
```powershell
$sw=[System.Diagnostics.Stopwatch]::StartNew(); npx vitest run test/sqpack-corpus.test.ts 2>&1 | Select-Object -Last 4; $sw.Stop(); "BASELINE sqpack-corpus warm: $([math]::Round($sw.Elapsed.TotalSeconds,1))s"
```
Expected: `97 passed` (or `97/97`), wall-clock roughly ~145–156s. Record the number.

Also record the cache count (must be unchanged by the whole task):
```powershell
(Get-ChildItem test\corpus\.oracle-cache -Filter *.bin | Measure-Object).Count
```
Expected: `691`.

- [ ] **Step 2: Replace `test/sqpack-corpus.test.ts` with the deduped version**

Replace the ENTIRE file with exactly this content:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadModpack } from "../src/index";
import { allFiles, FileStorageType, type ModpackFile } from "../src/model/modpack";
import { decodeSqPackFile, encodeSqPackFile, SqPackType, type DecodedFile } from "../src/sqpack/sqpack";
import { texMipSizes } from "../src/sqpack/type4";
import { corpusInputs, unwrapCached, assertCorpusPresent } from "./helpers/oracle";

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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

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

const inputs = corpusInputs();

describe("sqpack corpus", () => {
  it("requires the local corpus (fails if test/corpus/inputs is empty)", () => {
    assertCorpusPresent(inputs);
  });

  for (const path of inputs) {
    const name = basename(path);

    // Each pack is read, parsed, and decoded exactly ONCE here; the three checks below share the
    // result instead of repeating that work three times. A Type-2/3 decode failure throws in this
    // hook, which fails all three of the pack's checks — a hard error, exactly as intended.
    describe(name, () => {
      let entries: PackEntry[] = [];
      const legacyTex: string[] = [];

      beforeAll(() => {
        entries = compressedFiles(path).map((f) => ({ f, d: decodeTolerant(f, legacyTex) }));
      }, 1_200_000);

      // Release this pack's decoded data once its checks finish. Vitest retains the describe closures
      // for the whole file run, so without this the decoded data for all 32 packs would accumulate
      // (multi-GB). Clearing the reference keeps peak memory at ~one pack, matching the pre-refactor code.
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
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Confirms `beforeAll`/`afterAll` imports resolve, `PackEntry` typing is sound, and destructuring `{ f, d: first }` / `{ d }` satisfies strict mode.)

- [ ] **Step 4: Run the file — behavior preserved + faster**

Run:
```powershell
$sw=[System.Diagnostics.Stopwatch]::StartNew(); npx vitest run test/sqpack-corpus.test.ts 2>&1 | Select-Object -Last 6; $sw.Stop(); "DEDUP sqpack-corpus warm: $([math]::Round($sw.Elapsed.TotalSeconds,1))s"
```
Expected:
- `97 passed` — SAME test count and all passing (1 guard + 3 × 32 packs). If the count differs from 97, the restructure changed the test tree — stop and investigate.
- Wall-clock materially lower than Step 1's baseline (target roughly ~90–110s vs ~150s; the exact figure depends on the machine, but it must be clearly lower since two of the three decode passes are gone).
- The per-pack `[decode-all]` / `[self round-trip]` / `[/unwrap]` log lines still appear with the same shape.

- [ ] **Step 5: Confirm the oracle cache is untouched (no new spawns, coverage unchanged)**

Run:
```powershell
(Get-ChildItem test\corpus\.oracle-cache -Filter *.bin | Measure-Object).Count
```
Expected: `691` — unchanged from Step 1. (Proves the `/unwrap` cross-check still hits the same entries from cache and spawned nothing new.)

- [ ] **Step 6: Confirm the full suite is still green and `src/` untouched**

Run:
```powershell
git status --short
```
Expected: only `test/sqpack-corpus.test.ts` modified; nothing under `src/`, nothing under `test/corpus/`.

Run the full suite once to confirm no cross-file regression:
```powershell
npx vitest run 2>&1 | Select-Object -Last 4
```
Expected: `241 passed | 1 skipped` (the 1 skip is pre-existing), same as before the refactor.

- [ ] **Step 7: Commit**

```powershell
git add test/sqpack-corpus.test.ts
git commit -m "perf(test): decode each corpus pack once via per-pack beforeAll (dedup 3 passes)"
```

---

## Notes

- **Why `afterAll` matters:** Vitest builds the whole task tree up front (the `for` loop defines all 32 nested `describe`s at collection time) and keeps the describe/test closures alive for the run. Each closure captures its own `entries`. Without `afterAll` clearing it, all 32 packs' decoded arrays stay referenced simultaneously — multi-GB. Clearing the reference after each pack's tests keeps peak memory at ~one pack, matching the pre-refactor profile (where each `it` created and dropped its own decode).
- **Why a hook failure is acceptable:** a Type-2/3 decode failure throws inside `beforeAll`, which Vitest reports as the pack's hook failing (and its three `it`s not passing). That is the correct hard-error behavior — the old code threw inside each `it` for the same case. The reporting shape differs slightly (hook vs test), but a genuine Type-2/3 decode failure still turns the run red.
- **What is NOT deduped:** the self-round-trip's re-encode (`encodeSqPackFile`) is genuine per-sample work and stays in its `it` (it is not part of the shared one-time decode). This refactor removes the redundant *decode/read/parse*, not the encode.

---

## Self-Review

- **Spec coverage:** the single task performs the whole refactor (read/parse/decode once via `beforeAll`), preserves every assertion verbatim, keeps the guard test and `/unwrap` throw, adds `afterAll` for memory, and verifies test count (97), timing improvement, cache stability (691), `src/` untouched, and full-suite green. ✓
- **Placeholder scan:** none — the full file content is given verbatim, including all long explanatory comments; every command has expected output. ✓
- **Type consistency:** `PackEntry { f: ModpackFile; d: DecodedFile | null }` is used consistently in `beforeAll` (constructing `{ f, d: decodeTolerant(...) }`) and in all three `it`s (destructuring `{ d }`, `{ f, d: first }`, `{ f, d: decoded }`). Imports add `beforeAll`, `afterAll`; `SELF_CAP_PER_TYPE`, `bytesEqual`, `isPrefixRelation`, `canonicalTexLength`, `decodeTolerant`, `compressedFiles`, `entryType` are unchanged. ✓
