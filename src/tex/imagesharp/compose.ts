// Ported from SixLabors.ImageSharp v2.1.11 (verified against the v2.1.11 tag source):
//   - DrawImageProcessor{TPixelBg,TPixelFg}.cs · OnFrameApply (computes the overlap rectangle
//     between the background bounds and the foreground image placed at `this.Location`, then
//     blends row-by-row over that overlap only — pixels outside it are left untouched)
//   - PixelFormats/PixelBlenders/PorterDuffFunctions.Generated.cs · NormalSrcOver / NormalSrcAtop
//     (`source.W *= opacity;` then `Over(backdrop, source, Normal(backdrop, source))` /
//     `Atop(backdrop, source, Normal(backdrop, source))` — opacity scales the source alpha before
//     compositing; `Normal(backdrop, source)` is the color-blend step and simply returns `source`)
//   - PixelFormats/PixelBlenders/PorterDuffFunctions.cs · Normal / Over / Atop (straight-alpha
//     Vector4 in 0..1; `Over`/`Atop` divide the composited color by `MathF.Max(alpha,
//     Constants.Epsilon)` to un-premultiply, guarding against division by (near) zero)
//
// ImageSharp's Vector4 math is float32; this port uses JS float64. Byte-parity vs the real
// ImageSharp golden is therefore not guaranteed bit-for-bit; a documented tolerance is expected
// (see DIVERGENCE_RULES / Task 8).

// Constants.cs · Epsilon
const EPSILON = 1e-7;

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// PorterDuffFunctions.cs · Over(Vector4 backdrop, Vector4 source, Vector4 blend): straight-alpha
// SrcOver compositing. `blend` is `Normal(backdrop, source)`, i.e. `source` unchanged — inlined
// here since this port only ever composes with the Normal color blend.
function over(
  dR: number,
  dG: number,
  dB: number,
  dA: number,
  sR: number,
  sG: number,
  sB: number,
  sA: number,
): [number, number, number, number] {
  const blendW = dA * sA;
  const dstW = dA - blendW;
  const srcW = sA - blendW;
  const alpha = dstW + sA;
  const divisor = Math.max(alpha, EPSILON);
  const r = (dR * dstW + sR * srcW + sR * blendW) / divisor;
  const g = (dG * dstW + sG * srcW + sG * blendW) / divisor;
  const b = (dB * dstW + sB * srcW + sB * blendW) / divisor;
  return [r, g, b, alpha];
}

// PorterDuffFunctions.cs · Atop(Vector4 backdrop, Vector4 source, Vector4 blend): straight-alpha
// SrcAtop compositing. `blend` is `Normal(backdrop, source)`, i.e. `source` unchanged — inlined
// here since this port only ever composes with the Normal color blend.
function atop(
  dR: number,
  dG: number,
  dB: number,
  dA: number,
  sR: number,
  sG: number,
  sB: number,
  sA: number,
): [number, number, number, number] {
  const blendW = dA * sA;
  const dstW = dA - blendW;
  const alpha = dA;
  const divisor = Math.max(alpha, EPSILON);
  const r = (dR * dstW + sR * blendW) / divisor;
  const g = (dG * dstW + sG * blendW) / divisor;
  const b = (dB * dstW + sB * blendW) / divisor;
  return [r, g, b, alpha];
}

// DrawImageProcessor{TPixelBg,TPixelFg}.cs · OnFrameApply: blends `src` (placed at
// `(offsetX, offsetY)` in `dst`'s coordinate space) over `dst`, restricted to the overlap
// rectangle between `dst`'s bounds and the placed `src` bounds — pixels outside the overlap are
// left untouched. Colour blend is Normal, alpha composite is SrcOver
// (PorterDuffFunctions.Generated.cs · NormalSrcOver): `opacity` scales the source alpha before
// compositing.
export function drawImageSrcOver(
  dst: Uint8Array,
  dstW: number,
  dstH: number,
  src: Uint8Array,
  srcW: number,
  srcH: number,
  offsetX: number,
  offsetY: number,
  opacity: number,
): void {
  const minX = Math.max(0, offsetX);
  const maxX = Math.min(dstW, offsetX + srcW);
  const minY = Math.max(0, offsetY);
  const maxY = Math.min(dstH, offsetY + srcH);
  for (let y = minY; y < maxY; y++) {
    const sy = y - offsetY;
    for (let x = minX; x < maxX; x++) {
      const sx = x - offsetX;
      const dIdx = (y * dstW + x) * 4;
      const sIdx = (sy * srcW + sx) * 4;
      const dR = dst[dIdx]! / 255;
      const dG = dst[dIdx + 1]! / 255;
      const dB = dst[dIdx + 2]! / 255;
      const dA = dst[dIdx + 3]! / 255;
      const sR = src[sIdx]! / 255;
      const sG = src[sIdx + 1]! / 255;
      const sB = src[sIdx + 2]! / 255;
      const sA = (src[sIdx + 3]! / 255) * opacity;
      const [r, g, b, a] = over(dR, dG, dB, dA, sR, sG, sB, sA);
      dst[dIdx] = Math.round(clamp01(r) * 255);
      dst[dIdx + 1] = Math.round(clamp01(g) * 255);
      dst[dIdx + 2] = Math.round(clamp01(b) * 255);
      dst[dIdx + 3] = Math.round(clamp01(a) * 255);
    }
  }
}

// DrawImageProcessor{TPixelBg,TPixelFg}.cs · OnFrameApply: full-canvas variant for equal-size
// `dst`/`src` (offset 0, overlap is the whole image). Colour blend is Normal, alpha composite is
// SrcAtop (PorterDuffFunctions.Generated.cs · NormalSrcAtop): `opacity` scales the source alpha
// before compositing.
export function drawImageSrcAtop(
  dst: Uint8Array,
  src: Uint8Array,
  width: number,
  height: number,
  opacity: number,
): void {
  const count = width * height;
  for (let i = 0; i < count; i++) {
    const idx = i * 4;
    const dR = dst[idx]! / 255;
    const dG = dst[idx + 1]! / 255;
    const dB = dst[idx + 2]! / 255;
    const dA = dst[idx + 3]! / 255;
    const sR = src[idx]! / 255;
    const sG = src[idx + 1]! / 255;
    const sB = src[idx + 2]! / 255;
    const sA = (src[idx + 3]! / 255) * opacity;
    const [r, g, b, a] = atop(dR, dG, dB, dA, sR, sG, sB, sA);
    dst[idx] = Math.round(clamp01(r) * 255);
    dst[idx + 1] = Math.round(clamp01(g) * 255);
    dst[idx + 2] = Math.round(clamp01(b) * 255);
    dst[idx + 3] = Math.round(clamp01(a) * 255);
  }
}
