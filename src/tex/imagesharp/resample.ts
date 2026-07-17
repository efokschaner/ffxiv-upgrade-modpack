// Ported from SixLabors.ImageSharp v2.1.11:
//   - BicubicResampler.cs · GetValue (bicubic weight function, radius 2, a=-0.5)
//   - ResizeKernelMap.cs · BuildKernel (per-axis kernel construction, normalization)
//   - ResizeKernelMap.cs · TolerantMath (epsilon-tolerant ceil/floor used by BuildKernel)
//   - ResizeProcessor{,Helpers}.cs · ApplyNNResizeFrameTransform (NearestNeighbor mapping)
//   - ResizeWorker.cs · CalculateFirstPassValues / FillDestinationPixels (separable H-then-V
//     convolution; the horizontal pass writes into `transposedFirstPassBuffer`, a
//     `Buffer2D<Vector4>` — i.e. the intermediate between passes stays float. Only
//     `FillDestinationPixels`, after the *vertical* pass, converts to the pixel type via
//     `PixelOperations<TPixel>.Instance.FromVector4Destructive` — confirmed by reading
//     ResizeWorker.cs at the v2.1.11 tag; there is no byte conversion between the two passes.)
//
// ImageSharp's resize is float32 (Vector4) throughout; this port uses JS float64. Byte-parity vs the
// real ImageSharp golden is therefore not guaranteed bit-for-bit and a documented tolerance is expected
// (see DIVERGENCE_RULES / Task 8). The kernel-map math and separable H-then-V structure are ported
// faithfully, including keeping the inter-pass intermediate in float (see resizeAxisX/resizeAxisY
// below); only the float width (32-bit vs JS's 64-bit) differs.

// TolerantMath (ResizeKernelMap.cs, nested `TolerantMath` static class): ImageSharp uses an
// epsilon-tolerant ceil/floor when building kernel windows so that values that are mathematically
// exact integers (but land a hair off due to float error) don't get pushed to the wrong side.
const TOLERANCE = 1e-8;
function tolerantCeil(v: number): number {
  return Math.ceil(v - TOLERANCE);
}
function tolerantFloor(v: number): number {
  return Math.floor(v + TOLERANCE);
}

// BicubicResampler.cs · GetValue(x): radius=2, a=-0.5. Even function of x, defined here for x>=0
// (callers pass Math.abs(x)).
function bicubicWeight(x: number): number {
  if (x < 0) x = -x;
  if (x <= 1) {
    return (1.5 * x - 2.5) * x * x + 1;
  }
  if (x < 2) {
    return ((-0.5 * x + 2.5) * x - 4) * x + 2;
  }
  return 0;
}

interface KernelMap {
  /** Per-output-index source start (left bound, inclusive). */
  starts: Int32Array;
  /** Per-output-index normalized weight row; `weights[i][k]` is the weight for source index `starts[i] + k`. */
  weights: Float64Array[];
}

// ResizeKernelMap.cs · BuildKernel (bicubic case): constructs, for each output index along one axis,
// the window of source indices and normalized weights that contribute to it.
function buildBicubicKernelMap(srcLen: number, dstLen: number): KernelMap {
  const ratio = srcLen / dstLen;
  const scale = Math.max(ratio, 1);
  const radius = tolerantCeil(scale * 2);
  const starts = new Int32Array(dstLen);
  const weights: Float64Array[] = new Array(dstLen);
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) * ratio - 0.5;
    const left = Math.max(0, tolerantCeil(center - radius));
    const right = Math.min(srcLen - 1, tolerantFloor(center + radius));
    const len = right - left + 1;
    const row = new Float64Array(len);
    let sum = 0;
    for (let j = left; j <= right; j++) {
      const w = bicubicWeight((j - center) / scale);
      row[j - left] = w;
      sum += w;
    }
    // Normalize: edge windows are truncated (fewer source samples than the full kernel support),
    // so ImageSharp renormalizes each row's weights to sum to 1. Guard is `sum > 0` (not `!== 0`)
    // matching BuildKernel: bicubic side-lobes are negative, so a truncated window can in principle
    // sum to <= 0, and ImageSharp skips normalization in that case rather than dividing by it.
    if (sum > 0) {
      for (let k = 0; k < len; k++) {
        row[k] /= sum;
      }
    }
    starts[i] = left;
    weights[i] = row;
  }
  return { starts, weights };
}

// Convert a float channel value (conceptually 0..1 scaled) already carried here in 0..255 space to a
// byte, matching PixelOperations<TPixel>.FromVector4Destructive's clamp-then-round-half-away-from-zero.
// We keep intermediate math in 0..255 space (rather than normalizing to 0..1 and back) since it's
// equivalent and avoids extra float round-trips; only the clamp+round semantics need to match
// ImageSharp's.
//
// This is called exactly once per output pixel, at the very end of the vertical pass — matching
// ResizeWorker.cs's FillDestinationPixels, the only place ImageSharp converts float -> pixel type (see
// the module header). The horizontal pass (resizeAxisX) does NOT round; it writes a float intermediate,
// mirroring `transposedFirstPassBuffer : Buffer2D<Vector4>`.
function clampRoundByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}

// Horizontal pass: convolve each row of byte source pixels with the X kernel map, producing a FLOAT
// intermediate (dstW * h * 4 float64s, one Buffer2D<Vector4>-equivalent) — no rounding here, matching
// ResizeWorker.cs · CalculateFirstPassValues writing into `transposedFirstPassBuffer : Buffer2D<Vector4>`.
function resizeAxisX(
  src: Uint8Array,
  srcW: number,
  h: number,
  dstW: number,
  kernelMap: KernelMap,
): Float64Array {
  const out = new Float64Array(dstW * h * 4);
  for (let y = 0; y < h; y++) {
    const rowBase = y * srcW * 4;
    const outRowBase = y * dstW * 4;
    for (let x = 0; x < dstW; x++) {
      const start = kernelMap.starts[x]!;
      const row = kernelMap.weights[x]!;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < row.length; k++) {
        const w = row[k]!;
        const idx = rowBase + (start + k) * 4;
        r += w * src[idx]!;
        g += w * src[idx + 1]!;
        b += w * src[idx + 2]!;
        a += w * src[idx + 3]!;
      }
      const outIdx = outRowBase + x * 4;
      out[outIdx] = r;
      out[outIdx + 1] = g;
      out[outIdx + 2] = b;
      out[outIdx + 3] = a;
    }
  }
  return out;
}

// Vertical pass: convolve the FLOAT intermediate from resizeAxisX with the Y kernel map. This is the
// final pass, so — matching ResizeWorker.cs · FillDestinationPixels, the sole float -> byte conversion
// point (PixelOperations<TPixel>.FromVector4Destructive) — clamp+round to a byte happens here, once,
// at the final write.
function resizeAxisY(
  src: Float64Array,
  w: number,
  dstH: number,
  kernelMap: KernelMap,
): Uint8Array {
  const out = new Uint8Array(w * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const start = kernelMap.starts[y]!;
    const row = kernelMap.weights[y]!;
    const outRowBase = y * w * 4;
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < row.length; k++) {
        const w2 = row[k]!;
        const idx = (start + k) * w * 4 + x * 4;
        r += w2 * src[idx]!;
        g += w2 * src[idx + 1]!;
        b += w2 * src[idx + 2]!;
        a += w2 * src[idx + 3]!;
      }
      const outIdx = outRowBase + x * 4;
      out[outIdx] = clampRoundByte(r);
      out[outIdx + 1] = clampRoundByte(g);
      out[outIdx + 2] = clampRoundByte(b);
      out[outIdx + 3] = clampRoundByte(a);
    }
  }
  return out;
}

// ResizeProcessor.cs / ResizeKernelMap.cs (bicubic path, PremultiplyAlpha=false): separable resize —
// build the X kernel map and convolve horizontally (srcW*srcH -> dstW*srcH), then build the Y kernel
// map and convolve vertically (dstW*srcH -> dstW*dstH). Each channel (including alpha) is convolved
// independently since premultiplication is disabled for this pipeline.
export function resizeBicubic(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) {
    return rgba.slice();
  }
  const xKernelMap = buildBicubicKernelMap(srcW, dstW);
  const horizontal = resizeAxisX(rgba, srcW, srcH, dstW, xKernelMap);
  const yKernelMap = buildBicubicKernelMap(srcH, dstH);
  return resizeAxisY(horizontal, dstW, dstH, yKernelMap);
}

// ResizeProcessor{,Helpers}.cs · ApplyNNResizeFrameTransform: nearest-neighbor mapping via truncating
// float division, no blending — just a source-pixel copy per destination pixel.
export function resizeNearestNeighbor(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) {
    return rgba.slice();
  }
  const factorX = srcW / dstW;
  const factorY = srcH / dstH;
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.trunc(y * factorY);
    const srcRowBase = srcY * srcW * 4;
    const outRowBase = y * dstW * 4;
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.trunc(x * factorX);
      const srcIdx = srcRowBase + srcX * 4;
      const outIdx = outRowBase + x * 4;
      out[outIdx] = rgba[srcIdx]!;
      out[outIdx + 1] = rgba[srcIdx + 1]!;
      out[outIdx + 2] = rgba[srcIdx + 2]!;
      out[outIdx + 3] = rgba[srcIdx + 3]!;
    }
  }
  return out;
}
