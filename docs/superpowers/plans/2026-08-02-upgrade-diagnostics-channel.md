# Upgrade diagnostics channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `upgradeModpack` a diagnostics channel — it returns `{ ok, data, diagnostics }` instead of a bare `ModpackData`, so a failed upgrade is a null data pack with reasons rather than an escaping exception, and a *swallowed* transform failure is reported instead of vanishing.

**Architecture:** `upgradeModpack` returns a discriminated union. Its outermost frame catches **every** throw and converts it to `{ ok: false, data: null }` plus an error diagnostic. Internally nothing about the port changes: gaps still throw `UnportedGapError` and ported catch-alls still re-throw it. Fatal context (which sampler, which material, which option) travels **on the error instance** via an annotation array pushed by the catches that already re-throw. Non-fatal diagnostics — a failure TexTools also swallowed — travel via a narrow `Diagnostic[]` collector passed only to sites that actually emit.

**Tech Stack:** TypeScript, Vitest, Biome. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-01-upgrade-diagnostics-channel-design.md`. Read §3, §4.1–4.4, §6 and §7 before starting. The spec is authoritative; where this plan and the spec disagree, the spec wins and the plan is wrong.

## Global Constraints

- **This change must be byte-inert.** Diagnostics are report-only. Any change to upgraded output is by definition a bug in this work (spec §6.1). The corpus ratchet is the proof.
- **`Diagnostic.message` is not free text.** For any failure that reproduces a TexTools error, `message` must be the **verbatim** C# string, unprefixed and unwrapped, because `assertMatchedUpgradeFailure` substring-matches it against the oracle's captured trace (`test/helpers/corpus-upgrade.ts:48-58`). Identifying detail goes in `gamePath` / `option` / `provenance`, never spliced into `message`.
- **A port gap is always fatal.** `UnportedGapError` ⇒ `ok: false`. Never `ok: true` plus an error diagnostic. This is spec §4.1/§4.2 and is the invariant the whole feature most threatens.
- **The boundary catch is the only one that converts.** A `catch` inside the pipeline must never `return { ok: false }`. Ported catch-alls keep re-throwing `UnportedGapError` (AGENTS.md · *Port-gap errors vs. ported catches*).
- **Every line of business logic cites its C# source** as `file · symbol · lines`, verified against `reference/` — not from memory. New *scaffolding* (the `Diagnostic` type itself) has no C# counterpart and should say so rather than inventing a citation.
- **Ratchet integration lands last.** Diagnostics share `diff.files` with byte diffs, so wiring them in before byte-inertness is measured destroys the proof exactly when it matters (spec §6.1). Task 7 must not start before Task 6 is recorded.
- Run `npm run check` before every commit. The end-of-task gate is `npm run check`, `npm run typecheck`, `npm test`, all green.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/util/diagnostic.ts` (new) | `Diagnostic`, `DiagnosticCode`, `UpgradeResult`, `GapContextFrame`. Layer-neutral, beside `errors.ts`, so `src/mtrl/` etc. can reach it without importing "up" from `src/upgrade/`. | 1 |
| `src/util/errors.ts` (modify) | `UnportedGapError` gains `context: GapContextFrame[]`. | 1 |
| `src/upgrade/upgrade.ts` (modify) | The boundary: signature, catch-everything, `toDiagnostic`, context annotation in `materialRound`'s catch and the per-option loop, collector threading to `partials`. | 2, 4, 5 |
| `src/upgrade/unclaimed-hair.ts` (modify) | The re-throw precondition, then the error-diagnostic emitter. | 3, 5 |
| `src/index.ts` (modify) | Type re-exports for `UpgradeResult` / `Diagnostic` / `DiagnosticCode`. | 2 |
| `test/helpers/corpus-upgrade.ts` (modify) | Two-channel failure detection; the `!ours.ok` guard. | 2 |
| `test/helpers/upgrade-diff.ts` (modify) | `"diagnostic"` `DiffKind`. | 7 |
| `test/helpers/upgrade-baseline.ts` (modify) | `idOf` extension carrying `code`. | 7 |
| `test/util/diagnostic.test.ts` (new) | Unit tests for the type helpers and context merging. | 1 |

---

### Task 1: The `Diagnostic` type and error context

**Files:**
- Create: `src/util/diagnostic.ts`
- Modify: `src/util/errors.ts`
- Test: `test/util/diagnostic.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `Diagnostic`, `DiagnosticCode`, `UpgradeResult<T>`, `GapContextFrame`, `mergeGapContext(frames: GapContextFrame[]): GapContextFrame`; `UnportedGapError` with a public `context: GapContextFrame[]` field (default `[]`).

- [ ] **Step 1: Write the failing test**

Create `test/util/diagnostic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeGapContext } from "../../src/util/diagnostic";
import { UnportedGapError } from "../../src/util/errors";

describe("UnportedGapError context", () => {
  it("starts empty and accumulates frames pushed as the error unwinds", () => {
    const err = new UnportedGapError("no bundled data for ui/uld/dummy_id.tex");
    expect(err.context).toEqual([]);
    err.context.push({ gamePath: "ui/uld/dummy_id.tex" });
    err.context.push({ material: "chara/.../mt_c0201e0194_top_a.mtrl" });
    expect(err.context).toHaveLength(2);
  });

  it("keeps the message untouched — identifying detail never goes in message", () => {
    const err = new UnportedGapError("verbatim TexTools text");
    err.context.push({ material: "m.mtrl" });
    expect(err.message).toBe("verbatim TexTools text");
  });
});

describe("mergeGapContext", () => {
  it("merges frames innermost-first so outer frames win on conflict", () => {
    // Frames are pushed as the error unwinds: index 0 is the INNERMOST (deepest) frame.
    // The outer frame knows more about placement (which option), so it takes precedence.
    const merged = mergeGapContext([
      { gamePath: "inner.tex" },
      { material: "outer.mtrl", group: "G", option: "O" },
    ]);
    expect(merged).toEqual({
      gamePath: "inner.tex",
      material: "outer.mtrl",
      group: "G",
      option: "O",
    });
  });

  it("returns an empty frame for no context", () => {
    expect(mergeGapContext([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/util/diagnostic.test.ts`
Expected: FAIL — `src/util/diagnostic.ts` does not exist.

- [ ] **Step 3: Create `src/util/diagnostic.ts`**

```ts
/**
 * The diagnostics channel returned alongside an upgraded modpack.
 *
 * NOT a port of any C# symbol — TexTools reports the same events by writing a .NET
 * `Exception.ToString()` to `Trace`, which we deliberately do not reproduce (see
 * docs/superpowers/specs/2026-08-01-upgrade-diagnostics-channel-design.md §2). This module is
 * scaffolding for OUR seam, so it carries no `file · symbol · lines` citation; the individual
 * diagnostics emitted through it each cite the C# site whose behaviour they report.
 *
 * Lives in `src/util/` beside `errors.ts` for the same reason that file does: both the format layer
 * (`src/mtrl/`, `src/tex/`) and the upgrade layer need it, and `src/mtrl/` must not import "up".
 */

/** Stable diagnostic identities. Tests assert CODES, never prose, so message wording stays free to
 * change (spec §3). Values are the serialized form and reach the ratchet baseline — treat them as
 * a wire format and do not rename one without re-blessing. */
export enum DiagnosticCode {
  /** OUR PORT did not reproduce something. Always fatal (`ok: false`) — spec §4.1. */
  UnportedGap = "unported-gap",
  /** A failure the C# can also produce, escaping to the boundary. Fatal. Message is verbatim C#. */
  UpgradeFailed = "upgrade-failed",
  /** EndwalkerUpgrade.cs:1498-1501's swallow fired: a hair/tail/ear texture transform failed and the
   * raw pre-transform copies were left in place. NOT fatal — TexTools swallows here too, so bytes
   * still match the golden (docs/TEXTOOLS_BUGS.md #12). */
  HairTransformFailed = "hair-transform-failed",
}

/** One frame of context pushed onto an in-flight `UnportedGapError` as it unwinds (spec §4.3).
 * Every field is optional because no single frame knows them all: the throw site has the path, the
 * per-material catch has the material, and only `upgradeModpack`'s own loop has group + option. */
export interface GapContextFrame {
  gamePath?: string;
  material?: string;
  group?: string;
  option?: string;
  /** `file · symbol · lines` of the C# this operation ports, when the annotating frame knows it. */
  provenance?: string;
}

export interface Diagnostic {
  severity: "error" | "warning";
  code: DiagnosticCode;
  /** VERBATIM for reproduced-TexTools failures — `assertMatchedUpgradeFailure` substring-matches
   * this against the oracle's captured trace. Never prefix or wrap it (spec §3). */
  message: string;
  gamePath?: string;
  option?: { group: string; option: string };
  provenance: string;
  /** The originating error, when there was one. Kept so an `UnportedGapError` stays recognizable by
   * type and a genuine bug keeps its stack — the boundary catches everything, so without this the
   * distinction would be lost (spec §4.1). Not rendered to end users. */
  cause?: unknown;
}

/** Result of an upgrade. A discriminated union rather than a nullable field: `ok` narrows, so a
 * caller cannot reach `data` without handling failure, and the two can never disagree (spec §3).
 * "Produced but degraded" is deliberately not stored — it is `ok === true` with an `error`
 * diagnostic present. */
export type UpgradeResult<T> =
  | { ok: true; data: T; diagnostics: Diagnostic[] }
  | { ok: false; data: null; diagnostics: Diagnostic[] };

/** Flatten accumulated frames into one. Frames arrive innermost-first (index 0 is deepest, pushed
 * by the catch closest to the throw), and later/outer frames overwrite earlier ones for the same
 * key because the outer frame knows more about WHERE the failure sits. */
export function mergeGapContext(frames: GapContextFrame[]): GapContextFrame {
  return frames.reduce<GapContextFrame>((acc, f) => ({ ...acc, ...f }), {});
}
```

- [ ] **Step 4: Add `context` to `UnportedGapError`**

In `src/util/errors.ts`, keep the whole existing doc comment and change only the class body:

```ts
export class UnportedGapError extends Error {
  /** Context frames pushed by ported catches as this error unwinds (spec §4.3). The catches that
   * already re-throw this type push a frame FIRST and re-throw the SAME instance, so the boundary
   * can name the sampler, the material and the option without any signature changing and without
   * wrapping (which would nest `cause` and risk mangling `message`). Pushing before `throw err` does
   * not weaken the re-throw contract — the statement is still `throw err`, merely better labelled. */
  readonly context: GapContextFrame[] = [];
}
```

Add the import at the top of `errors.ts`:

```ts
import type { GapContextFrame } from "./diagnostic";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/util/diagnostic.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Verify nothing else broke**

Run: `npm run check && npm run typecheck`
Expected: both clean. No existing call site constructs `UnportedGapError` with a second argument, so adding a defaulted field is source-compatible.

- [ ] **Step 7: Commit**

```bash
git add src/util/diagnostic.ts src/util/errors.ts test/util/diagnostic.test.ts
git commit -m "feat(upgrade): add Diagnostic types and UnportedGapError context frames"
```

---

### Task 2: The seam — `upgradeModpack` returns `UpgradeResult`

This task is deliberately large because it is atomic: the signature cannot be half-changed. Its deliverable is *the whole suite green with the new seam in place and no behaviour change*.

**Files:**
- Modify: `src/upgrade/upgrade.ts:343-374`
- Modify: `src/index.ts:43`
- Modify: `test/helpers/corpus-upgrade.ts:27-62`, `:94`, `:102`, and the success branch
- Modify: `test/helpers/corpus-upgrade.test.ts`
- Modify: `test/upgrade/upgrade.test.ts` (9 call sites), `test/upgrade/absent-file-rounds.test.ts` (3), `test/upgrade/eye-mask.test.ts` (2), `test/upgrade/meta-drop.test.ts` (2), `test/upgrade/load-fix-collapse.test.ts` (1), `test/upgrade/resolve-highlight.test.ts` (1), `test/upgrade/skin-paths.test.ts` (1)

**Interfaces:**
- Consumes: `Diagnostic`, `DiagnosticCode`, `UpgradeResult`, `GapContextFrame`, `mergeGapContext` (Task 1).
- Produces: `upgradeModpack(data: ModpackData): UpgradeResult<ModpackData>`; `assertMatchedUpgradeFailure(name: string, oracleMessage: string, runUpgrade: () => UpgradeResult<ModpackData>): void`.

- [ ] **Step 1: Write the failing test for the boundary**

Append to `test/upgrade/upgrade.test.ts`:

```ts
describe("upgradeModpack (boundary)", () => {
  it("returns ok:true and the upgraded data on success", () => {
    const r = upgradeModpack(sampleData());
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.data).toBeDefined();
    expect(r.diagnostics).toEqual([]);
  });

  it("converts an escaping throw into ok:false with a null data pack, never re-throwing", () => {
    // meta-drop's `parseMetaRoot` guard is a fail-loud throw with no C# analogue; it is the
    // cheapest way to reach the boundary from a constructed input.
    const input = modpackWithSingleFile(
      "chara/nonsense/root.meta",
      new Uint8Array([0, 0, 0, 0]),
      FileStorageType.RawUncompressed,
    );
    const r = upgradeModpack(input);
    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0].severity).toBe("error");
  });
});
```

If `modpackWithSingleFile` / `sampleData` are not already in scope at the bottom of that file, reuse the helpers the existing `describe` blocks use — do not re-declare them.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/upgrade/upgrade.test.ts -t "boundary"`
Expected: FAIL — `r.ok` is undefined (`upgradeModpack` still returns `ModpackData`), and the second case throws instead of returning.

- [ ] **Step 3: Change the signature and add the boundary**

In `src/upgrade/upgrade.ts`, add imports:

```ts
import {
  type Diagnostic,
  DiagnosticCode,
  mergeGapContext,
  type UpgradeResult,
} from "../util/diagnostic";
import { UnportedGapError } from "../util/errors";
```

(`UnportedGapError` is likely already imported — do not duplicate it.)

Add above `upgradeModpack`:

```ts
/** Convert an error escaping the pipeline into the fatal diagnostic the caller sees.
 *
 * Catches EVERY error type, not just `UnportedGapError` (spec §4.1): to someone holding a modpack
 * that did not upgrade, "our port has not reproduced this" and "TexTools refuses this too" are the
 * same event — no pack — and they are rendered through one list. The distinction survives in `code`
 * and `cause`, which is what tests and the ratchet read.
 *
 * `message` is passed through UNCHANGED. `assertMatchedUpgradeFailure` substring-matches it against
 * the oracle's captured trace, so any prefix here silently breaks the expected-failure golden.
 */
function toDiagnostic(err: unknown): Diagnostic {
  const gap = err instanceof UnportedGapError ? err : undefined;
  const ctx = mergeGapContext(gap?.context ?? []);
  return {
    severity: "error",
    code: gap ? DiagnosticCode.UnportedGap : DiagnosticCode.UpgradeFailed,
    message: err instanceof Error ? err.message : String(err),
    gamePath: ctx.gamePath ?? ctx.material,
    option:
      ctx.group !== undefined && ctx.option !== undefined
        ? { group: ctx.group, option: ctx.option }
        : undefined,
    provenance:
      ctx.provenance ?? "src/upgrade/upgrade.ts · upgradeModpack · boundary",
    cause: err,
  };
}
```

Then rewrite the entry point. Keep the entire existing doc comment above it and keep the body identical — only the wrapper and the returns change:

```ts
export function upgradeModpack(data: ModpackData): UpgradeResult<ModpackData> {
  const diagnostics: Diagnostic[] = [];
  try {
    const out = cloneModpack(data);
    // ... existing body verbatim, unchanged ...
    partials(out, computeUnusedTextures(allTextures, targets));
    return { ok: true, data: out, diagnostics };
  } catch (err) {
    // The ONE conversion point (spec §4.1). No `catch` inside the pipeline may do this: ported
    // catch-alls must keep re-throwing UnportedGapError so a port gap never becomes a silent skip.
    return { ok: false, data: null, diagnostics: [...diagnostics, toDiagnostic(err)] };
  }
}
```

- [ ] **Step 4: Add the type re-exports**

In `src/index.ts`, beside the existing `export { cloneModpack, upgradeModpack }` line:

```ts
export {
  type Diagnostic,
  DiagnosticCode,
  type UpgradeResult,
} from "./util/diagnostic";
export { UnportedGapError } from "./util/errors";
```

`DiagnosticCode` is an enum (a value), so it is a value export, not `type`.

- [ ] **Step 5: Update the mechanical call sites**

Run `npm run typecheck` and fix each reported site. The pattern is:

```ts
// before
const out = upgradeModpack(input);
// after
const r = upgradeModpack(input);
expect(r.ok).toBe(true);
if (!r.ok) throw new Error("unreachable");
const out = r.data;
```

Prefer a local helper in files with several call sites rather than repeating the narrowing:

```ts
function upgradedOk(input: ModpackData): ModpackData {
  const r = upgradeModpack(input);
  if (!r.ok) {
    throw new Error(
      `expected a successful upgrade, got: ${r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ")}`,
    );
  }
  return r.data;
}
```

Do **not** apply this to the four assertion sites in Step 6 — they assert the outcome rather than consume it.

- [ ] **Step 6: Fix the four throw-dependent assertions**

These do not typecheck-fail; two of them **silently become tautologies** (spec §3, class 2). All four must change.

`test/upgrade/eye-mask.test.ts:185` and `test/upgrade/load-fix-collapse.test.ts:177`:

```ts
// before — passes forever once the boundary stops throwing, proving nothing
expect(() => upgradeModpack(data)).not.toThrow();
// after
const r = upgradeModpack(data);
expect(r.ok).toBe(true);
```

`test/upgrade/absent-file-rounds.test.ts:157` and `test/upgrade/meta-drop.test.ts:177-181`:

```ts
// before
expect(() => upgradeModpack(data)).toThrow(/file has no bytes/);
// after
const r = upgradeModpack(data);
expect(r.ok).toBe(false);
expect(r.diagnostics[0].message).toMatch(/file has no bytes/);
```

Use each file's own existing regex; do not substitute the example.

- [ ] **Step 7: Make the expected-failure harness read both channels**

In `test/helpers/corpus-upgrade.ts`, replace the signature and the detection half of `assertMatchedUpgradeFailure`. Keep the matched-reason block and the trailing `console.log` exactly as they are:

```ts
export function assertMatchedUpgradeFailure(
  name: string,
  oracleMessage: string,
  runUpgrade: () => UpgradeResult<ModpackData>,
): void {
  // TWO channels, because the two halves of the pipeline fail differently (spec §6.6):
  //   - `loadModpack` is out of scope for the diagnostics channel (spec §5) and still THROWS. It is
  //     deliberately called inside this assertion (see registerUpgradeCheck) because a pack the
  //     oracle refuses at LOAD is refused just as legitimately by our loader.
  //   - `upgradeModpack` no longer throws; it returns ok:false.
  let ourMessage: string | undefined;
  try {
    const result = runUpgrade();
    if (!result.ok) {
      // The fatal diagnostic is the LAST one — execution aborted there (spec §4).
      ourMessage = result.diagnostics[result.diagnostics.length - 1]?.message;
    }
  } catch (e) {
    ourMessage = e instanceof Error ? e.message : String(e);
  }
  if (ourMessage === undefined) {
    expect.fail(
      `${name}: ConsoleTools /upgrade errored but our upgrade SUCCEEDED — divergence.\n` +
        `Oracle error was:\n${oracleMessage}`,
    );
  }
  // ... existing matched-reason block unchanged, using `ourMessage` ...
}
```

- [ ] **Step 8: Add the `!ours.ok` guard on the success branch**

In `registerUpgradeCheck`, replace `const oursModel = upgradeModpack(source);` with:

```ts
const oursResult = upgradeModpack(source);
// The oracle produced a pack and we did not — a divergence, and the corpus-wide net under spec
// §4.2 catching a fatal site quietly downgraded. `writeModpack` would reject a null anyway (it
// takes ModpackData, not ModpackData | null), but a type error names no pack and gives no
// reasons; this does. It also forecloses a careless `.data!` here later.
if (!oursResult.ok) {
  expect.fail(
    `${name}: ConsoleTools /upgrade produced a pack but OUR upgrade failed — divergence.\n` +
      oursResult.diagnostics.map((d) => `  [${d.code}] ${d.message}`).join("\n"),
  );
}
const oursModel = oursResult.data;
```

- [ ] **Step 9: Update the harness's own unit tests**

In `test/helpers/corpus-upgrade.test.ts`, the callbacks now return an `UpgradeResult`. Update the existing three and add a fourth:

```ts
const okResult = (): UpgradeResult<ModpackData> => ({
  ok: true,
  data: {} as ModpackData,
  diagnostics: [],
});
const failedWith = (message: string): UpgradeResult<ModpackData> => ({
  ok: false,
  data: null,
  diagnostics: [
    {
      severity: "error",
      code: DiagnosticCode.UpgradeFailed,
      message,
      provenance: "test",
    },
  ],
});

it("passes when our upgrade returns ok:false whose fatal diagnostic matches the oracle", () => {
  const oracleMessage =
    "System.IO.InvalidDataException: Cannot upgrade modpack - Highlight/Visibility options are " +
    "unresolveable either due to missing files or too much complexity.";
  expect(() =>
    assertMatchedUpgradeFailure("m.pmp", oracleMessage, () =>
      failedWith(
        "Highlight/Visibility options are unresolveable either due to missing files or too much complexity.",
      ),
    ),
  ).not.toThrow();
});
```

The existing "our upgrade SUCCEEDS where the oracle errored" case becomes `() => okResult()`. The existing throw-based cases stay as they are — they still exercise the `loadModpack` channel.

- [ ] **Step 10: Run the full suite**

Run: `npm run check && npm run typecheck && npm test`
Expected: all green, **same pass/skip counts as before this task** (543 files, 1986 passed, 1 skipped). A changed count means a call site was missed or a behaviour moved.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(upgrade): return UpgradeResult from upgradeModpack

The outermost frame now catches every throw and converts it to
{ ok: false, data: null } plus an error diagnostic. Internally nothing
changes: gaps still throw and ported catch-alls still re-throw them.

Fixes four throw-dependent assertions, two of which would otherwise have
become tautologies that pass forever, and teaches the expected-failure
harness to read failure from both channels (loadModpack still throws)."
```

---

### Task 3: Precondition — the archetype emitter must re-throw port gaps

Spec §4.1 makes this a precondition of emitting there: we cannot certify `unclaimed-hair.ts:213` as a "TexTools also skipped here" site while it would equally swallow a port gap.

**Files:**
- Modify: `src/upgrade/unclaimed-hair.ts:213-221`
- Test: `test/upgrade/unclaimed-hair.test.ts` (create if absent)

**Interfaces:**
- Consumes: `UnportedGapError` (existing).
- Produces: nothing new.

- [ ] **Step 1: Check whether the sibling has the same catch**

Read `updateUnclaimedHairAccessory` (`src/upgrade/unclaimed-hair.ts:282` onward). If it has its own bare catch-all, it gets the identical treatment in this task. If it does not, note that in the commit message rather than adding one.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { UnportedGapError } from "../../src/util/errors";

describe("updateUnclaimedHairTextures — port-gap escape", () => {
  it("re-throws UnportedGapError rather than swallowing it as a transform failure", () => {
    // The catch at unclaimed-hair.ts:213 faithfully reproduces EndwalkerUpgrade.cs:1498-1501's
    // swallow of ANY transform exception. It must still not absorb OUR port-gap signal: doing so
    // leaves the raw pre-transform copies in place and reports nothing, which is the class-1
    // silent-wrong-output failure the guard exists to prevent.
    expect(() => {
      try {
        throw new UnportedGapError("simulated gap beneath the transform");
      } catch (err) {
        if (err instanceof UnportedGapError) throw err;
      }
    }).toThrow(UnportedGapError);
  });
});
```

Replace this placeholder shape with a real one: build the minimal option that reaches the transform and stub the gap. If no constructed input can reach a throw beneath that catch (the sweep doc notes `src/tex/encode.ts:26` is reachable from no production path today), assert the guard by injecting a table entry that forces `resizeToPow2ForMerge` down the NPOT path. If neither is reachable, say so in the commit message and rely on Task 5's test, which exercises the same catch.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run test/upgrade/unclaimed-hair.test.ts`
Expected: FAIL — the bare catch swallows and the function returns normally.

- [ ] **Step 4: Add the guard**

```ts
      } catch (err) {
        // Bare catch-all, faithfully reproducing EndwalkerUpgrade.cs:1498-1501
        // (`catch (Exception ex) { Trace.WriteLine(ex); continue; }`): it swallows ANY transform
        // failure — a genuinely corrupt or malformed input as much as any other — leaving the raw
        // copies already written above in place.
        // See docs/TEXTOOLS_BUGS.md #12 for why this catch-all is itself a TexTools defect we
        // reproduce rather than narrow.
        //
        // It must NOT absorb a port-gap signal. Only failures the C# can ITSELF produce may be
        // swallowed here; an UnportedGapError says our port is incomplete, which the C# cannot
        // express and which must reach the boundary as a fatal ok:false (spec §4.1). This site
        // has form: the TextureResizeUnsupported type that used to keep the NPOT-resize gap out of
        // this catch was removed in 2026-07-22 and the gap went quiet again (AGENTS.md).
        if (err instanceof UnportedGapError) throw err;
        continue;
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/upgrade/unclaimed-hair.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the corpus**

Run: `npm test`
Expected: green. A pack that now fails where it used to pass is a **finding**, not something to bless — a real port gap this catch was hiding. Report it and stop; do not re-bless the baseline (`docs/backlog/2026-07-31-unported-gap-error-sweep.md` step 4).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(upgrade): stop unclaimed-hair's catch-all swallowing port gaps

Precondition for emitting a diagnostic there: we cannot certify the site
as 'TexTools also skipped here' while it would equally eat an
UnportedGapError. Burns down one confirmed instance from the sweep
backlog."
```

---

### Task 4: Context annotation, and the two fatal tests

**Files:**
- Modify: `src/upgrade/upgrade.ts:186-197` (materialRound's catch), `:354-365` (the per-option loop)
- Modify: `test/upgrade/upgrade.test.ts:337-344`, `:357-364`

**Interfaces:**
- Consumes: `GapContextFrame`, `UnportedGapError.context` (Task 1); `toDiagnostic` (Task 2).
- Produces: nothing new — this fills fields already on `Diagnostic`.

- [ ] **Step 1: Write the failing test**

Rewrite the two cases in `test/upgrade/upgrade.test.ts` (currently asserting `toBeInstanceOf(UnportedGapError)` at `:343` and `:363`). The gate-B one:

```ts
    const r = upgradeModpack(input);

    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
    const d = r.diagnostics[r.diagnostics.length - 1];
    expect(d.code).toBe(DiagnosticCode.UnportedGap);
    // A DIRECT instanceof, not a cause-chain walk — that is exactly why spec §4.3 annotates the
    // error in place instead of wrapping it at each frame.
    expect(d.cause).toBeInstanceOf(UnportedGapError);
    // Motivation 3: the fatal report now names WHICH material aborted the pack, which the bare
    // propagating throw never did even though materialRound's frame knew it.
    expect(d.gamePath).toBe(mtrlPath);
    expect(d.option).toEqual({ group: "Default", option: "Default" });
```

Use whatever group/option names `modpackWithSingleFile` actually produces — read the helper rather than assuming `"Default"`.

The `serializeMtrl` empty-sampler case gets the same shape with its own `mtrlPath`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/upgrade/upgrade.test.ts -t "unported gap propagation"`
Expected: FAIL — `d.gamePath` and `d.option` are `undefined`; nothing annotates yet.

- [ ] **Step 3: Annotate in materialRound's catch**

`src/upgrade/upgrade.ts:186-197` — add one line before the existing re-throw, keeping the whole existing comment:

```ts
    } catch (err) {
      // ... existing comment, unchanged ...
      if (err instanceof UnportedGapError) {
        // Annotate, then re-throw the SAME instance (spec §4.3): this frame knows the material,
        // which neither the throw site (a bare path) nor the boundary does. Pushing before the
        // throw does not weaken the re-throw contract — the statement is still `throw err`.
        err.context.push({ material: path });
        throw err;
      }
      return f;
    }
```

Use the identifier `materialRound`'s loop actually binds for the game path (`upgradeOne(path, f)` — so `path`). Verify against the file; do not guess.

- [ ] **Step 4: Annotate the group/option in the per-option loop**

Wrap the pass-1 loop body in `upgradeModpack` (`:354-365`):

```ts
  for (const group of out.groups) {
    for (const option of group.options) {
      try {
        metadataRound(option);
        for (const info of materialRound(option)) {
          const k = targetKey(info);
          if (!targets.has(k)) targets.set(k, info);
        }
        for (const p of option.files.keys()) {
          if (p.endsWith(".tex")) allTextures.add(p);
        }
      } catch (err) {
        // NOT a ported catch — it swallows nothing and changes no control flow. It exists only to
        // annotate: this is the only frame holding BOTH the group and the option, because
        // materialRound takes a bare ModpackOption and ModpackGroup.name is never passed down
        // (spec §4.3). Everything is re-thrown, port gap or not.
        if (err instanceof UnportedGapError) {
          err.context.push({ group: group.name, option: option.name });
        }
        throw err;
      }
    }
  }
```

Confirm the field names on `ModpackGroup` / `ModpackOption` in `src/model/modpack.ts` before writing `group.name` / `option.name`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/upgrade/upgrade.test.ts`
Expected: PASS.

- [ ] **Step 6: Prove byte-inertness**

Run: `npm test`
Expected: green, unchanged counts. This task adds a `try` around a hot loop and must not alter a single output byte.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(upgrade): annotate port-gap errors with material, group and option

Repays motivation 3: a fatal upgrade now names which sampler, material
and option aborted it. Context rides on the error instance and each catch
re-throws the same object, so cause stays a direct instanceof and the
verbatim message is untouched."
```

---

### Task 5: The non-fatal emitter — report what TexTools swallowed

**Files:**
- Modify: `src/upgrade/unclaimed-hair.ts:213-221`, `:146-150` (signature)
- Modify: `src/upgrade/upgrade.ts:268-289` (`partials`), `:372` (its call)
- Test: `test/upgrade/unclaimed-hair.test.ts`

**Interfaces:**
- Consumes: `Diagnostic`, `DiagnosticCode` (Task 1); the re-throw guard (Task 3).
- Produces: `updateUnclaimedHairTextures(option, contained, table, diagnostics: Diagnostic[])`; `partials(data, unused, diagnostics: Diagnostic[])`.

- [ ] **Step 1: Write the failing test**

```ts
it("reports a swallowed hair-transform failure instead of silently leaving raw copies", () => {
  // Build an option whose hair normal/specular pair reaches the transform and fails inside it
  // (a truncated .tex body is the cheapest). TexTools swallows here too
  // (EndwalkerUpgrade.cs:1498-1501, TEXTOOLS_BUGS.md #12), so the upgrade still SUCCEEDS and the
  // bytes still match the golden — the only change is that we now say it happened.
  const r = upgradeModpack(input);

  expect(r.ok).toBe(true);
  const d = r.diagnostics.find((x) => x.code === DiagnosticCode.HairTransformFailed);
  expect(d).toBeDefined();
  expect(d?.severity).toBe("error");
  expect(d?.gamePath).toBe(normDest);
  expect(d?.provenance).toContain("EndwalkerUpgrade.cs");
  // The raw pre-transform copies written at unclaimed-hair.ts:194-195 are still in place —
  // reporting must not change the transform.
  if (!r.ok) throw new Error("unreachable");
  expect(r.data.groups[0].options[0].files.has(normDest)).toBe(true);
});
```

Fill in `input` / `normDest` from the fixtures the existing hair tests use. If none exist, build the minimal pair from `HAIR_REGEXES`' expected naming and a deliberately truncated `.tex`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/upgrade/unclaimed-hair.test.ts`
Expected: FAIL — `r.diagnostics` is empty.

- [ ] **Step 3: Thread the collector**

Spec §4.4: a collector, not annotation, because nothing throws here. Keep its reach minimal — a function takes it only if it or its callees emit.

`updateUnclaimedHairTextures` gains a fourth parameter:

```ts
export function updateUnclaimedHairTextures(
  option: ModpackOption,
  contained: Set<string>,
  table: HairMaterialTable,
  /** Collector for swallowed-failure reports (spec §4.4). Non-fatal diagnostics cannot ride out on
   * an error the way port gaps do (§4.3), because this path deliberately throws nothing. */
  diagnostics: Diagnostic[],
): void {
```

`partials` gains the same and forwards it; `upgradeModpack` passes its own array:

```ts
  partials(out, computeUnusedTextures(allTextures, targets), diagnostics);
```

Do **not** thread it into `updateUnclaimedHairAccessory`, `updateSkinPaths` or `updateEyeMask` unless Task 3 Step 1 found a swallow there that this task is also reporting.

- [ ] **Step 4: Emit at the catch**

```ts
      } catch (err) {
        // ... the whole existing comment from Task 3, unchanged ...
        if (err instanceof UnportedGapError) throw err;
        // Report what TexTools also skipped. NOT fatal: the C# swallows here, so the upgrade
        // completes and the bytes still match the golden — the raw pre-transform copies written
        // above stay in place. This is spec §4's `ok: true` + severity "error" archetype.
        diagnostics.push({
          severity: "error",
          code: DiagnosticCode.HairTransformFailed,
          message: err instanceof Error ? err.message : String(err),
          gamePath: normDest,
          provenance:
            "EndwalkerUpgrade.cs · UpdateUnclaimedHairTextures · 1498-1501",
          cause: err,
        });
        continue;
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/upgrade/unclaimed-hair.test.ts`
Expected: PASS.

- [ ] **Step 6: Prove byte-inertness again**

Run: `npm test`
Expected: green, unchanged counts.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(upgrade): report hair transforms TexTools swallowed

The archetype ok:true + error diagnostic. Non-fatal by construction: the
C# swallows at EndwalkerUpgrade.cs:1498-1501, so the pack still upgrades
and the bytes still match the golden -- we only stop being silent."
```

---

### Task 6: Measure the day-one corpus diagnostic count

A measurement, not a code change. Its output decides Task 7's baseline and is a finding in its own right: any non-zero count is a set of packs silently partially upgraded today (spec §6.2).

**Files:** none modified. Produces a note for the PR description.

- [ ] **Step 1: Add a temporary count to the harness**

In `registerUpgradeCheck`, after the `!oursResult.ok` guard:

```ts
if (oursResult.diagnostics.length > 0) {
  console.log(
    `[upgrade] ${name}: ${oursResult.diagnostics.length} diagnostics — ` +
      oursResult.diagnostics.map((d) => d.code).join(", "),
  );
}
```

- [ ] **Step 2: Run the corpus and capture the output**

Run: `npm test 2>&1 | Select-String "diagnostics —"`
Record: total packs emitting, total diagnostics, and the code histogram.

- [ ] **Step 3: Interpret before proceeding**

Expect a low count. Per spec §6.2 it is driven by `unclaimed-hair.ts:213` (rate unknown) **plus** MergePixelData failures absorbed on the hair path — the round-2 MergePixelData site is fatal and lives in `test/corpus/upgrade-error/`, but the same guards inside `resizeForMerge` sit within the swallow.

A **large** count means something else is firing; investigate before blessing anything. A count of **zero** means Task 5's emitter has no corpus coverage and is pinned only by its synthetic test — note that in the PR rather than treating it as a clean result.

- [ ] **Step 4: Keep the log line**

It is genuinely useful and costs nothing on a clean pack. Commit it with the measurement in the message.

```bash
git add -A
git commit -m "test(upgrade): log per-pack diagnostic counts across the corpus

Day-one measurement: <N> of <M> packs emit <K> diagnostics (<histogram>)."
```

---

### Task 7: Ratchet integration

**Do not start before Task 6 is recorded.** Diagnostics share `diff.files` with byte diffs, so wiring them in earlier means the first emitting pack fails the ratchet for a non-byte reason and the byte-inertness proof is gone (spec §6.1).

**Files:**
- Modify: `test/helpers/upgrade-diff.ts:16-21`, `:27-33`
- Modify: `test/helpers/upgrade-baseline.ts:47-49`
- Modify: `test/helpers/corpus-upgrade.ts` (fold diagnostics into `diff.files`)

**Interfaces:**
- Consumes: `Diagnostic`, `DiagnosticCode`.
- Produces: `DiffKind` gains `"diagnostic"`; `FileDiff` gains an optional `code?: string`.

- [ ] **Step 1: Write the failing test**

In `test/helpers/upgrade-baseline.test.ts` (create if absent):

```ts
it("distinguishes two diagnostics on the same file by code", () => {
  const a: FileDiff = { kind: "diagnostic", gamePath: "x.tex", index: 0, status: "added", code: "hair-transform-failed" };
  const b: FileDiff = { kind: "diagnostic", gamePath: "x.tex", index: 0, status: "added", code: "unported-gap" };
  // b must NOT be allowed by a baseline containing only a — otherwise a regression to a different
  // failure on the same file passes silently.
  expect(compareToBaseline([b], [a]).ok).toBe(false);
  expect(compareToBaseline([a], [a]).ok).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/helpers/upgrade-baseline.test.ts`
Expected: FAIL — `idOf` ignores `code`, so `b` is allowed.

- [ ] **Step 3: Add the kind and the field**

In `upgrade-diff.ts`:

```ts
export type DiffKind =
  | "payload"
  | "manifest"
  | "structure"
  | "roundtrip"
  | "transform"
  | "diagnostic";
// "diagnostic" is the THIRD non-oracle kind, alongside "roundtrip" and "transform": it records OUR
// upgrade reporting that it skipped or failed something, with no TexTools artifact on the other
// side. Only ok:true runs reach it — a pack the oracle refuses returns early on the error branch,
// and a pack the oracle upgraded but we could not fails hard at the !ours.ok guard. So a
// "diagnostic" entry always describes a COMPLETED, DEGRADED upgrade, which is what makes "a new
// one is a regression" the right reading. See the diagnostics-channel spec §7.
```

And on `FileDiff`:

```ts
  /** Diagnostic code, for `kind: "diagnostic"` only. Part of the ratchet identity — see idOf. */
  code?: string;
```

- [ ] **Step 4: Extend `idOf`**

```ts
function idOf(f: FileDiff): string {
  // `code` participates for diagnostics ONLY. It cannot ride in `status`: DiffStatus is a closed
  // union shared by every other kind, and the regression printout (corpus-upgrade.ts) prints
  // `gamePath#index:status` without `kind`, so a bare code there would read ambiguously. Narrowing
  // the extension to this kind keeps the blast radius to one line. See the spec §7.
  const code = f.kind === "diagnostic" && f.code ? `@${f.code}` : "";
  return `${f.kind ?? "payload"}|${f.gamePath}#${f.index}:${f.status}${code}`;
}
```

- [ ] **Step 5: Fold diagnostics into the diff**

In `corpus-upgrade.ts`, replace the temporary log from Task 6 with a real mapping:

```ts
// Stable identity requires a stable ORDER (idOf keys on index), so sort before indexing: by
// gamePath then code. `gamePath` is required on FileDiff but optional on Diagnostic, so a
// diagnostic with no path gets an explicit sentinel rather than falling through as undefined.
const diagnostics: FileDiff[] = [...oursResult.diagnostics]
  .sort((a, b) =>
    (a.gamePath ?? "").localeCompare(b.gamePath ?? "") ||
    a.code.localeCompare(b.code),
  )
  .map((d, i) => ({
    kind: "diagnostic" as const,
    gamePath: d.gamePath ?? "(no path)",
    index: i,
    status: "added" as const,
    code: d.code,
    detail: d.message,
  }));
```

and add `...diagnostics` to the `diff.files` spread.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/helpers/upgrade-baseline.test.ts`
Expected: PASS.

- [ ] **Step 7: Bless, then verify the ratchet holds**

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
npm test
```

Expected: the second run is green with no regressions. Inspect the newly written baseline files — every added entry must be `kind: "diagnostic"`. **A new byte entry means this task perturbed output and must be investigated, not blessed.**

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test(upgrade): ratchet diagnostics through the existing upgrade baseline

A third non-oracle DiffKind alongside roundtrip and transform, reusing the
subset semantics: a new diagnostic is a regression, a disappeared one is
an improvement. idOf carries the code for this kind only."
```

---

### Task 8: Documentation and PR

**Files:**
- Modify: `docs/BACKLOG.md`, `docs/superpowers/specs/2026-08-01-upgrade-diagnostics-channel-design.md`
- Delete: this plan

- [ ] **Step 1: Close the backlog item**

Remove prioritized item 1 (the diagnostics channel) from `docs/BACKLOG.md`, since it shipped. Leave `docs/backlog/2026-07-31-unported-gap-error-sweep.md` in place — this work answered its blocked question and burned down one instance, but the sweep itself is unfinished.

- [ ] **Step 2: Flip the spec's status line**

`Status: designed, not implemented` → `Status: implemented (<PR link or branch>)`. Leave the rest of the spec as the durable record.

- [ ] **Step 3: Delete the plan**

AGENTS.md: a plan is committed when written so it lives in branch history, then deleted on the branch before the PR, so reviewers and the merge see only the durable spec and the shipped work.

```bash
git rm docs/superpowers/plans/2026-08-02-upgrade-diagnostics-channel.md
```

- [ ] **Step 4: Final gate**

Run: `npm run check && npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 5: Commit and open the PR**

```bash
git add -A
git commit -m "docs: close the diagnostics-channel backlog item and retire the plan"
git push -u origin feat/upgrade-diagnostics-channel
```

The PR description must carry Task 6's measurement — it is the finding this work produced, not an implementation detail.
