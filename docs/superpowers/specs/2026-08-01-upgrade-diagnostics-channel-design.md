# Upgrade diagnostics channel

Status: implemented (`feat/upgrade-diagnostics-channel`)
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
   normal-sampler path. The one frame that catches — `materialRound` at `upgrade.ts:186-197` —
   re-throws bare, so the whole pack aborts naming neither the sampler, the material, nor the option
   *even though that frame knows the material*. §4.3 is how that context gets recovered.

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
  modpack path for a subtler reason than the `// No-Op` label at `:643`: with `files != null`, every consumer
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
  widening (`docs/BACKLOG.md` prioritized item 2, "Widen the corpus"). A C#-side coverage harness
  was considered and rejected: we deliberately split modules, and a large fraction of C# branches
  (every `files == null` half) are structurally unreachable on the modpack path, so the signal
  arrives buried in noise.

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
- **`gamePath` and `option` are not free either.** On the failure path they are populated from
  context annotated onto the error as it unwinds (§4.3), because no single frame knows the sampler,
  the material *and* the option. `option` in particular can only be filled by `upgradeModpack`'s own
  loop. Both stay optional: a diagnostic whose frames never reached an annotating catch has neither,
  which is also why §7 cannot key the ratchet on `gamePath` alone.
- **The type lives in `src/util/`, beside `errors.ts`**, which sits below both the format and upgrade
  layers for exactly this reason. `loadModpack` / `writeModpack` are out of scope (§5) but can adopt
  the same type later without a redesign.

`src/index.ts:43` already re-exports `upgradeModpack` as a value and needs no change there, but it
must gain a **type** re-export for `UpgradeResult` / `Diagnostic` / `DiagnosticCode`, which is what
any consumer of the channel actually imports.

Call sites split into three classes, and only the first is mechanical:

1. **Mechanical (~25 tests, `test/helpers/corpus-upgrade.ts:94,102`).** `const out = upgradeModpack(x)`
   becomes a narrowed `const r = upgradeModpack(x)`.
2. **Assertions that silently rot.** `test/upgrade/eye-mask.test.ts:185` and
   `test/upgrade/load-fix-collapse.test.ts:177` assert `expect(() => upgradeModpack(…)).not.toThrow()`.
   Once the boundary catches everything these are **tautologies that pass forever** — they no longer
   distinguish a clean upgrade from `ok: false`. `load-fix-collapse`'s is the more valuable of the
   two: it exists to prove a corrupt duplicate model was dropped at load so the pipeline survives.
   Both become `expect(r.ok).toBe(true)`. They are two of the very few corpus-independent assertions
   that a pack upgrades cleanly, so they belong to §4.2's load-bearing set, not to this list's item 1.
3. **Assertions that fail loudly but change meaning.** `test/upgrade/absent-file-rounds.test.ts:157`
   (`toThrow(/file has no bytes/)`) and `test/upgrade/meta-drop.test.ts:177-181`
   (`toThrow(/unrecognized root path/)`) guard fail-loud throws. They become `ok === false` plus a
   `code` assertion. Less dangerous than class 2 — they break rather than lie — but they are also
   `ok:false`-line guards per §4.2.

Plus `test/helpers/corpus-upgrade.test.ts`, which unit-tests the helper §6.6 rewrites — see there.

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

**Precondition: the archetype emitter does not currently satisfy that.** The §4 table names
`unclaimed-hair.ts:213` as the canonical `ok: true` + `error` site, but that catch is **bare** —
`} catch { … continue; }` (`src/upgrade/unclaimed-hair.ts:213-221`), with no `UnportedGapError`
re-throw. It is a confirmed open instance in
`docs/backlog/2026-07-31-unported-gap-error-sweep.md`, and AGENTS.md names this exact site's history:
the `TextureResizeUnsupported` type that used to keep it from eating the NPOT-resize gap was removed
in 2026-07-22 and the gap went quiet again. `updateEndwalkerHairTextures` sits beneath it and reaches
`resizeToPow2ForMerge` → `resizeForMerge`.

Emitting a diagnostic there *certifies* "TexTools also skipped here". We must not certify that over a
catch which would equally swallow a port gap. **So this work adds
`if (err instanceof UnportedGapError) throw err;` to that catch before, or in the same change as, its
diagnostic** — the guard AGENTS.md's "adding a `catch` is a gap audit" demands, applied to adding an
emitter. Today the exposure is latent (`src/tex/encode.ts:26`'s throw is documented as reachable from
no production path), which is why this is a precondition rather than a live bug.

**A port gap is fatal even inside a swallowing catch.** `docs/backlog/2026-07-31-unported-gap-error-sweep.md`
was written expecting the opposite — that this channel would let a re-thrown gap "surface to the user
without failing the entire upgrade outright". **That assumption is overruled here**, and this spec
resolves the question that backlog item was blocked on. A gap means our port got that file wrong; a
pack containing a silently-wrong file, flagged only by a diagnostic the user may not read, is the
best-effort wrong output AGENTS.md forbids. The whole pack fails. *Operator's call, 2026-08-01.*

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

### 4.3 Context reaches the boundary by annotation, not by wrapping

§6.4 wants the diagnostic to name the sampler, the material, and the option. None of those are known
where the throw originates: `fileExists` (`src/upgrade/reference/file-exists.ts`) has only a path
string, `materialRound`'s catch (`upgrade.ts:186-197`) has the material, and only `upgradeModpack`'s
own loop (`:354-365`) has the group and option. So the context has to travel.

It travels **on the error instance**. `UnportedGapError` gains a `context` array; the ported catches
that already re-throw it push a frame first and re-throw *the same object*:

```ts
// upgrade.ts:186 — materialRound's existing catch, one line richer
} catch (err) {
  if (err instanceof UnportedGapError) {
    err.context.push({ material: mtrl.mtrlPath });
    throw err;             // SAME instance
  }
  return f;                // mirrors EndwalkerUpgrade.cs:522-539
}
```

Chosen over the two alternatives for specific reasons:

- **Not wrap-and-rethrow.** A new error per frame nests `cause`, so §6.4's `cause instanceof
  UnportedGapError` becomes a chain walk, and every wrapper is an opportunity to mangle the verbatim
  `message` the oracle harness substring-matches (§3).
- **Not a threaded collector.** Passing a collector through `materialRound`, `metadataRound`,
  `upgradeRemainingTextures`, `partials` and `unclaimedHair` changes signatures across most of the
  ported surface — exactly the broad-touch byte-inertness risk §6.1 exists to bound.

Annotation costs no signature changes, preserves `cause instanceof UnportedGapError`, and leaves
`message` untouched. It also does not weaken the re-throw contract: the statement is still
`throw err`, merely better labelled — which is what keeps it compatible with AGENTS.md's
*Port-gap errors vs. ported catches* rule rather than carving an exception into it.

`Diagnostic.gamePath` / `option` are populated from the accumulated frames at the boundary. Note the
consequence for `option`: `materialRound` receives a bare `ModpackOption` (`upgrade.ts:164`) and
`ModpackGroup.name` is never passed down, so the `{group, option}` pair can **only** be annotated by
`upgradeModpack`'s own loop, which is the only frame holding both.

### 4.4 Non-fatal diagnostics need a collector, and that is not a contradiction

§4.3 covers the **fatal** path only. A swallowed failure — `unclaimed-hair.ts:213`, the archetype —
never throws, so there is no error instance to ride out on and no unwinding frame to annotate. Those
sites need a **collector passed in**.

This does not reopen the alternative §4.3 rejected. What was rejected there was threading a collector
through the whole ported surface *to carry context for errors that already propagate on their own*.
Here the collector is threaded only to **actual emitting sites** — on day one exactly one call chain,
`partials` → `unclaimedHair`. The two mechanisms divide cleanly by who needs what:

| Path | Mechanism | Why |
|---|---|---|
| Fatal (throws) | Context annotated onto the error (§4.3) | The error already propagates; only its labelling is missing. |
| Non-fatal (swallowed) | Collector parameter to the emitting site | Nothing propagates; the report has to be handed somewhere. |

The collector is a plain `Diagnostic[]` that `upgradeModpack` owns and appends to the result. Keep its
reach minimal: a function takes it **only if it or its callees emit**. Widening it "for symmetry" is
the signature churn §4.3 declined, and it makes byte-inertness (§6.1) harder to argue.

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

   **Sequencing matters here, because §7 puts diagnostics into the same `diff.files` array
   `compareToBaseline` scores** (`test/helpers/corpus-upgrade.ts:204-219`). Existing baselines contain
   no `"diagnostic"` entries, so once wired, the first pack that emits one fails the ratchet for a
   reason that is not a byte change — and the byte-inertness proof is muddied exactly when it is most
   needed. So **take this measurement, and item 2's, before wiring diagnostics into the ratchet**;
   §7 lands after byte-inertness is established, and the bless that records the day-one diagnostic set
   is a separate, deliberate step.
2. **Measure the corpus diagnostic count on day one.** It decides the regression guard, and a
   non-zero count is a finding in its own right: packs silently partially upgraded today that still
   match the golden because TexTools swallowed too. `UnportedGapError` was measured at zero across
   all 110 local packs, so the count is driven by the swallowing sites.

   The `MergePixelData` guards are **site-dependent**, not uniformly fatal. At the round-2 site
   (`src/upgrade/texture.ts:401-403`, deliberately un-`try`'d to match `EndwalkerUpgrade.cs:1842`)
   they fail the pack outright — `ok: false`, so those packs live in `test/corpus/upgrade-error/` and
   are scored by item 6, never by the ratchet. But the *same two guards* inside `resizeForMerge`
   (`texture.ts:177-192`) are also reached from `updateEndwalkerHairTextures`, which runs **inside**
   the swallowing try at `unclaimed-hair.ts:196-221` (faithful — the C# swallows at
   `EndwalkerUpgrade.cs:1495-1502`). On that path a MergePixelData failure yields `ok: true` plus an
   error diagnostic, which *does* reach the ratchet. So the expected count is not "just
   `unclaimed-hair.ts:213`, fire rate unknown" — it is that site plus whatever MergePixelData
   failures the hair path absorbs.

   **Measured, 2026-08-02 (Task 6):** the day-one count came back **zero**, across all ~105 local
   packs (85 real + 20 synthetic). Neither the bare `unclaimed-hair.ts:213` swallow nor a
   hair-path-absorbed `MergePixelData` failure is reached by any local corpus pack. The prediction
   above stands as the reasoning for *why* a non-zero count would not have been surprising; the corpus
   simply doesn't carry an input that reaches either shape. The site is pinned by synthetic unit tests
   instead (§6 item 3), and the ratchet integration (§7) therefore started from an empty day-one
   diagnostic set.
3. **Content assertions are synthetic unit tests, one per emitting site.** Hand-built minimal input
   forcing the skip; assert `code` and `gamePath`. Per AGENTS.md, a site no corpus pack reaches must
   be pinned by a synthetic test or it should have been a fail-loud guard instead.
4. **The fatal half rewrites two existing tests.** `test/upgrade/upgrade.test.ts` asserts
   `toBeInstanceOf(UnportedGapError)` at `:343` and `:363` (inside the cases titled at `:320` / `:350`).
   Since the boundary no longer lets it escape, they become: `ok === false`, the diagnostic's `code`
   is the unported-gap code, `cause` is an `UnportedGapError` (a direct `instanceof`, not a chain
   walk — that is §4.3's reason for annotating rather than wrapping), and — new, repaying motivation 3
   — the diagnostic names the sampler and material via the annotated context.
5. **The `ok:false`/`ok:true` line gets explicit guards.** Per §4.2 this line is no longer type-
   enforced, so it is these tests or nothing. The guard set is the two tests above **plus the four
   throw-dependent call sites in §3's classes 2 and 3** — in particular the two `.not.toThrow()`
   assertions, which must become `ok === true` or they assert nothing at all. Any new emitting site
   needs a sibling test proving it emits on an `ok: true` result *because TexTools also skipped
   there*, not because a fatal case was quietly downgraded.
6. **The expected-failure harness needs a real change, not a call-site update.**
   `assertMatchedUpgradeFailure` (`test/helpers/corpus-upgrade.ts:27-62`) treats "nothing was thrown"
   as proof we diverged; left alone it would fail every oracle-error pack the moment
   `upgradeModpack` stops throwing. It must read failure from **two** channels, because `loadModpack`
   is out of scope (§5), still throws, and is deliberately invoked *inside* the assertion
   (`:86-91` — a pack the oracle refuses at load is legitimately refused by our loader):
   - failure is `threw || !result.ok`;
   - the text matched against the oracle's trace is `err.message` **or** the fatal diagnostic's
     `message` — which is why §3 pins that field to the verbatim C# text.

   The helper has its **own** unit tests (`test/helpers/corpus-upgrade.test.ts`), which pass it a
   `() => void` callback. They change with its contract: the callback now returns an `UpgradeResult`,
   the existing "our upgrade SUCCEEDED → divergence" case is re-expressed as returning `ok: true`, and
   a **fourth case is added** — returned `ok: false` whose fatal diagnostic matches the oracle trace →
   pass. Without that case the new two-channel branch ships untested.
7. **The success branch needs a new loud guard.** On the real-golden branch of
   `registerUpgradeCheck`, a throw used to fail the test by escaping. An `ok: false` will *not*
   silently sail on — `writeModpack` (`src/index.ts:68`) does not accept `ModpackData | null`, so it
   is a compile error, which is §3's discriminated union doing its job. The guard is still required,
   for two reasons the type cannot supply: it produces a **diagnosis** rather than a type error (*the
   oracle produced a pack and we did not* is a divergence, and the message should say so), and it
   forecloses a careless `.data!` at the same site. This is also the corpus-wide net under §4.2 — it
   catches a fatal site downgraded anywhere the corpus reaches.

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

**Three details to resolve in implementation**, all of them shape mismatches between `Diagnostic`
and `FileDiff` rather than open design questions. `idOf` keys on `kind|gamePath#index:status` and
deliberately excludes `detail` as cosmetic, so:

- **`code` must reach the identity.** Otherwise two different diagnostics on the same file are
  indistinguishable. The two candidates are not equal: `DiffStatus` is a **closed union**
  (`"added" | "removed" | "mismatch"`, `test/helpers/upgrade-diff.ts:10`) shared by every other diff
  kind, so widening it to carry a `code` touches all of them — and the regression printout at
  `corpus-upgrade.ts:228` prints `gamePath#index:status` without `kind`, so a bare code there reads
  ambiguously. A narrow `idOf` extension for this kind alone is the smaller blast radius. Comment
  the choice at `idOf`.
- **`gamePath` is required on `FileDiff` (`upgrade-diff.ts:29`) and optional on `Diagnostic` (§3).**
  A diagnostic whose context never reached an annotating frame has no natural key. Specify the
  placeholder (e.g. a sentinel path) rather than leaving it to fall out as `undefined`.
- **`index` is "position within this path's sorted diff list" (`upgrade-diff.ts:30`)** — undefined
  for a diagnostic. Define the ordering that assigns it, or the ratchet identity is unstable across
  runs and every run reads as a regression.

## 8. Follow-ons

- **Mutation testing** as the general instrument for latent divergence (§2). Separate backlog item.
- `loadModpack` / `writeModpack` adopting `Diagnostic` (§5).
- **The `UnportedGapError` sweep** (`docs/backlog/2026-07-31-unported-gap-error-sweep.md`) is
  *unblocked*, not completed, by this spec: §4.1 answers the question it was waiting on (a gap is
  fatal) and takes `unclaimed-hair.ts:213` as a precondition, but the remaining retagging — including
  `load-fixes.ts:109`'s case-by-case adjudication — stays that item's work.
