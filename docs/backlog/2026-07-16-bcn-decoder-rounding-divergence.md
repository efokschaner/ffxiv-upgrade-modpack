# Deepen / re-evaluate the known ±1 BCn decoder divergence vs TexTools

Filed: 2026-07-16 · Status: open · Priority: unprioritized · Surfaced while sourcing the bundled
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
