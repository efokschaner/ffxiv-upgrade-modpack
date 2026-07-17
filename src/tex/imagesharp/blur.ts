// Ported from SixLabors.ImageSharp v2.1.11 (verified against the v2.1.11 tag source):
//   - BoxBlurProcessor.cs · Radius / BoxBlurProcessor{TPixel}.cs · OnFrameApply, CreateBoxKernel
//     (uniform 1/(2r+1) 1-D kernel of length `(radius*2)+1`; OnFrameApply constructs it and hands
//     off to Convolution2PassProcessor with `preserveAlpha: false`)
//   - Convolution2PassProcessor{TPixel}.cs · OnFrameApply (2-pass separable convolution: builds one
//     KernelSamplingMap, runs the horizontal pass into an intermediate buffer, then the vertical
//     pass) and its nested HorizontalConvolutionRowOperation / VerticalConvolutionRowOperation ·
//     Convolve4 (the `preserveAlpha == false` path: premultiply via Numerics.Premultiply, convolve,
//     un-premultiply via Numerics.UnPremultiply — the path BoxBlur always takes)
//   - KernelSamplingMap.cs · BuildSamplingOffsetMap (precomputes, per axis, sample offsets clamped
//     to `[bounds.min, bounds.max]` via Numerics.Clamp — edge-clamp border handling: the nearest
//     edge pixel is replicated, not truncated+renormalized the way the bicubic resampler's kernel
//     windows are — see resample.ts for the contrasting case) and GetRowOffsetSpan /
//     GetColumnOffsetSpan (accessors the row operations read the precomputed offsets from)
//
// ImageSharp's convolution is float32 (Vector4) throughout; this port uses JS float64. Byte-parity vs
// the real ImageSharp golden is therefore not guaranteed bit-for-bit; a documented tolerance is
// expected (see DIVERGENCE_RULES / Task 8).

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Convolution2PassProcessor{TPixel}.cs · HorizontalConvolutionRowOperation/VerticalConvolutionRowOperation
// · Convolve4 (via Numerics.Premultiply): convolution runs in premultiplied-alpha space. Premultiply
// RGB by alpha (all channels normalized to 0..1 float) before either pass.
function toPremultipliedFloat(rgba: Uint8Array, count: number): Float64Array {
  const out = new Float64Array(count * 4);
  for (let i = 0; i < count; i++) {
    const idx = i * 4;
    const a = rgba[idx + 3]! / 255;
    out[idx] = (rgba[idx]! / 255) * a;
    out[idx + 1] = (rgba[idx + 1]! / 255) * a;
    out[idx + 2] = (rgba[idx + 2]! / 255) * a;
    out[idx + 3] = a;
  }
  return out;
}

// Convolution2PassProcessor{TPixel}.cs · VerticalConvolutionRowOperation · Convolve4 (via
// Numerics.UnPremultiply): after the vertical pass, un-premultiply (divide RGB by alpha, guarded
// by alpha > 0) and convert back to bytes via clamp-then-round.
function toUnpremultipliedBytes(
  premul: Float64Array,
  count: number,
): Uint8Array {
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const idx = i * 4;
    const a = premul[idx + 3]!;
    let r = premul[idx]!;
    let g = premul[idx + 1]!;
    let b = premul[idx + 2]!;
    if (a > 0) {
      r /= a;
      g /= a;
      b /= a;
    }
    out[idx] = Math.round(clamp(r, 0, 1) * 255);
    out[idx + 1] = Math.round(clamp(g, 0, 1) * 255);
    out[idx + 2] = Math.round(clamp(b, 0, 1) * 255);
    out[idx + 3] = Math.round(clamp(a, 0, 1) * 255);
  }
  return out;
}

// BoxBlurProcessor{TPixel}.cs · CreateBoxKernel (uniform kernel) + KernelSamplingMap.cs ·
// BuildSamplingOffsetMap (edge-clamp): horizontal 1-D box convolution over premultiplied float
// samples. `weight` is `1/(2*radius+1)`.
function convolveHorizontal(
  src: Float64Array,
  w: number,
  h: number,
  radius: number,
  weight: number,
): Float64Array {
  const out = new Float64Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const rowBase = y * w * 4;
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = clamp(x + k, 0, w - 1);
        const idx = rowBase + sx * 4;
        r += src[idx]!;
        g += src[idx + 1]!;
        b += src[idx + 2]!;
        a += src[idx + 3]!;
      }
      const outIdx = rowBase + x * 4;
      out[outIdx] = r * weight;
      out[outIdx + 1] = g * weight;
      out[outIdx + 2] = b * weight;
      out[outIdx + 3] = a * weight;
    }
  }
  return out;
}

// BoxBlurProcessor{TPixel}.cs · CreateBoxKernel (uniform kernel) + KernelSamplingMap.cs ·
// BuildSamplingOffsetMap (edge-clamp): vertical 1-D box convolution over premultiplied float
// samples, mirroring convolveHorizontal along the Y axis.
function convolveVertical(
  src: Float64Array,
  w: number,
  h: number,
  radius: number,
  weight: number,
): Float64Array {
  const out = new Float64Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const outRowBase = y * w * 4;
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = clamp(y + k, 0, h - 1);
        const idx = sy * w * 4 + x * 4;
        r += src[idx]!;
        g += src[idx + 1]!;
        b += src[idx + 2]!;
        a += src[idx + 3]!;
      }
      const outIdx = outRowBase + x * 4;
      out[outIdx] = r * weight;
      out[outIdx + 1] = g * weight;
      out[outIdx + 2] = b * weight;
      out[outIdx + 3] = a * weight;
    }
  }
  return out;
}

// BoxBlurProcessor{TPixel}.cs · OnFrameApply / Convolution2PassProcessor{TPixel}.cs · OnFrameApply:
// 2-pass separable box blur (horizontal then vertical) with a uniform `1/(2*radius+1)` kernel,
// computed in premultiplied-alpha space with edge-clamp borders. `radius <= 0` is a no-op copy.
export function boxBlur(
  rgba: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) {
    return rgba.slice();
  }
  const count = width * height;
  const weight = 1 / (2 * radius + 1);
  const premul = toPremultipliedFloat(rgba, count);
  const horizontal = convolveHorizontal(premul, width, height, radius, weight);
  const vertical = convolveVertical(horizontal, width, height, radius, weight);
  return toUnpremultipliedBytes(vertical, count);
}
