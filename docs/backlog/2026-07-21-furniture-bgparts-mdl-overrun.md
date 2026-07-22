# Furniture `bgparts` `.mdl` — the writer still refuses models carrying real furniture bounding boxes

**Filed:** 2026-07-21, from the minion/mount/furniture corpus expansion. **Narrowed 2026-07-21b**:
the *parse* half — the `modelDataSize` overrun this item was originally filed for — **shipped**. What
remains is the writer-side gate described below.

**Severity:** **rubric class 1 — silent wrong output.** `makeTtmpLoadFix`'s per-file
`catch { return null }` (`src/upgrade/load-fixes.ts`, a faithful port of `WizardData.cs:721-727`'s
`FixOldModel` catch) swallows the throw: the pack still upgrades and still produces output, but
silently **missing the affected models** — no error reaches the user, and TexTools' golden keeps them.

## What shipped (the parse half)

`parseMdl` overran `modelDataSize` on furniture models that declare a non-zero
`FurniturePartBoundingBoxCount` but store none of those boxes (`fun_b0_m0613.mdl` 1601 > 641;
`gar_b0_m0193.mdl` 1118 > 1022 — in both cases the overrun is exactly `32 × count`). The cause was an
unported branch of `GetXivMdl`: `Mdl.cs:1003-1014` detects that shape (LoD0's `VertexDataOffset`
lands on `preBound`, the position right after the fixed + per-bone boxes), zeroes the boxes it read
and seeks the stream back, so those bytes are never consumed. `src/mdl/parse.ts` now reproduces the
rewind; `test/mdl/mdl-parse.test.ts` and `test/mdl/mdl-roundtrip.test.ts` pin both directions
(boxes absent → not consumed; boxes really present → still consumed).

## What remains: the writer's furniture-bounding-box gate

`makeUncompressedMdl` (`src/mdl/model/serialize.ts`) still fails loud on a model that carries **real**
furniture bounding boxes:

```
mdl: furniture bounding boxes (unweighted multi-part model) are out of scope for makeUncompressedMdl
```

Three distinct corpus models across two packs reach it, and are therefore dropped from our output:

| pack | model |
| --- | --- |
| `Crystal-Striking-Goddess.ttmp2` | `bgcommon/hou/outdoor/general/0193/bgparts/gar_b0_m0193.mdl` |
| `raykie Gym Equipment Posing Props V1_0_2.ttmp2` | `bgcommon/hou/indoor/general/0467/bgparts/fun_b0_m0467.mdl` |
| `raykie Gym Equipment Posing Props V1_0_2.ttmp2` | `bgcommon/hou/indoor/general/0257/bgparts/fun_b0_m0257.mdl` |

This is the `HasBonelessParts` write path: `Mdl.cs:3314-3318` uses the source model's
`HasBonelessParts` flag to write the per-part **bounding-box index** into the part's attribute-mask
slot instead of a real attribute bitmask (`src/mdl/model/serialize.ts` mirrors the read at
`sourceHasBonelessParts`, then throws rather than emit the block). Closing this needs the boneless-part
bounding-box block written back out, and `flags2`'s `HAS_BONELESS_PARTS` bit preserved rather than
cleared.

The design specs anticipated this fail-loud:
`docs/superpowers/specs/2026-07-06-model-normalizer-design.md:128-130,211` ("non-chara models
(bg/furniture carry extra structure … `furniturePartBoundingBoxCount`) … fail loud").

## Related, found while fixing the parse half

- Letting these models through revealed that the v6 bump seam
  ([`2026-07-13-resave-mdl-v6-bump-seam.md`](2026-07-13-resave-mdl-v6-bump-seam.md)) **does** reach
  `/upgrade` output after all — 3 of `raykie`'s now-emitted models differ from the golden in exactly
  one field, the MDL version. That item's opening claim ("not a bug in our shipped `/upgrade` output")
  has been corrected there.
- One furniture model has no binormals, which makes an unported `CalculateTangents` branch reachable:
  [`2026-07-21-unported-tangent-recompute.md`](2026-07-21-unported-tangent-recompute.md).

## Test that would have caught it

The furniture corpus packs in `test/corpus/real/` (`Crystal-Striking-Goddess`, `raykie`). The parse
half is now additionally pinned by synthetic unit tests, since the corpus packs are gitignored.
