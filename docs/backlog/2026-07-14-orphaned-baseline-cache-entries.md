# Nothing prunes ratchet baselines / goldens for corpus packs that no longer exist

Filed: 2026-07-14 · Status: open · Priority: unprioritized (harness & housekeeping)

Every ratchet baseline and cached golden is content-addressed by `sha256(input pack)`
(`test/helpers/upgrade-baseline.ts` · `baselinePath`; `upgrade-golden.ts`, `resave-golden.ts`,
`oracle.ts`). Nothing ever removes one. When a pack's bytes change — a corpus mod updated, or a
synthetic rebuilt with a different fixture — its old key is simply never referenced again, and the
file stays.

Measured 2026-07-14 (66 live corpus packs):

| dir | files | unreferenced | size |
|---|---|---|---|
| `.upgrade-baseline/` | 70 | **4** | ~0 |
| `.resave-baseline/` | 65 | 0 | ~0 |
| `.upgrade-cache/` | 76 | **10** | 0.4 MB |
| `.resave-cache/` | 69 | **3** | ~0 |

(`.oracle-cache/` is keyed by `sha256(entry)`, not by pack, so it is out of scope — its entries are
shared across packs and an "unreferenced" one cannot be identified this way.)

**This is not a disk problem** — the whole orphaned set is under half a megabyte. It is a *legibility*
problem: `ls .upgrade-baseline | wc -l` no longer answers "how many packs are ratcheted", so the
counts you reason about during a bless are quietly wrong, and a stale baseline looks exactly like a
live one.

**Partly addressed 2026-07-18.** A second, independent source of count-inflation is fixed: blessing
an *empty* diff set used to write an `[]` file, even though `loadBaseline` is always consumed as
`?? []` so absent and empty assert the same thing. `saveBaseline` now removes the file instead (98
existing empty files pruned across the three roots — `.upgrade-baseline` 85→77, `.resave-baseline`
80→70, `.roundtrip-baseline` 81→1). A baseline directory's file count is now the count of packs that
**still diverge**, and a pack burned to zero divergences disappears from it. What remains open is the
harder half described here: keys belonging to packs that no longer exist at all.

**An orphan is not invalid, only unreferenced.** If a pack's bytes ever return to a previous state,
its old baseline and golden are correct and would be hit again. Pruning trades that (rare) cache hit
for legibility.

## The hazard any fix must handle

The obvious pruner — *"delete every baseline whose key matches no pack in `test/corpus/`"* — is
**dangerous**, because the corpus is gitignored and therefore routinely *partial*. On a fresh clone
`test/corpus/real/` is empty; someone with only the synthetic packs built would run that pruner and
delete **every real pack's baseline**, silently un-ratcheting the entire suite. The damage would not
surface as a failure — a missing baseline reads as "no known divergences", so the next bless would
quietly re-record the current output as the new truth.

So a pruner must refuse to run unless it can establish the corpus is complete, or it must be
explicitly scoped (e.g. prune only keys it can prove were superseded in this working tree). Whatever
the mechanism, **an empty or partial corpus must be a hard stop, not a licence to delete.**

## Provenance

Surfaced during the `SelectionType` fix (2026-07-13/14, PR #23), which re-keyed a synthetic `.ttmp2`
twice and so had to hand-prune the superseded baselines. Reasoning about which files were safe to
delete — and confirming the 4 pre-existing `.upgrade-baseline` orphans dated from 2026-07-08..12 and
were *not* ours — was fiddly enough by hand to be worth automating, and the near-miss above is
precisely why it should not be automated carelessly.
