# Fileless Corpus Test Parallelization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static 16-file corpus sharding with **fileless, runtime-generated parallel work units** (one Vitest spec per pack × check-family) driven by a custom Vitest 4 Node-API runner, dropping the warm wall-clock's floor from the heaviest whole pack (~54s) to the longest single check (~24s).

**Architecture:** Upgrade Vitest 1.6→4 (+ Vite→6/7). A TypeScript runner (`scripts/run-tests.ts`) calls the Node API: it globs the normal `*.test.ts` specs, then creates one **virtual** spec per corpus work unit via `project.createSpecification("\0virtual:corpus-unit:<i>")`, backed by a Vite plugin whose `load` emits `registerUnit(<i>)`. Vitest's forks pool schedules all specs dynamically across a capped worker count. `npm test` runs the runner (normal + corpus); `npm run test:watch` stays plain `vitest` (normal only). Fail-on-absent moves to a real `test/corpus-guard.test.ts`.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest 4 + Vite 6/7, Node built-ins only, `vite-node` (bundled) or `tsx` to run the TS runner. No runtime deps added.

**Spec:** `docs/superpowers/specs/2026-07-02-fileless-corpus-parallelization-design.md`.

## Global Constraints

- **`src/` must NOT change.** Only `test/`, `scripts/`, config files, and `package.json` change.
- **Behavior-preserving for the checks.** Every corpus assertion, comment, timeout, and `console.log` tag (`[decode-all]`, `[self round-trip]`, `[/unwrap]`, `[mtrl]`) survives verbatim — the reused `registerXChecks` helpers (already committed) are not edited. Only *how units are scheduled* changes.
- **Fail-on-absent policy preserved.** An empty corpus must FAIL loudly (not silently pass) for both the general corpus guard and the `.pmp`-required guard, via `assertCorpusPresent`. The `/unwrap` throw-on-null inside `registerSqpackChecks` is untouched.
- **Deterministic unit order.** `enumerateUnits()` is the single source of truth for count AND order: pack paths sorted ascending, then per pack the fixed order `[sqpack, golden, mtrl, (pmp if .pmp)]`. The runner and the workers both derive units from it; they must agree.
- **Import-safety.** Importing the enumeration must run no test registration and pull in no `vitest` runtime — so the runner can import it outside a worker. (Enforced by splitting enumeration into `corpus-units.ts` and registration into `corpus-register.ts`.)
- **Oracle cache correctness under concurrent writers** — already fixed (unique per-writer temp name); do not regress.
- **Dependency min-age ≥ 7 days.** Install upgrades with npm's `--before=2026-06-25` (7 days before 2026-07-02) so only packages published on/before that date resolve.
- **TypeScript strict / `noUncheckedIndexedAccess`** — `npm run typecheck` clean.
- **Windows / PowerShell** dev environment; corpus runs need an explicit large timeout (well past the 120s PowerShell default) — use `300000`.

---

## File Structure

**Reused unchanged (already committed on this branch — do NOT edit):**
- `test/helpers/oracle.ts`, `test/helpers/compare.ts` (exports `bytesEqual`), and the four check helpers `test/helpers/corpus-sqpack.ts`, `corpus-golden.ts`, `corpus-mtrl.ts`, `corpus-pmp.ts` (`registerSqpackChecks`/`registerGoldenCheck`/`registerMtrlChecks`/`registerPmpManifestChecks`, each `(pack: string) => void`).

**New:**
- `test/helpers/corpus-units.ts` — `enumerateUnits()`, `Unit`, `CheckKind`. Pure `node:fs`/`node:path`; import-safe.
- `test/helpers/corpus-register.ts` — `registerUnit(index)` dispatching to the reused check helpers (loaded only in workers).
- `test/corpus-guard.test.ts` — the fail-on-absent guards (a real, normally-discovered file).
- `scripts/corpus-units-plugin.ts` — the Vite virtual-module plugin.
- `scripts/run-tests.ts` — the Node-API runner.

**Modified:**
- `vitest.config.ts` — `pool: "forks"` + capped `maxForks` (env-overridable).
- `package.json` — dep bumps; `test` → runner; `test:watch` unchanged; `engines.node` bump.
- `vite.config.ts` — only if the Vite major bump requires it (re-verified, not assumed).

**Deleted (superseded static-shard apparatus + monolithic corpus files):**
- `test/corpus-shard.00.test.ts … test/corpus-shard.15.test.ts` (16 files, currently untracked in the working tree).
- `test/helpers/corpus-shards.ts` (`shardOf`, `SHARD_COUNT`, `registerCorpusShard`).
- `test/corpus-shards.test.ts` (`shardOf` tests + shard-file meta-test).
- `test/sqpack-corpus.test.ts`, `test/mtrl-corpus.test.ts`, `test/golden.test.ts` (delegating stubs from the old Task 3 — the corpus checks now run only via virtual units).

---

## Task 1: Reset the working tree to a clean base (remove superseded apparatus)

The branch currently has committed Task 1–3 work (cache fix, `shardOf`, the four check helpers, delegating stubs, trimmed `pmp-manifest`) plus **uncommitted** Task 4 changes (16 shard files, `registerCorpusShard`, the shard meta-test, `sqpack/mtrl/golden` deletions). Bring the tree to a clean base for the redesign: no shard apparatus, no monolithic corpus files, helpers retained.

**Files:**
- Delete: `test/corpus-shard.00.test.ts` … `test/corpus-shard.15.test.ts`, `test/helpers/corpus-shards.ts`, `test/corpus-shards.test.ts`, `test/sqpack-corpus.test.ts`, `test/mtrl-corpus.test.ts`, `test/golden.test.ts`.
- Keep as-is: `test/pmp-manifest.test.ts` (already trimmed to the synthetic test in the working tree), all `test/helpers/corpus-*.ts` check helpers, `test/helpers/oracle.ts`, `test/helpers/compare.ts`.

**Interfaces:**
- Consumes: nothing new.
- Produces: a green (corpus-less) suite as a base; no `shardOf`/`registerCorpusShard`/`SHARD_COUNT` remain in the tree.

- [ ] **Step 1: Delete the shard files and shard apparatus**

```powershell
Remove-Item test/corpus-shard.*.test.ts, test/helpers/corpus-shards.ts, test/corpus-shards.test.ts -Force
```

- [ ] **Step 2: Delete the monolithic corpus test files**

```powershell
Remove-Item test/sqpack-corpus.test.ts, test/mtrl-corpus.test.ts, test/golden.test.ts -Force
```

- [ ] **Step 3: Confirm no dangling references remain**

Run: `Select-String -Path test/*.ts, test/helpers/*.ts -Pattern 'corpus-shards|registerCorpusShard|SHARD_COUNT|shardOf'`
Expected: no matches (empty output).

- [ ] **Step 4: Typecheck + run the suite (corpus-less, still on Vitest 1.6)**

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run` (timeout 300000)
Expected: all green. The corpus checks no longer run (that is expected and temporary); only the non-corpus unit tests, `oracle-cache.test.ts`, and the trimmed `pmp-manifest.test.ts` run. There must be 0 failures.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "refactor(test): remove superseded static-shard apparatus and monolithic corpus files"
```

---

## Task 2: Upgrade to Vitest 4 (+ Vite 6/7) and set the forks worker cap

Vitest 4's `createSpecification` (fileless specs) is the prerequisite for the runner. Vitest 4 requires Vite ≥ 6 and Node ≥ 20.

**Files:**
- Modify: `package.json` (devDeps: `vitest`, `vite`, `@types/node`; `engines.node`), `vitest.config.ts`.
- Possibly modify: `vite.config.ts` (only if the Vite major bump requires it).

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a working Vitest 4 install; `vitest.config.ts` with `pool: "forks"` and env-overridable `maxForks`.

- [ ] **Step 1: Upgrade the toolchain with a 7-day min-age cutoff**

```powershell
npm install -D --before=2026-06-25 vitest@^4 vite@^6 "@types/node@^22"
```

If npm reports a peer conflict between the chosen `vitest@4` and `vite@6` (Vitest 4.1.x also supports Vite 7), retry allowing Vite 7:

```powershell
npm install -D --before=2026-06-25 vitest@^4 vite@^7 "@types/node@^22"
```

Then confirm the resolved versions:

Run: `node -e "const p=require('./package.json');console.log(p.devDependencies.vitest,p.devDependencies.vite,p.devDependencies['@types/node'])"`
Expected: `vitest` is `^4.x`, `vite` is `^6.x` or `^7.x`, `@types/node` is `^22.x`. Record the exact resolved versions.

- [ ] **Step 2: Raise the Node engine floor**

In `package.json`, add (or update) the `engines` block (place it after `"type": "module",`):

```json
  "engines": {
    "node": ">=20.19"
  },
```

- [ ] **Step 3: Set the pool and worker cap in `vitest.config.ts`**

Replace `vitest.config.ts` entirely with:

```ts
import { defineConfig } from "vitest/config";

// Worker cap: bounds peak memory when big corpus packs (200–457 MB) load in parallel.
// Override per run with VITEST_MAX_WORKERS. `forks` isolates per-worker memory better than threads.
const MAX_WORKERS = Number(process.env.VITEST_MAX_WORKERS) || 8;

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { maxForks: MAX_WORKERS, minForks: 1 } },
  },
});
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean. If `@types/node@22` surfaces new strictness errors in `src/`, STOP — `src/` must not change; report the errors instead (they indicate a real incompatibility to discuss).

- [ ] **Step 5: Verify the library build survived the Vite major bump**

Run: `npm run build`
Expected: builds successfully. If it fails, the Vite 5→6/7 bump touched the build — fix `vite.config.ts` as needed (this file MAY change; `src/` may not), then re-run until green.

- [ ] **Step 6: Verify the (corpus-less) suite runs on Vitest 4**

Run: `npx vitest run` (timeout 300000)
Expected: all green (same tests as Task 1 Step 4, now on Vitest 4). If the default reporter or config surfaces a v4 breaking change, fix it in `vitest.config.ts` only.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json vitest.config.ts vite.config.ts
git commit -m "build(test): upgrade to vitest 4 + vite 6/7; forks pool with worker cap"
```

---

## Task 3: Enumeration + registration helpers, and the fail-on-absent guard

Create the two-module split (`corpus-units.ts` pure/import-safe; `corpus-register.ts` vitest-side) and the guard file. TDD the enumeration.

**Files:**
- Create: `test/helpers/corpus-units.ts`, `test/helpers/corpus-register.ts`, `test/corpus-guard.test.ts`.
- Test: `test/corpus-units.test.ts` (create).

**Interfaces:**
- Consumes: `corpusInputs`, `assertCorpusPresent` (`./helpers/oracle`); `registerSqpackChecks` (`./corpus-sqpack`), `registerGoldenCheck` (`./corpus-golden`), `registerMtrlChecks` (`./corpus-mtrl`), `registerPmpManifestChecks` (`./corpus-pmp`).
- Produces:
  - `type CheckKind = "sqpack" | "golden" | "mtrl" | "pmp"`
  - `interface Unit { pack: string; check: CheckKind }`
  - `enumerateUnits(): Unit[]` (deterministic; import-safe — no `vitest`, no side effects)
  - `registerUnit(index: number): void`

- [ ] **Step 1: Write the failing test for `enumerateUnits`**

Create `test/corpus-units.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { enumerateUnits } from "./helpers/corpus-units";
import { corpusInputs } from "./helpers/oracle";

describe("enumerateUnits", () => {
  const units = enumerateUnits();
  const packs = corpusInputs();

  it("emits sqpack+golden+mtrl for every pack, plus pmp for .pmp packs", () => {
    const pmpCount = packs.filter((p) => p.toLowerCase().endsWith(".pmp")).length;
    expect(units.length).toBe(packs.length * 3 + pmpCount);
  });

  it("is deterministic and sorted by pack path, fixed check order per pack", () => {
    expect(enumerateUnits()).toEqual(units); // stable across calls
    // pack paths appear in ascending sorted order
    const firstIdxOfPack = new Map<string, number>();
    units.forEach((u, i) => { if (!firstIdxOfPack.has(u.pack)) firstIdxOfPack.set(u.pack, i); });
    const packOrder = [...firstIdxOfPack.keys()];
    expect(packOrder).toEqual([...packOrder].sort());
    // per pack, the checks appear in [sqpack, golden, mtrl, (pmp)] order
    for (const pack of packOrder) {
      const checks = units.filter((u) => u.pack === pack).map((u) => u.check);
      const expected = pack.toLowerCase().endsWith(".pmp")
        ? ["sqpack", "golden", "mtrl", "pmp"]
        : ["sqpack", "golden", "mtrl"];
      expect(checks).toEqual(expected);
    }
  });

  it("covers every pack exactly once for the sqpack check", () => {
    const sqpackPacks = units.filter((u) => u.check === "sqpack").map((u) => u.pack);
    expect(new Set(sqpackPacks)).toEqual(new Set(packs));
    expect(sqpackPacks.length).toBe(packs.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/corpus-units.test.ts`
Expected: FAIL — `./helpers/corpus-units` does not exist.

- [ ] **Step 3: Implement `corpus-units.ts` (pure, import-safe)**

Create `test/helpers/corpus-units.ts`:

```ts
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Pure enumeration of corpus work units. Depends ONLY on node:fs/node:path and runs NO test
// registration on import, so the Node-API runner can import it outside any test worker. The
// vitest-dependent dispatch lives in corpus-register.ts (loaded only inside workers).

export type CheckKind = "sqpack" | "golden" | "mtrl" | "pmp";
export interface Unit { pack: string; check: CheckKind }

// Mirrors oracle.ts CORPUS_INPUTS, but SORTED so the unit order is deterministic and identical
// between the runner (which imports this to count specs) and the workers (which index into it).
const CORPUS_INPUTS = join(__dirname, "..", "corpus", "inputs");

function sortedPacks(): string[] {
  if (!existsSync(CORPUS_INPUTS)) return [];
  return readdirSync(CORPUS_INPUTS)
    .filter((f) => /\.(ttmp2?|pmp)$/i.test(f))
    .sort()                       // deterministic order (single source of truth)
    .map((f) => join(CORPUS_INPUTS, f));
}

/**
 * Every (pack × check-family) work unit, in a stable order: packs sorted ascending, then per pack
 * the fixed check order [sqpack, golden, mtrl, (pmp if .pmp)]. sqpack is ONE unit (its three its
 * share one decode via beforeAll). The index into this array is the virtual module's identity.
 */
export function enumerateUnits(): Unit[] {
  const units: Unit[] = [];
  for (const pack of sortedPacks()) {
    units.push({ pack, check: "sqpack" });
    units.push({ pack, check: "golden" });
    units.push({ pack, check: "mtrl" });
    if (pack.toLowerCase().endsWith(".pmp")) units.push({ pack, check: "pmp" });
  }
  return units;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/corpus-units.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `corpus-register.ts` (vitest-side dispatch)**

Create `test/helpers/corpus-register.ts`:

```ts
import { enumerateUnits, type CheckKind } from "./corpus-units";
import { registerSqpackChecks } from "./corpus-sqpack";
import { registerGoldenCheck } from "./corpus-golden";
import { registerMtrlChecks } from "./corpus-mtrl";
import { registerPmpManifestChecks } from "./corpus-pmp";

// Loaded ONLY inside a Vitest worker (via the virtual corpus-unit module). Statically imports the
// vitest-dependent check helpers, so it must never be imported from the runner — keep enumeration
// (corpus-units.ts) separate for that reason.
const DISPATCH: Record<CheckKind, (pack: string) => void> = {
  sqpack: registerSqpackChecks,
  golden: registerGoldenCheck,
  mtrl: registerMtrlChecks,
  pmp: registerPmpManifestChecks,
};

/** Register the checks for the unit at `index` in enumerateUnits(). Called by the virtual module
 * the runner creates for that index. Throws on a stale/out-of-range index. */
export function registerUnit(index: number): void {
  const units = enumerateUnits();
  const unit = units[index];
  if (!unit) {
    throw new Error(`corpus unit index ${index} out of range (have ${units.length})`);
  }
  DISPATCH[unit.check](unit.pack);
}
```

- [ ] **Step 6: Create the fail-on-absent guard `test/corpus-guard.test.ts`**

This real, normally-discovered file preserves the fail-on-absent policy even when the corpus is empty (which would otherwise produce zero corpus specs and pass silently):

```ts
import { describe, it } from "vitest";
import { corpusInputs, assertCorpusPresent } from "./helpers/oracle";

// Fail-on-absent policy lives here (a real file that is ALWAYS discovered) rather than inside the
// per-unit virtual specs: an empty corpus yields zero corpus units, so the guard must not depend on
// any unit existing. Same assertions/messages as the pre-parallelization corpus files.
describe("corpus presence", () => {
  const inputs = corpusInputs();
  it("requires the local corpus (fails if test/corpus/inputs is empty)", () => {
    assertCorpusPresent(inputs);
  });
  it("requires .pmp packs in the local corpus (fails if none present)", () => {
    assertCorpusPresent(inputs.filter((p) => p.toLowerCase().endsWith(".pmp")), ".pmp corpus inputs");
  });
});
```

- [ ] **Step 7: Typecheck + run the enumeration test and guard**

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run test/corpus-units.test.ts test/corpus-guard.test.ts`
Expected: PASS (3 enumeration tests + 2 guard tests = 5), because the local corpus is present.

- [ ] **Step 8: Commit**

```powershell
git add test/helpers/corpus-units.ts test/helpers/corpus-register.ts test/corpus-units.test.ts test/corpus-guard.test.ts
git commit -m "test(corpus): add import-safe unit enumeration, worker-side dispatch, and presence guard"
```

---

## Task 4: Virtual-module plugin + Node-API runner (prove the plumbing)

Create the Vite plugin that turns `virtual:corpus-unit:<i>` into `registerUnit(<i>)`, and the runner that globs normal specs + creates virtual specs. De-risk the fiddly resolved-id / import-path / exit-code wiring by first running a **single** unit, then the whole corpus — without yet switching `npm test`.

**Files:**
- Create: `scripts/corpus-units-plugin.ts`, `scripts/run-tests.ts`.

**Interfaces:**
- Consumes: `enumerateUnits` (`../test/helpers/corpus-units`); `registerUnit` (`../test/helpers/corpus-register`, referenced only inside generated virtual code); Vitest Node API `createVitest`, `Vitest.globTestSpecifications`, `Vitest.getRootProject`, `TestProject.createSpecification`, `Vitest.runTestSpecifications`, `Vitest.state.getTestModules`, `Vitest.close`.
- Produces: `corpusUnitsPlugin(): Plugin`; a runnable `scripts/run-tests.ts` that runs normal + corpus specs and sets `process.exitCode`. Honours `CORPUS_UNIT=<i>` to run a single unit (debug aid).

- [ ] **Step 1: Determine the TS bootstrap (vite-node vs tsx)**

Check whether `vite-node` shipped with the Vitest 4 install:

Run: `if (Test-Path node_modules/.bin/vite-node.cmd) { "vite-node present" } else { "vite-node ABSENT" }`

If ABSENT, add `tsx` (min-age enforced):

```powershell
npm install -D --before=2026-06-25 tsx
```

Record which bootstrap you will use (`vite-node` if present, else `tsx`). All later `run-tests.ts` invocations use that command.

- [ ] **Step 2: Write the virtual-module plugin**

Create `scripts/corpus-units-plugin.ts`:

```ts
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Plugin } from "vite";

// Turns `virtual:corpus-unit:<index>` into a tiny module that registers that unit's checks inside a
// worker. Uses the Rollup null-byte convention (\0-prefixed resolved id) so no other plugin or the
// filesystem tries to handle it. The generated code imports registerUnit by an absolute file URL so
// it resolves from a virtual module that has no real path (and works on Windows).
const PREFIX = "virtual:corpus-unit:";
const RESOLVED = "\0" + PREFIX;

export function corpusUnitsPlugin(): Plugin {
  const here = dirname(fileURLToPath(import.meta.url));
  const registerModule = pathToFileURL(resolve(here, "../test/helpers/corpus-register.ts")).href;
  return {
    name: "corpus-units",
    enforce: "pre",
    resolveId(id) {
      if (id.startsWith(RESOLVED)) return id;      // already resolved (what the runner passes)
      if (id.startsWith(PREFIX)) return "\0" + id; // tolerate the un-prefixed form too
      return null;
    },
    load(id) {
      if (!id.startsWith(RESOLVED)) return null;
      const index = Number(id.slice(RESOLVED.length));
      return `import { registerUnit } from ${JSON.stringify(registerModule)};\nregisterUnit(${index});\n`;
    },
  };
}
```

- [ ] **Step 3: Write the runner**

Create `scripts/run-tests.ts`:

```ts
import { createVitest } from "vitest/node";
import { corpusUnitsPlugin } from "./corpus-units-plugin";
import { enumerateUnits } from "../test/helpers/corpus-units";

// Custom test runner: runs the normal *.test.ts specs PLUS one fileless virtual spec per corpus
// (pack × check) work unit, so Vitest's forks pool schedules them dynamically across cores.
// CORPUS_UNIT=<i> runs a single corpus unit (and nothing else) as a plumbing/debug aid.
async function main(): Promise<void> {
  const single = process.env.CORPUS_UNIT;
  const vitest = await createVitest(
    "test",
    { watch: false },
    { plugins: [corpusUnitsPlugin()] }, // viteOverrides — where Vite plugins go
  );
  try {
    const project = vitest.getRootProject();
    const unitCount = enumerateUnits().length;
    const indices =
      single !== undefined ? [Number(single)] : Array.from({ length: unitCount }, (_, i) => i);
    const corpusSpecs = indices.map((i) => project.createSpecification(`\0virtual:corpus-unit:${i}`));
    const normalSpecs = single !== undefined ? [] : await vitest.globTestSpecifications();
    await vitest.runTestSpecifications([...normalSpecs, ...corpusSpecs], true);
    const failed = vitest.state.getTestModules().filter((m) => !m.ok());
    process.exitCode = failed.length > 0 ? 1 : 0;
  } finally {
    await vitest.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

> **Resilience note (installed-version API):** `vitest.state.getTestModules()` + `.ok()` is the documented v4 accessor for pass/fail. If the installed 4.x exposes it differently, use the value returned by `runTestSpecifications` instead — capture `const result = await vitest.runTestSpecifications(...)` and derive failure from `result.testModules` (each has `.ok()`), or fall back to `vitest.state.getFiles().some(f => f.result?.state === "fail")`. The Step 5/6 runs will surface any mismatch immediately.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`tsconfig` already covers `scripts/`? If `scripts/` is outside `include`, add it — see note.) If `scripts/**` is not type-checked, add `"scripts"` to the `include` array in `tsconfig.json` and re-run.

- [ ] **Step 5: Prove the plumbing on a SINGLE unit**

Pick unit 0 (first pack's `sqpack` check). Using your chosen bootstrap (`vite-node` or `tsx`):

Run: `$env:CORPUS_UNIT='0'; npx vite-node scripts/run-tests.ts; Remove-Item Env:CORPUS_UNIT` (timeout 300000)
(Substitute `npx tsx scripts/run-tests.ts` if using tsx.)
Expected: the virtual module resolves and loads, the first pack's sqpack checks run and pass, and the `[decode-all]`/`[self round-trip]`/`[/unwrap]` tags for that pack appear. Exit code 0.

If this fails on module resolution (e.g. the `\0` id or the file-URL import), fix the plugin `resolveId`/`load` or the generated import specifier until the single unit runs. This is the critical de-risk step.

- [ ] **Step 6: Run the FULL corpus + normal suite through the runner**

Run: `$sw=[System.Diagnostics.Stopwatch]::StartNew(); npx vite-node scripts/run-tests.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\fileless-run.log" | Select-Object -Last 8; $sw.Stop(); "FILELESS full suite: $([math]::Round($sw.Elapsed.TotalSeconds,1))s"` (timeout 300000)
Expected: all green (normal unit tests + guard + ~100 corpus units), exit 0, wall-clock materially below the ~72s static-shard baseline (target ~25–35s).

- [ ] **Step 7: Confirm every pack's every check ran exactly once**

```powershell
foreach ($tag in '[decode-all]','[mtrl]','[self round-trip]','[/unwrap]') {
  $n = (Select-String -Path "$env:TEMP\fileless-run.log" -Pattern ([regex]::Escape($tag)) -AllMatches | Measure-Object).Count
  "$tag lines: $n"
}
```
Expected: `[decode-all]` = 32, `[mtrl]` = 32, `[self round-trip]` ≥ 32, `[/unwrap]` ≥ 32.

- [ ] **Step 8: Commit**

```powershell
git add scripts/corpus-units-plugin.ts scripts/run-tests.ts tsconfig.json package.json package-lock.json
git commit -m "test(corpus): fileless Node-API runner with virtual (pack x check) work units"
```

---

## Task 5: Cut `npm test` over to the runner and full verification

Point `npm test` at the runner, verify behavior, fail-on-absent, cache integrity, and sweep the worker cap.

**Files:**
- Modify: `package.json` (`scripts.test`).

**Interfaces:**
- Consumes: `scripts/run-tests.ts` (Task 4).
- Produces: `npm test` runs the full fileless suite with a correct exit code.

- [ ] **Step 1: Point `test` at the runner**

In `package.json`, change the `test` script (use the bootstrap chosen in Task 4 Step 1). For `vite-node`:

```json
    "test": "vite-node scripts/run-tests.ts",
```
(or `"test": "tsx scripts/run-tests.ts",` if using tsx). Leave `test:watch` as `"vitest"` unchanged.

- [ ] **Step 2: Run `npm test` and confirm green + correct exit code**

Run: `npm test; "exit=$LASTEXITCODE"` (timeout 300000)
Expected: all green; `exit=0`.

- [ ] **Step 3: Verify a failing/erroring unit propagates a non-zero exit code**

Prove the exit-code wiring without editing any check: run a single out-of-range unit index, which makes `registerUnit` throw during collection (a hard error):

Run: `$env:CORPUS_UNIT='999999'; npx vite-node scripts/run-tests.ts; "exit=$LASTEXITCODE"; Remove-Item Env:CORPUS_UNIT` (timeout 120000)
(Substitute your chosen bootstrap — `vite-node` or `tsx`.)
Expected: the virtual module throws during collection (unit index out of range), and `exit=1`. This confirms a failing/erroring module yields a non-zero exit code.

- [ ] **Step 4: Verify fail-on-absent (empty corpus FAILS, not passes)**

Temporarily point the corpus inputs elsewhere and confirm the guard fails:

```powershell
Rename-Item "test/corpus/inputs" "inputs_hidden"
try {
  npm test; "exit=$LASTEXITCODE"
} finally {
  Rename-Item "test/corpus/inputs_hidden" "inputs"
}
```
Expected: `test/corpus-guard.test.ts` FAILS both guards (corpus + `.pmp`), `exit=1` — an empty corpus is a loud red signal, not silent green. With no inputs, `enumerateUnits()` returns `[]`, so zero corpus specs are created and the guard is the only thing enforcing presence. Confirm `test/corpus/inputs` is restored afterward.

- [ ] **Step 5: Confirm oracle cache integrity (warm, no residue, not staged)**

```powershell
"bin: $((Get-ChildItem test/corpus/.oracle-cache -Filter *.bin | Measure-Object).Count)"
"tmp: $((Get-ChildItem test/corpus/.oracle-cache -Filter *.tmp -ErrorAction SilentlyContinue | Measure-Object).Count)"
git status --short test/corpus
```
Expected: `.bin` count unchanged at `691`; `.tmp` count `0`; `git status` shows nothing under `test/corpus/` (gitignored).

- [ ] **Step 6: Sweep the worker cap to pick a good default**

```powershell
foreach ($w in 6,8,12) {
  $env:VITEST_MAX_WORKERS = "$w"
  $sw=[System.Diagnostics.Stopwatch]::StartNew(); npm test *>$null; $sw.Stop()
  "maxWorkers=$w : $([math]::Round($sw.Elapsed.TotalSeconds,1))s"
}
Remove-Item Env:VITEST_MAX_WORKERS
```
Expected: all runs green; pick the fastest (or the knee) and set that as the default `|| 8` in `vitest.config.ts` if a different value is clearly better. Record the numbers. The floor should sit near the longest single unit (~24s); confirm no run regresses toward the ~54s whole-pack floor.

- [ ] **Step 7: Final typecheck + build + full run**

Run: `npm run typecheck`
Expected: clean.

Run: `npm run build`
Expected: succeeds.

Run: `npm test; "exit=$LASTEXITCODE"` (timeout 300000)
Expected: all green; `exit=0`.

- [ ] **Step 8: Commit**

```powershell
git add package.json vitest.config.ts
git commit -m "perf(test): run corpus via fileless parallel units (~72s -> ~25-35s); npm test uses the runner"
```

---

## Notes

- **Why fileless beats static shards:** the static-shard model floored wall-clock at the single heaviest *pack* (~54s: pmp-manifest 24s + golden 22s on one 232 MB `.pmp`), because a pack can't be split across workers. Making the work unit a *(pack × check)* pair lets those two checks run on different workers; the floor drops to the longest single *check* (~24s). Dynamic pool scheduling removes the need for any static balancing (`shardOf`, `SHARD_COUNT`, and the meta-test are gone).
- **Why a custom runner:** `createSpecification` (the only way to inject virtual/fileless specs) is Node-API-only, so `npm test` runs `scripts/run-tests.ts` instead of `vitest run`. It runs the normal `*.test.ts` specs (via `globTestSpecifications`) AND the virtual corpus specs in one pool, and computes the exit code from `state.getTestModules().ok()` (unlike `start()`, `runTestSpecifications` does not set it for you).
- **Watch mode:** `npm run test:watch` stays plain `vitest` and sees only real files — the heavy corpus units are intentionally excluded from watch.
- **Import-safety split:** `corpus-units.ts` (fs/path only) is import-safe for the runner; `corpus-register.ts` statically imports the vitest-dependent check helpers and is loaded only inside workers via the virtual module. Never import `corpus-register.ts` from the runner.
- **Determinism contract:** the runner counts specs from `enumerateUnits()` and the worker indexes into the same function; both sort packs identically, so index `i` denotes the same unit on both sides. If corpus files change between the two enumerations within one run (they won't), indices could skew — acceptable, as the corpus is static during a run.
- **Memory:** the forks cap (`VITEST_MAX_WORKERS`, default 8) bounds how many big packs are resident at once. Fine-grained units mean at most one pack per in-flight worker, same as the old `afterAll` release.
- **Per-unit overhead:** ~100 specs vs 16 files means more scheduling and repeated module inits; worker reuse + Vite transform caching keep warm cost dominated by pack IO/decode. If overhead proves material (Task 4 Step 6), coarsen `enumerateUnits` to group several small packs' same-family checks into one unit — localized, no architecture change.

---

## Self-Review

- **Spec coverage:** upgrade to Vitest 4 + Vite 6/7 (Task 2); fileless (pack × check) virtual specs via the Node-API runner + plugin (Task 4); dynamic scheduling replacing `shardOf`/`SHARD_COUNT`/meta-test, all deleted (Task 1); import-safe enumeration split (Task 3); fail-on-absent guard in a real file (Task 3 + verified Task 5 Step 4); `npm test` runs normal + corpus, correct exit code (Task 4/5); watch stays plain `vitest` (Task 5 Step 1); worker cap (Task 2 + swept Task 5 Step 6); behavior-preserving tags (Task 4 Step 7); cache integrity (Task 5 Step 5); `src/` untouched; min-age installs (Task 2/4). ✓
- **Placeholder scan:** none — full file contents for every new file, exact commands with expected output, and exact edits for `package.json`/`vitest.config.ts`. ✓
- **Type consistency:** `enumerateUnits(): Unit[]` and `Unit`/`CheckKind` defined in Task 3 are consumed with those names in `corpus-register.ts` and `run-tests.ts`; `registerUnit(index: number)` matches its virtual-module call site and the guard against out-of-range indices; `corpusUnitsPlugin(): Plugin` is consumed by the runner; `createVitest(mode, cliOptions, viteOverrides)` places the plugin in the 3rd arg; the virtual id `\0virtual:corpus-unit:<i>` produced by the runner matches the plugin's `RESOLVED` prefix in `load`. ✓
