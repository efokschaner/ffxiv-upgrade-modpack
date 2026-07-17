# Round 6 partials — `UpdateEyeMask` pixel pipeline (`ConvertEyeMaskToDiffuse`)

**Date:** 2026-07-16
**Status:** Design proposed; implementation pending.
**Foundation:** completes the sibling control-flow spec
(`docs/superpowers/specs/2026-07-16-eye-mask-partial-design.md`), which shipped the `UpdateEyeMask`
gate + iris table and left a **fail-loud throw** at the pixel step. Closes the round-6 eye-mask
partial backlog item, and ports (verifies, not closes) the resampler half of
`docs/backlog/2026-07-10-imagesharp-resampler.md` (T3). Extends the roadmap design
(`docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md`, §5 bundled assets, §8
burndown).

**Goal:** Port `EndwalkerUpgrade.ConvertEyeMaskToDiffuse` (`EndwalkerUpgrade.cs:1910-2003`) and the
tail of `UpdateEyeMask` (`:2056-2077`) — the ImageSharp pixel pipeline that turns a loose Endwalker
iris **mask** into a Dawntrail iris **diffuse** — **removing the throw** the control-flow slice left
behind, and landing it together with a real ConsoleTools `/upgrade` **golden** that proves the
conversion. This is the deliverable the backlog demands: the golden proving the conversion and the
removal of the throw are the *same* work.

---

## 1. Where the seam is now, and what this closes

The control-flow slice ships everything up to the pixel conversion: the `EyeMaskPathRegex` match, the
option-exists check, the face/race parse, and the bundled iris `(race,face)→diffuse` existence oracle
with its `FileExists` gate (`src/upgrade/eye-mask.ts`, table in `src/upgrade/reference/eye-materials.ts`).
When an unclaimed `--c{race}f{face}_iri_s.tex` clears every guard, the port **throws** at the pixel
step. This spec replaces that throw with the faithful conversion.

Two facts from the C# trace fix the scope (confirmed while brainstorming this spec):

- **Write-back is already solved and byte-exact.** `DefaultTextureFormat` is `A8R8G8B8`
  (`XivCache.cs:68`); the eye path's `ConvertToDDS(..., DefaultTextureFormat, useMipMaps:true)` +
  `DDSToUncompressedTex` (`:2069-2073`) is the same `allowFast8888` fast path the round-2 texture port
  already matches byte-for-byte via `encodeUncompressedTex` (`src/tex/encode.ts`) — including the
  `CreateFast8888DDS` "world's-worst-mipmaps" decimation (`generateMipmaps`, parity-tested).
  `writeGeneratedTex` handles the container form.
- **The one real blocker is the ImageSharp float pipeline** — a Bicubic resize, a NearestNeighbor
  resize, a `BoxBlur(w/128)`, and two `DrawImage` composites (positioned `SrcOver`, then full-canvas
  `SrcAtop`). We hand-port these (see §5); a third-party library is ruled out (see §3).

---

## 2. Decision record — hand-port vs. library (operator-flagged)

The backlog flagged two avenues: survey a third-party npm library, and expect a "close-enough"
golden. Resolution:

- **Hand-port, pure TS.** **The browser deployment target decides it.** The shipped pipeline runs in
  the Vite browser bundle, so native libraries (`sharp`/libvips) are out entirely. The pure-JS/WASM
  alternatives (`jimp`, `wasm-vips`) use *different* resampler/blur/composite algorithms than
  ImageSharp — so they do **not** get us closer to the golden (which is produced *by* ImageSharp
  2.1.11); they force a wider, harder-to-justify tolerance **and** add bundle weight, while `jimp`
  lacks a first-class `SrcAtop`. A hand-port is zero-dependency, browser-native, deterministic, and
  yields the *tightest* achievable tolerance against an ImageSharp golden. Operator approved
  (2026-07-16).
- **Close-enough golden, yes.** Byte-parity against ImageSharp's float32 pipeline from JS float64 is
  not expected; the golden is compared under a documented per-pixel `DIVERGENCE_RULES` tolerance
  (see §7), blessed as tight as the port allows.

---

## 3. The C# pipeline, traced (`ConvertEyeMaskToDiffuse` + `UpdateEyeMask` tail)

`UpdateEyeMask` tail (`:2056-2077`), after the iris `FileExists` gate:

1. `baseMaterial = Mtrl.GetXivMtrl(irisPath)`; `newTexPath = g_SamplerDiffuse.TexturePath` (`:2056-2059`)
   — already captured per-entry as `diffusePath` in `eye-materials.ts`; **no material read at runtime**.
2. `pixels = tex.GetRawPixels()` (`:2062`) — decode the mask `.tex` to RGBA (our `decodeToRgba`).
3. `updated = ConvertEyeMaskToDiffuse(pixels, tex.Width, tex.Height)` (`:2064`) — the pipeline below.
4. `SwizzleRB(updated.PixelData, …)` (`:2066`) — see §6 (the swizzle seam).
5. `ConvertToDDS(…, A8R8G8B8, useMipMaps:true) → DDSToUncompressedTex` (`:2069-2073`) →
   `encodeUncompressedTex(…, {mips:true})`.
6. `WriteFile(maskData, newTexPath, …)` (`:2077`) → `writeGeneratedTex(option, diffusePath, …)`.

`ConvertEyeMaskToDiffuse(maskData, ow, oh)` (`:1910-2003`), exact order:

1. `ratio = 0.442`; `w = ow*4`, `h = oh*4`; `irisW = (int)(w*ratio)`, `irisH = (int)(h*ratio)`
   (`:1915-1924`). Integer truncation on the iris dims.
2. Read base-game `eye01_base.tex` (diffuse) and `eye01_mask.tex` (frame); `GetRawPixels` each
   (`:1928-1932`) — **bundled**, see §5.
3. `ExpandChannel(maskData, 0, ow, oh)` (`:1935`) — greyscale the mask onto R,G,B from **red**.
4. `resizedMask = ResizeImage(maskData, ow, oh, irisW, irisH)` (`:1936`) — **Bicubic** (default).
5. `ExpandChannel(frameData, 2, frameW, frameH, includeAlpha:true)` (`:1939`) — greyscale the frame
   from **blue**, alpha included.
6. Resize `frameImage` to `(w,h)` with **NearestNeighbor** (`:1943-1952`), then `BoxBlur(w/128)`
   (`:1956`); read pixels back (`:1957`).
7. New blank `w×h` canvas; `DrawImage(resizedMask, point=((w/2)-(irisW/2),(h/2)-(irisH/2)), 1.0f)`
   (positioned, default **Normal+SrcOver**) (`:1960-1972`).
8. `MaskImage(maskPixels, frameData, w, h)` (`:1977`) — copy the frame's **alpha** into the mask
   canvas's alpha.
9. Resize `baseDiffuse` to `(w,h)` **Bicubic** (`:1980-1991`); `DrawImage(maskCanvas,
   GraphicsOptions{AlphaCompositionMode=SrcAtop})` (full-canvas, **Normal+SrcAtop**) (`:1993-1997`).
10. Return `(finalData, w, h)` (`:1999-2000`).

`w/128` is C# integer division (`int/int`). The `(int)` casts truncate toward zero.

---

## 4. Module decomposition (split, don't blend)

The new code traces to two upstreams; it splits along that line. Each module cites its source in a
header comment (ImageSharp files cited as `SixLabors.ImageSharp v2.1.11 · <File>.cs · <method>`).

| Module | Upstream | Contents |
|---|---|---|
| `src/tex/imagesharp/resample.ts` (new) | ImageSharp 2.1.11 | `resizeBicubic`, `resizeNearestNeighbor` (`Stretch`, `PremultiplyAlpha=false`) |
| `src/tex/imagesharp/blur.ts` (new) | ImageSharp 2.1.11 | `boxBlur(rgba,w,h,radius)` — 2-pass separable, premultiplied, edge-clamp |
| `src/tex/imagesharp/compose.ts` (new) | ImageSharp 2.1.11 | `drawImage` with Porter-Duff `Normal+SrcOver` (positioned, opacity) and `Normal+SrcAtop` (full-canvas) |
| `src/tex/helpers.ts` (extend) | `TextureHelpers.cs` | `expandChannel`, `maskImage`, `swizzleRB` (trivial per-texel, byte-exact) |
| `src/upgrade/eye-mask.ts` (extend) | `EndwalkerUpgrade.cs` | `convertEyeMaskToDiffuse` orchestration + the `UpdateEyeMask` tail; **remove the throw** |
| `scripts/extract-eye-materials.ts` (extend) | `Tex.GetXivTex`/`GetRawPixels` | also emit the bundled base eye textures via `/extract` `.tga` (§5.6) |
| `src/upgrade/reference/eye-base-textures.ts` (new, generated) | base game | decoded 128×128 RGBA constants for `eye01_base`/`eye01_mask` (from TexTools' own `.tga` decode), base64-embedded |
| `src/upgrade/texture.ts` (edit) | `EndwalkerUpgrade.cs` | replace the two `TextureResizeUnsupported` throws with `resizeBicubic` calls (§7 scope) |

A new `src/tex/imagesharp/` subsystem is the honest home for the ImageSharp ports: a distinct
upstream, reusable (the resampler is the shared T3 dependency), each function cited to its ImageSharp
file/method — mirroring how the C# separates `TextureHelpers`/`Tex` (image ops) from
`EndwalkerUpgrade` (orchestration). Per "split, don't blend", `convertEyeMaskToDiffuse` stays in
`eye-mask.ts` (an `EndwalkerUpgrade` symbol) and merely *calls* the `imagesharp/` ops.

---

## 5. The ImageSharp ports — exact algorithms (ImageSharp v2.1.11)

All resize/blur/composite math is **float32 `Vector4`** RGBA in 0..1. Provenance verified against the
`v2.1.11` tag. Each op gets its own ImageSharp-derived unit test (§7).

### 5.1 Bicubic resampler — `resample.ts`
Provenance: `BicubicResampler.cs · GetValue/Radius`, `ResizeKernelMap.cs · BuildKernel`,
`ResizeProcessor{TPixel}.cs`, `ResizeKernel.cs`.

- **Weight**, radius 2, `a = -0.5` (Catmull-Rom): for `x≥0`, `W(x) = 1.5x³−2.5x²+1` (`x≤1`);
  `−0.5x³+2.5x²−4x+2` (`1<x<2`); `0` (`x≥2`). Even function (uses `|x|`). Compute in float32.
- **Kernel build** per output index `i`: `ratio = srcLen/dstLen`; `scale = max(ratio, 1)`
  (widens only on downscale); `radius = ceil(scale·2)`; `center = (i+0.5)·ratio − 0.5`;
  `left = max(0, ceil(center−radius))`, `right = min(srcLen−1, floor(center+radius))`; weight at
  source `j` is `W((float)((j−center)/scale))`; **normalize by the sum of the surviving weights**
  (edge windows are truncated *then* renormalized to sum 1). `ceil`/`floor` use ImageSharp's
  `TolerantMath` (epsilon-tolerant) — port that tolerance.
- **Separable**: horizontal pass then vertical. `PremultiplyAlpha=false` ⇒ **no** premultiply;
  `Compand=false`. Weighted dot-product `Σ wᵢ·pixelᵢ` from `left`.

### 5.2 NearestNeighbor resampler — `resample.ts`
Provenance: `NearestNeighborResampler.cs`, `ResizeProcessor{TPixel}.ApplyNNResizeFrameTransform`.

- `factor = (float)srcDim/dstDim` per axis; `srcX = (int)(x·widthFactor)`, `srcY = (int)(y·heightFactor)`
  for a full-canvas Stretch (origins 0). **Truncation, no `+0.5`.** Copy pixels directly (no blend).

### 5.3 BoxBlur — `blur.ts`
Provenance: `BoxBlurProcessor{TPixel}.CreateBoxKernel`, `Convolution2PassProcessor{TPixel}.cs`,
`KernelSamplingMap.cs`.

- 1-D kernel length `2r+1`, every weight `1f/(2r+1)`. **2-pass separable** (horizontal then vertical),
  computed in **premultiplied** space (`Premultiply` before, `UnPremultiply` after). **Borders
  clamp** sample coordinates to the nearest edge (replicate) — *note the contrast with resize, which
  truncates the window and renormalizes.*
- Radius here is `w/128` (C# int division). For `r=0` (tiny masks: `w<128`, i.e. `ow<32`) the kernel
  is length 1 (identity) — reproduce, don't special-case away.

### 5.4 DrawImage compositing — `compose.ts`
Provenance: `DrawImageProcessor{…}.cs`, `PorterDuffFunctions.cs` (`Over`, `Atop`, `Normal`),
`DefaultPixelBlenders.Generated.cs`.

Straight-alpha `Vector4` in/out (0..1). `Normal(backdrop,source)=source`. `opacity` scales
`source.W` first. `ε = Constants.Epsilon` guards the divisor.

- **`Over`** (SrcOver): `blendW=d.W·s.W`; `dstW=d.W−blendW`; `srcW=s.W−blendW`; `alpha=dstW+s.W`;
  `color = (d·dstW + s·srcW + s·blendW)/max(alpha,ε)`; `color.W=alpha`.
- **`Atop`** (SrcAtop): `blendW=d.W·s.W`; `dstW=d.W−blendW`; `alpha=d.W` (backdrop alpha preserved);
  `color = (d·dstW + s·blendW)/max(alpha,ε)`; `color.W=alpha`.
- **Positioned draw** (step 7): a `Point` offset selects which overlay pixel aligns to each backdrop
  pixel over the overlap region; no scaling. Opacity 1.0.
- **Full-canvas draw** (step 9): overlay and backdrop are the same size; blend every pixel.

### 5.5 Per-texel helpers — `src/tex/helpers.ts`
Provenance: `TextureHelpers.cs`. All byte-exact integer/copy ops, matching the existing helpers there.

- `expandChannel(data, channel, w, h, includeAlpha=false)` (`:191`): copy `data[i+channel]` into the
  first 3 (or 4) channels of each texel.
- `maskImage(base, mask, w, h)` (`:88`): `base[i+3] = mask[i+3]` per texel; reproduce the
  size-mismatch `InvalidDataException` guard (`:90-95`) as a throw.
- `swizzleRB(data, w, h)` (`:172`): swap bytes 0 and 2 per texel.

### 5.6 Bundled base-game eye textures — `eye-base-textures.ts`
`ConvertEyeMaskToDiffuse` reads `chara/common/texture/eye/eye01_base.tex` and `eye01_mask.tex` via
`GetXivTex(...).GetRawPixels()` (`:1928-1932`). **Measured (2026-07-16, live game):** both are
**128×128 DXT1 (BC1), 8 mips**; the pipeline consumes each as decoded **128×128 RGBA** (64 KiB).

- **Form — embed the decoded RGBA as constants, not raw `.tex`.** Every other generated reference
  table (`hair-materials.ts`, `index-path-overrides.ts`, …) stores the **pre-resolved consumed form**
  — the fields/values the ported logic reads — never raw file bytes needing a runtime parse.
  `eye-base-textures.ts` follows suit: it exports the **decoded RGBA + dims** (e.g.
  `{ width: 128, height: 128, rgba: Uint8Array }` per texture), the exact `GetRawPixels` output
  `convertEyeMaskToDiffuse` uses directly. No runtime `.tex` parse, no BC decode on the hot path.
- **Source encoding.** There is no comma-array binary precedent in the repo; embed each 64 KiB
  payload as a **base64 string decoded once at module load** (via a small shared util — reuse one in
  `src/util` if present), keeping the generated file ~⅓ the size of a numeric-array literal. (A plain
  `new Uint8Array([...])` literal is the alternative if we prefer zero decode ceremony; base64 chosen
  for size.)
- **Decode source — zero BC-parity risk.** Obtain the pixels from **TexTools' own decode**, not ours:
  `ConsoleTools /extract <path> <dest>.tga` emits an uncompressed 32-bit TGA (measured: `imageType=2`,
  `bpp=32`, 18-byte header + 128×128×4, **no** footer, descriptor `0x08` ⇒ 8 alpha bits, **bottom-left
  origin**). `extract-eye-materials.ts` parses that TGA — **flip rows to top-down and swap BGRA→RGBA**
  — reconstructing exactly `GetRawPixels`. So the bundled constants are precisely what the C# pipeline
  consumes; nothing leans on `decodeToRgba`'s BC1 path for these, and the systematic BC-decode-parity
  risk is designed out rather than deferred to the golden. (Confirm the row flip against the golden —
  a vertical flip would be a glaring structured diff.)

---

## 6. The write-back / swizzle seam

Round-2 textures reach byte-parity as `decodeToRgba → transform → encodeUncompressedTex`, with
`packA8R8G8B8`'s R↔B swap folded in and **no** explicit `SwizzleRB`. The eye path is different: it
calls `SwizzleRB` (`:2066`) **before** `ConvertToDDS`. `CreateFast8888DDS` (`Tex.cs:823`) copies its
input as-is under BGRA channel masks; the R↔B reordering to the canonical `.tex` layout happens in
`DDSToUncompressedTex`. So the eye tail's net channel order is a real question the port must get
right.

**Resolution:** implement the tail as the C# does — apply `swizzleRB` then `encodeUncompressedTex` —
and verify against the golden. An R↔B error is a glaring, structured diff (whole channels swapped),
so it is self-correcting during implementation; trace `DDSToUncompressedTex` (`Tex.cs`) to confirm the
faithful arrangement rather than guessing. Because we can produce the golden locally, this is a
bounded implementation detail, not a design risk.

---

## 7. Verification — the golden lands with the port

### 7.1 New eye golden (primary)
A committed builder `scripts/generate-synthetics/build-synthetic-eye-mask.ts` (mirroring the existing
`build-synthetic-*` builders and their byte-reproducible `pmp-builder`/`ttmp2-builder` machinery)
authors a minimal pack carrying a loose `--c{race}f{face}_iri_s.tex` for a `(race,face)` **present**
in `eye-materials.ts`, with meaningful **red-channel** data (only Mask.Red survives the conversion).
Built pack is gitignored; `npm run synthetics` regenerates it. Run through `/upgrade`, cached, and
compared under a new **`DIVERGENCE_RULES`** entry (`test/helpers/upgrade-compare.ts`) that confirms
the converted diffuse matches the golden within a documented per-pixel tolerance (float64-vs-float32),
citing this spec. Files matched by no rule must stay byte-identical. Bless the tolerance empirically,
as tight as the port allows; if it must be loose, that is a signal to investigate, not to widen
silently.

### 7.2 Resampler proof against real corpus (scope: operator-chosen)
Beyond the eye synthetic, wire `resizeBicubic` into the two round-2/round-6 hair resize skips that
real corpus mods exercise, replacing the `TextureResizeUnsupported` throws in
`updateEndwalkerHairTextures` (`src/upgrade/texture.ts`): the pow2 pre-step (`:1195`) and the
common-max `ResizeImages` (`:1205`). This moves `Misty_Hairstyle_Female` (normal 4096² vs mask 1024²)
and `Eliza` (512² vs 1024²) from **baselined raw-copy skips** to **within-tolerance resized+transformed
diffs** vs real ConsoleTools/ImageSharp output — the strongest isolated proof the resampler is
faithful (real ImageSharp bytes, no blur/compositing confound). Re-bless those per-pack ratchet
baselines. Confirm each resize call site's sampler/filter against the C# before wiring (`:1195`
pow2 pre-step filter vs `:1205` Bicubic).

**Out of scope (left to the T3 item, `docs/backlog/2026-07-10-imagesharp-resampler.md`):** the T2
`FixOldTexData` NPOT resize and full T3 closure. `resizeToPowerOfTwo` (`src/tex/encode.ts`) keeps its
fail-loud throw until then. Update the T3 backlog item to record that the resampler itself is now
ported (in `src/tex/imagesharp/resample.ts`) and only its remaining call-site wiring stays open.

### 7.3 Unit tests
- Each `imagesharp/` op: an ImageSharp-derived synthetic fixture (small hand-computed input/output)
  asserting the exact math (kernel weights, NN truncation, box-blur edge-clamp, Over/Atop formulas).
- `test/upgrade/eye-mask.test.ts`: flip the throw-path assertion to assert the conversion runs and
  writes at `diffusePath`; keep the skip-path assertions (regex miss, iris absent, race round-trip).
- The per-texel helpers get byte-exact assertions alongside the existing `helpers` tests.

---

## 8. Provenance & licensing documentation (required deliverable)

ImageSharp is a NuGet dependency of `xivModdingFramework` (`xivModdingFramework.csproj:37`,
`SixLabors.ImageSharp 2.1.11`), and we now port specific image ops from it. Document its version and
provenance **in the same place the other ported upstreams are documented**, not ad hoc:

- **README provenance section** (`README.md`, "Upstream provenance — what we port from"): add
  ImageSharp `v2.1.11` alongside the existing table — analogous to the `bc7enc_rdo` "BC7 codec
  reference" row (a dependency we reference to port a specific codec). Note it is **not vendored under
  `reference/`** but read from the `SixLabors/ImageSharp` GitHub tag `v2.1.11` (the version pinned by
  xivModdingFramework and therefore the exact algorithms that produced the golden), Apache-2.0
  licensed, and that `src/tex/imagesharp/` ports its resamplers/blur/compositing.
- **`NOTICE`**: add a sub-entry (mirroring the `bc7enc_rdo` block) —

      src/tex/imagesharp/ contains image resampling, blur, and compositing
      ported from SixLabors.ImageSharp (v2.1.11):
        Copyright (c) Six Labors.
        Licensed under the Apache License, Version 2.0.

  Apache-2.0 is one-way compatible with GPL-3.0-or-later, so the combined work remains GPL-3.0.
- **Module headers** cite `SixLabors.ImageSharp v2.1.11 · <File>.cs · <method>` (per §5), the same
  `file · symbol` convention as every other ported module.

---

## 9. End-of-task gate

`npm run check`, `npm run typecheck`, `npm test` all green:

- New eye golden matches within the blessed tolerance; the throw is gone; `eye-mask.test.ts` asserts
  conversion.
- Misty/Eliza baselines re-blessed to within-tolerance resized diffs (no longer raw-copy skips); no
  other corpus pack regresses.
- New `imagesharp/` + helper unit tests pass.
- README provenance + `NOTICE` updated; backlog items updated (`…-partials-eye-mask.md` deleted with
  its guard/gap references swept per BACKLOG.md; `…-imagesharp-resampler.md` narrowed to the remaining
  call-site wiring).

If the base-texture extraction cannot run in a given session (no live game/ConsoleTools), the
committed `extract-eye-materials.ts` plus a one-line operator run regenerates
`eye-base-textures.ts` — the same regenerate-on-a-game-machine contract the iris table already
carries. (Both game and ConsoleTools are present on the operator's machine, so this lands in-session.)
