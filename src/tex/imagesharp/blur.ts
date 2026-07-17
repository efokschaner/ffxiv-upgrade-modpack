// Ported from SixLabors.ImageSharp v2.1.11:
//   - BoxBlurProcessor.cs · OnFrameApply (uniform 1/(2r+1) 1-D kernel, radius from the processor's
//     Radius option)
//   - Convolution2PassProcessor.cs · OnFrameApply / ApplyConvolution (2-pass separable convolution:
//     horizontal pass into an intermediate buffer, then a vertical pass; premultiplied-alpha working
//     space; un-premultiply after the second pass)
//   - KernelSamplingMap.cs · GetSampleRow / Clamp (edge-clamp border handling: sample coordinates are
//     clamped to `[0, dim-1]`, i.e. the nearest edge pixel is replicated, not truncated+renormalized
//     the way the bicubic resampler's kernel windows are — see resample.ts for the contrasting case)
//
// ImageSharp's convolution is float32 (Vector4) throughout; this port uses JS float64. Byte-parity vs
// the real ImageSharp golden is therefore not guaranteed bit-for-bit; a documented tolerance is
// expected (see DIVERGENCE_RULES / Task 8).

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Convolution2PassProcessor.cs: convolution runs in premultiplied-alpha space. Premultiply RGB by
// alpha (all channels normalized to 0..1 float) before either pass.
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

// Convolution2PassProcessor.cs: after the vertical pass, un-premultiply (divide RGB by alpha, guarded
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

// BoxBlurProcessor.cs (uniform kernel) + KernelSamplingMap.cs (edge-clamp): horizontal 1-D box
// convolution over premultiplied float samples. `weight` is `1/(2*radius+1)`.
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

// BoxBlurProcessor.cs (uniform kernel) + KernelSamplingMap.cs (edge-clamp): vertical 1-D box
// convolution over premultiplied float samples, mirroring convolveHorizontal along the Y axis.
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

// BoxBlurProcessor.cs · OnFrameApply / Convolution2PassProcessor.cs · OnFrameApply: 2-pass separable
// box blur (horizontal then vertical) with a uniform `1/(2*radius+1)` kernel, computed in
// premultiplied-alpha space with edge-clamp borders. `radius <= 0` is a no-op copy.
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
