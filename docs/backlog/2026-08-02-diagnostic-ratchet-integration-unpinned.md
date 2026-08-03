# The §7 diagnostics ratchet integration has no live test — deleting its wiring breaks nothing

Filed 2026-08-02, from the final whole-branch review of `feat/upgrade-diagnostics-channel`
(`docs/superpowers/specs/2026-08-01-upgrade-diagnostics-channel-design.md`, in particular §7
"Baseline integration").

## The problem

§7 makes diagnostics ratchet through the existing `test/corpus/.upgrade-baseline/` by folding
`Diagnostic`s into the same `diff.files` array `compareToBaseline` scores, alongside the existing
`"structure"` / `"payload"` / `"roundtrip"` / `"transform"` `DiffKind`s. The wiring for this lives in
`test/helpers/corpus-upgrade.ts` (~:297-305):

```ts
const diff = {
  ...payload,
  files: [
    ...payload.files,
    ...archive,
    ...selfDiffs,
    ...transform,
    ...diagnostics,
  ],
};
```

**Concrete proof it is unpinned:** delete `...diagnostics,` from that spread, run `npm test`, and
every test still passes. No test — not the corpus harness, not a unit test — notices the wiring
between `diagnosticsToFileDiffs` (which converts a pack's `Diagnostic[]` into `FileDiff`s of kind
`"diagnostic"`) and the ratchet is gone.

## Why the corpus can't catch it today

The design spec's own §6 item 2 measured the day-one diagnostic count across the full local corpus
(85 real + 20 synthetic packs, ~105 total) at **zero** — neither the bare `unclaimed-hair.ts:213`
swallow (`EndwalkerUpgrade.cs:1498-1501`, `docs/TEXTOOLS_BUGS.md` #12) nor a hair-path-absorbed
`MergePixelData` failure is reached by any pack currently in `test/corpus/`. So today's baselines
contain no `"diagnostic"` entries, and `compareToBaseline`'s subset check (`ok` iff `actual ⊆
baseline`) passes trivially whether or not diagnostics ever reach it at all.

The two halves either side of the wiring ARE unit-tested — `diagnosticsToFileDiffs`'s conversion has
its own tests, and `compareToBaseline`'s `code`-identity semantics are pinned by
`test/helpers/upgrade-baseline.test.ts` — but nothing exercises them **together** through the ratchet
integration itself. A regression that silently dropped the `...diagnostics` spread (or reordered it
out from under `idOf`'s keying, or broke `diagnosticsToFileDiffs`'s call site) would ship invisibly.

## Proposed fix (not built here — deliberately deferred)

A committed synthetic-pack builder under `scripts/generate-synthetics/` (matching the existing
pattern, e.g. `scripts/generate-synthetics/build-synthetic-f1.ts`) that emits a `.ttmp2` with a loose
hair normal/mask pair whose normal has a **truncated header** — the same recipe already used to force
the swallow in two in-memory fixtures:

- `test/upgrade/unclaimed-hair.test.ts:264-268` (unit-level, drives `updateUnclaimedHairTextures`
  directly) — see the "leaves the raw copies untransformed when the transform throws" test.
- `test/upgrade/unclaimed-hair-port-gap.test.ts:52-105` (`buildHairRescuePack`, e2e through
  `upgradeModpack`, though that file mocks `updateEndwalkerHairTextures` to force the OTHER branch,
  `UnportedGapError` propagation — the *genuine* corrupt-input recipe lives in
  `unclaimed-hair.test.ts` instead).

Because `EndwalkerUpgrade.cs:1498-1501` swallows identically in TexTools, ConsoleTools' `/upgrade`
golden for this pack should byte-match ours — the only difference is our single
`HairTransformFailed` diagnostic, which becomes the pack's sole baseline entry after a bless. That
would give the `"diagnostic"` `DiffKind` its first live data point: a real regression in the ratchet
wiring (dropping the spread, breaking `diagnosticsToFileDiffs`, mis-keying `idOf`) would then show up
as a newly-missing or newly-appearing baseline entry, same as any byte diff does today.

## Scope note

This is a **test-coverage** gap in the harness, not a product bug — `upgradeModpack`'s diagnostics
channel itself is correct and unit-tested; only the corpus-level ratchet integration lacks a pack
that reaches it. Cross-reference
`docs/superpowers/specs/2026-08-01-upgrade-diagnostics-channel-design.md` §7 when this is picked up.
