# PMP Writer Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `writePmp`'s round-trip write with TexTools' regenerate-from-the-typed-model
write, which eliminates the shipping defect (generated textures land in the zip with no `Files`
key naming them), and fix the four harness blind spots that let it through.

**Architecture:** Harness first, writer second. Phase 1 makes the bug *visible* (diff the artifact
we ship, not the in-memory model; report manifest diffs per-difference; add a self-consistency
invariant; add a `/resave` write-side oracle) and blesses the resulting red diffs into the ratchet.
Phase 2 ports the writer (`MakeOptionPrefix` → `ResolveDuplicates` → `PopulatePmpStandardOption` →
manifest regeneration) and those diffs go green.

**Tech Stack:** TypeScript (ESM, `type: module`), Vitest via a custom parallel runner, Biome,
fflate. No new dependencies.

Spec: `docs/superpowers/specs/2026-07-12-pmp-writer-regeneration-design.md`. Read it first.

## Global Constraints

- **Byte-parity with ConsoleTools is the definition of correct** for payload members. Manifest
  JSONs are compared **semantically (deep-equal on the parsed object)**, not byte-for-byte —
  serializer quirks (property order, indentation) are not a fidelity question. Value *spelling* is:
  a `Files` value is a backslashed string (`PMP.cs:914`), and a forward-slashed value is a different
  value, not different formatting.
- **Every line of business logic cites its C# source** as `file · symbol · lines` in a header or
  comment. No invented behaviour. Reproduce quirks and bugs faithfully; register genuine defects in
  `docs/TEXTOOLS_BUGS.md`.
- **`reference/` is read-only.** Never edit, lint, or format it.
- **Fail loud, never silently diverge.** An unported structure throws.
- **End-of-task ritual (required, every task):** `npm run check`, `npm run typecheck`, `npm test` —
  all green before the task is done.
- **Biome owns formatting.** Never hand-format; run `npm run check`.
- Blessing baselines: `$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`
- Corpus and baselines are **gitignored** (local-only). Baseline churn is never committed; only
  code and docs are.

## Facts established during design (do not re-derive)

These were confirmed empirically or by reading the C#. Trust them.

1. `WriteModpack` (`WizardData.cs:1312-1326`) dispatches on the **destination extension**, and the
   GUI upgrade handler reuses the **source** extension. Format conversion is not an upgrade flow.
2. `/resave` = `WizardData.FromModpack(src)` → `WriteModpack(dest)` (`Program.cs:191-221`) — the
   same load path `/upgrade` takes, minus the transform. It is a pure writer oracle.
3. The `/upgrade` load path calls `UnpackPmpOption(o, null, unzipPath, **false**)`
   (`WizardData.cs:818`) — `mergeManipulations = false`. A PMP-sourced model holds **no `.meta`
   files**; manipulations round-trip opaquely. Our model is already faithful here.
4. `writeModpack` (`src/index.ts:59-76`) **already throws** on cross-format conversion, so a `.meta`
   can never reach `writePmp` through it. The `.meta` throw in Task 8 is defense-in-depth for direct
   `writePmp` callers.
5. `IsEmptyOption` (`PMP.cs:1513-1517`) = `!(FileSwaps.Count > 0 || Manipulations.Count > 0 || Files.Count > 0)`.
6. **Verified against ConsoleTools `/resave` on two real corpus packs**: output members are
   `default/<gamePath>`, `<group>/<option>/<gamePath>`, and `common/{idx}/{filename}`. There is
   **no `pN/` page prefix** on either. Both packs have an empty `default_mod.json`, so
   `DataPages.Count == 1` and `MakePagePrefix` returns `""`.
7. **TexTools bug (new, register it in Task 6):** `WizardData.FromPMP` (`WizardData.cs:1118-1158`)
   pushes the synthesized "Default" page onto `DataPages` **first**, then appends pages `0..pageMax`,
   then assigns each group via `data.DataPages[g.Page]` — which for `g.Page == 0` indexes the
   **Default page**, not the page it just created. The real page 0 stays empty. `ClearEmpties()`
   (which would prune it) is only called by the **GUI import wizard**
   (`ImportWizardWindow.xaml.cs:143`); the headless `/upgrade` and `/resave` paths call only
   `ClearNulls()` (`WizardData.cs:1462`), which does not remove empty pages. So a pack with a
   **non-empty** `default_mod.json` **and** groups ends up with `DataPages.Count >= 2`, which
   switches on the `pN/` prefix for every path. Reproduce this faithfully.

## File Structure

**New source modules:**
- `src/util/sha1.ts` — SHA-1 digest. Scaffolding standing in for C#'s `SHA1.Create()`; used only
  as a content-equality key by `ResolveDuplicates`. No Node `crypto` (the lib is browser-targeted).
- `src/container/option-prefix.ts` — port of `MakePagePrefix`/`MakeGroupPrefix`/`MakeOptionPrefix`
  (`WizardData.cs:1362-1458`) plus the `FromPMP` page construction they depend on
  (`WizardData.cs:1118-1158`).
- `src/container/resolve-duplicates.ts` — port of `ResolveDuplicates` (`PmpExtensions.cs:476-566`).

**Modified source:**
- `src/container/pmp.ts` — `writePmp` regenerates instead of round-tripping.
- `src/upgrade/upgrade.ts` — extract `applyLoadFixes`.
- `src/index.ts` — export `applyLoadFixes`.

**New test helpers:**
- `test/helpers/json-diff.ts` — JSON-pointer structural diff (Task 2).
- `test/helpers/pmp-self-consistency.ts` — dangling-key / orphan-member invariant (Task 4).
- `test/helpers/resave-golden.ts` — cached `/resave` oracle (Task 5).
- `test/helpers/corpus-resave.ts` — the per-pack resave check (Task 5).

**Modified test helpers:**
- `test/helpers/oracle.ts` — cross-process mutex (Task 1).
- `test/helpers/upgrade-archive-diff.ts` — per-difference manifest diffs (Task 2), `checkPayloadMembers` (Task 9).
- `test/helpers/corpus-upgrade.ts` — artifact diff (Task 3), self-consistency (Task 4).
- `test/helpers/corpus-units.ts`, `test/helpers/corpus-register.ts` — register the `resave` check (Task 5).

---

## Phase 0 — Prerequisite

### Task 1: Cross-process mutex around ConsoleTools

ConsoleTools is not safe to run concurrently (existing `BACKLOG.md` item). Phase 1 adds a second
oracle command, roughly doubling cold-cache spawns, so this is now a prerequisite: without it, a
newcomer populating a cold corpus sees a spurious hard failure. The test runner uses Vitest's
`forks` pool, so an in-process lock is insufficient — this must be a **cross-process** lock.

**Files:**
- Modify: `test/helpers/oracle.ts:125-128` (the `run` function)
- Test: `test/oracle-mutex.test.ts` (create)

**Interfaces:**
- Produces: nothing new is exported. `run()` stays private; every ConsoleTools entry point
  (`resave`, `upgrade`, `unwrap`, `wrap`, `extractGameFile`) goes through it and is therefore
  serialized.

- [ ] **Step 1: Write the failing test**

Create `test/oracle-mutex.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { withConsoleToolsLock } from "./helpers/oracle";

const dir = mkdtempSync(join(tmpdir(), "ctlock-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("withConsoleToolsLock", () => {
  it("runs the body and releases the lock afterward", () => {
    const lock = join(dir, "a.lock");
    const out = withConsoleToolsLock(() => 42, { lockPath: lock });
    expect(out).toBe(42);
    expect(existsSync(lock)).toBe(false);
  });

  it("releases the lock even when the body throws", () => {
    const lock = join(dir, "b.lock");
    expect(() =>
      withConsoleToolsLock(
        () => {
          throw new Error("boom");
        },
        { lockPath: lock },
      ),
    ).toThrow("boom");
    expect(existsSync(lock)).toBe(false);
  });

  it("breaks a stale lock rather than deadlocking", () => {
    const lock = join(dir, "c.lock");
    // Simulate a crashed holder: a lock file with an mtime far in the past.
    withConsoleToolsLock(
      () => {
        // Nested acquisition of the SAME path with a zero stale window must break in and succeed,
        // proving the staleness path works without waiting out the real timeout.
        const inner = withConsoleToolsLock(() => "broke-in", {
          lockPath: lock,
          staleMs: 0,
          timeoutMs: 1000,
        });
        expect(inner).toBe("broke-in");
      },
      { lockPath: lock },
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/oracle-mutex.test.ts`
Expected: FAIL — `withConsoleToolsLock` is not exported from `./helpers/oracle`.

- [ ] **Step 3: Implement the lock**

In `test/helpers/oracle.ts`, add these imports to the existing `node:fs` import list if absent:
`closeSync`, `openSync`, `unlinkSync`, `utimesSync`. Then add, above `run`:

```ts
/** Cross-process mutex for ConsoleTools. The tool is not safe to run concurrently (shared
 *  config/lock/temp state — observed 2026-07-12: several cold /upgrade spawns fail together with
 *  exit -1, while the same inputs succeed one at a time). The corpus runner schedules units across
 *  Vitest's `forks` pool, so an in-process lock cannot help: the lock must be a filesystem object.
 *
 *  O_EXCL create is the acquire; unlink is the release. A holder that crashes leaves the file
 *  behind, so a lock older than `staleMs` is broken by force. Sleeping is synchronous (Atomics.wait
 *  on a throwaway SharedArrayBuffer) because run() is execFileSync — there is no event loop to
 *  yield to. */
const LOCK_PATH = join(tmpdir(), "ffxiv-upgrade-modpack-consoletools.lock");
const LOCK_STALE_MS = 10 * 60 * 1000; // > the longest single ConsoleTools run we have seen
const LOCK_TIMEOUT_MS = 20 * 60 * 1000;
const LOCK_POLL_MS = 50;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withConsoleToolsLock<T>(
  body: () => T,
  opts: { lockPath?: string; staleMs?: number; timeoutMs?: number } = {},
): T {
  const lockPath = opts.lockPath ?? LOCK_PATH;
  const staleMs = opts.staleMs ?? LOCK_STALE_MS;
  const timeoutMs = opts.timeoutMs ?? LOCK_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let fd: number | null = null;

  for (;;) {
    try {
      fd = openSync(lockPath, "wx"); // O_CREAT | O_EXCL — atomic acquire
      break;
    } catch {
      // Held by someone. Break it if it is older than staleMs (its holder crashed).
      let age = 0;
      try {
        age = Date.now() - statSync(lockPath).mtimeMs;
      } catch {
        continue; // vanished between open and stat — retry the acquire immediately
      }
      if (age > staleMs) {
        try {
          unlinkSync(lockPath);
        } catch {
          // Another waiter broke it first; either way the next acquire attempt decides.
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for the ConsoleTools lock (${lockPath}). ` +
            `If no ConsoleTools is running, delete that file.`,
        );
      }
      sleepSync(LOCK_POLL_MS);
    }
  }

  try {
    return body();
  } finally {
    try {
      closeSync(fd);
      unlinkSync(lockPath);
    } catch {
      // Already released/broken — nothing to do.
    }
  }
}
```

Now wrap `run`:

```ts
function run(args: string[]): void {
  // execFileSync throws on non-zero exit; ConsoleTools returns -1 on error (Program.cs:94-138).
  // Serialized across processes: ConsoleTools is not concurrency-safe (see withConsoleToolsLock).
  withConsoleToolsLock(() => {
    execFileSync(CONSOLE_TOOLS, args, { stdio: "pipe" });
  });
}
```

- [ ] **Step 4: Run the test and the suite**

Run: `npx vitest run test/oracle-mutex.test.ts`
Expected: PASS (3 tests).

Run: `npm run check && npm run typecheck && npm test`
Expected: all green. The corpus cache is warm, so no ConsoleTools spawns — this proves no regression.

- [ ] **Step 5: Prove the lock actually serializes a cold cache**

Delete one pack's cached golden and re-run its unit, to exercise a real spawn under the lock:

```powershell
# pick any cached key; deleting one entry forces exactly one cold spawn
Get-ChildItem test\corpus\.upgrade-cache\*.bin | Select-Object -First 1 | Remove-Item
npm test
```
Expected: green, and the deleted cache entry is regenerated.

- [ ] **Step 6: Commit**

```powershell
git add test/helpers/oracle.ts test/oracle-mutex.test.ts
git commit -m "test(oracle): serialize ConsoleTools behind a cross-process lock"
```

- [ ] **Step 7: Remove the now-fixed BACKLOG entry**

Delete the "**ConsoleTools is not safe to run concurrently — the oracle needs a mutex**" item from
`BACKLOG.md` (Unprioritized). Keep its "serial cache-warm entry point" idea only if you did not
implement it — you did not, so re-file that single sentence as its own short Unprioritized item.

```powershell
git add BACKLOG.md
git commit -m "docs(backlog): retire the ConsoleTools mutex item (now fixed)"
```

---

## Phase 1 — Make the bug visible

### Task 2: Per-difference manifest diffs (harness fix D)

`diffArchives` deep-equals each manifest JSON and emits **one** `mismatch` token per document
(`upgrade-archive-diff.ts:303-316`). Once a document is baselined as mismatched, every further
difference in it is invisible forever — which is how a missing `Files` key hid behind an unrelated
`Version`/`Name` difference. Report one diff per JSON pointer instead.

**Files:**
- Create: `test/helpers/json-diff.ts`
- Create: `test/helpers/json-diff.test.ts`
- Modify: `test/helpers/upgrade-archive-diff.ts` (the manifest branch of `diffArchives`)

**Interfaces:**
- Produces: `jsonPointerDiff(ours: unknown, golden: unknown): Array<{ pointer: string; status: "added" | "removed" | "mismatch" }>`
  — `added` = present in golden, missing from ours; `removed` = present in ours, missing from golden;
  `mismatch` = present in both, unequal leaf. Orientation matches `diffUpgrade` and the existing
  `diffArchives` (golden-only ⇒ `added`; ours-only ⇒ `removed`).
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/json-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { jsonPointerDiff } from "./json-diff";

describe("jsonPointerDiff", () => {
  it("returns nothing for deep-equal documents", () => {
    expect(jsonPointerDiff({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual([]);
  });

  it("reports a golden-only key as added and an ours-only key as removed", () => {
    expect(jsonPointerDiff({ b: 2 }, { a: 1 })).toEqual([
      { pointer: "/a", status: "added" },
      { pointer: "/b", status: "removed" },
    ]);
  });

  it("reports an unequal leaf as a mismatch at its pointer", () => {
    expect(jsonPointerDiff({ a: { b: 1 } }, { a: { b: 2 } })).toEqual([
      { pointer: "/a/b", status: "mismatch" },
    ]);
  });

  it("escapes ~ and / in keys per RFC 6901", () => {
    expect(jsonPointerDiff({}, { "chara/x~y.mtrl": "v" })).toEqual([
      { pointer: "/chara~1x~0y.mtrl", status: "added" },
    ]);
  });

  it("indexes into arrays and reports length differences per index", () => {
    expect(jsonPointerDiff({ m: [1] }, { m: [1, 2] })).toEqual([
      { pointer: "/m/1", status: "added" },
    ]);
  });

  it("reports a type change at the node itself, not its children", () => {
    expect(jsonPointerDiff({ a: [1] }, { a: { b: 1 } })).toEqual([
      { pointer: "/a", status: "mismatch" },
    ]);
  });

  it("sorts by pointer so ratchet ids are stable", () => {
    const d = jsonPointerDiff({ z: 1, a: 1 }, { z: 2, a: 2 });
    expect(d.map((x) => x.pointer)).toEqual(["/a", "/z"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/helpers/json-diff.test.ts`
Expected: FAIL — cannot resolve `./json-diff`.

- [ ] **Step 3: Implement `jsonPointerDiff`**

Create `test/helpers/json-diff.ts`:

```ts
export type JsonDiffStatus = "added" | "removed" | "mismatch";
export interface JsonPointerDiff {
  pointer: string;
  status: JsonDiffStatus;
}

/** RFC 6901: '~' -> '~0', '/' -> '~1'. Order matters ('~' first). */
function escapeToken(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function kindOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * Structural diff of two parsed JSON documents, one entry per differing JSON pointer.
 *
 * Replaces the whole-document deep-equal that `diffArchives` used to do. That granularity was a
 * ratchet hazard, not a cosmetic one: a baseline records (kind, gamePath, index, status), so a
 * document blessed as `mismatch` swallowed every FUTURE difference in the same document — which is
 * exactly how a missing `Files` key hid behind an unrelated `Version` difference. One diff per
 * pointer means each accepted difference is pinned individually and nothing else can hide under it.
 *
 * Orientation matches diffUpgrade/diffArchives: golden-only => "added", ours-only => "removed".
 * A node whose TYPE differs is a single `mismatch` at that node; we do not descend into it (the
 * children of an array and of an object are not comparable, so per-child diffs would be noise).
 */
export function jsonPointerDiff(
  ours: unknown,
  golden: unknown,
  pointer = "",
): JsonPointerDiff[] {
  if (kindOf(ours) !== kindOf(golden)) {
    return [{ pointer, status: "mismatch" }];
  }
  if (Array.isArray(ours) && Array.isArray(golden)) {
    const out: JsonPointerDiff[] = [];
    const n = Math.max(ours.length, golden.length);
    for (let i = 0; i < n; i++) {
      const p = `${pointer}/${i}`;
      if (i >= ours.length) out.push({ pointer: p, status: "added" });
      else if (i >= golden.length) out.push({ pointer: p, status: "removed" });
      else out.push(...jsonPointerDiff(ours[i], golden[i], p));
    }
    return out;
  }
  if (isObj(ours) && isObj(golden)) {
    const keys = [...new Set([...Object.keys(ours), ...Object.keys(golden)])].sort();
    const out: JsonPointerDiff[] = [];
    for (const k of keys) {
      const p = `${pointer}/${escapeToken(k)}`;
      const inOurs = Object.hasOwn(ours, k);
      const inGolden = Object.hasOwn(golden, k);
      if (!inOurs) out.push({ pointer: p, status: "added" });
      else if (!inGolden) out.push({ pointer: p, status: "removed" });
      else out.push(...jsonPointerDiff(ours[k], golden[k], p));
    }
    return out;
  }
  return ours === golden ? [] : [{ pointer, status: "mismatch" }];
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/helpers/json-diff.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Rewire the manifest branch of `diffArchives`**

In `test/helpers/upgrade-archive-diff.ts`, add `import { jsonPointerDiff } from "./json-diff";` and
replace the `else` branch inside `diffArchives`' member loop (currently `upgrade-archive-diff.ts:302-316`):

```ts
    } else {
      const o = parse(name, om.get(name)!);
      const g = parse(name, gm.get(name)!);
      // The confirmation always runs; it is inert (returns `g` verbatim) whenever nothing in `g`
      // qualifies as a confirmed drop, so this reduces to a straight structural diff in that case.
      // One FileDiff PER DIFFERING JSON POINTER, not one per document: see jsonPointerDiff's doc
      // comment for why the old document-granular `mismatch` was a ratchet hazard.
      for (const d of jsonPointerDiff(o, dropConfirmedAbsentKeys(o, g, gm))) {
        diffs.push({
          kind: "manifest",
          gamePath: `${name}#${d.pointer}`,
          index: 0,
          status: d.status,
          detail: undefined,
        });
      }
    }
```

Delete the now-unused `deepEqual` function (`upgrade-archive-diff.ts:43-60`) if nothing else in the
file uses it — check with a grep first; `test/helpers/compare.ts` has its own `structurallyEqual`
that `corpus-pmp.ts` uses, which is unaffected.

- [ ] **Step 6: Update the archive-diff unit tests**

`test/helpers/upgrade-archive-diff.test.ts` asserts the old document-granular shape. Run it, read
each failure, and update the expected `gamePath` values from `"meta.json"` to
`"meta.json#/<pointer>"` — one entry per differing pointer. Do **not** weaken any assertion: if a
test asserted "exactly one manifest diff", it should now assert exactly the set of pointers that
differ. Add one new test proving the point of this task:

```ts
it("reports each differing manifest key separately, so one blessed diff cannot hide another", () => {
  const ours = pack({ "meta.json": json({ Name: "a", Version: "1" }) });
  const golden = pack({ "meta.json": json({ Name: "b", Version: "2" }) });
  const diffs = diffArchives(ours, golden);
  expect(diffs.map((d) => d.gamePath).sort()).toEqual([
    "meta.json#/Name",
    "meta.json#/Version",
  ]);
});
```

(Use whatever `pack` / `json` archive-building helpers that test file already defines; read it first
and follow its existing idiom rather than inventing new ones.)

- [ ] **Step 7: Re-bless the corpus baselines**

Manifest diff ids all changed shape, so every pack with a baselined manifest mismatch must be
re-recorded. This is a **mechanical** re-bless, not an approval of new divergences:

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
npm test
```
Expected: the second run is green.

**Sanity check before moving on:** open one re-blessed baseline for an affected pack and confirm the
manifest entries are now pointer-scoped, e.g. `default_mod.json#/Version`, and that you can see the
*specific* differences rather than a single opaque `default_mod.json#0:mismatch`. Note in the commit
message roughly how many pointers each affected pack has — that number is the blindness this task
removes.

- [ ] **Step 8: Full gate + commit**

Run: `npm run check && npm run typecheck && npm test`

```powershell
git add test/helpers/json-diff.ts test/helpers/json-diff.test.ts test/helpers/upgrade-archive-diff.ts test/helpers/upgrade-archive-diff.test.ts
git commit -m "test(harness): report manifest diffs per JSON pointer, not per document"
```

---

### Task 3: Diff the artifact we ship, not the in-memory model (harness fix A)

`corpus-upgrade.ts:47` feeds `oursModel` — straight out of `upgradeModpack` — into `diffUpgrade`.
The written archive is only used by `diffArchives`. So no writer bug can ever reach the payload
diff. Re-read our own archive and diff **that**.

**This is the task that would have caught the bug on its own.**

**Files:**
- Modify: `test/helpers/corpus-upgrade.ts:44-55`

**Interfaces:**
- Consumes: `loadModpack`, `writeModpack` from `src/index` (already imported there).
- Produces: nothing new.

- [ ] **Step 1: Make the change**

In `test/helpers/corpus-upgrade.ts`, after `const oursArchive = writeModpack(oursModel, target);`,
re-read it and diff the re-read model:

```ts
      const target = name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
      const oursArchive = writeModpack(oursModel, target);
      // Diff the ARTIFACT WE SHIP, not the in-memory model. Feeding `oursModel` here made every
      // writer bug invisible by construction: a file the writer emits with no `Files` key naming it
      // is a perfectly good file in the model and an unreachable orphan in the pack. Re-reading
      // closes that gap — such a file comes back as an ExtraFile, drops out of `allFiles`, and its
      // gamePath shows as `added` against the golden. (It also puts the whole write->read round-trip
      // under the golden oracle for free.)
      const oursReRead = loadModpack(name, oursArchive);

      const payload = diffUpgrade(name, oursReRead, reference, confirmDivergence);
```

- [ ] **Step 2: Run the suite and READ THE FAILURES**

Run: `npm test`

Expected: **FAILURES on the three PMP packs whose texture round fires** —
`Westlaketea's Constellation Crown (Dawntrail Edition).pmp`, `[Jaque] Marcellus [May 2024].pmp`,
`[Jaque] Romeo & Juliet [feb 2023] - DT update.pmp` — reported as `added` payload diffs on the
generated `.tex` game paths (the golden has them; our re-read artifact does not, because they are
orphan zip members).

**This is the bug, seen by the harness for the first time. Do not "fix" it here.** Record what you
see (pack, gamePath, status) in the commit message.

Other packs may also newly fail if the write→read round-trip loses something. If any **TTMP** pack
fails, stop and report it — that is a `writeTtmp2` round-trip bug, a genuinely new finding, and it
needs its own look before you bless it away.

- [ ] **Step 3: Bless the new diffs into the ratchet**

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
npm test
```
Expected: the second run is green, with the defect now **recorded** in the baselines of those three
packs. Phase 2 burns those entries back down.

- [ ] **Step 4: Full gate + commit**

Run: `npm run check && npm run typecheck && npm test`

```powershell
git add test/helpers/corpus-upgrade.ts
git commit -m @'
test(harness): diff the written artifact, not the in-memory model

The payload diff consumed `oursModel` straight from upgradeModpack, so the
writer was never in the comparison at all. Re-reading our own archive puts it
there -- and immediately surfaces the generated-texture-with-no-Files-key defect
on the three PMP packs whose texture round fires (baselined here, fixed in the
writer port).
'@
```

---

### Task 4: PMP self-consistency invariant (harness fix E)

A cheap, oracle-free invariant on our own output: every payload member must be reachable, and every
`Files` key must resolve. It fails closed even where no golden exists (a synthetic pack, a new
corpus mod, a user's pack in the browser).

**Files:**
- Create: `test/helpers/pmp-self-consistency.ts`
- Create: `test/helpers/pmp-self-consistency.test.ts`
- Modify: `test/helpers/corpus-upgrade.ts`

**Interfaces:**
- Produces: `pmpSelfConsistency(archive: Uint8Array, sourceExtras: Set<string>): FileDiff[]` —
  `FileDiff` from `./upgrade-diff`. Returns `kind: "structure"` diffs with
  `gamePath: "self:dangling:<zipPath>"` (a `Files` value naming no member) or
  `gamePath: "self:orphan:<member>"` (a member no `Files`/`Image` names and that was not already an
  extra of the source). Empty array when the pack is self-consistent.
- Consumes: `readZip` (`src/zip/zip`).

- [ ] **Step 1: Write the failing test**

Create `test/helpers/pmp-self-consistency.test.ts`. Build the archives with `writeZip` from
`src/zip/zip` (the same writer `writePmp` uses), so the test exercises real zip bytes:

```ts
import { describe, expect, it } from "vitest";
import { writeZip } from "../../src/zip/zip";
import { pmpSelfConsistency } from "./pmp-self-consistency";

const enc = new TextEncoder();
const j = (v: unknown) => enc.encode(JSON.stringify(v));
const bytes = (n: number) => new Uint8Array([n]);

function archive(members: Record<string, Uint8Array>): Uint8Array {
  return writeZip(new Map(Object.entries(members)), { store: false });
}

const META = j({ Name: "t", Image: "" });

describe("pmpSelfConsistency", () => {
  it("passes a pack whose Files keys and members agree", () => {
    const a = archive({
      "meta.json": META,
      "default_mod.json": j({ Files: { "chara/a.tex": "default\\chara\\a.tex" } }),
      "default/chara/a.tex": bytes(1),
    });
    expect(pmpSelfConsistency(a, new Set())).toEqual([]);
  });

  it("flags a Files key whose member is absent (dangling)", () => {
    const a = archive({
      "meta.json": META,
      "default_mod.json": j({ Files: { "chara/a.tex": "default\\chara\\a.tex" } }),
    });
    expect(pmpSelfConsistency(a, new Set())).toEqual([
      {
        kind: "structure",
        gamePath: "self:dangling:default/chara/a.tex",
        index: 0,
        status: "removed",
        detail: "chara/a.tex",
      },
    ]);
  });

  it("flags a member no Files key names (orphan)", () => {
    const a = archive({
      "meta.json": META,
      "default_mod.json": j({ Files: {} }),
      "default/chara/a.tex": bytes(1),
    });
    expect(pmpSelfConsistency(a, new Set())).toEqual([
      {
        kind: "structure",
        gamePath: "self:orphan:default/chara/a.tex",
        index: 0,
        status: "added",
        detail: undefined,
      },
    ]);
  });

  it("does not flag a member that was already an ExtraFile of the source", () => {
    const a = archive({
      "meta.json": META,
      "default_mod.json": j({ Files: {} }),
      "readme.txt": bytes(1),
    });
    expect(pmpSelfConsistency(a, new Set(["readme.txt"]))).toEqual([]);
  });

  it("does not flag an image a manifest references", () => {
    const a = archive({
      "meta.json": j({ Name: "t", Image: "images/cover.png" }),
      "default_mod.json": j({ Files: {} }),
      "images/cover.png": bytes(1),
    });
    expect(pmpSelfConsistency(a, new Set())).toEqual([]);
  });

  it("finds keys and members inside group_NNN options too", () => {
    const a = archive({
      "meta.json": META,
      "default_mod.json": j({ Files: {} }),
      "group_001_g.json": j({
        Name: "G",
        Options: [{ Name: "O", Files: { "chara/b.tex": "g\\o\\chara\\b.tex" } }],
      }),
    });
    expect(pmpSelfConsistency(a, new Set())).toEqual([
      {
        kind: "structure",
        gamePath: "self:dangling:g/o/chara/b.tex",
        index: 0,
        status: "removed",
        detail: "chara/b.tex",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/helpers/pmp-self-consistency.test.ts`
Expected: FAIL — cannot resolve `./pmp-self-consistency`.

- [ ] **Step 3: Implement it**

Create `test/helpers/pmp-self-consistency.ts`:

```ts
import { readZip } from "../../src/zip/zip";
import type { FileDiff } from "./upgrade-diff";

const dec = new TextDecoder();
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Deliberately looser than the PMP reader's own `windowsPathKey` (src/container/pmp.ts). Sharing
 *  the reader's key would make this invariant agree with any regression IN the reader: a lost
 *  case-fold would make the reader consider a member unreachable, the writer drop it, and this
 *  check bless the drop. A looser key can only ever report FEWER problems than really exist, so it
 *  fails closed. (Same reasoning, and the same function, as `looseKey` in upgrade-archive-diff.ts.) */
function looseKey(path: string): string {
  return path.toLowerCase().replace(/[. ]/g, "");
}

function isManifestName(name: string): boolean {
  const n = name.split("/").pop()!.toLowerCase();
  return (
    n === "meta.json" || n === "default_mod.json" || (n.startsWith("group_") && n.endsWith(".json"))
  );
}

/** Every zip path a manifest names: option `Files` VALUES plus every `Image` field (meta, group,
 *  option). Returned with the raw (forward-slashed) spelling alongside the gamePath that named it,
 *  so a dangling report can say which key dangles. */
function referenced(
  members: Map<string, Uint8Array>,
): Array<{ zipPath: string; gamePath: string }> {
  const out: Array<{ zipPath: string; gamePath: string }> = [];
  const addFiles = (opt: unknown): void => {
    if (!isObj(opt)) return;
    if (typeof opt.Image === "string" && opt.Image !== "") {
      out.push({ zipPath: opt.Image.replace(/\\/g, "/"), gamePath: "" });
    }
    if (!isObj(opt.Files)) return;
    for (const [gamePath, value] of Object.entries(opt.Files)) {
      if (typeof value !== "string") continue;
      out.push({ zipPath: value.replace(/\\/g, "/"), gamePath });
    }
  };

  for (const [name, data] of members) {
    if (!isManifestName(name)) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(dec.decode(data));
    } catch {
      continue; // a manifest we cannot parse is not this check's problem — the golden diff owns that
    }
    if (!isObj(doc)) continue;
    if (typeof doc.Image === "string" && doc.Image !== "") {
      out.push({ zipPath: doc.Image.replace(/\\/g, "/"), gamePath: "" });
    }
    if (Array.isArray(doc.Options)) for (const o of doc.Options) addFiles(o);
    else addFiles(doc); // default_mod.json: the document IS the option
  }
  return out;
}

/**
 * Self-consistency of a PMP WE WROTE: an oracle-free invariant that the pack is actually usable.
 *
 * Two failures, both of which shipped silently before the writer regeneration:
 *  - DANGLING: an option's `Files` value names a zip path with no member. Penumbra cannot load it.
 *  - ORPHAN:   a payload member that no `Files`/`Image` field names, and that was not already an
 *              unreferenced extra of the SOURCE pack (PMP.cs:213-215 preserves those verbatim, so
 *              they are legitimately unreferenced on the way out too).
 *
 * `sourceExtras` is the source pack's `data.extraFiles` key set. Pass an empty set for a pack with
 * none. Reported as FileDiffs so the result rides the existing ratchet instead of hard-failing —
 * the defect this catches is pre-existing on real corpus packs and must be blessed before it is
 * burned down.
 */
export function pmpSelfConsistency(
  archive: Uint8Array,
  sourceExtras: Set<string>,
): FileDiff[] {
  const members = readZip(archive);
  const memberKeys = new Set(
    [...members.keys()].filter((n) => !isManifestName(n)).map(looseKey),
  );
  const extraKeys = new Set([...sourceExtras].map(looseKey));
  const refs = referenced(members);
  const refKeys = new Set(refs.map((r) => looseKey(r.zipPath)));

  const diffs: FileDiff[] = [];
  for (const r of refs) {
    if (r.gamePath === "") continue; // an Image that names nothing is not a payload failure
    if (memberKeys.has(looseKey(r.zipPath))) continue;
    diffs.push({
      kind: "structure",
      gamePath: `self:dangling:${r.zipPath}`,
      index: 0,
      status: "removed",
      detail: r.gamePath,
    });
  }
  for (const name of members.keys()) {
    if (isManifestName(name)) continue;
    const k = looseKey(name);
    if (refKeys.has(k) || extraKeys.has(k)) continue;
    diffs.push({
      kind: "structure",
      gamePath: `self:orphan:${name}`,
      index: 0,
      status: "added",
      detail: undefined,
    });
  }
  return diffs.sort((a, b) => (a.gamePath < b.gamePath ? -1 : a.gamePath > b.gamePath ? 1 : 0));
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/helpers/pmp-self-consistency.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire it into the corpus upgrade check**

In `test/helpers/corpus-upgrade.ts`, import it and fold its diffs into the same list, PMP only:

```ts
import { pmpSelfConsistency } from "./pmp-self-consistency";
```

and, replacing the line that builds `diff`:

```ts
      // Oracle-free invariant on OUR OWN artifact: no dangling `Files` key, no orphan member.
      // Independent of the golden, so it still guards a pack ConsoleTools cannot upgrade or that
      // has no golden at all. PMP-only: a TTMP has no per-file zip members to orphan.
      const selfDiffs =
        target === "pmp"
          ? pmpSelfConsistency(
              oursArchive,
              new Set(loadModpack(name, bytes).extraFiles?.keys() ?? []),
            )
          : [];

      const diff = {
        ...payload,
        files: [...payload.files, ...archive, ...selfDiffs],
      };
```

- [ ] **Step 6: Run and READ the failures**

Run: `npm test`

Expected: the same three PMP packs now ALSO report `self:orphan:…` diffs for the generated
`.tex` members, and `self:dangling:…` for the hair normals/masks whose `pmpPath` was lost. Record
the counts. This is the *same* bug, seen from a second, oracle-independent angle.

- [ ] **Step 7: Bless, gate, commit**

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
npm run check; npm run typecheck; npm test
git add test/helpers/pmp-self-consistency.ts test/helpers/pmp-self-consistency.test.ts test/helpers/corpus-upgrade.ts
git commit -m "test(harness): assert our written PMP is self-consistent (no dangling keys, no orphan members)"
```

---

### Task 5: The `/resave` write-side oracle (harness fix B) + the load-fix seam

Nothing in the suite has ever AB-tested our **writers** against TexTools. `/resave` is exactly
load-then-write (`Program.cs:191-221`), so `writeModpack(applyLoadFixes(loadModpack(pack)))` should
equal `ConsoleTools /resave pack`.

`applyLoadFixes` exists because TexTools' load is not inert: for an old pack it runs `FixOldModel`
and `FixOldTexData` **at load** (`WizardData.cs:716-727`, `TTMP.cs:1367-1379`), whereas our
equivalents live inside `upgradeModpack`. Naming that seam is also a fidelity improvement in its own
right — it un-blends load-time fixes from the upgrade transform.

**Files:**
- Modify: `src/upgrade/upgrade.ts` (extract `applyLoadFixes`)
- Modify: `src/index.ts` (export it)
- Create: `test/helpers/resave-golden.ts`
- Create: `test/helpers/corpus-resave.ts`
- Modify: `test/helpers/corpus-units.ts`, `test/helpers/corpus-register.ts`
- Modify: `.gitignore` (add `test/corpus/.resave-cache/` and `test/corpus/.resave-baseline/` — check
  whether the existing rules already cover them by pattern before adding)

**Interfaces:**
- Produces:
  - `applyLoadFixes(data: ModpackData): void` (mutates in place) — from `src/upgrade/upgrade.ts`,
    re-exported by `src/index.ts`.
  - `resaveGoldenCached(name: string, bytes: Uint8Array, opts?): Uint8Array | null` — from
    `test/helpers/resave-golden.ts`. Null only when uncached AND no oracle available.
  - `registerResaveCheck(pack: string): void` — from `test/helpers/corpus-resave.ts`.
- Consumes: `withConsoleToolsLock` is already inside `run()` (Task 1); `jsonPointerDiff` (Task 2);
  `oracleKey`/`oracleCacheGet`/`oracleCachePut`/`oracleAvailable`/`resave` from `./oracle`;
  `diffArchives` from `./upgrade-archive-diff`; `diffUpgrade` from `./upgrade-diff`;
  `loadBaseline`/`saveBaseline`/`compareToBaseline` from `./upgrade-baseline`.

- [ ] **Step 1: Extract `applyLoadFixes` (no behaviour change)**

In `src/upgrade/upgrade.ts`, add above `upgradeModpack`:

```ts
/**
 * TexTools' LOAD-time fixes, as a named seam.
 *
 * `WizardData.FromModpack` does not hand back the pack as it sits on disk: for an old pack
 * (DoesModpackNeedFix, TTMP.cs:916-930) it runs every `.tex` through FixOldTexData
 * (TTMP.cs:1367-1379) and every `.mdl` through FixOldModel (WizardData.cs:716-727) BEFORE any
 * caller sees it. Both `/upgrade` (ModpackUpgrader.cs:58) and `/resave` (Program.cs:204) take that
 * same load path, so these fixes are part of "load", not part of "upgrade".
 *
 * We used to run them inside upgradeModpack, which conflated the two. Naming the seam lets the
 * /resave oracle compare like with like (test/helpers/corpus-resave.ts) and makes the port's shape
 * match the C#'s. PMP never needs either fix (both gates are TTMP-only), so this is a no-op there.
 */
export function applyLoadFixes(data: ModpackData): void {
  texFixRound(data);
  const gate = needsMdlFix(data);
  for (const group of data.groups) {
    for (const option of group.options) {
      modelRound(option, gate);
    }
  }
}
```

and rewrite the head of `upgradeModpack` to use it:

```ts
export function upgradeModpack(data: ModpackData): ModpackData {
  const out = cloneModpack(data);
  applyLoadFixes(out);
  // Pass 1 (ModpackUpgrader.cs:88-120): material + metadata per option; collect
  // texture-upgrade targets into a single first-wins-deduped map.
  const targets = new Map<string, UpgradeInfo>();
  for (const group of out.groups) {
    for (const option of group.options) {
      metadataRound(option);
      for (const info of materialRound(option)) {
        const k = targetKey(info);
        if (!targets.has(k)) targets.set(k, info);
      }
    }
  }
```

(the rest of `upgradeModpack` is unchanged; `texFixRound`, `needsMdlFix` and the per-option
`modelRound` call move into `applyLoadFixes`.)

**Ordering check — do not skip.** In the current code `texFixRound` runs first, then per option
`modelRound` → `metadataRound` → `materialRound`. After the extraction, ALL options' `modelRound`
run before ANY option's `metadataRound`. Confirm this is behaviour-preserving: `modelRound` only
reads/writes `.mdl` entries of its own option and records nothing global; `metadataRound` and
`materialRound` never read `.mdl`. So the interleaving is unobservable. Say so in the commit message.

In `src/index.ts`, extend the existing upgrade export:

```ts
export { applyLoadFixes, cloneModpack, upgradeModpack } from "./upgrade/upgrade";
```

- [ ] **Step 2: Prove it changed nothing**

Run: `npm run check && npm run typecheck && npm test`
Expected: green, **with no baseline re-bless**. If anything moves, the extraction was not
behaviour-preserving — stop and find out why.

```powershell
git add src/upgrade/upgrade.ts src/index.ts
git commit -m "refactor(upgrade): name the load-fix seam (texFix + model) that TexTools applies at load"
```

- [ ] **Step 3: Write the cached `/resave` oracle**

Create `test/helpers/resave-golden.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  oracleAvailable,
  oracleCacheGet,
  oracleCachePut,
  oracleKey,
  resave,
} from "./oracle";

/** Content-addressed cache of ConsoleTools /resave outputs. Under the gitignored test/corpus/ tree.
 *  Separate dir from .upgrade-cache: the key is sha256(input pack) for BOTH, so they would collide. */
export const DEFAULT_RESAVE_CACHE = join(__dirname, "..", "corpus", ".resave-cache");

let RESAVE_TMP: string | null = null;
function resaveTmpDir(): string {
  if (RESAVE_TMP === null) RESAVE_TMP = mkdtempSync(join(tmpdir(), "resave-"));
  return RESAVE_TMP;
}

/** Source extension drives BOTH sides: WriteModpack dispatches on the DESTINATION extension
 *  (WizardData.cs:1312-1326), so resaving to the same extension is what exercises the writer we are
 *  testing. A legacy `.ttmp` resaves to `.ttmp2` — TexTools has no legacy writer, and our
 *  writeModpack targets ttmp2 for the whole TTMP family. */
function resaveExt(name: string): "pmp" | "ttmp2" {
  return name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
}

function resaveViaConsoleTools(name: string, bytes: Uint8Array): Uint8Array {
  const dir = resaveTmpDir();
  const lower = name.toLowerCase();
  const srcExt = lower.endsWith(".pmp") ? "pmp" : lower.endsWith(".ttmp") ? "ttmp" : "ttmp2";
  const src = join(dir, `in.${srcExt}`);
  const dest = join(dir, `out.${resaveExt(name)}`);
  writeFileSync(src, bytes);
  rmSync(dest, { force: true }); // a silent no-write must surface as ENOENT, not a stale read
  resave(src, dest);
  return new Uint8Array(readFileSync(dest));
}

/**
 * Cached ConsoleTools /resave golden for `bytes`, spawning ConsoleTools at most once per distinct
 * input. /resave is load-then-write (Program.cs:191-221) with NO transform, so it is a pure oracle
 * for our writers — the one thing the /upgrade harness has never covered (it compares our writer to
 * the INPUT archive on the no-op branch, i.e. it takes our own writer as ground truth).
 *
 * Unlike /upgrade there is no no-op case: /resave always writes.
 * Returns null only when uncached AND no oracle is available (caller fails per policy).
 */
export function resaveGoldenCached(
  name: string,
  bytes: Uint8Array,
  opts: {
    dir?: string;
    available?: boolean;
    produce?: (name: string, bytes: Uint8Array) => Uint8Array;
  } = {},
): Uint8Array | null {
  const dir = opts.dir ?? DEFAULT_RESAVE_CACHE;
  const key = oracleKey(bytes);
  const hit = oracleCacheGet(key, dir);
  if (hit !== null) return hit;
  const available = opts.available ?? oracleAvailable();
  if (!available) return null;
  const out = (opts.produce ?? resaveViaConsoleTools)(name, bytes);
  oracleCachePut(key, out, dir);
  return out;
}
```

- [ ] **Step 4: Write the corpus resave check**

Create `test/helpers/corpus-resave.ts`:

```ts
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { applyLoadFixes, loadModpack, writeModpack } from "../../src/index";
import { oracleKey } from "./oracle";
import { diffArchives } from "./upgrade-archive-diff";
import { compareToBaseline, loadBaseline, saveBaseline } from "./upgrade-baseline";
import { confirmDivergence } from "./upgrade-compare";
import { diffUpgrade } from "./upgrade-diff";
import { DEFAULT_RESAVE_BASELINE, resaveGoldenCached } from "./resave-golden";

const BLESS = process.env.UPDATE_UPGRADE_BASELINE === "1";

/**
 * WRITE-SIDE golden check: load + load-time fixes + write, vs ConsoleTools /resave — the same
 * load path /upgrade takes (Program.cs:204 -> WizardData.FromModpack), minus the transform. This is
 * the first thing in the suite to AB-test our WRITERS against TexTools at all; the /upgrade harness
 * oracles the transform and, on its no-op branch, silently takes our own writer as ground truth.
 *
 * Ratcheted against its own baseline dir (the key is sha256(input pack) for both harnesses, so a
 * shared dir would collide).
 */
export function registerResaveCheck(pack: string): void {
  const name = basename(pack);
  describe(`resave golden: ${name}`, () => {
    it("matches ConsoleTools /resave within the ratchet baseline", () => {
      const bytes = new Uint8Array(readFileSync(pack));
      const ours = loadModpack(name, bytes);
      applyLoadFixes(ours); // TexTools' load is not inert for old packs — see applyLoadFixes
      const target = name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
      const oursArchive = writeModpack(ours, target);

      const goldenBytes = resaveGoldenCached(name, bytes);
      if (goldenBytes === null) {
        throw new Error(
          `No /resave golden for ${name}: uncached and no oracle (TexTools) available. ` +
            `Run with ConsoleTools installed to populate test/corpus/.resave-cache.`,
        );
      }
      const golden = loadModpack(`golden.${target}`, goldenBytes);

      const payload = diffUpgrade(
        name,
        loadModpack(name, oursArchive), // re-read: compare the ARTIFACT, same as corpus-upgrade
        golden,
        confirmDivergence,
      );
      // Payload MEMBER NAMES are compared here from the start (unlike the /upgrade harness, which
      // has to keep them off until the writer regenerates them): that is the whole point of this
      // check — the names are what the writer decides.
      const archive = diffArchives(oursArchive, goldenBytes, target === "pmp");
      const diff = { ...payload, files: [...payload.files, ...archive] };
      const key = oracleKey(bytes);

      if (BLESS) {
        saveBaseline(key, diff.files, DEFAULT_RESAVE_BASELINE);
        console.log(
          `[resave] blessed ${name}: ${diff.matched} matched, ${diff.files.length} recorded`,
        );
        return;
      }

      const baseline = loadBaseline(key, DEFAULT_RESAVE_BASELINE) ?? [];
      const { ok, regressions } = compareToBaseline(diff.files, baseline);
      console.log(
        `[resave] ${name}: ${diff.matched} matched, ${diff.files.length} diffs, ` +
          `${regressions.length} regressions (baseline ${baseline.length})`,
      );
      if (!ok) {
        expect.fail(
          `resave regressions in ${name}: ` +
            regressions.map((r) => `${r.gamePath}#${r.index}:${r.status}`).join(", "),
        );
      }
    }, 1_200_000);
  });
}
```

Add the baseline dir constant to `test/helpers/resave-golden.ts`:

```ts
/** Ratchet baseline for the resave check. Separate dir from the upgrade baseline: both are keyed by
 *  sha256(input pack), so one dir would make the two harnesses overwrite each other. */
export const DEFAULT_RESAVE_BASELINE = join(__dirname, "..", "corpus", ".resave-baseline");
```

- [ ] **Step 5: Register the new check kind**

`test/helpers/corpus-units.ts` — add `"resave"` to `CheckKind` and push a unit per pack:

```ts
export type CheckKind =
  | "sqpack"
  | "golden"
  | "mtrl"
  | "pmp"
  | "tex"
  | "mdl"
  | "geometry"
  | "upgrade"
  | "resave";
```

and inside `enumerateUnits`, after the `upgrade` push:

```ts
    units.push({ pack, check: "resave" });
```

Update that function's doc comment's check-order list to include `resave`.

`test/helpers/corpus-register.ts` — import and dispatch:

```ts
import { registerResaveCheck } from "./corpus-resave";
...
  upgrade: registerUpgradeCheck,
  resave: registerResaveCheck,
```

- [ ] **Step 6: Confirm the caches are gitignored**

Run: `git check-ignore -v test/corpus/.resave-cache/x.bin test/corpus/.resave-baseline/x.json`
Expected: both report a matching `.gitignore` rule. If either does not, add the rules to
`.gitignore` next to the existing `.upgrade-cache` / `.upgrade-baseline` entries.

- [ ] **Step 7: Populate the cache (COLD — this spawns ConsoleTools once per pack)**

This is the first cold run of a second oracle over the whole corpus. It will take a while. The Task 1
mutex is what makes it safe.

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
npm test
```
Expected: the second run is green.

- [ ] **Step 8: READ what the oracle found — this is the payoff**

For each pack, look at its `test/corpus/.resave-baseline/<key>.json`. Write up, in the commit message:

1. **PMP packs** — expect large baselines: our writer round-trips where TexTools regenerates. You
   should see `structure`/`added`/`removed` diffs on payload member names (`common/N/…` vs source
   names) and `manifest` pointer diffs (`default_mod.json#/Version` added, `#/Name` removed, …).
   These are the very divergences Phase 2 removes. **Confirm that**, because it is your check that
   the writer port is aimed at real, observed differences and not at your reading of the C#.
2. **TTMP packs** — this is NEW information. Any diff here is an unoracled `writeTtmp2` divergence.
   Note what they are. Do **not** fix them in this plan; file each as a `BACKLOG.md` item with the
   evidence. (Known and already normalized away: `ModOffset`/`ModSize` in the `.mpl`,
   `upgrade-archive-diff.ts:26`.)

- [ ] **Step 9: File the TTMP findings, gate, commit**

Add a `BACKLOG.md` (Unprioritized) item per distinct `writeTtmp2` divergence class the oracle found,
each citing the pack and the diff. If it found none, say so explicitly in the commit message — that
is a real result (it means `writeTtmp2` is already byte-faithful).

Run: `npm run check && npm run typecheck && npm test`

```powershell
git add test/helpers/resave-golden.ts test/helpers/corpus-resave.ts test/helpers/corpus-units.ts test/helpers/corpus-register.ts BACKLOG.md .gitignore
git commit -m @'
test(harness): add the /resave write-side oracle

/resave is load-then-write with no transform (Program.cs:191-221), so it AB-tests
our writers directly -- the one thing the /upgrade harness never has (on its no-op
branch it compares against the INPUT archive, i.e. it treats our own writer as
ground truth). Covers PMP and TTMP2. Findings recorded in the baselines; the PMP
ones are what the writer port burns down next.
'@
```

---

## Phase 2 — Port the writer

### Task 6: `sha1` + `option-prefix`

**Files:**
- Create: `src/util/sha1.ts`, `test/util/sha1.test.ts`
- Create: `src/container/option-prefix.ts`, `test/container/option-prefix.test.ts`
- Modify: `docs/TEXTOOLS_BUGS.md`

**Interfaces:**
- Produces:
  - `sha1Hex(data: Uint8Array): string` — from `src/util/sha1.ts`.
  - `optionPrefixes(data: ModpackData): Map<ModpackOption, string>` — from
    `src/container/option-prefix.ts`. Maps every option in the pack (including the leading synthesized
    "Default" group's option) to its zip folder prefix, e.g. `""`, `"default/"`,
    `"options/black veil/"`, `"p2/outfit/juliet/"`. Prefixes end with `/` unless empty.
- Consumes: `safeName` from `src/container/pmp.ts` (already exported).

- [ ] **Step 1: `sha1` test**

Create `test/util/sha1.test.ts` with the canonical NIST vectors:

```ts
import { describe, expect, it } from "vitest";
import { sha1Hex } from "../../src/util/sha1";

const enc = new TextEncoder();

describe("sha1Hex", () => {
  it("hashes the empty input", () => {
    expect(sha1Hex(new Uint8Array(0))).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });
  it("hashes 'abc'", () => {
    expect(sha1Hex(enc.encode("abc"))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });
  it("hashes the 56-byte vector (two-block, length-padding boundary)", () => {
    expect(
      sha1Hex(enc.encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    ).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
  });
  it("hashes a million 'a's", () => {
    expect(sha1Hex(new Uint8Array(1_000_000).fill(0x61))).toBe(
      "34aa973cd4c4daa4f61eeb2bdbad27316534016f",
    );
  });
});
```

Run: `npx vitest run test/util/sha1.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `sha1`**

Create `src/util/sha1.ts` — a standard FIPS 180-1 SHA-1. Node's `crypto` is unavailable (this
library is browser-targeted; see `vite.config` / the browser consumer), and `SubtleCrypto` is async,
so a small synchronous implementation is the right call.

Header comment:

```ts
// SHA-1 (FIPS 180-1). Scaffolding, not a port: it stands in for C#'s `SHA1.Create()` in
// ResolveDuplicates (PmpExtensions.cs:478), where the digest is used ONLY as a content-equality key
// for deduplication — never persisted, never compared against a TexTools-produced hash. Any
// collision-resistant hash would reproduce TexTools' behaviour; SHA-1 is what the C# uses, so we
// use it too and keep the mapping obvious. Implemented here rather than via node:crypto because the
// library is browser-targeted, and via SubtleCrypto's async API is unusable from a sync writer.
```

Then the implementation (h0..h4 init, 80-round loop, big-endian length padding, hex output).

Run: `npx vitest run test/util/sha1.test.ts` → PASS (4 tests).

- [ ] **Step 3: `option-prefix` test**

Create `test/container/option-prefix.test.ts`. Build minimal `ModpackData` values (a helper local to
the test file) and assert the prefixes. Cover, at minimum:

```ts
// 1. Empty default group + one single-option group  -> "" default, "<group>/" for the group's option
//    (Westlaketea shape; VERIFIED against ConsoleTools /resave: members are `options/black veil/…`)
// 2. Multi-option group -> "<group>/<option>/"
// 3. Single-option group -> "<group>/" (no option segment; MakeOptionPrefix, WizardData.cs:1439-1446)
// 4. Two options with the SAME name in one group -> second gets "<group>/<name> (1)/"
//    (the uniquifying while-loop, WizardData.cs:1448-1453)
// 5. A blank option name -> "Blank Option" (WizardData.cs:1433-1435); a blank group name ->
//    "Blank Group" (WizardData.cs:1391-1394). NOTE these are NOT path-safed after substitution in
//    the C# -- reproduce the capitalized literal verbatim.
// 6. NON-EMPTY default mod + groups on page 0 -> the FromPMP page-index bug (see below):
//    DataPages = [DefaultPage(+the page-0 groups), emptyPage0] -> Count 2 -> "p1/" on everything on
//    the default page and "p2/" on nothing (page 2 is the empty one). Assert the exact prefixes your
//    port produces and pin them; the /resave oracle in Task 8 is the arbiter if a corpus pack hits it.
// 7. Names are path-safed and lowercased via safeName (PMP.MakePMPPathSafe -> IOUtil.MakePathSafe).
```

- [ ] **Step 4: Implement `option-prefix`**

Create `src/container/option-prefix.ts`. Port, in order:

- **Page construction** — `WizardData.FromPMP` (`WizardData.cs:1118-1158`). The synthesized "Default"
  group (our `data.groups[0]`) becomes its own page **iff its option is non-empty**, where empty is
  `IsEmptyOption` (`PMP.cs:1513-1517`): no `Files`, no `FileSwaps`, no `Manipulations`. Then pages
  `0..max(group.page)` are appended, and each real group is assigned to `pages[group.page]` — **which
  is the C#'s bug**: when a Default page exists, index 0 is *it*, so page-0 groups land on the
  Default page and the created page 0 stays empty. `ClearEmpties()` would prune it but is GUI-only
  (`ImportWizardWindow.xaml.cs:143`); the headless path calls only `ClearNulls()`
  (`WizardData.cs:1462`), which does not. Reproduce all of it.
- **`MakePagePrefix`** (`WizardData.cs:1362-1382`): `""` unless `DataPages.Count > 1`, then
  `"p" + (index + 1) + "/"`.
- **`MakeGroupPrefix`** (`:1383-1412`): `pagePrefix + safeName(group.name || "Blank Group") + "/"`,
  with the uniquifying while-loop against sibling groups' already-assigned folder paths.
- **`MakeOptionPrefix`** (`:1419-1458`): `groupPrefix` when the group has exactly one option;
  `groupPrefix + safeName(option.name || "Blank Option") + "/"` otherwise; then the uniquifying
  while-loop against sibling options.

**Reproduce the C#'s infinite-loop hazard faithfully or not at all — read `:1406-1409` carefully:**
`MakeGroupPrefix`'s while-loop never increments `i`, so if a collision *did* occur it would spin
forever. `MakeOptionPrefix`'s loop (`:1448-1453`) DOES increment. Port the group loop's condition as
written but guard it: if the loop would iterate more than once, **throw** with a message citing
`WizardData.cs:1406-1409` — a documented gap that fails loudly beats reproducing a hang. Add this to
`docs/TEXTOOLS_BUGS.md`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/container/option-prefix.test.ts test/util/sha1.test.ts`
Expected: PASS.

- [ ] **Step 6: Register the two TexTools bugs**

Add to `docs/TEXTOOLS_BUGS.md`, following the file's existing entry format:

1. **`FromPMP` page-index off-by-one.** `WizardData.cs:1118-1158`. When `default_mod.json` is
   non-empty, the synthesized Default page occupies `DataPages[0]`, so `DataPages[g.Page]` for a
   page-0 group appends to the *Default* page and the freshly-created page 0 is left empty. Since
   `ClearEmpties()` is GUI-only, the empty page survives into `WritePmp`, pushing `DataPages.Count`
   above 1 and switching on the `pN/` folder prefix for the entire pack. Status: reproduced (it is
   observable in the output paths, so not reproducing it would diverge).
2. **`MakeGroupPrefix`'s non-incrementing collision loop.** `WizardData.cs:1406-1409`:
   `while (page.Groups.Any(x => x.FolderPath == groupPrefix)) { groupPrefix = pagePrefix + gName + " (" + i + ")/"; }`
   — `i` is never incremented, so a genuine collision spins forever on the same candidate. (The
   sibling loop in `MakeOptionPrefix`, `:1448-1453`, increments correctly.) Status: **we throw**
   rather than hang.

- [ ] **Step 7: Gate + commit**

```powershell
npm run check; npm run typecheck; npm test
git add src/util/sha1.ts test/util/sha1.test.ts src/container/option-prefix.ts test/container/option-prefix.test.ts docs/TEXTOOLS_BUGS.md
git commit -m "feat(pmp): port MakeOptionPrefix/MakeGroupPrefix/MakePagePrefix (WizardData.cs:1362-1458)"
```

---

### Task 7: `resolve-duplicates`

**Files:**
- Create: `src/container/resolve-duplicates.ts`, `test/container/resolve-duplicates.test.ts`

**Interfaces:**
- Produces: `resolveDuplicates(data: ModpackData, prefixes: Map<ModpackOption, string>): Map<ModpackFile, string>`
  — the zip path each file is written to. Files with no bytes (absent) are **present in the input but
  absent from the returned map** (see below).
- Consumes: `sha1Hex` (Task 6), `optionPrefixes` (Task 6).

- [ ] **Step 1: Write the failing test**

Create `test/container/resolve-duplicates.test.ts`. Cover:

```ts
// 1. A file used once keeps `<optionPrefix><gamePath>`.
// 2. A file whose CONTENT repeats (same bytes, any option) moves to `common/{idx}/{basename}` --
//    and BOTH occurrences get that path (the final re-loop, PmpExtensions.cs:556-565).
// 3. `idx` starts at 1 and increments once per distinct duplicated content, in FILE ORDER
//    (groups in order, options in order, files in Files-map order).
// 4. `{basename}` is the basename of the FIRST occurrence's pmpPath (Path.GetFileName of the
//    already-assigned `<prefix><gamePath>`), i.e. the gamePath's filename.
// 5. Three copies of the same content still yield ONE common/{idx} entry (the second occurrence
//    moves it; the third finds a path already starting with "common/" and leaves it alone --
//    PmpExtensions.cs:540).
// 6. ZERO-HASH BUG (docs/TEXTOOLS_BUGS.md section 7): an ABSENT file (no bytes) is not hashed; it is
//    given an all-zero hash key (PmpExtensions.cs:509-514) and thus DEDUPES AGAINST EVERY OTHER
//    ABSENT FILE. Two absent files therefore BURN an `idx` value, shifting the numbering of every
//    later real duplicate. Assert that shift explicitly -- it is load-bearing for member-name parity.
// 7. Absent files are excluded from the RETURNED map (they get neither a member nor a Files key --
//    PopulatePmpStandardOption's File.Exists skip, PMP.cs:883-888).
```

- [ ] **Step 2: Implement it**

Create `src/container/resolve-duplicates.ts`, a direct port of `ResolveDuplicates`
(`PmpExtensions.cs:476-566`). Header comment must cite that symbol and note:

- **`useCompressed` is always false for us.** `PmpExtensions.cs:488-499` picks compressed-vs-
  uncompressed hashing by majority storage type; a PMP model is entirely `RawUncompressed`, so
  `compCount == 0` and the uncompressed branch always wins. (And only equality classes matter, not
  the digest values — see `src/util/sha1.ts`.)
- **The zero-hash bug is reproduced deliberately** (`PmpExtensions.cs:509-514`,
  `docs/TEXTOOLS_BUGS.md` §7): an absent file is not hashed but IS inserted with a default
  (all-zero) key, so absent files dedupe against each other and consume `idx` values that shift the
  `common/N` numbering of real duplicates. A "fix" here diverges from the golden.
- **Iteration order is the contract.** C# enumerates `Dictionary<Guid, FileIdentifier>` in insertion
  order (no removals), and insertion order is option-by-option, file-by-file
  (`FileIdentifier.IdentifierListFromDictionaries`, `PmpExtensions.cs:594-626`). Our `Map` preserves
  insertion order, so iterate groups → options → `option.files` and the numbering follows.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run test/container/resolve-duplicates.test.ts` → PASS.

- [ ] **Step 4: Gate + commit**

```powershell
npm run check; npm run typecheck; npm test
git add src/container/resolve-duplicates.ts test/container/resolve-duplicates.test.ts
git commit -m "feat(pmp): port ResolveDuplicates incl. the common/N dedup and its zero-hash bug"
```

---

### Task 8: Regenerate the PMP write

The payload. `writePmp` stops reading `pmpPath` and the raw `Files` map, and rebuilds the pack from
the model the way `PopulatePmpStandardOption` + `PMP.WritePmp` do.

**Files:**
- Modify: `src/container/pmp.ts` (`optionToJson`, `writePmp`; `pruneAbsentFiles` becomes dead — delete it)

**Interfaces:**
- Consumes: `optionPrefixes` (Task 6), `resolveDuplicates` (Task 7).
- Produces: no signature change to `writePmp(data: ModpackData): Uint8Array`.

- [ ] **Step 1: Rewrite `optionToJson` to emit `Files` from the model**

`Files` is no longer carried through from `o.raw`; it is built from the model, keyed by gamePath,
valued with the backslashed zip path `resolveDuplicates` assigned. Everything `o.raw` carries that
the model does not type (`Imc`/`Combining` extras, `Priority`, …) is still re-emitted. Absent files
contribute no key — which is now a *consequence* of them having no zip path, not a special case, so
`pruneAbsentFiles` is deleted.

The function needs the zip paths, so give it the map:

```ts
/** Reconstruct a PMP option JSON document, regenerating `Files` from the model.
 *
 * TexTools NEVER round-trips this map: PopulatePmpStandardOption (PMP.cs:871-928) builds it fresh
 * from its typed model, `opt.Files.Add(fi.Path, fi.PmpPath.Replace("/", "\\"))` (PMP.cs:914). We
 * used to re-emit `o.raw`'s map verbatim, which made any file the pipeline ADDED (a generated index
 * map) unnameable and any file it REPOINTED (a regenerated hair normal) dangle. Regenerating removes
 * that whole class of bug. A file with no bytes contributes no key AND no member, which reproduces
 * the absent-file drop (PMP.cs:883-888) for free.
 *
 * Fields `o.raw` carries that our model does not type (Imc/Combining extras, Priority, ...) are
 * still re-emitted from it. `includeMeta=false` omits Name/Description/Image for default_mod.json,
 * mirroring ShouldSerialize* on IsDataContainerOnly (PMP.cs:1496-1501). */
function optionToJson(
  o: ModpackOption,
  includeMeta: boolean,
  zipPaths: Map<ModpackFile, string>,
): PmpOptionJsonRaw {
  const Files: Record<string, string> = {};
  for (const f of o.files) {
    const zip = zipPaths.get(f);
    if (zip === undefined) continue; // absent: no member, no key (PMP.cs:883-888)
    Files[f.gamePath] = zip.replace(/\//g, "\\"); // PMP.cs:914
  }
  ...
}
```

Keep the `o.raw` spread for the untyped extras, but **override** `Files` with the regenerated map.

- [ ] **Step 2: Throw on a `.meta`/`.rgsp` reaching the PMP writer**

In the payload loop, before writing:

```ts
    // PopulatePmpStandardOption turns a .meta into Manipulations and a .rgsp into Manipulations
    // (PMP.cs:891-900 -> PMPExtensions.MetadataToManipulations / RgspToManipulations,
    // PmpExtensions.cs:417) rather than writing either as a zip member. We do NOT port that: a
    // PMP-sourced model holds no .meta at all (the upgrade load path passes
    // mergeManipulations=false, WizardData.cs:818, so manipulations stay opaque), and a TTMP-sourced
    // one can only reach here through a format conversion that no upgrade flow performs
    // (WriteModpack dispatches on the destination extension and the GUI reuses the source's,
    // WizardData.cs:1312-1326) -- and which writeModpack already rejects outright (src/index.ts).
    // Fail loud instead of silently emitting a member TexTools would never write. See BACKLOG.md.
    if (/\.(meta|rgsp)$/.test(f.gamePath)) {
      throw new Error(
        `pmp: writing a ${f.gamePath.endsWith(".meta") ? ".meta" : ".rgsp"} file into a PMP is ` +
          `unported (PMP.cs:891-900 converts it to Manipulations): ${f.gamePath}`,
      );
    }
```

- [ ] **Step 3: Rewrite `writePmp`'s body**

Compute the prefixes and zip paths once, up front, then use them for both the manifests and the
payload members:

```ts
export function writePmp(data: ModpackData): Uint8Array {
  const enc = new TextEncoder();
  const entries = new Map<string, Uint8Array>();
  // Regenerate every zip path from the typed model, the way TexTools does: optionPrefix + gamePath,
  // then content-dedup into common/{idx}/ (WizardData.cs:1526 -> PmpExtensions.cs:476-566). The
  // source pack's own member names (`pmpPath`) are NOT reused -- that round-trip is what made a
  // generated file unnameable (see optionToJson).
  const prefixes = optionPrefixes(data);
  const zipPaths = resolveDuplicates(data, prefixes);
  ...
}
```

The manifest sections keep their existing `data.meta.raw` / `g.raw` re-emit for the fields the model
does not type, but each option is now serialized with `optionToJson(o, includeMeta, zipPaths)`.

The payload loop becomes: for each file with a zip path, `entries.set(zipPath, f.data)`. **The
windowsPathKey NTFS-collapse loop stays** — `File.WriteAllBytes` into a working directory
(`PMP.cs:908-910`) is still what TexTools does, so two paths that NTFS folds together still collapse.
But now, because paths are regenerated per option, a collapse should be genuinely impossible for
distinct content: keep the collapse and **throw** if two files collapse onto one key with *different*
bytes, citing that a differing-content collision means our naming is wrong (TexTools' content-dedup
guarantees identical bytes at any shared path).

ExtraFiles re-emit is unchanged.

- [ ] **Step 4: Run the WRITER oracle first — it is the one that adjudicates**

Run: `npx vitest run` filtered to the resave units for the PMP packs (use `CORPUS_UNIT=<i> npm test`
with the indices `enumerateUnits()` gives the PMP `resave` units, or run `npm test` and read the
`[resave]` lines).

Expected: the PMP resave baselines should now be **dramatically smaller** — member names and the
`Files` map should match TexTools. What remains will be the manifest fields the model does not yet
regenerate.

**Iterate here against the oracle, not against your reading of the C#.** Every remaining diff is a
concrete instruction. In particular the spec flags these as "the oracle decides":
- `common/{idx}` numbering (insertion order + the zero-hash bug),
- whether `meta.json`'s `Image` is rewritten into the pack by `WizardHelpers.WriteImage`
  (`WizardData.cs:1497`),
- whether `metadataRound` is load-time (if the resave golden shows reconstructed `.meta`
  manipulations, move `metadataRound` into `applyLoadFixes` and say so).

- [ ] **Step 5: Regenerate the manifest documents from the model**

Using the remaining resave diffs as the spec, make `meta.json` / `default_mod.json` /
`group_NNN_*.json` match: `default_mod.json` gains `Version` and loses `Name`/`Description`;
`meta.json` always carries `Image`; every initialized field TexTools' typed model has is written.
Cite `PMP.cs:830-869` and `WizardData.cs:1460-1560`. Keep re-emitting from `raw` only the fields the
typed model does **not** own.

Re-run the resave units after each change. Target: **empty PMP resave baselines.**

- [ ] **Step 6: Now check the /upgrade harness**

Run: `npm test`

Expected: the three PMP packs' `self:orphan:` / `self:dangling:` diffs (Task 4) and their `added`
payload diffs (Task 3) are **gone**. That is the shipping defect fixed, proven by two independent
checks that were red before.

Re-bless (the PMP baselines should shrink substantially — several should reach zero):

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
npm test
```

Report, in the commit message, the before/after baseline sizes per PMP pack. A pack whose baseline
did NOT shrink is a signal you have missed something — investigate before committing.

- [ ] **Step 7: Gate + commit**

```powershell
npm run check; npm run typecheck; npm test
git add src/container/pmp.ts
git commit -m @'
fix(pmp): regenerate the PMP write from the typed model

writePmp re-emitted the source `Files` map verbatim and reused the source zip
names, so a file the pipeline ADDED (a generated index map) got a zip member no
`Files` key named -- the pack simply did not work in Penumbra -- and a file it
regenerated in place lost its path and left a dangling key. TexTools never
round-trips: it rebuilds names and the `Files` map from its typed model
(PopulatePmpStandardOption PMP.cs:871-928, ResolveDuplicates PmpExtensions.cs:476-566,
MakeOptionPrefix WizardData.cs:1419). Port that, and the whole class of bug goes
away rather than being patched.

Proven by the /resave writer oracle (member names + Files map now match TexTools)
and by the artifact diff + self-consistency invariant added in Phase 1, both of
which were red on this defect and are now green.
'@
```

---

### Task 9: Turn on the last check, land the blocked synthetic, clean up the backlog

**Files:**
- Modify: `test/helpers/corpus-upgrade.ts` (the `checkPayloadMembers` argument)
- Modify: `test/helpers/upgrade-archive-diff.ts` (its doc comment)
- Modify: `scripts/generate-synthetics/build-all.ts`
- Modify: `BACKLOG.md`

- [ ] **Step 1: Enable payload member-name comparison for every PMP (harness fix C)**

In `corpus-upgrade.ts`, `checkPayloadMembers` is currently `target === "pmp" && golden.kind === "noop"`.
The no-op restriction existed *only* because our writer reused source names where TexTools
regenerates them. It no longer does:

```ts
      // Payload member NAMES are now comparable on the real-golden branch too: our writer
      // regenerates them the TexTools way (optionPrefix + gamePath, content-deduped into common/N).
      // This is strictly stronger than the payload diff: a member name IS `<optionPrefix><gamePath>`,
      // so it catches a file landing in the WRONG OPTION -- which diffUpgrade's whole-pack,
      // gamePath-keyed multiset flattens away entirely.
      const archive = diffArchives(oursArchive, goldenBytes, target === "pmp");
```

Update `diffArchives`' doc comment (`upgrade-archive-diff.ts:264-271`) to delete the "No-op only"
justification, keeping the "PMP only" one.

Run: `npm test`. Any new diff here is a real member-name divergence — investigate rather than bless.
If clean, no re-bless is needed.

- [ ] **Step 2: Land the previously-blocked synthetic pack**

`scripts/generate-synthetics/build-synthetic-absent-file-upgraded.ts` exists but is unregistered: it
could not reach a clean 0-diff because of the manifest-regeneration gap Task 8 just closed. Register
it:

```ts
import "./build-synthetic-absent-file-upgraded";
```

Run:
```powershell
npm run synthetics
npm test
```
Expected: the new synthetic pack appears as a corpus unit and **fully matches** its golden (no
baseline). If it does not, the remaining diff is a real finding — report it before blessing anything.

- [ ] **Step 3: Burn down the backlog**

In `BACKLOG.md`:
- **Delete** the top Prioritized item (the generated-texture `Files`-key defect) — fixed.
- **Delete** the "`writePmp` round-trips the source pack where TexTools *regenerates* it" item —
  fixed (all three sub-symptoms).
- **Add** an Unprioritized item for the unported `.meta`/`.rgsp` → `Manipulations` conversion
  (`PMP.cs:891-900`, `PmpExtensions.cs:417`), noting: unreachable today (no upgrade flow converts
  format; `writeModpack` rejects cross-format), fail-loud in `writePmp`, and that
  `/resave x.ttmp2 → y.pmp` is the ready-made golden if ttmp→pmp conversion ever becomes a product
  feature.
- Confirm the `writeTtmp2` findings from Task 5 Step 9 are filed.

- [ ] **Step 4: Update the spec's status**

Change the spec's `Status: proposed` line to `Status: implemented (<date>)` and add a one-paragraph
"What actually happened" note recording anything the oracle contradicted (the `pN/` prefix question,
the `common/{idx}` numbering, the `Image` question, whether `metadataRound` turned out to be
load-time). This is the durable record; the plan gets deleted.

- [ ] **Step 5: Final gate + commit**

```powershell
npm run check; npm run typecheck; npm test
git add test/helpers/corpus-upgrade.ts test/helpers/upgrade-archive-diff.ts scripts/generate-synthetics/build-all.ts BACKLOG.md docs/superpowers/specs/2026-07-12-pmp-writer-regeneration-design.md
git commit -m "test(harness): compare PMP payload member names on every branch; land the absent-file synthetic"
```

- [ ] **Step 6: Delete this plan**

Per `AGENTS.md`: a plan is transient; the spec, code, tests and git history are the record.

```powershell
git rm docs/superpowers/plans/2026-07-12-pmp-writer-regeneration.md
git commit -m "docs(plans): retire the PMP writer regeneration plan (merged)"
```
