import { concatBytes } from "../util/binary";
import { buildCanonicalTexHeader } from "./header";
import { A8R8G8B8 } from "./types";

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Resizes RGBA to the next power-of-two dimensions (no-op if already power-of-two). Mirrors the
 *  ResizeXivTx pre-step (EndwalkerUpgrade.cs:1098), whose real resample filter is Bicubic. That
 *  filter is not yet ported, so a genuine NPOT resize FAILS LOUD rather than emit a point-sampled
 *  (non-byte-parity) result — an earlier placeholder did exactly that and would have silently
 *  diverged. Currently uncalled by any production path (only re-exported via the tex barrel and
 *  exercised by unit tests); the upgrade pipeline never resizes, so this is latent. The throw
 *  hardens the path for when the encoder is wired in. */
export function resizeToPowerOfTwo(
  rgba: Uint8Array,
  width: number,
  height: number,
): { rgba: Uint8Array; width: number; height: number } {
  const tw = nextPow2(width),
    th = nextPow2(height);
  if (tw === width && th === height) return { rgba, width, height };
  throw new Error(
    `tex: NPOT resize (${width}x${height} -> ${tw}x${th}) not yet ported (C# uses a Bicubic filter; point sampling would diverge)`,
  );
}

/** Downsampled mip chain — a faithful port of xivModdingFramework's `CreateFast8888DDS`
 *  (`Tex.cs:823`), the filter the Dawntrail upgrade ACTUALLY uses for regenerated `A8R8G8B8`
 *  textures. `FrameworkSettings.DefaultTextureFormat` is `A8R8G8B8`, so every regenerated texture
 *  takes `ConvertToDDS(..., allowFast8888: true)`'s fast path (`EndwalkerUpgrade.cs:1213/1222/2069/
 *  2094`) — a nearest-neighbour DECIMATION (the top-left texel of each 2×2 block, NOT a box average;
 *  its own author calls it "the world's singularly worst MipMaps") producing `max(1, floor(log2(min(
 *  w,h))))` levels, i.e. it stops at a 2-pixel minimum dimension, not 1×1. We match it byte-for-byte
 *  (design spec §6); the oracle-free parity test lives in test/tex/tex-encode.test.ts. Inputs are
 *  power-of-two (resizeToPowerOfTwo runs first), so the integer floor-log2 equals C#'s
 *  `(int)Math.Log(minDim, 2)`. */
export function generateMipmaps(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array[] {
  const minDim = Math.min(width, height);
  let mipCount = 0;
  while (2 ** (mipCount + 1) <= minDim) mipCount++;
  mipCount = Math.max(1, mipCount);

  const chain: Uint8Array[] = [rgba];
  let src = rgba,
    w = width,
    h = height;
  for (let level = 1; level < mipCount; level++) {
    const nw = w >> 1,
      nh = h >> 1;
    const dst = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        // Top-left texel of the 2×2 block: source (2x, 2y) in the previous mip (row stride w).
        const so = (y * 2 * w + x * 2) * 4;
        const o = (y * nw + x) * 4;
        dst[o] = src[so]!;
        dst[o + 1] = src[so + 1]!;
        dst[o + 2] = src[so + 2]!;
        dst[o + 3] = src[so + 3]!;
      }
    }
    chain.push(dst);
    src = dst;
    w = nw;
    h = nh;
  }
  return chain;
}

/** Packs RGBA into an A8R8G8B8 (.tex stores B,G,R,A) mip and returns the mip bytes. */
function packA8R8G8B8(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i + 2]!; // B
    out[i + 1] = rgba[i + 1]!; // G
    out[i + 2] = rgba[i]!; // R
    out[i + 3] = rgba[i + 3]!; // A
  }
  return out;
}

/** Builds an uncompressed A8R8G8B8 .tex from RGBA pixels. Matches ConsoleTools output format
 *  (DefaultTextureFormat = A8R8G8B8). */
export function encodeUncompressedTex(
  rgba: Uint8Array,
  width: number,
  height: number,
  opts: { mips?: boolean } = {},
): Uint8Array {
  const mips = opts.mips ? generateMipmaps(rgba, width, height) : [rgba];
  const header = buildCanonicalTexHeader(A8R8G8B8, width, height, mips.length);
  return concatBytes([header, ...mips.map(packA8R8G8B8)]);
}
