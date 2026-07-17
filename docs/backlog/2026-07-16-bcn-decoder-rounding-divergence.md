# Our BCn decoder differs from TexTools' by ±1 (interpolation rounding)

Filed: 2026-07-16 · Status: open · Priority: unprioritized · Surfaced while sourcing the bundled
base eye textures for the eye-mask pixel pipeline
(`docs/superpowers/specs/2026-07-16-eye-mask-pixel-pipeline-design.md` §5.6).

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

**Why it matters / reachability.** `decodeToRgba` is on the round-2 texture path
(`src/upgrade/texture.ts:42/62/91-92`), which decodes a mod's **source** normal/mask before
transforming and re-encoding. A corpus mod shipping a **BC-compressed** normal/mask that reaches
`createIndexFromNormal` / `upgradeMaskTex` / `updateEndwalkerHairTextures` would carry this ±1 into
the re-encoded output and diff against the `/upgrade` golden. It has not been isolated because those
paths have so far seen uncompressed `A8R8G8B8` sources — so this is **latent**, but it is a genuine
"found divergence = test-coverage gap" (AGENTS.md): no test currently decodes a BC block and asserts
byte-parity against TexTools, so the drift is invisible until an edge input hits it. (BC7 may be
exempt if TexTools decodes BC7 via a DirectXTex-equivalent path rather than `DxtUtil`, which handles
only DXT1/3/5 — confirm which decoder TexTools actually uses per format before assuming BC7 matches.)

**What to investigate.**
1. Trace `DDS.ConvertPixelData` (`DDS.cs`) to confirm exactly which decoder handles each block format
   (FNA `DxtUtil` for DXT1/3/5? something else for BC4/5/7?) and capture its precise rounding.
2. Scan the corpus for BC-compressed source textures reaching the round-2 decode path — does any real
   pack actually exercise it? If none, this stays latent and the throw/parity gap is theoretical.
3. Decide the fix: either **match FNA `DxtUtil`'s rounding** in our decoder (reproduce its exact
   integer math so `decodeToRgba` == `GetRawPixels` byte-for-byte), or, if a corpus case makes it
   reachable, add a scoped `DIVERGENCE_RULES` per-pixel tolerance for BC-sourced re-encodes and cite
   this item. Prefer the former (byte-parity is the bar).

**Already mitigated where it would have bitten.** The eye-mask pixel pipeline sidesteps this by
sourcing its bundled base textures from TexTools' own `.tga` decode (`GetRawPixels`-exact) rather than
our decoder (spec §5.6), so the eye diffuse does not inherit the ±1. This item is about the *general*
decoder, not that specific bundling.

Reference: `src/tex/decode.ts`, `src/tex/bc7.ts`; `reference/.../Textures/FileTypes/DDS.cs`
(`ConvertPixelData`), `reference/.../Textures/DataContainers/XivTex.cs:161` (`GetRawPixels`); FNA
`DxtUtil` (the decoder TexTools delegates block decoding to).
