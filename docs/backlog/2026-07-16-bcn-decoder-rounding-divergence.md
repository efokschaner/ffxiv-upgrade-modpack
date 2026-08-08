# Deepen / re-evaluate the known ±1 BCn decoder divergence vs TexTools

Filed: 2026-07-16 · Status: open · Surfaced while sourcing the bundled
base eye textures for the eye-mask pixel pipeline
(`docs/superpowers/specs/2026-07-16-eye-mask-pixel-pipeline-design.md` §5.6).

**This divergence is already known and accepted — this item is to look deeper and re-decide, not a
fresh discovery.** The ±1 BCn value-rounding gap is documented in `src/tex/decode.ts` (`decodeBc5`
header, ~:396-398, "S3TC/RGTC implementation-defined value rounding") and already **absorbed by a
tolerance**: `test/helpers/upgrade-compare.ts`'s first `DIVERGENCE_RULES` entry confirms any generated
A8R8G8B8 `.tex` differing from the golden by ≤±1 per post-header byte. So today the port *accepts* the
gap rather than eliminating it. What this item adds is (a) a concrete measurement against TexTools'
*actual* decoder, (b) confirmation it extends beyond BC5 to **DXT1**, and (c) the re-evaluation below.

Our block-texture decoders (`src/tex/decode.ts` for BC1/DXT1, DXT3, DXT5, BC4, BC5; `src/tex/bc7.ts`
for BC7) are ported from **richgel999/bc7enc_rdo** (`rgbcx.h` / `bc7decomp.cpp`) and BC7 is
pixel-exact vs the **DirectXTex `texconv`** reference (`bc7.ts:5`). TexTools does **not** use either:
`XivTex.GetRawPixels` → `DDS.ConvertPixelData` (`DDS.cs`) delegates block decoding to **FNA's
`DxtUtil`** (Ms-PL) — the decoder our `decode.ts:2` header notes we deliberately did *not* port (the
bc7enc source is MIT/Unlicense; FNA's is Ms-PL). The two round the reconstructed interpolated colors
(`(2·c0+c1)/3`, `(c0+2·c1)/3`, plus the RGB565→888 expansion) differently, so our decode drifts from
TexTools' by **±1 LSB** on any texel landing on an interpolated color.

**Repro (measured 2026-07-16).** Decode two base-game DXT1 textures both ways — ours
(`decodeToRgba(parseTex(.tex))`) vs TexTools' own decode (`ConsoleTools /extract … .tga`, which is
`GetRawPixels` → TGA), normalized to top-down RGBA:

| Texture | Bytes differing / 65536 | Max delta |
|---|---|---|
| `chara/common/texture/eye/eye01_base.tex` (128×128 DXT1) | 9099 (~14%) | 1 |
| `chara/common/texture/eye/eye01_mask.tex` (128×128 DXT1) | 1094 (~1.7%) | 1 |

**Why it matters / how it's currently handled.** `decodeToRgba` is on the round-2 texture path
(`src/upgrade/texture.ts:42/62/91-92`), which decodes a mod's **source** normal/mask before
transforming and re-encoding. A corpus mod shipping a **BC-compressed** normal/mask that reaches
`createIndexFromNormal` / `upgradeMaskTex` / `updateEndwalkerHairTextures` carries this ±1 into the
re-encoded output — and the golden harness **already tolerates it**: the `.tex` ±1 `DIVERGENCE_RULES`
entry confirms it as an intended divergence (phenomenon-scoped, not path-scoped), so it does *not*
fail the suite. The gap is therefore not "uncaught" but "papered over by a tolerance the port would
rather not need" — plus there is no *direct* unit test decoding a BC block and asserting byte-parity
against **TexTools' `DxtUtil`** specifically (the `decodeBc5` corroboration is against `texconv`, a
*third* decoder, not the one TexTools runs). (BC7 may be exempt: TexTools decodes BC5/BC7 via
`JeremyAnsel.BcnSharp` → the same `bc7enc_rdo` native we ported, per tex-codec spec §3, while `DxtUtil`
handles only DXT1/3/5 + BC4 — so the drift likely affects only the `DxtUtil` formats. Confirm per
format; the DXT1 repro above only proves the `DxtUtil` case.)

**Re-evaluate the original decoder-source choice.** The decision to port from `bc7enc_rdo` rather
than TexTools' actual decoder is documented in the tex-codec spec
(`docs/superpowers/specs/2026-07-03-tex-codec-design.md`): §3's *"Licensing note"* (`DxtUtil` is
**Ms-PL**, GPL-incompatible per the FSF, so we do **not** transcribe it; `bc7enc_rdo` is MIT/Unlicense,
GPL-compatible), and §7's justification that *"a spec-conformant decoder **matches** any other …, so
byte-exact parity is achievable."* **That §7 assumption is what this finding falsifies:** BC1 decode
is *not* uniquely determined by the S3TC standard — the interpolation and RGB565→888 rounding are
implementation-defined, so `bc7enc_rdo` and `DxtUtil` are both conformant yet disagree by ±1. The
license reasoning still stands (we cannot copy Ms-PL `DxtUtil` code into a GPL-3.0 project), but the
parity conclusion built on top of it does not. A fix here should also correct that §7 claim.

**What to investigate.**
1. Trace `DDS.ConvertPixelData` (`DDS.cs`) to confirm exactly which decoder handles each block format
   (FNA `DxtUtil` for DXT1/3/5 + BC4; `JeremyAnsel.BcnSharp` → `bc7enc_rdo` native for BC5/BC7 per the
   spec §3) and capture each one's precise rounding. **BC5/BC7 may already be byte-exact** — if
   TexTools' BC5/BC7 path is the same `bc7enc_rdo` we ported, only the `DxtUtil`-decoded formats
   (DXT1/3/5, BC4) would drift. Confirm; the eye DXT1 repro only proves the `DxtUtil` case.
2. Scan the corpus for BC-compressed source textures reaching the round-2 decode path — does any real
   pack actually exercise it? If none, this stays latent and the parity gap is theoretical.
3. Decide the fix: **match `DxtUtil`'s rounding** so `decodeToRgba` == `GetRawPixels` byte-for-byte.
   Because `DxtUtil` is Ms-PL, do this as a **clean-room reimplementation** — reproduce the observable
   rounding from the S3TC standard, tuned/validated against TexTools' *output* (e.g. the `.tga`
   decode), **not** by transcribing `DxtUtil`'s source. The algorithm/rounding behaviour is not
   copyrightable; only `DxtUtil`'s specific code is, and we never read it into the port. (Fallback, if
   a corpus case makes it reachable before this lands: a scoped `DIVERGENCE_RULES` per-pixel tolerance
   for BC-sourced re-encodes, citing this item — but byte-parity is the bar, so prefer the fix.)

**Already mitigated where it would have bitten.** The eye-mask pixel pipeline sidesteps this by
sourcing its bundled base textures from TexTools' own `.tga` decode (`GetRawPixels`-exact) rather than
our decoder (spec §5.6), so the eye diffuse does not inherit the ±1. This item is about the *general*
decoder, not that specific bundling.

Reference: `src/tex/decode.ts`, `src/tex/bc7.ts`; `reference/.../Textures/FileTypes/DDS.cs`
(`ConvertPixelData`), `reference/.../Textures/DataContainers/XivTex.cs:161` (`GetRawPixels`); FNA
`DxtUtil` (the decoder TexTools delegates block decoding to).

## Update 2026-08-07 — upstream replaced `DxtUtil` outright, and both premises above moved

Found while verdicting `371f74b` ("Fix Racial Deforms and Replace GPL violating `DxtUtil.cs`") during
the v3.1.1.4 re-pin. **Two of this item's load-bearing premises are now out of date, in opposite
directions**, which is why it is being promoted rather than just annotated.

**1. The licensing obstacle is gone.** `DxtUtil.cs` is no longer FNA's Ms-PL code. At this pin
(`reference/.../Helpers/DxtUtil.cs:1-15`) it carries the **GPL-3.0** header, the same licence as this
repo. The "clean-room reimplementation, validate against output, never transcribe" constraint in
*What to investigate* step 3 — and the tex-codec spec §3 licensing note it rests on — **no longer
applies to this file**. A direct port is now legally available to us, which changes the cost of
closing this item substantially.

**2. More importantly, the decoder itself was rewritten, so our measurement is stale.** The new file
is a fresh in-house implementation, not a relicensed copy of the old one:

- `DecodeDxt1Block` (`:154`), `DecodeDxt3Block` (`:166`), `DecodeDxt5Block` (`:203`) and
  `DecodeBc4Block` (`:241`), driven by a shared `DecodeBlocks` walker (`:69`).
- BC5 and BC7 still delegate to `JeremyAnsel.BcnSharp` — `Bc5Sharp.Decode` (`:44`), `Bc7Sharp.Decode`
  (`:52`) — confirming this item's existing structural guess (step 1) exactly: only the
  `DxtUtil`-decoded formats (DXT1/3/5, BC4) were ever candidates for the drift, and BC5/BC7 route
  through the same `bc7enc_rdo` lineage we ported.

The consequence is the sharp part: **the ±1 divergence characterized in the Repro table above was
measured on 2026-07-16 against the OLD FNA-derived decoder, which no longer exists at our pin.** The
9099/65536 and 1094/65536 figures describe a decoder TexTools no longer runs. The current
divergence — if any — is unmeasured. Three outcomes are possible and we do not yet know which holds:

- the rewrite happens to round the way we do, and the gap is **already closed**, making our
  `DIVERGENCE_RULES` ±1 `.tex` tolerance unnecessary — a tolerance that is no longer needed is not
  harmless, because it silently absorbs *any* future ±1 regression across every generated
  A8R8G8B8 `.tex`, not just this one;
- the gap persists at the same magnitude, and the item proceeds as originally written but with a
  direct port now permitted instead of a clean-room one;
- the gap **changed shape**, in which case our accepted tolerance is currently confirming a
  divergence whose stated cause is wrong.

**Revised first step, replacing step 3's framing.** Before deciding anything about a fix, **re-run
the Repro measurement against the v3.1.1.4 oracle** — the same two base-game DXT1 eye textures,
ours (`decodeToRgba(parseTex(.tex))`) vs `ConsoleTools /extract … .tga`, normalized to top-down RGBA.
That measurement is cheap, needs no new code, and decides which of the three outcomes above we are in
— and therefore whether this item is a port, a tolerance retirement, or a re-characterization. Do not
skip it and port from the new source on the assumption the drift is still there; the whole reason
this item is ranked where it is, is that the accepted tolerance may now be resting on a false premise.

Steps 1 and 2 of *What to investigate* stand unchanged (step 1 is now largely answered — record the
`DDS.ConvertPixelData` trace to close it formally). The §7 correction owed to the tex-codec spec also
stands: the "any spec-conformant decoder matches byte-for-byte" claim was falsified by the original
measurement regardless of which implementation TexTools ships today.
