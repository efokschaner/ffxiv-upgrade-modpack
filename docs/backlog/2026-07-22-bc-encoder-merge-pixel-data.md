# `MergePixelData`'s BC re-encode is unported, and the NPOT mask and hair paths diverge because of it

**Filed:** 2026-07-22, from the NPOT texture-resize work
([`docs/superpowers/specs/2026-07-21-npot-texture-resize-design.md`](../superpowers/specs/2026-07-21-npot-texture-resize-design.md)).

**Severity:** an **accepted, operator-adjudicated divergence** (2026-07-22), not a silent bug — the
site documents it and three synthetic packs ratchet it. But it is a real byte-parity hole, and the
only divergence in the repo carried by a ratchet rather than a `DIVERGENCE_RULES` confirmation.

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

**The hair path has the same exposure, and it is unmeasured.** `CreateHairMaps`
(`TextureHelpers.cs:261-286`) is a channel shuffle plus one `RemapByte` — no quantization either — and
`updateEndwalkerHairTextures`' NPOT pre-step (`EndwalkerUpgrade.cs:1195-1202`) is a `ResizeXivTx` call
like the other two. So an NPOT hair normal or mask in a BC format diverges by the same unbounded
amount. No synthetic covers it (no corpus pack has an NPOT hair texture at all), so unlike the mask
path it is divergent *and* unmeasured. Treat the numbers above as covering both in kind.

**The 116 is the BC re-encode, not our resampler — measured, not assumed.** The obvious worry about
a max delta that large is that our Bicubic resampler is diverging from TexTools'. It is not. Two
independent isolations:

- `npot-mask-a8` uses the *same* pseudo-random adversarial content as `-dxt5`, in a lossless format,
  so it is a direct resampler-vs-resampler test — and it is byte-identical (0 / 1398176).
- Sharper: wrap *our decode of the `-dxt5` source* as an A8R8G8B8 mask and run it through the oracle.
  Both sides then start from identical pixels and differ *only* by the resampler (no BC on either
  side). Result: **max delta 1, on 19 of 1398176 bytes** — the documented float64-vs-float32
  resampler tolerance, nothing more. (Throwaway measurement, 2026-07-22; the pack is not kept.)

So of the `-dxt5` max delta 116, the resampler contributes ≤1 and the elided BC re-encode contributes
the rest. There is no resampler code fix that would move it — closing it needs a BC *encoder*. (The
±1 float tolerance is separately closable via `Math.fround` emulation of ImageSharp's `Vector4`, but
that is cosmetic, already covered by the global `.tex` ±1 rule, and would not touch this divergence.)

**The spread between the smooth and adversarial rows is the other half of the finding.** The magnitude
tracks how well the *resampled* image fits BC's per-block endpoint model — a property of the content,
not the format.
Smooth content lands at max delta 9 with a hard-decaying histogram
(370243@1, 195057@2, 83411@3, 26258@4, 4556@5, 1274@6, 33@7, 4@9). Pseudo-random content, where every
4×4 block has huge post-resample variance, blows out to 116.

**Read 9 as a floor, not as the realistic figure.** `smoothDxt5Blocks` is near-flat *within* each 4×4
block (endpoints roughly one step apart), which is about the easiest input BC endpoint fitting can
get — and it still produces 48.7% differing bytes. A real gear mask has hard material boundaries
falling inside blocks and will land above 9. We cannot bound it either way, because computing the
error for a given input *is* the nvtt-compatible encode we do not have.

## Which AGENTS.md rule this departs from

Worth naming, because it is not the obvious one. AGENTS.md's three-part bar for a divergence
(registered defect + corpus accounting + in-game verification) governs **user-benefit** divergences —
where we deliberately depart because TexTools is *wrong*. This is not one of those: TexTools is right,
we simply have no nvtt-compatible encoder.

The rule that actually binds is **"fail loud, never silently diverge"**, which read strictly says a
BC-sourced NPOT mask should **throw**. We ship lossy output instead. So this is a knowing departure
from a stated principle, not merely a missing registry entry, and it is recorded that way so it stays
auditable. The justification is user impact: throwing aborts the *entire pack*, which for content
anywhere near the smooth end trades a working mod for a ≤9/255 difference in one mask.

## Why there is no `DIVERGENCE_RULES` entry

`AGENTS.md` requires every intended divergence to be *confirmed* by a rule that verifies the specific
expected difference and rejects everything else. No such rule is constructible here — with the
important qualification at the end of this section.

A **tolerance** rule was considered explicitly (operator question, 2026-07-22: "ensure the pixel RGBAs
are within one or two of the golden like we have done in other validators") and rejected on the
numbers. ±1/±2 does not survive contact with either fixture — smooth content already reaches 9.

The reason a *larger* threshold is also wrong is specific, and worth stating precisely because an
earlier draft of this file got it wrong. It is **not** that `DIVERGENCE_RULES` predicates are
corpus-wide and would absolve real packs: `DivergenceRule.predicate` is
`(gamePath: string) => boolean` (`test/helpers/upgrade-compare.ts`), and all three fixtures sit at the
fictional `chara/equipment/e9999/...`, so a path-scoped rule would match these packs and nothing else.
The real objection is that **all three fixtures deliberately share one mask gamePath**, so a
path-scoped predicate cannot distinguish the smooth case from the adversarial one. The only bound
expressible over them is ≤116 — roughly 45% of an 8-bit channel's range — which would confirm
essentially any output and is not a confirmation in AGENTS.md's sense at all.

That also names the route to a real rule, if one is ever wanted: **give the three packs distinct mask
gamePaths**, then a smooth-content rule bounded at ≤9 becomes expressible, and the adversarial pack
keeps its own looser record. So the honest statement is not "no rule is constructible" but **"no rule
is constructible without a change we chose not to make"** — the change costs one builder edit and a
re-bless. It is deferred, not impossible, and the reason to defer is the floor caveat above: a ≤9
bound calibrated to a near-flat fixture would be tighter than real content warrants, so it would start
failing on the first realistic NPOT BC mask anyone uploads.

A **shape** rule fares no better: confirming "these bytes differ exactly as a BC round-trip would
explain" requires performing the BC round-trip.

## What the ratchet does and does not assert

Do not over-read the baselines. Ratchet identity is `kind|gamePath#index:status`
(`test/helpers/upgrade-baseline.ts`) — it excludes `detail` and the payload bytes, and `status` stays
`"mismatch"` for *any* content difference, including a length change. So the two DXT5 packs' baseline
entries **record that a divergence exists at that path; they do not police its size.** A future change
that emitted garbage for a BC-sourced NPOT mask would still pass them.

The live regression guard is **`npot-mask-a8`**, which carries no payload entry at all and so must
stay byte-exact — it covers the Bicubic resampler and `upgradeGearMask` on this path. The measured
±9/±116 figures above are a record of a measurement, not an invariant under test. Restoring that
assertion is the second reason to want the distinct-gamePaths change described above.

So this divergence is carried by its three ratchet baselines plus the documentation at the site
(`resizeToPow2ForMerge`'s doc comment), the `DIVERGENCE_RULES` header (which points here so an audit
starting from the registry does not conclude that list is exhaustive), and this file — deliberately,
and with the operator's call on record. It is the one place in the repo where a baseline carries a
divergence a rule cannot.

## What would close it

A BC1/BC3/BC4/BC5 encoder matching TexImpNet/nvtt's output byte-for-byte. That is a large piece of
work with its own oracle problem, and it would also retire the related ±1 BCn **decoder** divergence
([`2026-07-16-bcn-decoder-rounding-divergence.md`](2026-07-16-bcn-decoder-rounding-divergence.md)) if
done as a matched pair. Note `MergePixelData`'s BC7 arm is different again — it shells out to
`DDS.TexConvRawPixels` (`Tex.cs:650-653`, i.e. texconv.exe), which is not portable to a browser at all.

**Loose end on the same BC7 arm.** Because it bypasses `MergePixelData`'s TexImpNet path, it also
bypasses the `<64` size guard — which is why `resizeToPow2ForMerge` exempts BC7 from that guard. That
exemption is the one guard-related behaviour on this branch with **no oracle**: it comes from reading
`Tex.cs:650-653` and a hand-derived unit test, not from a pack. It is a guard *suppression*, so if the
reading is wrong we succeed where TexTools aborts. A 40×40 BC7 mask pack in the ordinary `synthetic`
root would settle it — see the design spec §3.4 for the texconv caveat that makes the result need
careful reading.

## Reachability

**Zero corpus packs reach it.** No real pack has an NPOT mask or an NPOT hair texture; the three
`npot-mask-*` packs are authored fixtures. Per `docs/BACKLOG.md`'s "deploying changes the probability
term" note, a hand-authored NPOT mask is plausible enough for a public upload endpoint that this
should not be treated as extinct — but it is not a live defect in anything we have seen.

## Test that pins it

`test/corpus/synthetic/npot-mask-a8.ttmp2`, `npot-mask-dxt5.ttmp2` and
`npot-mask-dxt5-smooth.ttmp2` (`scripts/generate-synthetics/build-synthetic-npot-mask.ts`). All three
share one material and one power-of-two normal and differ **only** in the mask — `-a8` vs `-dxt5`
isolates the round-trip as the cause rather than the resampler, and `-dxt5` vs `-dxt5-smooth`
isolates content as the thing that sets its magnitude. Keep both properties if you touch them: each
comparison is only meaningful because exactly one variable moves.
