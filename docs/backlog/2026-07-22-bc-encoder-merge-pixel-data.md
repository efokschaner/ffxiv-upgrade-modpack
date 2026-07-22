# `MergePixelData`'s BC re-encode is unported, and the NPOT mask path diverges because of it

**Filed:** 2026-07-22, from the NPOT texture-resize work
([`docs/superpowers/specs/2026-07-21-npot-texture-resize-design.md`](../superpowers/specs/2026-07-21-npot-texture-resize-design.md)).

**Severity:** an **accepted, operator-adjudicated divergence** (2026-07-22), not a silent bug — the
site documents it and two synthetic packs ratchet it. But it is a real byte-parity hole, and the only
one on this branch that a `DIVERGENCE_RULES` entry cannot confirm.

## What diverges

`Tex.ResizeXivTx` (`Tex.cs:413-420`) does three things: Bicubic-resize the decoded pixels, overwrite
the tex's dims, then `Tex.MergePixelData` (`Tex.cs:637-706`) — which **re-encodes the resized RGBA
back into the source's own BC format** via TexImpNet/nvtt. The caller then immediately decodes it
again. So TexTools' pixels have been through one extra lossy compression cycle that ours have not.

`src/upgrade/texture.ts`'s `resizeToPow2ForMerge` elides that round-trip: we have no
nvtt-compatible BC encoder. The *failures* `MergePixelData` owns are reproduced (the
`GetCompressionFormat` unsupported-format throw, `Tex.cs:718-747`; the `<64` size guard,
`Tex.cs:656-660`) — only the re-encode itself is skipped.

## Measured cost

Against real cached ConsoleTools `/upgrade` goldens:

| case | pack | result |
|---|---|---|
| lossless source (`A8R8G8B8` → `CompressionFormat.BGRA`) | `npot-mask-a8.ttmp2` | **byte-identical**, 0 / 1398176 |
| lossy source, quantizing consumer (index path) | `Club Cyberia Motorbike.ttmp2` | **byte-identical**, all 12 options |
| lossy source, non-quantizing consumer, smooth content | `npot-mask-dxt5-smooth.ttmp2` | 680836 / 1398176 differ (48.7%), **max delta 9** |
| lossy source, non-quantizing consumer, adversarial content | `npot-mask-dxt5.ttmp2` | 1337354 / 1398176 differ (95.65%), **max delta 116** |

The index path survives because `CreateIndexTexture` (`TextureHelpers.cs:222-260`) reads only the
normal's alpha and quantizes it into rows of 17, which absorbs the round-trip error.
`upgradeGearMask` has no such quantization, so on the mask path the error reaches the output bytes.

**The spread between the last two rows is the real finding.** The magnitude tracks how well the
*resampled* image fits BC's per-block endpoint model — a property of the content, not the format.
Smooth content (what a real gear mask looks like) lands at max delta 9 with a hard-decaying histogram
(370243@1, 195057@2, 83411@3, 26258@4, 4556@5, 1274@6, 33@7, 4@9). Pseudo-random content, where every
4×4 block has huge post-resample variance, blows out to 116. Real masks should sit near the smooth
end — but we cannot bound it, because computing the error for a given input *is* the nvtt-compatible
encode we do not have.

## Why there is no `DIVERGENCE_RULES` entry

`AGENTS.md` requires every intended divergence to be *confirmed* by a rule that verifies the specific
expected difference and rejects everything else. No such rule is constructible here.

A **tolerance** rule was considered explicitly (operator question, 2026-07-22: "ensure the pixel RGBAs
are within one or two of the golden like we have done in other validators") and rejected on the
numbers. ±1/±2 does not survive contact with either fixture — smooth content already reaches 9. And a
±9 rule would be worse than no rule: the existing global `.tex` ±1 tolerance is legitimate because it
rests on a **provable** bound (BCn decoder rounding is ≤1 by construction), whereas 9 and 116 are
merely what two authored fixtures happened to produce. Since `DIVERGENCE_RULES` predicates apply
corpus-wide, a fixture-calibrated threshold would begin silently absolving unrelated, genuine `.tex`
regressions on real packs — trading a documented gap for a blind spot.

A **shape** rule fares no better: confirming "these bytes differ exactly as a BC round-trip would
explain" requires performing the BC round-trip.

So this divergence is pinned by its two ratchet baselines plus the documentation at the site
(`resizeToPow2ForMerge`'s doc comment) and here — deliberately, and with the operator's call on
record. It is the one place on this branch where a baseline carries a divergence a rule cannot.

## What would close it

A BC1/BC3/BC4/BC5 encoder matching TexImpNet/nvtt's output byte-for-byte. That is a large piece of
work with its own oracle problem, and it would also retire the related ±1 BCn **decoder** divergence
([`2026-07-16-bcn-decoder-rounding-divergence.md`](2026-07-16-bcn-decoder-rounding-divergence.md)) if
done as a matched pair. Note `MergePixelData`'s BC7 arm is different again — it shells out to
`DDS.TexConvRawPixels` (`Tex.cs:650-653`, i.e. texconv.exe), which is not portable to a browser at all.

## Reachability

**Zero corpus packs reach it.** No real pack has an NPOT mask; the two `npot-mask-*` packs are
authored fixtures. Per `docs/BACKLOG.md`'s "deploying changes the probability term" note, an NPOT
hand-authored mask is plausible enough for a public upload endpoint that this should not be treated as
extinct — but it is not a live defect in anything we have seen.

## Test that pins it

`test/corpus/synthetic/npot-mask-a8.ttmp2`, `npot-mask-dxt5.ttmp2` and
`npot-mask-dxt5-smooth.ttmp2` (`scripts/generate-synthetics/build-synthetic-npot-mask.ts`). All three
share one material and one power-of-two normal and differ **only** in the mask — `-a8` vs `-dxt5`
isolates the round-trip as the cause rather than the resampler, and `-dxt5` vs `-dxt5-smooth`
isolates content as the thing that sets its magnitude. Keep both properties if you touch them: each
comparison is only meaningful because exactly one variable moves.
