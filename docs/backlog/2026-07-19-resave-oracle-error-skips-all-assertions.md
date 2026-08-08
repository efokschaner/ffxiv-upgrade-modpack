# `/resave` asserts nothing when its oracle errors — the oracle-free checks could still run

Filed: 2026-07-19 · Status: **open, low priority** (see *Status after the v3.1.1.4 re-pin* below)

`registerResaveCheck` (`test/helpers/corpus-resave.ts:52-66`) returns early when the cached result is
`{ kind: "error" }`, before comparing anything. It is **loud** about it — `console.error("[resave]
UNVERIFIED: …")` naming the pack and quoting the oracle's stack, then `ctx.skip(message)` so the unit
reports skipped-with-a-note rather than green. That much is right and should stay.

What it gives up is that the skip happens *before* any assertion at all, including the ones that need
no oracle.

**Why the skip (not a matched-failure assertion) is correct here.** The `/upgrade` harness asserts a
*matched* failure — oracle throws AND our port throws the same error is a PASS, a mismatch is a loud
FAIL (`assertMatchedUpgradeFailure`, `test/helpers/corpus-upgrade.ts:27`, used at `:90`). That is
right for `/upgrade`, where an oracle error is transform logic we are meant to reproduce. It is
**wrong for this case**: the only `/resave` oracle error in the corpus is
`Milktruck Bust Scaling Tweaks v1.0.0.ttmp2`, where TexTools converts each `.rgsp` into an RSP
manipulation on write and reads **the installed game's `human.cmp`**, which this TexTools build does
not recognise (`CMP Format Changed - Unable to read all CMP data`, full stack in
`docs/backlog/2026-07-11-expected-failure-golden.md`). That is environmental — a property of the
machine and game version, not of the pack. Asserting we must crash too would reproduce a failure with
no modpack-semantic meaning, and would invert the moment TexTools ships a fix or the game changes.
**Do not "fix" this item by making it a matched-failure assertion.**

**What could run instead.** Everything that does not need a golden:

- the write → re-read → compare-against-the-in-memory-model round-trip (the same seam
  `registerUpgradeCheck` gets for free by re-reading `oursArchive`), and
- `pmpSelfConsistency` (no dangling `Files` key, no orphan member) for a PMP.

That turns "UNVERIFIED" into "verified as far as is possible without an oracle" for these packs.
Milktruck is a `.ttmp2`, so only the round-trip half applies to the one pack that exists today — the
self-consistency half would matter for a future PMP that trips a write-side oracle error.

**Why it is worth doing.** This pack is the one place in the corpus where a pack is *both* a
`/upgrade` no-op and a `/resave` oracle error, so nothing in either harness compares its written
output to anything. Surfaced by the PR review for
`docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md`, which removed the
`/upgrade` no-op branch's (unsound) member-name comparison and so left this pack's writer covered by
neither harness. The concrete scenario: a `writeTtmp2` regression that drops `ModPackPages` or mangles
option names on that pack ships green.

Deliberately **not** closed by coupling the two harnesses — the `/upgrade` no-op branch will not read
`/resave`'s error markers (operator call, 2026-07-19: the two checks stay independent, and the case is
rare). Fixing it inside `/resave`, where the error is already known, needs no crosstalk at all.

**Scope note.** `ctx.skip` after running the oracle-free assertions still reports the unit as skipped,
which is the honest status — the *oracle* comparison genuinely did not happen. Decide whether the
assertions run before the skip, or whether such a pack should report as passing on the reduced check
set with the loud `UNVERIFIED` line retained. The first is less of a change and keeps the skip count
meaningful (`corpus-resave.ts:64` is currently the **only** skip site in the whole suite, so
`1 skipped` in a run is exactly this pack).

## Status after the v3.1.1.4 re-pin

Updated 2026-08-07. Operator ruling, same date, per the re-pin spec's §4.5 sign-off requirement
(`docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md`): **keep this item, at reduced
priority, and build a synthetic pack that keeps the code path exercised.**

**The only real-world instance is gone.** This item's motivating pack,
`Milktruck Bust Scaling Tweaks v1.0.0.ttmp2`, errored because TexTools v3.1.0.2 could not read the
patch-7.5 `human.cmp` — environmental, and fixed upstream in the re-pin target (spec §1.1-1.2). After
the re-pin: `test/corpus/.resave-cache` holds **zero** `.error` markers and the whole suite reports
**zero** skips, so ConsoleTools now round-trips that pack and its writer is compared against a real
golden. The concrete harm described above — "a `writeTtmp2` regression that drops `ModPackPages` or
mangles option names on that pack ships green" — no longer applies to it.

**Why the item stays open anyway.** What was fixed is one *instance*; the *shape* is unchanged.
`registerResaveCheck` (`test/helpers/corpus-resave.ts:53-67`) still skips before asserting anything,
so the next pack that trips a write-side oracle error silently loses the oracle-free coverage again,
and it does so quietly — a skip, not a red. That recurrence is not hypothetical: the CMP breakage was
itself "TexTools hardcoded an offset the game outgrew", and spec §1.1 records that the throw was
**luck** — had the patch added a multiple of 56 bytes, the same build would have written a corrupted
`human.cmp` instead of failing. Game patches keep landing.

**Do not implement the fix speculatively.** With no pack reaching `:53-67`, code written now ships
with nothing able to exercise it — the untested generality this repo has explicitly rejected
elsewhere (see `test/helpers/corpus-upgrade.ts:115-126`, which throws rather than keep a dark
untested branch), and a fix with no covering test is incomplete under AGENTS.md. The prerequisite is
therefore the synthetic below, not the fix.

### Prerequisite: keep this path exercised

Operator ask, 2026-08-07: the branch must stop depending on a real-world accident, so it cannot
degrade unnoticed a third time. The ask was framed as a synthetic pack under `test/corpus/synthetic/`
(committed builder, per AGENTS.md *Synthetic tests*); investigating it established that **no pack can
durably do this** and that the coverage belongs at the harness seam instead. Both halves are recorded
below — the pack route first, because its requirements are what prove the seam route is the right
one.

A pack would have to satisfy a **specific and non-obvious shape** — not simply "a pack TexTools
rejects":

1. **ConsoleTools `/resave` must fail** — `WizardData.FromModpack` or `WriteModpack` throws
   (`ConsoleTools/Program.cs:191-221` catches, prints, exits −1).
2. **Our port must SUCCEED** on the same input, or there is no `oursArchive` to run the oracle-free
   assertions against and the item's whole point is moot. This is the asymmetry Milktruck had:
   TexTools does game-data-dependent work on write (`.rgsp` → RSP manipulation, reading the installed
   `human.cmp`) that our port does not — we treat `.rgsp` as opaque payload.
3. **The failure must be pack-intrinsic, not environmental.** Milktruck's depended on the installed
   game version and evaporated when upstream fixed it. A trigger that is a property of the *bytes*
   survives re-pins and patches; one that depends on the machine will rot exactly as this one did.

Requirement 3 is what makes this non-trivial, and requirements 1+2 together carry a constraint that
is easy to miss:

> **Requirement 2 rules out any trigger that is a plain pack-validity failure.** If TexTools throws
> because the pack is malformed in a way our port also parses, AGENTS.md requires us to *reproduce*
> the throw faithfully — so our port fails too, there is no `oursArchive`, and the oracle-free
> assertions still have nothing to run against. The pack must make the oracle fail at work our port
> **legitimately does not perform at all**. That is what made Milktruck's asymmetry sound rather than
> a divergence: TexTools reads live game data on write; we treat `.rgsp` as opaque payload, so we are
> not "diverging", we are simply not executing that step.

**Candidate trigger — investigated and REJECTED, 2026-08-07.** Kept here because the reasoning that
kills it also kills the whole *class*, and re-deriving that would waste the next reader's time. The
Milktruck failure site is on the *write* path and takes its parameters from the *pack*:

- `PMP.cs · ManipulationsToMetadata · 1318-1349` groups RSP manipulations by race/gender —
  `:1320` `GroupBy(x => x.GetRaceGenderHash())`, `:1325` `group.First().GetRaceGender()` — both read
  from the manipulation's own data.
- `:1335` then calls `CMP.GetScalingParameter(rg.Race, rg.Gender, true, tx)`, which reads the
  installed game's `human.cmp` (`CMP.cs:188-192` → `CharaMakeParameter.GetScalingParameter`). This is
  where "CMP Format Changed" fired.
- A `.ttmp2` carrying a `.rgsp` reaches exactly this code on resave: `WizardData.cs:691-703` decodes
  the file to RSP manipulations on load, and `:486-501` converts them back via
  `ManipulationsToMetadata` on write.

So a `.rgsp` whose **race/gender is outside the CMP's record range** should make
`CharaMakeParameter.GetScalingParameter` index out of bounds — driven by the pack's bytes, not the
machine, and inside the game-data step our port never executes. Race/gender is parsed as a bare
integer from the file path (`CMP.cs · GetRaceGenderFromRgspPath · 121-128`, regex → `Int32.Parse` →
unchecked cast to `XivSubRace`/`XivGender`), so an out-of-range value is straightforward to author.

**Why it is rejected — and why no real modpack can do this job.** Operator observation, 2026-08-07:
*our port must eventually do everything TexTools does.* That is the project's actual bar — byte-parity
with ConsoleTools output — so "our port never executes that code path" is a statement about **today**,
not an architectural boundary. This repo already has the pattern for porting game-data-dependent
logic without a live game: pre-extract the minimum surface into a generated constants table via a
committed `scripts/extract-*` script (AGENTS.md, *Bundle the minimum data surface*). There is no
reason in principle we would never bundle the CMP defaults and port the RSP write path.

So the candidate rots exactly as Milktruck did, only on a different axis: Milktruck stopped
exercising this branch when **upstream fixed CMP**; the candidate would stop when **we finish the
port**. Same silent failure mode, longer fuse.

That generalizes into a dilemma which rules out the entire approach:

- A **pack-intrinsic** trigger stops working as the port converges — we end up failing wherever
  TexTools fails, which is the goal, and then our side throws too (requirement 2 lost).
- The only **permanently** asymmetric failures are **environmental** — TexTools reads the installed
  game, we read pinned bundled constants, so it can break on a machine/patch where we cannot. That
  asymmetry is durable *precisely because* it is a property of the machine, which is what makes it
  unusable as a fixture (requirement 3 lost).

Requirements 2 and 3 are therefore in tension **by construction**, and no authored modpack satisfies
both for long. Do not spend more time hunting for one.

### Revised approach: cover it at the harness seam, not with a pack

The thing needing protection here is **harness logic**, not port fidelity: *"when the oracle errors,
do the oracle-free assertions still run?"* is a question about our test harness, and TexTools has no
opinion on it. It does not need — and cannot durably get — a real AB test.

`resaveGoldenCached` already exposes the seam: `opts.produce` (`test/helpers/resave-golden.ts:163`),
which `test/helpers/resave-golden.test.ts` already uses to exercise outcomes without spawning
ConsoleTools. The obstacle is only that the code in question sits inside `registerResaveCheck`'s
`it()` callback, so nothing can call it directly.

Shape of the work, when it is picked up:

1. Extract the oracle-free assertions (write → re-read → compare-against-the-in-memory-model, plus
   `pmpSelfConsistency` for a PMP) out of the `it()` callback into an exported function.
2. Call it from the `{ kind: "error" }` branch **before** the `ctx.skip`, and from the normal path.
3. Unit-test it directly against a real authored pack with an injected erroring `produce`.

That covers the branch permanently: it cannot rot when upstream changes, and it cannot rot when our
port advances. It is a synthetic unit test rather than a golden — a deliberate departure from
AGENTS.md's usual preference, justified because that preference governs *ported behaviour*, and this
is harness behaviour with no oracle to appeal to.
