# Furniture `bgparts` `.mdl` overruns `modelDataSize` — codec throws on a subset

**Filed:** 2026-07-21, from the minion/mount/furniture corpus expansion.

**Severity:** hard `parseMdl` throw. Loud, so honest, but it breaks asset round-trips (and, once the
housing-meta gap above is fixed, would break the model round of furniture `/upgrade`). Companion to
`docs/backlog/2026-07-21-bgcommon-housing-meta-root-unsupported.md` — together, "bgcommon
housing/furniture support".

## Symptom

`parseMdl` (`src/mdl/parse.ts:81-86`) fails its no-overrun gate on some furniture background-part
models:

```
mdl: model-data walk overran modelDataSize (consumed 1601 > 641)   bgcommon/hou/indoor/general/0613/bgparts/fun_b0_m0613.mdl   (raykie)
mdl: model-data walk overran modelDataSize (consumed 1118 > 1022)  bgcommon/hou/outdoor/general/0193/bgparts/gar_b0_m0193.mdl  (Crystal-Striking-Goddess)
```

It breaks the `corpus-mdl` and `corpus-geometry` asset round-trips for those packs, plus two
corpus-derived unit tests that iterate every model (`test/mdl/model/binormals-present.test.ts`,
`test/mdl/model/serialize.test.ts`) — all four hit `gar_b0_m0193.mdl` / `fun_b0_m0613.mdl`.

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
