# `MergePixelData`'s encode is unported, and the NPOT mask/hair paths and the `.tex` load seam diverge because of it

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

## Second consequence, found 2026-08-09: the mip **chain** diverges too, not only the pixels

Everything above this line is about the *pixels* — the lossy BC round-trip our output skips. That is
one consequence of eliding `MergePixelData`. There is a second, recorded here because it has the same
root cause (we do not port `MergePixelData`'s encode) and will be closed or not by the same work.

**Why it was invisible until now.** At three of `MergePixelData`'s four `/upgrade` call paths, the
`ResizeXivTx` call is only an NPOT-normalizing *pre-step* and the **final** encode is a separate,
later `Tex.ConvertToDDS(byte[], …, allowFast8888: true)` — the index path
(`EndwalkerUpgrade.cs · CreateIndexFromNormal · 1098` then `· 1107`), the hair path
(`· UpdateEndwalkerHairTextures · 1197,1201` then `· 1213,1222`) and the mask path
(`· UpgradeMaskTex · 2088` then `· 2094`). `DefaultTextureFormat` is `A8R8G8B8`, so that later call
takes `CreateFast8888DDS`, and *its* mip chain is what lands in the file. `src/tex/encode.ts ·
generateMipmaps` is a faithful port of `CreateFast8888DDS`, so those three paths are right — whatever
mip chain `MergePixelData` built in between is overwritten and never observed.

**The load seam is the fourth call path, and it has no second encode.**
`EndwalkerUpgrade.cs · ValidateTexFileData · 2109-2112` calls `ResizeXivTx` and then
`tex.ToUncompressedTex()` **directly**. So here `MergePixelData` *is* the final encode, and its mip
behaviour reaches the output bytes:

- it asks nvtt for a full pyramid — `SetMipmapGeneration(true, maxMipCount)` with `maxMipCount = -1`
  whenever the source had mips (`Tex.cs · MergePixelData · 672-678, 685`), i.e. all the way down to
  1×1;
- and it then sets `MipMapCount = GetMipCount(Width, Height)` (`Tex.cs · MergePixelData · 700-704`),
  where `GetMipCount(largestSize) = floor(log2(largestSize) + 1)` over `max(w, h)`
  (`Tex.cs · GetMipCount · 707-714`) — **7** levels for a 64px result.

Ours calls `encodeUncompressedTex(…, { mips: true })` (`src/upgrade/validate-tex.ts ·
validateTexFileData · 37-39`), i.e. `generateMipmaps`' `CreateFast8888DDS` decimation, which stops at
a **2px** floor and emits `max(1, floor(log2(min(w, h))))` levels — **6** for the same 64px result.
Correct at the other three sites, wrong at this one.

**Measured** against a real ConsoleTools `/upgrade` golden (`load-seam-npot.ttmp2`, 2026-08-09):

| | ours | golden |
|---|---|---|
| `.tex` length | 21920 | 21924 |
| header `MipCount` | 6 | 7 |
| dimensions | 64×64 | 64×64 |

Both sides agree on the resize itself: mip0 — the first 16384 payload bytes, `64*64*4` — is
**byte-identical**, and the divergence begins at exactly the mip0/mip1 boundary (payload offset
16384). The 4-byte length difference is the missing 1×1 level. Note the fixture is **A8R8G8B8**, a
lossless source: this consequence is *not* BC-specific, which is why the item's title and the
"Measured cost" table above — both scoped to the BC re-encode — do not cover it.

**Open question, not yet answered.** Only the *first* differing offset was probed. Whether mip levels
1-5 would match nvtt's own filter even once the level *count* is right is **unchecked** — nobody has
compared those levels pixel-by-pixel. So the fix is not necessarily "emit one more level": it may be
that this call site needs a real nvtt-compatible mip filter rather than `CreateFast8888DDS`'s
top-left-texel decimation. Answer that before assuming a `GetMipCount`-shaped variant of
`encodeUncompressedTex` closes it.

**Reached by** `test/corpus/synthetic/load-seam-npot.ttmp2`
(`scripts/generate-synthetics/build-synthetic-load-seam-npot.ts`), built 2026-08-09 as the Branch-A
load-seam golden. Its `/upgrade` and `/resave` baseline entries therefore contain **a real defect**
alongside the cosmetic `ModsJsons[].{Name,Category,DatFile}` re-derivation gap
([`2026-07-13-resave-ttmp2-name-category.md`](2026-07-13-resave-ttmp2-name-category.md)) — anyone
burning that baseline down should treat the `_d.tex` payload entry as this item, not as manifest
noise.

## Measured cost

Scoped to the BC re-encode — the *pixel* consequence. The mip-chain consequence above has its own
measurement. Against real cached ConsoleTools `/upgrade` goldens:

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

**"No forever-baseline" is true of the pixel half only, as of 2026-08-09.** The mip-chain consequence
is carried by `load-seam-npot.ttmp2`'s ratchet baseline, deliberately and with no confirmation rule —
because it is **not** an intended divergence to confirm. It is a straightforward port bug: our output
is wrong and TexTools' is right, with no trade-off and nothing to adjudicate. A `DIVERGENCE_RULES`
entry would assert we meant it. The baseline records it as a known-open diff, and *this section of
this item* is the documentation AGENTS.md requires a baseline entry to have alongside it.

## What would close it

Note the goal is in genuine tension with `docs/TEXTOOLS_BUGS.md` #18: "closing" this means
*reproducing* the golden, which means re-introducing the needless BC generation into a used texture.
So the honest framing is a choice, not a pure fix — byte-parity vs. the (plausibly, unverified)
higher-quality output we ship today. If the operator ever prefers parity here, the way to get it is:

**The two consequences do not close together.** The mip-chain half (above) needs no BC encoder at
all — it is reachable on a lossless A8R8G8B8 source — so it is separable and much cheaper: the level
*count* is a one-line `GetMipCount` port, and the only real question is whether levels 1+ need nvtt's
filter as well (unmeasured; see that section's open question). The pixel half is the expensive one:

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

**Corrected 2026-07-25 — no longer "zero corpus packs reach it."** That claim was accurate only for
the *specific* mask/hair material-round call sites this item was filed against: no real pack has an
NPOT mask or an NPOT hair texture, and the three `npot-mask-*` packs bracketing the cost above remain
authored fixtures. But the underlying capability gap this item tracks — no BC encoder matching
TexImpNet/nvtt, so `MergePixelData`'s re-encode is elided wherever we resize a BC source — is not
confined to those two call sites. The `ValidateTexFileData` load-seam port
(`docs/superpowers/specs/2026-07-25-validate-tex-load-seam-design.md`) wires the identical
`resizeForMerge` primitive into the load-time NPOT-resize branch, and the real pack
`KK_Sportcar_Final_Hotfix_V1.1.1.ttmp2` reaches it there: a DXT1 2048×2048 NPOT-with-mips demihuman
specular (`v01_d1022e0001_dwn_s.tex`) resizes to A8R8G8B8 where the golden re-encodes to DXT1 (measured
mip0 max delta 254/255, noise-magnitude — see `test/helpers/upgrade-compare.ts`'s
`confirmBcResizedAsA8` rule). So a real pack now depends on this same gap; it is fresh evidence for
re-weighing this item's priority (`docs/BACKLOG.md`'s "deploying changes the probability term" note),
even though the mask/hair call sites this item is scoped to remain unreached by any known corpus pack.

**Widened again 2026-08-09.** The same load seam reaches the elision on a **lossless** source too,
via the mip chain rather than the pixels — `test/corpus/synthetic/load-seam-npot.ttmp2`, see the
*Second consequence* section above. So two corpus packs now depend on this item: one real
(`KK_Sportcar_Final_Hotfix_V1.1.1.ttmp2`, BC pixels) and one synthetic (`load-seam-npot.ttmp2`, mip
chain). Ranking is unchanged — that is not this item's call to make.

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
