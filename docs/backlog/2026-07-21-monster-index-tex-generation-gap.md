# A mount/monster material's generated `_id` index texture is silently missing from our output

**Filed:** 2026-07-21, from the minion/mount/furniture corpus expansion.

**Severity:** **silent wrong output** — the worst class in the ranking rubric. The pack upgrades with
no error, but the result is missing a texture TexTools generates, so the mod is degraded and the user
never learns. Narrow (one known pack) and the root cause is not yet traced, which is why it ranks
below the broad, confirmed housing crash rather than at the very top.

## Symptom

`Club Cyberia Motorbike.ttmp2` (a mount — monster root `m0242`) upgrades **successfully** in our
pipeline (full baseline written, no throw), but its output omits an index/`_id` texture the golden
has. In the `.upgrade-baseline` the entry is `added` (golden-only) in **all 12 options**:

```
added  chara/monster/m0242/obj/body/b0001/texture/v01_m0242b0001_n_c_id.tex   (×12, OptionList 0-11)
added  TTMPL.mpl#/ModPackPages/0/ModGroups/0/OptionList/{0..11}/ModsJsons/19   (its manifest entries)
```

We emit **no** `_id` map for `m0242` at all — there is no counterpart `removed` (ours-only) entry
under a different name, so this is not a rename/dedup mismatch: the file is simply not generated. The
material's normal map `v01_m0242b0001_n_c.tex` (the `_c` colour variant) is present on both sides (a
`payload mismatch`), and TexTools derived `…_n_c_id.tex` from it; we did not.

Most monster packs in the expansion do **not** trigger this — `胖莫古力` (m0341), `Telephone` (m8044),
`Cig Prop` (m8045), `Flying Wheelchair` (m0449) show no `_id` gap, because their materials don't bind
an index sampler. Only `m0242` (an index-binding material) does, and there we miss it.

## Why this is not covered by the existing index items

`docs/backlog/2026-07-20-hair-texture-exists-namespace-scope.md` (#2) is about the **hair** sampler
namespace; this is a **monster** root. The index-path-resolution work
(`docs/superpowers/specs/2026-07-20-index-path-resolution-design.md`) resolves *which base material's
index sampler path to steal* and verified monster roots are covered for the steal — but that is the
sampler **path**, not the **generation of the `_id.tex` file** itself (round 4,
`UpgradeRemainingTextures` — `docs/superpowers/specs/2026-07-09-texture-round-design.md`). The gap is
in generation, and no item tracks it.

## What the fix has to establish (trace during implementation)

Confirmed: the *symptom* (golden has `…_n_c_id.tex` ×12, we emit none). **Not** yet confirmed: the
*cause*. Trace round-4 index-map generation for the `m0242` `_c` colour-variant material — why the
`UpgradeInfo` index target is not recorded (or the file not written) for it. Candidate angles: the
`_c` colour-variant normal path, or a monster-specific branch in the material round that never enqueues
the index-map generation. Reproduce the miss with a synthetic or the `Club Cyberia` golden first, then
prove the fix by driving the 12 `added` entries + their `ModsJsons/19` manifest entries to zero.

Verify before assuming it is *our* bug: check that TexTools isn't itself mis-generating a redundant
file (a `docs/TEXTOOLS_BUGS.md` candidate). Byte-parity says match it either way, but the adjudication
belongs in the trace.

## Test that would have caught it

`Club Cyberia Motorbike.ttmp2`, now in `test/corpus/real/`. It is the reproducer; the fix should drive
its `_id.tex` `added` entries out of the baseline.
