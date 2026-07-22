# Furniture `bgparts` `.mdl` overruns `modelDataSize` — codec throws on a subset

**Filed:** 2026-07-21, from the minion/mount/furniture corpus expansion.

**Severity:** **rubric class 1 — silent wrong output**, not a loud crash. The companion housing-meta
gap shipped 2026-07-21
([`docs/superpowers/specs/2026-07-21-housing-meta-drop-design.md`](../superpowers/specs/2026-07-21-housing-meta-drop-design.md);
its backlog item was deleted per this repo's shipped-item convention), so furniture packs now reach the
model round of `/upgrade` — and there, `makeTtmpLoadFix`'s per-file `catch { return null }`
(`src/upgrade/load-fixes.ts`, a faithful port of `WizardData.cs:721-727`'s `FixOldModel` catch) swallows
this throw same as any other model-normalize failure. The pack still upgrades and still produces
output, but silently **missing the affected models** — no error is surfaced to the user, and TexTools'
own golden keeps all of them. This item still breaks asset round-trips (`corpus-mdl`/`corpus-geometry`
harnesses, which call `parseMdl` directly and do see the throw), so it is loud *there*; the class change
is specifically about the `/upgrade` product path. Re-ranked to backlog items 1-2 (silent wrong output)
in `docs/BACKLOG.md`, alongside the mount `_id.tex` gap.

## Symptom

`parseMdl` (`src/mdl/parse.ts:81-86`) fails its no-overrun gate on some furniture background-part
models:

```
mdl: model-data walk overran modelDataSize (consumed 1601 > 641)   bgcommon/hou/indoor/general/0613/bgparts/fun_b0_m0613.mdl   (raykie)
mdl: model-data walk overran modelDataSize (consumed 1118 > 1022)  bgcommon/hou/outdoor/general/0193/bgparts/gar_b0_m0193.mdl  (Crystal-Striking-Goddess)
```

Direct callers of `parseMdl` (`corpus-mdl`/`corpus-geometry` asset round-trips, plus two
corpus-derived unit tests that iterate every model —
`test/mdl/model/binormals-present.test.ts`, `test/mdl/model/serialize.test.ts`) see the throw and fail
loudly — all four hit `gar_b0_m0193.mdl` / `fun_b0_m0613.mdl`. But in the `/upgrade` product path the
throw is caught and swallowed at the load-fix seam (see Severity above): `raykie`'s corpus run confirms
this — its golden carries 9 `bgcommon/hou/**/bgparts/*.mdl` entries that our output now silently omits
(the `9 × .mdl added` + `9 × manifest added` slice of the pack's 97 baselined diffs; the remaining 29
`.tex` mismatches and 50 manifest mismatches are unrelated pre-existing gaps — see
`docs/superpowers/specs/2026-07-21-housing-meta-drop-design.md` §4 for the full decomposition and
citations).

## Not "all furniture" — a structure-specific subset

Most furniture `bgparts` models parse and round-trip fine — `gar_b0_m0087.mdl`, `gar_b0_m0112.mdl`
decode→encode with only the expected normalized-channel divergence ("expected divergence confirmed").
Only a subset overruns, and by different magnitudes: `1118 > 1022` is a ~96-byte over-read (≈ 3× a
32-byte bounding box — a plausible `furniturePartBoundingBoxCount` miscount), while `1601 > 641` is a
~2.5× overrun (a larger structural miss). So this is one or two specific section-size bugs in the
non-chara walk, not a blanket "bg models unsupported".

## Provenance / context

The `.mdl` codec design already flagged this as an anticipated but unbuilt gap:
`docs/superpowers/specs/2026-07-03-mdl-codec-design.md:188` ("`furniturePartBoundingBoxCount` … non-zero
only for some `bg`/furniture models") and `:283,297-300` (an over-read is surfaced loudly and is "a
codec bug"); `docs/superpowers/specs/2026-07-06-model-normalizer-design.md:128-130,211` ("non-chara
models (bg/furniture carry extra structure … `furniturePartBoundingBoxCount`) … fail loud"). The
design foresaw the fail-loud; **no backlog item existed** and no corpus pack reached it until now.

The walk to audit against is `Mdl.cs · GetXivMdl` (the model-data section walk,
`reference/…/Models/FileTypes/Mdl.cs:349-995`), specifically the furniture bounding-box block
(`Mdl.cs:969-994`, mapped in the codec spec's section table as
`32 · (4 + BoneCount + FurniturePartBoundingBoxCount)`), and whatever bg-only section our walk is
under-counting. Our current bounding-box read is `src/mdl/parse.ts:74-76`.

## Test that would have caught it

The furniture corpus packs now in `test/corpus/real/` (`Crystal-Striking-Goddess`, `raykie`). Fix
should make `parseMdl` consume exactly `modelDataSize` for these models and keep the asset round-trips
byte-exact (per the codec's byte-parity target).
