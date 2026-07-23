# `MergePixelData`'s BC re-encode is unported, and the NPOT mask and hair paths diverge because of it

**Filed:** 2026-07-22, from the NPOT texture-resize work
([`docs/superpowers/specs/2026-07-21-npot-texture-resize-design.md`](../superpowers/specs/2026-07-21-npot-texture-resize-design.md)).

**Severity:** an **accepted, operator-adjudicated divergence** (2026-07-22), not a silent bug — the
site documents it and two committed `DIVERGENCE_RULES` entries confirm it (see below), backed by three
synthetic packs. But it is a real byte-parity hole: we cannot reproduce the golden's bytes on a
BC-compressed NPOT mask/hair source without a BC encoder.

## What diverges

`Tex.ResizeXivTx` (`Tex.cs:413-420`) does three things: Bicubic-resize the decoded pixels, overwrite
the tex's dims, then `Tex.MergePixelData` (`Tex.cs:637-706`) — which **re-encodes the resized RGBA
back into the source's own BC format** via TexImpNet/nvtt. The caller then immediately decodes it
again. So TexTools' pixels have been through one extra lossy compression cycle that ours have not.

`src/upgrade/texture.ts`'s `resizeToPow2ForMerge` elides that round-trip: we have no
nvtt-compatible BC encoder. The *failures* `MergePixelData` owns are reproduced (the
`GetCompressionFormat` unsupported-format throw, `Tex.cs:718-747`; the `<64` size guard,
`Tex.cs:656-660`) — only the re-encode itself is skipped.

**The round-trip is unnecessary, and it degrades an actually-used texture — filed as a TexTools bug
(`docs/TEXTOOLS_BUGS.md` #18).** It exists only to keep the `XivTex` object in its declared format;
every caller decodes it right back, and the final output is uncompressed `A8R8G8B8`. The three
affected outputs — `_id.tex`, the gear mask, the hair normal/mask — are all textures a shader samples
in-game (material samplers), **not** preview images (those go through `Image`/`ImagePath`). So this is
not a divergence we merely *tolerate* because we lack an encoder; it is one where reproducing TexTools
would copy a needless quality loss into what the user renders. Our skipping it is therefore
**plausibly higher quality**, not just unavoidable — with the caveat that "higher quality" is a
code-trace argument and has **not** been game-verified (`AGENTS.md` user-benefit bar: leg 1 met via
#18, leg 3 not), so no confirmed-superiority claim is made.

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

## How it is confirmed — committed rules, no forever-baseline

`AGENTS.md` requires an intended divergence to be *confirmed* by a rule, not suppressed by a
gitignored ratchet baseline. This one is (as of 2026-07-23) — two path-scoped `DIVERGENCE_RULES`
entries (`test/helpers/upgrade-compare.ts`). The design took a few turns, recorded here because the
dead ends are instructive:

1. **A single delta tolerance across all cases — rejected.** ±1/±2 (the operator's first instinct,
   "within one or two like the other validators") does not survive: smooth content already reaches 9.
   A *larger* shared threshold is worse — the smooth 9 is a content-dependent *floor* (§ "Read 9 as a
   floor") and the adversarial 116 has no bound, so any single number either false-fails realistic
   content or, at ≤116, confirms essentially anything.
2. **Distinct gamePaths + per-fixture rules — shipped.** Giving the three fixtures distinct mask paths
   (`top_a`/`top_b`/`top_c`, one builder edit) lets a path-scoped `confirm` treat each case on its
   merits:
   - `top_b` (`npot-mask-dxt5-smooth`, realistic): valid same-shape A8R8G8B8 mask **within a generous
     sanity ceiling** (`NPOT_MASK_BC_BOUND = 32`; measured 9, headroom for a different nvtt build). A
     ceiling, not a claimed bound — it catches gross breakage without pretending to know the true
     magnitude.
   - `top_c` (`npot-mask-dxt5`, adversarial): valid same-shape A8R8G8B8 mask, **pixels exempt** — no
     numeric bound is meaningful on noise content (measured 116).
   - `top_a` (`npot-mask-a8`, lossless source): **not covered by any rule** — byte-identical to its
     golden, the hard regression guard.

**What the rules do and don't assert, honestly.** They verify structure (format/dims/length) and, for
`top_b`, a coarse delta ceiling; they do **not** verify the pixels are *correct* (we can't, without
the encoder). That correctness is guarded byte-exactly where it can be: `npot-mask-a8` (same code
path, lossless source, byte-identical) and the unit tests in `test/upgrade/texture.test.ts`. A
committed rule with a cited reason is documentation; the earlier ratchet-baseline-only handling was
not (that is why this changed).

A **shape** rule — confirming "these bytes differ exactly as a BC round-trip would explain" — remains
impossible: it requires performing the BC round-trip, i.e. the encoder we lack.

## What would close it

Note the goal is in genuine tension with `docs/TEXTOOLS_BUGS.md` #18: "closing" this means
*reproducing* the golden, which means re-introducing the needless BC generation into a used texture.
So the honest framing is a choice, not a pure fix — byte-parity vs. the (plausibly, unverified)
higher-quality output we ship today. If the operator ever prefers parity here, the way to get it is:

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
`npot-mask-dxt5-smooth.ttmp2` (`scripts/generate-synthetics/build-synthetic-npot-mask.ts`). Each is a
structurally identical pack re-pathed to its own equipment variant (`top_a`/`top_b`/`top_c`) and
differs **only** in the mask content — `-a8` vs `-dxt5` isolates the round-trip as the cause rather
than the resampler, and `-dxt5` vs `-dxt5-smooth` isolates content as the thing that sets its
magnitude. **Two properties are load-bearing, keep both if you touch these:** (1) exactly one variable
moves between packs, or the attribution breaks; (2) the three masks sit at *distinct* gamePaths, or
the `top_b`/`top_c` `DIVERGENCE_RULES` predicates would also cover `-a8`'s mask and neuter its
byte-exact guard. There are **no** payload baseline entries for any of them — the mask divergences are
confirmed by rule, not baselined.
