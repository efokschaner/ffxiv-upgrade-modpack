# 18. `ResizeXivTx` needlessly BC-recompresses a resized texture that is decoded again and stored uncompressed

**Status:** diverged · **Where:** `Tex.cs:412-419` (`ResizeXivTx`) → `Tex.cs:636-705`
(`MergePixelData`), as called by the three NPOT pre-steps `EndwalkerUpgrade.cs:1096-1099`
(`CreateIndexFromNormal`), `:2086-2089` (`UpgradeMaskTex`), `:1195-1202`
(`UpdateEndwalkerHairTextures`). See `src/upgrade/texture.ts` · `resizeToPow2ForMerge`.

Each pre-step resizes its source with `Tex.ResizeXivTx`. `ResizeXivTx` resizes to raw pixels, then
calls `MergePixelData` to **re-encode those pixels back into the source's own compression format**
(e.g. DXT5) and store them in the `XivTex`. Every caller then immediately calls `GetRawPixels()` to
decode them again, applies its transform, and writes the result as **uncompressed A8R8G8B8**
(`DefaultTextureFormat`, `XivCache.cs:68`; final encode at `EndwalkerUpgrade.cs:1105-1112` and
`:2094`). So on a BC-compressed source the resized image is put through a full, lossy BC compression
generation whose result is thrown away two lines later and never reaches the output format. The
re-encode exists only to keep the `XivTex` object holding data in its declared format — a property
none of these callers use, because they immediately want raw pixels back.

It is demonstrably avoidable: `TextureHelpers.ResizeImage` (`TextureHelpers.cs:365-401`) resizes and
returns **raw** pixels with no re-encode, and TexTools uses it directly two lines later in the very
same hair path — the common-size `ResizeImages` at `:1205` (`TextureHelpers.cs:336-337`). The NPOT
pre-step just reached for the format-preserving utility when the raw one was right beside it.

**Impact — and it lands on real, in-material textures, not preview images.** All three outputs are
shipped textures a shader samples in-game (the material's index / mask / hair samplers); modpack
preview thumbnails go through a different path (`Image`/`ImagePath`) and never touch this code. Two
sub-cases:
- **Index path:** the recompression happens, but `CreateIndexTexture` reads only the normal's alpha
  and quantizes it into rows of 17 (`TextureHelpers.cs:222-260`), which absorbs the round-trip loss
  entirely — no observable quality effect (our output is byte-identical to the golden there).
- **Mask & hair paths:** `UpgradeGearMask` / `CreateHairMaps` have no such quantization, so the BC
  generation loss survives into the final used texture. On a 400×400 DXT5 mask the round-trip moves up
  to 116/255 on the worst channel for adversarial content, ~9 for smooth content — see
  `docs/backlog/2026-07-22-bc-encoder-merge-pixel-data.md`.

**Us:** we do **not** reproduce it. `resizeToPow2ForMerge` resizes to raw RGBA and carries it straight
on — exactly what the raw `ResizeImage` primitive returns — for two reasons, not one: we have no
nvtt-compatible BC encoder to reproduce the round-trip with, **and** reproducing it would faithfully
copy a needless quality loss into a texture the game actually samples. Our output therefore diverges
from the golden on an NPOT BC mask/hair source (documented, and confirmed by two path-scoped
`DIVERGENCE_RULES` entries — `2026-07-22-bc-encoder-merge-pixel-data.md`) and is **plausibly higher
quality** there — one fewer BC generation. That "higher quality" is a code-trace argument, **not** game-verified: under `AGENTS.md`'s
user-benefit-divergence bar we have leg 1 (this entry) but not leg 3 (real-game confirmation), so we
make no confirmed claim of superiority — we simply decline to reproduce a defect we could not
reproduce anyway.

**Upstream fix:** in the three NPOT pre-steps, resize with `TextureHelpers.ResizeImage` (raw pixels)
instead of `Tex.ResizeXivTx`, dropping the `MergePixelData` round-trip — matching what `:1205` already
does. Note the same round-trip incidentally owns the `<64` and unsupported-format aborts
(`Tex.cs:655-659`, `:717-746`, the TexImpNet compressor guards); removing it also removes those
aborts, which is itself an improvement (TexTools currently refuses some tiny/odd-format NPOT sources
it has no real need to).
