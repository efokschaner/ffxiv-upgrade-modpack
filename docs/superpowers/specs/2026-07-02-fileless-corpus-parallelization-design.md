# Fileless Corpus Test Parallelization — Design

**Date:** 2026-07-02
**Status:** Design approved (brainstorming complete) — ready for implementation planning
**Supersedes:** Task 4 of the (now-completed, history-only) `plans/2026-07-02-corpus-parallelization.md` — the 16 hand-/generated shard files + `SHARD_COUNT` meta-test. Tasks 1–3 of that plan were **kept** and reused: oracle cache concurrency fix; the four `registerXChecks` helpers; exported `bytesEqual`.

---

## 1. Goal

Parallelize the corpus test suite across CPU cores **without maintaining any per-shard test files**, and drop the warm wall-clock as far as the corpus's structure allows. Concretely: replace the file-per-shard model with **runtime-generated, fileless parallel work units** driven through the Vitest 4 Node API, where the work unit is a single **(pack × check-family)** pair. The Vitest worker pool schedules those units dynamically, so the wall-clock floor becomes the single longest unit rather than the single heaviest whole pack.

### Why this exists (measured motivation)

The previous approach (Task 4: 16 static shard files, one balanced slice of *whole packs* per file) was implemented and verified green, but measured **~72s warm** on a 16-core host — far from the plan's ~15–20s target. Root cause, verified by isolating the heaviest shard:

- The heaviest single pack (`[DVNO] DMBX Shoes 1.pmp`, 232 MB) takes **~54s** for its full check suite: pmp-manifest **23.8s** + golden **22.0s** + mtrl **3.0s** + sqpack **~5s**.
- A whole pack cannot be split across workers in the file-per-shard model, so that ~54s is an unbreakable floor. Contention from 16 workers each loading 200–457 MB packs added another ~15s (54s → ~72s).

Splitting the **checks** of a pack into independent work units drops the floor from ~54s (whole pack) to ~24s (the single longest check, pmp-manifest on that pack). Dynamic scheduling then keeps all workers busy without any static balancing.

### Success criteria

- Warm full-suite wall-clock materially below the ~72s of the static-shard approach; target ~25–35s (floored by the ~24s longest unit + scheduling/contention overhead).
- **Zero** per-shard test files, **zero** `SHARD_COUNT`/shard-file meta-test.
- Every corpus assertion, comment, timeout, and `console.log` tag preserved verbatim (behavior-preserving move of the checks).
- **Fail-on-absent policy preserved**: an empty corpus FAILS loudly (does not silently pass), for both the general corpus guard and the `.pmp`-required guard.
- Oracle `/unwrap` cache stays correct under concurrent writers (already fixed in Task 1).
- `npm test` runs **everything** — the normal unit tests *and* the corpus units — in one invocation with a correct exit code.
- `npm run build` and the full suite green after the vitest 1.6→4 / vite 5→6 upgrade.

### Out of scope

- Any change to `src/`. Only `test/`, `scripts/`, config, and `package.json` change.
- Changing *what* each check asserts. This is a relocation + scheduling change, not a test-logic change.
- Watch-mode execution of corpus units (see §6).
- Multi-machine `--shard` distribution.

---

## 2. Background: the Vitest parallelism constraint

Vitest's unit of CPU parallelism is the **test specification** (normally one per file); the pool (`forks` by default in v4) runs each specification in a separate worker process, but tests *within* one specification run serially. `.concurrent` only overlaps async IO within a single worker — it gives no CPU parallelism for our decode/encode/zip work. So N-way CPU parallelism requires N specifications.

**The v4 lever:** `TestProject.createSpecification(moduleId, filters?)` creates a specification for an arbitrary module id and *does not require the module to exist on disk*. Paired with a Vite virtual-module plugin (`resolveId`/`load`) that synthesizes the module's source, this yields **fileless** specifications. `createSpecification` is only reachable via the Node API (`createVitest` → `runTestSpecifications`), not the `vitest run` CLI — hence the custom runner.

This capability does not exist in Vitest 1.x, which is why the upgrade to Vitest 4 (and its required Vite ≥ 6) is a prerequisite.

---

## 3. Architecture

```
npm test
  └─ vite-node|tsx scripts/run-tests.ts        (the custom runner)
       ├─ createVitest("test", { … , plugins: [corpusUnitsPlugin] , poolOptions cap })
       ├─ normal specs:   await vitest.globTestSpecifications()          (all real *.test.ts)
       ├─ corpus specs:   enumerateUnits().forEach((_, i) =>            (imported — single source of truth)
       │                     project.createSpecification(`virtual:corpus-unit:${i}`))
       ├─ await vitest.runTestSpecifications([...normal, ...corpus])
       ├─ process.exitCode = state.getCountOfFailedTests() > 0 ? 1 : 0
       └─ await vitest.close()

corpusUnitsPlugin (Vite plugin)
  resolveId("virtual:corpus-unit:<index>") -> "\0virtual:corpus-unit:<index>"
  load(id)  -> `import { registerUnit } from ".../test/helpers/corpus-units";
                registerUnit(${index});`

test/helpers/corpus-units.ts
  enumerateUnits(): Unit[]                       (deterministic: sorted packs × {sqpack,golden,mtrl,(+pmp if .pmp)})
  registerUnit(index)                           (look up enumerateUnits()[index]; dispatch to registerXChecks)

test/corpus-guard.test.ts    (a REAL file, discovered normally)
  fail-on-absent guards: assertCorpusPresent(corpus) + assertCorpusPresent(.pmp only)
```

### 3.1 Work-unit model

A **Unit** is `{ pack: string, check: "sqpack" | "golden" | "mtrl" | "pmp" }`. `enumerateUnits()` reads `corpusInputs()` and, per pack, emits `sqpack`, `golden`, `mtrl`, and additionally `pmp` when the pack ends in `.pmp`. For 32 packs (~4 of them `.pmp`) this is ~100 units.

`sqpack` stays a **single** unit even though it registers three `it`s — those three share one decode via `beforeAll` (from Task 3's `registerSqpackChecks`), so splitting them would triple the decode cost. The other three families are already one `it` each.

**Units are addressed by index, not by name.** Pack filenames contain spaces, brackets, and non-ASCII (`rox ♡ crash (bibo+).ttmp2`, `[•PM•] Martini.ttmp2`), which are hostile inside a module id. The virtual module id is therefore `virtual:corpus-unit:<index>`, where `<index>` indexes a **deterministic** `enumerateUnits()` ordering: pack paths **sorted ascending**, then per pack the fixed check order `[sqpack, golden, mtrl, (pmp)]` (if `corpusInputs()` does not already sort, `enumerateUnits` sorts explicitly).

`enumerateUnits` is the **single source of truth for both count and order**: the TS runner `import`s it to know how many specs to create, and the worker's `registerUnit(index)` calls the same function and registers `enumerateUnits()[index]`. There is no second, plain-JS enumeration to keep in sync. `corpus-units.ts` is structured so that **importing it runs no test registration** — `enumerateUnits` depends only on `node:fs`/`node:path`, and the vitest-dependent `registerXChecks` are only reached when `registerUnit` is actually invoked inside a worker (via a local/deferred import if needed) — so the runner can import `enumerateUnits` outside any test context safely.

### 3.2 Dynamic scheduling replaces static sharding

There is **no partitioner**. `shardOf`, `registerCorpusShard`, `SHARD_COUNT`, and the shard-file meta-test are all deleted. `runTestSpecifications` hands the full spec list to the pool, which runs up to `maxWorkers` at once and pulls the next spec as workers free up. The two heavy units of the big pack (golden, pmp) run on different workers automatically; no cost-weighting is needed.

### 3.3 The runner and both test kinds

`npm test` must cover the normal unit tests too. The runner obtains the normal specs via `vitest.globTestSpecifications()` (standard FS discovery of `*.test.ts`, which finds the unit tests, `corpus-guard.test.ts`, `oracle-cache.test.ts`, the trimmed `pmp-manifest.test.ts`, etc.) and concatenates the virtual corpus specs, then runs them together in one pool. Exit code is derived from the aggregate run state.

---

## 4. Fail-on-absent policy (critical)

With one spec per unit, an **empty corpus yields zero corpus specs** — so the guard cannot live only inside the corpus units, or an empty corpus would pass silently. Therefore the guards live in a **real, always-discovered file** `test/corpus-guard.test.ts`:

- `it("requires the local corpus …")` → `assertCorpusPresent(corpusInputs())`.
- `it("requires .pmp packs …")` → `assertCorpusPresent(corpusInputs().filter(.pmp), ".pmp corpus inputs")`.

This preserves the exact policy (and the exact error messages) from the current code, independent of how many corpus units exist. The `/unwrap` throw-on-null and the `.pmp`-required guard from Task 3 remain inside their respective `registerXChecks`.

---

## 5. Components and interfaces

**Reused unchanged (already committed, Tasks 1–3):**
- `test/helpers/oracle.ts` — concurrency-safe `oracleCachePut` (Task 1).
- `test/helpers/corpus-sqpack.ts`, `corpus-golden.ts`, `corpus-mtrl.ts`, `corpus-pmp.ts` — `registerSqpackChecks` / `registerGoldenCheck` / `registerMtrlChecks` / `registerPmpManifestChecks`, each `(pack: string) => void`.
- `test/helpers/compare.ts` — exported `bytesEqual`.

**New:**
- `test/helpers/corpus-units.ts`
  - `type Unit = { pack: string; check: "sqpack" | "golden" | "mtrl" | "pmp" }`
  - `enumerateUnits(): Unit[]` — deterministic (sorted packs × fixed check order); used by the worker via `registerUnit` and mirrored by the runner.
  - `registerUnit(index: number): void` — looks up `enumerateUnits()[index]` and dispatches to the matching `registerXChecks`. Throws on an out-of-range index or unknown check (guards against a malformed/stale virtual id).
- `scripts/corpus-units-plugin.ts` (or inline in the runner) — the Vite plugin: `resolveId` + `load` for `virtual:corpus-unit:<index>`.
- `scripts/run-tests.ts` — the Node-API runner (TypeScript). Imports `enumerateUnits` for the spec count, builds normal + virtual specs, runs, sets exit code, closes.
- `test/corpus-guard.test.ts` — the fail-on-absent guards (§4).

**Deleted:**
- `test/corpus-shard.00.test.ts … .15.test.ts` (16 files).
- `test/helpers/corpus-shards.ts` (`shardOf`, `SHARD_COUNT`, `registerCorpusShard`).
- `test/corpus-shards.test.ts` (`shardOf` unit tests + shard-file meta-test) — obsolete; the `shardOf` primitive is gone.

**Modified:**
- `package.json` — deps bump (§7); `test` script → runner; `test:watch` unchanged (plain `vitest`, §6); optional `engines.node` bump.
- `vitest.config.ts` — worker cap via `poolOptions.forks.maxForks` (default; overridable by `VITEST_MAX_WORKERS`); `pool: "forks"` explicit. The runner reads this same config through `createVitest`.
- `vite.config.ts` — only if the vite 5→6 bump requires it (re-verified, not assumed).

---

## 6. Decisions

- **Watch mode stays plain `vitest`.** `npm run test:watch` continues to call `vitest` directly and therefore discovers only the real `*.test.ts` files — the heavy corpus units are intentionally absent from watch (nobody wants to re-run 100s-long corpus checks on save). The custom runner is for the full `npm test`.
- **Runner language + bootstrap.** The runner is TypeScript (`scripts/run-tests.ts`). It is executed via `vite-node` **if that CLI ships with the Vitest 4 install** (zero new deps, same transform pipeline as the tests); otherwise via `tsx` added as a dev dependency. This is decided at install time by checking `node_modules/.bin`, not an architectural fork. (Targeting a newer Node is acceptable, which also keeps native type-stripping as a future fallback.)
- **Pool = forks, capped.** `forks` (v4 default) isolates per-worker memory for the big packs. Cap `maxForks` (~8, tuned by measurement; overridable via `VITEST_MAX_WORKERS`) to bound peak memory while keeping cores busy. Fine-grained units mean fewer big packs resident at once than the whole-pack model.
- **No cost-weighting / no partitioner.** Dynamic pool scheduling makes static balancing unnecessary; deleting `shardOf` removes code and a whole test.
- **Upgrade pinned by min-age.** vitest 1.6→4 and vite 5→6 pinned to exact versions ≥ 7 days old (per operator policy); `@types/node` bumped to match the chosen Node target.

---

## 7. Upgrade & migration notes

- **Version floors:** Vitest 4 requires Vite ≥ 6.0 and Node ≥ 20. This repo is on vite 5.2.11 → **vite 5→6 is part of this work**. Operator is fine targeting a Node newer than 20.
- **Low breaking-change exposure:** the config is minimal (`globals`, `environment: node`); no workspace, browser, coverage, or module mocks in the corpus path — most v4 breaking changes (workspace→projects, browser provider packages, coverage remap, `basic` reporter removal, `poolMatchGlobs`/`environmentMatchGlobs` removal, mock-alias cleanup) do not apply. **Main risk is the vite 5→6 bump touching the library build** (`vite.config.ts`, the `fflate` bundle) — re-verify `npm run build` explicitly.
- **Node-API surface to get right in the runner:** reporter selection (default reporter), aggregate exit code, and clean `close()` (so the process exits). Filters/`-t` are not required for `npm test`; if desired later they can be threaded through `runTestSpecifications`.

---

## 8. Testing strategy

- **Behavior preservation:** after the switch, the full run must be all-green with the **same** per-pack `console.log` tags — `[decode-all]` ×32, `[mtrl]` ×32, `[self round-trip]` and `[/unwrap]` ≥32 — proving every pack's every check ran exactly once.
- **Fail-on-absent:** temporarily pointing at an empty inputs dir must make `corpus-guard.test.ts` FAIL (both guards), not pass. Verified once during implementation.
- **Cache integrity:** `.oracle-cache/*.bin` count unchanged (warm), `*.tmp` residue = 0, nothing under `test/corpus/` staged in git.
- **Perf:** record warm wall-clock vs the ~72s static-shard baseline; confirm the floor is now the longest *unit* (~24s), not the heaviest *pack* (~54s). Sweep `VITEST_MAX_WORKERS` to pick the cap.
- **Per-unit overhead risk:** ~100 specs vs 16 files means more scheduling and more repeated module inits. Workers are reused and Vite caches transforms, so warm cost should be dominated by pack IO/decode (same as today). If overhead is material, coarsen by grouping several *small* packs' same-family checks into one unit — a localized change to `enumerateUnits`, no architecture change.

---

## 9. Non-goals / YAGNI

- No static cost model or LPT balancing (dynamic scheduling supersedes it).
- No watch-mode support for corpus units.
- No CLI filter passthrough in the runner (add later only if needed).
- No changes to check semantics or to `src/`.
