# Upgrade diagnostics channel

Status: designed, not implemented
Backlog item: `docs/BACKLOG.md` prioritized #1, which was described inline for want of a design
decision. This spec is that decision; the index entry now links here and is deleted when this ships.

## 1. Why

`upgradeModpack` reproduces several TexTools `catch`-and-continue handlers faithfully. That is
correct — the C# is the spec — but TexTools writes a `Trace` line where we write nothing, so the
planned webpage would report success on a partial upgrade. Three motivations have accumulated:

1. **Swallowed transform failures.** `src/upgrade/unclaimed-hair.ts:213-221` reproduces
   `EndwalkerUpgrade.cs:1498-1501` (`catch (Exception ex) { Trace.WriteLine(ex); continue; }`,
   registered as `docs/TEXTOOLS_BUGS.md` #12). Genuine parse failures vanish, leaving the raw
   pre-transform copies written at `unclaimed-hair.ts:194-195` in place.
2. **Guards that lost their identifying detail.** The two `MergePixelData` guards now throw
   TexTools' error text verbatim, because the expected-failure harness asserts a *matched reason*
   against the oracle's captured trace (`test/helpers/corpus-upgrade.ts:44-58`). Faithful, but they
   no longer name *which* texture failed.
3. **Fatal aborts with no context.** `fileExists` throws `UnportedGapError` for any valid FFXIV path
   outside `chara/`, and two call sites feed it mod-authored, unconstrained paths:
   `repath-hair-mashups.ts` (nine calls per matched material) and — far more heavily travelled —
   `upgradeMaterial`'s gate B at `material.ts:155`, whose `idPath` derives from the mod's own
   normal-sampler path. Nothing catches between there and `upgradeModpack`'s caller, so the whole
   pack aborts naming neither the sampler, the material, nor the option.

This is **not a divergence**. Transform behaviour is unchanged; we only surface what was skipped.

## 2. What this is deliberately not

An earlier draft proposed shaping our diagnostics to match ConsoleTools' `Trace` output, making it a
second AB-testable oracle. **Rejected.** Recorded here because the reasoning outlives the idea.

- **The text can never match.** `Trace.WriteLine(ex)` emits a .NET `Exception.ToString()` — type,
  message, and a stack trace with C# frames. Unreproducible in TypeScript, and coupling user-facing
  warnings to .NET exception dumps makes them worse for users, not better.
- **The event set could match, but the window is a keyhole.** The trace only sees sites where
  TexTools happens to call `Trace.WriteLine`. Bare handlers — `EndwalkerUpgrade.cs:511-514`
  (`catch { continue; }`) and `:1771-1774` (`catch { return null; }`) — emit nothing, so they are
  invisible to a trace oracle as well as to the golden.
- **Most traced sites are already pinned by the golden.** At `:1498` a swallow leaves raw bytes where
  transformed ones belong, so the byte diff already fires. The oracle would be redundant there.
- **The genuinely byte-invisible set is tiny and unverified.** `:641` looks byte-neutral on the
  modpack path for a subtler reason than its `// No-Op` label: with `files != null`, every consumer
  of the `try`'s result sits inside `if (files == null)` (`:647-658`), so `CreateIndexFromNormal`'s
  output is computed and discarded either way. That is one confirmed candidate — too thin to justify
  a fourth ratchet plus a corpus-wide ConsoleTools re-run (the golden cache is keyed on
  `sha256(input)` and stores no traces, and backfilling needs the game install).

**The general problem the trace oracle was reaching for — "control flow differs but bytes match" —
is real and is not solved here.** Matching bytes on an input means we are correct *on that input*;
a control-flow difference absorbed by that input is a *latent* divergence, and the remedy is an
input that makes it visible. That decomposes into two failure modes with different instruments:

- **(a) A decision no input distinguishes.** Detector: mutation testing. General over the whole port,
  needs no oracle (goldens are cached), and its output is a worklist of synthetics to author — which
  feeds the existing `scripts/generate-synthetics/` loop. **Filed as a separate backlog item.**
- **(b) C# behaviour never ported at all.** No branch to mutate, no line to be uncovered — coverage
  is blind to it by construction. Stays answered by the citation-and-reading discipline plus corpus
  widening (prioritized item 3). A C#-side coverage harness was considered and rejected: we
  deliberately split modules, and a large fraction of C# branches (every `files == null` half) are
  structurally unreachable on the modpack path, so the signal arrives buried in noise.

## 3. The seam

Modelled on the TypeScript compiler API: an entry point returns the product *and* its diagnostics,
and the caller decides what to do with them. Unlike `ts.createProgram`, our entry point can also fail
to produce anything at all — the "failing compilation" case — which is a **`data: null`** result
rather than an escaping exception (§4).

```ts
export type UpgradeResult =
  | { ok: true; data: ModpackData; diagnostics: Diagnostic[] }
  | { ok: false; data: null; diagnostics: Diagnostic[] };

export function upgradeModpack(data: ModpackData): UpgradeResult;
```

```ts
interface Diagnostic {
  severity: "error" | "warning";
  code: DiagnosticCode;    // stable enum
  message: string;
  gamePath?: string;
  option?: { group: string; option: string };
  provenance: string;      // "EndwalkerUpgrade.cs · UpgradeEndwalkerHair · 1498-1501"
  cause?: unknown;         // originating error, when there was one
}
```

- **A discriminated union, not a bare nullable.** `ok` narrows, so a caller cannot reach `data`
  without handling failure, and the two fields can never disagree the way an independent `success`
  bool would drift from `data === null`. "Produced but degraded" is deliberately *not* a stored flag
  — it is `ok === true` with an `error` diagnostic present, derivable and impossible to desync.
- **`code` is load-bearing for testability.** Tests assert codes, never prose, so message wording
  stays free to change. TypeScript's numeric diagnostic codes serve the same purpose. `code` is also
  what preserves the port-gap / C#-reachable-failure distinction that §4 removes from the control
  flow — see there.
- **`message` is not free text on the failure path.** For any failure reproducing a TexTools error,
  `message` must stay the **verbatim** C# text, because the expected-failure harness substring-matches
  it against the oracle's captured trace (`test/helpers/corpus-upgrade.ts:44-58`). Motivation 2's
  identifying detail therefore belongs in `gamePath` / `option` / `provenance` — never spliced into
  `message`.
- **`provenance` is unusual for a diagnostics API but is this repo's convention** — every behaviour
  cites its C# source, and a diagnostic *is* a behaviour. With the constraint above it is also how
  motivation 2 gets repaid without touching matched text.
- **`cause` keeps the stack.** The boundary catches everything (§4), so without it a genuine
  programming error would be flattened into a tidy sentence and its stack lost. Not rendered to the
  end user; it exists for tests and debugging.
- **The type lives in `src/util/`, beside `errors.ts`**, which sits below both the format and upgrade
  layers for exactly this reason. `loadModpack` / `writeModpack` are out of scope (§5) but can adopt
  the same type later without a redesign.

Call sites to update: ~25 tests, `test/helpers/corpus-upgrade.ts:94,102`, and the re-export at
`src/index.ts:43`. Mostly mechanical — `const out = upgradeModpack(x)` becomes a narrowed
`const r = upgradeModpack(x)` — with two exceptions that are *not* mechanical and are specified in
§6: `assertMatchedUpgradeFailure` and the success branch of `registerUpgradeCheck`.

## 4. Failure, severity, and the boundary

**This is the invariant the feature most threatens, and it is not negotiable.**

The TypeScript analogy stops at the product: `ts.createProgram` returns errors because it still hands
back a valid program; our pipeline **cannot** produce a valid modpack past a port gap. Where it
resumes is the *shape of the report* — a failed compilation is a result, not an exception. So the
outcomes are:

| Outcome | Meaning |
|---|---|
| **`ok: false`, `data: null`** | No pack came out. Covers **both** a port gap and a C#-reachable failure TexTools also refuses. The fatal diagnostic carries `severity: "error"` and is the last in the array — execution aborted there. There is no third severity: fatality is expressed by `ok`, so a diagnostic read on its own never has to encode it. |
| **`ok: true` + `severity: "error"`** | The upgrade completed but output is degraded — something we tried to transform and could not. TexTools swallowed here too, so bytes still match the golden. `unclaimed-hair.ts:213` is the archetype. |
| **`ok: true` + `severity: "warning"`** | Notable, but the output is as intended. |

### 4.1 The boundary catches everything

`upgradeModpack`'s outermost frame catches every escaping throw and converts it to `ok: false`,
without discriminating on error type:

```ts
try {
  ...pipeline...
} catch (err) {
  return { ok: false, data: null, diagnostics: [...diagnostics, toDiagnostic(err)] };
}
```

The reason is the consumer. These results feed a fairly standard *"list of reasons we could not
upgrade this pack"* UI, and to the person holding a modpack that did not upgrade, "our port has not
reproduced this" and "TexTools refuses this too" are the same event: no pack. Presenting them
through different mechanisms — one a rendered list, the other an unhandled exception — makes the
product worse for no gain the user can perceive. *Operator's call, 2026-08-01.*

**Uniform presentation does not mean uniform data.** The distinction survives, moved from the control
flow into the payload:

- **`code`** says which kind of failure this was. An unported gap carries a distinct code from a
  reproduced TexTools error, so tests, the ratchet, and any future telemetry separate them exactly as
  they do today.
- **`cause`** carries the original error object, so an `UnportedGapError` is still recognizable by
  type and a genuine programming error still has its stack.

Internally **nothing changes**: port gaps still throw `UnportedGapError`, and every ported catch-all
must still re-throw it (AGENTS.md, *Port-gap errors vs. ported catches*). The conversion happens
exactly once, at the public seam. A `catch` *inside* the pipeline that returned `ok: false` instead
of re-throwing would reintroduce the swallow this whole discipline exists to prevent.

### 4.2 The erosion risk changes shape — it does not go away

The original concern was that a fail-loud guard gets downgraded into an `error` diagnostic. That risk
is unchanged in substance, but **the line it crosses has moved**. It is no longer throw-versus-
diagnostic; it is:

> **`ok: false` versus `ok: true`.**

A site that used to throw must still produce `ok: false`. Turning it into `ok: true` plus an `error`
diagnostic hands the user a pack our port silently botched — the class-1 silent-wrong-output failure.
A diagnostic on an `ok: true` result reports what TexTools *also* skipped; `ok: false` reports that no
usable artifact exists. They must not merge.

Because the boundary no longer distinguishes error types, this line is not enforced by the type
system — it is enforced by tests. §6 items 4-6 are that enforcement, and they are load-bearing rather
than incidental coverage.

`warning` may have **no emitter on day one** — all three motivations are "we skipped or failed
something". It stays in the type (the site will want the distinction) but no site should be invented
to justify it.

## 5. Scope

`upgradeModpack` only, matching the backlog item. `loadModpack` and `writeModpack` have their own
skips (`makeTtmpLoadFix`; `readLegacyTtmp`'s empty-pack return, itself a filed backlog item) — out
of scope here, enabled later by the type's placement in `src/util/`.

## 6. Testing

No new oracle or harness infrastructure.

1. **Byte-inertness, free from the existing corpus.** The real risk is not a wrong warning but a
   perturbed output — threading a channel through `upgradeModpack` touches many call sites. All 85
   real + 20 synthetic packs still matching their existing baselines is that proof. Diagnostics are
   report-only, so *any* output change is by definition a bug in this change.
2. **Measure the corpus diagnostic count on day one.** It decides the regression guard, and a
   non-zero count is a finding in its own right: packs silently partially upgraded today that still
   match the golden because TexTools swallowed too. Expected low — the `MergePixelData` guards fail
   the pack outright (`ok: false`, so those packs live in `test/corpus/upgrade-error/` and are scored
   by item 6, not by the ratchet), and `UnportedGapError` was measured at zero
   across all 110 local packs — leaving `unclaimed-hair.ts:213`, whose fire rate is unknown.
3. **Content assertions are synthetic unit tests, one per emitting site.** Hand-built minimal input
   forcing the skip; assert `code` and `gamePath`. Per AGENTS.md, a site no corpus pack reaches must
   be pinned by a synthetic test or it should have been a fail-loud guard instead.
4. **The fatal half rewrites two existing tests.** `test/upgrade/upgrade.test.ts:320` and `:350`
   assert `toBeInstanceOf(UnportedGapError)` on a caught throw. Since the boundary no longer lets it
   escape, they become: `ok === false`, the diagnostic's `code` is the unported-gap code, `cause` is
   an `UnportedGapError`, and — new, repaying motivation 3 — the diagnostic names the sampler and
   material.
5. **The `ok:false`/`ok:true` line gets explicit guards.** Per §4.2 this line is no longer type-
   enforced, so it is these tests or nothing. Those two tests are the guard for the sites they cover;
   any new emitting site needs a sibling test proving it emits on an `ok: true` result *because
   TexTools also skipped there*, not because a fatal case was quietly downgraded.
6. **The expected-failure harness needs a real change, not a call-site update.**
   `assertMatchedUpgradeFailure` (`test/helpers/corpus-upgrade.ts:27-62`) treats "nothing was thrown"
   as proof we diverged; left alone it would fail every oracle-error pack the moment
   `upgradeModpack` stops throwing. It must read failure from **two** channels, because `loadModpack`
   is out of scope (§5), still throws, and is deliberately invoked *inside* the assertion
   (`:86-91` — a pack the oracle refuses at load is legitimately refused by our loader):
   - failure is `threw || !result.ok`;
   - the text matched against the oracle's trace is `err.message` **or** the fatal diagnostic's
     `message` — which is why §3 pins that field to the verbatim C# text.
7. **The success branch needs a new loud guard.** On the real-golden branch of
   `registerUpgradeCheck`, a throw used to fail the test by escaping; an `ok: false` would instead
   sail into `writeModpack(null)`. That branch gains an explicit `if (!ours.ok) expect.fail(...)`:
   *the oracle produced a pack and we did not* is a divergence. This is also the corpus-wide net
   under §4.2 — it catches a fatal site downgraded anywhere the corpus reaches.

## 7. Baseline integration

Diagnostics ratchet through the **existing** `test/corpus/.upgrade-baseline/`, not a fourth root.

`DiffKind` (`test/helpers/upgrade-diff.ts:16-21`) already carries two non-oracle kinds —
`"roundtrip"` (our codec against itself) and `"transform"` (our transform where the oracle wrote
nothing). A **`"diagnostic"` kind is a third of that species**: it records our own behaviour, with no
TexTools artifact on the other side.

This reuses the ratchet machinery untouched:

- `idOf` (`upgrade-baseline.ts:47-49`) already keys on `kind|gamePath#index:status`.
- `compareToBaseline` (`:84-91`) gives the right semantics for free: a **new** diagnostic is a
  regression (fails), a **disappeared** one is an improvement (passes) — subset, exactly as for
  byte diffs.
- `saveBaseline`'s delete-on-empty (`:69-81`) stays correct: a pack's file vanishes only when byte
  diffs *and* diagnostics are both clean, which is the right terminal state.

Recording the diagnostic **set**, not a count, is deliberate: the ratchet is subset-based, which is
meaningless on a scalar, and a set says *which* diagnostic regressed.

**Only `ok: true` runs reach the ratchet.** A pack the oracle refuses returns early on
`registerUpgradeCheck`'s error branch and is scored by §6 item 6; a pack the oracle upgraded but we
could not fails hard at §6 item 7. So a baseline entry always describes a *completed, degraded*
upgrade — which is what makes "a new diagnostic is a regression" the right reading.

**One detail to resolve in implementation.** `idOf` deliberately excludes `detail` as cosmetic, so
the diagnostic's `code` must reach the ratchet identity via `status` or via a narrow `idOf`
extension for this kind — otherwise two different diagnostics on the same file are
indistinguishable. Pick one during implementation and comment the choice at `idOf`.

## 8. Follow-ons

- **Mutation testing** as the general instrument for latent divergence (§2). Separate backlog item.
- `loadModpack` / `writeModpack` adopting `Diagnostic` (§5).
