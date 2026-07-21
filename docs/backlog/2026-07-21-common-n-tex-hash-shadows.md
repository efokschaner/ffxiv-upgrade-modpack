# PMP `structure` diffs are tex-payload shadows, not a `common/N` numbering bug

Filed: 2026-07-21 · Status: open · Priority: unprioritized (cosmetic) · Surfaced while tracing
`2026-07-17-pmp-writer-orphan-member-retention.md` (which owns the *other* ~5 `structure` entries)

Of the ~47 `kind:"structure"` entries in `.upgrade-baseline`, ~5 are the genuine orphan/rename
writer gap (that sibling item). The remaining **~42 are shadows of the `.tex` payload divergences**
(design spec `2026-06-30-…-design.md` §8.3's `.tex` bulk — the float-precision resize/decode tail;
primary open item `2026-07-10-imagesharp-resampler.md`), in two mechanical shapes. Neither is an
independent root, so **there is nothing to fix here directly** — this item exists to record the
coupling (so it isn't rediscovered as a phantom numbering bug) and to pin the verification gate.

## The two shapes

**~22 · direct member-name re-reports.** `status:"mismatch"` at option-prefixed member names
(`<option>/chara/…/foo.tex`). `diffPayloadMembers` (`test/helpers/upgrade-archive-diff.ts:335`)
byte-compares matched-name pairs, so a genuine per-`gamePath` payload divergence is reported a
second time under its zip member name. Verified: **19/19** across the two Jaque packs have the
option-stripped path present as a `payload` entry in the same baseline. Trivially derivative — each
clears the moment its `payload` sibling does.

**~20 · `common/N` hash-class shifts.** `status:"mismatch"` at `common/N/foo.tex`, same member name
on both archives, offset content. This *looks* like a dedup **numbering** divergence but is **not** an
independent `ResolveDuplicates` bug — our port (`src/container/resolve-duplicates.ts`) reproduces C#'s
iteration order and the zero-hash idx-burn (`docs/TEXTOOLS_BUGS.md` #8) faithfully, and neither pack
carries FileSwaps (so the `layoutEquivalent` re-keying, gated on `packHasFileSwaps`, does not and
should not apply). The real cause is upstream: `ResolveDuplicates` dedups by **content SHA1**
(`PmpExtensions.cs:518,537-550`). A texture whose bytes we resize/decode differently from TexTools
lands in a **different content-hash equality class**, so a different set of files gets promoted into
`common/{idx}` and the numbering shifts. Because FFXIV texture variants share basenames, the shifted
assignments collide in `diffPayloadMembers`' name buckets and surface as `mismatch` rather than
`added`/`removed`.

Evidence for the coupling: **100 % of the `common/N` mismatch basenames are themselves
payload-divergent `.tex`** —

| pack | `common/N` mismatches | basenames also payload-divergent `.tex` |
|---|---|---|
| `[Jaque] Marcellus [May 2024].pmp` | 6 | 6/6 |
| `[Jaque] Romeo & Juliet [feb 2023] - DT update.pmp` | 11 | 11/11 |
| `Westlaketea's Constellation Crown (Dawntrail Edition).pmp` | 3 | 3/3 |

## Why cosmetic

Penumbra keys on the redirect table (`gamePath -> content`), not on the `common/N` member name, so a
renumbering is runtime-equivalent — the same reason the `layoutEquivalent` mode exists for FileSwaps
packs (`diffPayloadSemantic`, `upgrade-archive-diff.ts`). The `.tex` payload divergences these shadow
are themselves a bounded float-precision tail, not silent corruption.

## What to do — verification gate, not a fix

No direct change. These burn down **with** the `.tex` payload bulk (design §8.3). When that work lands
and our texture bytes match TexTools':

1. Re-bless (`$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`).
2. Confirm the ~22 direct shadows and ~20 `common/N` entries clear alongside their `payload` siblings.
3. **Any `common/N` entry that *survives* byte-matching textures is then a genuine numbering-input
   divergence** — option/`Files` insertion order, or a differing absent-file / zero-hash set between
   our load and TexTools' — and *at that point* graduates into its own investigation against
   `resolve-duplicates.ts` and the reader's `Files`-map build order (`src/container/pmp.ts`). Until
   then, treat a `common/N` structure entry as a symptom, not a cause.
