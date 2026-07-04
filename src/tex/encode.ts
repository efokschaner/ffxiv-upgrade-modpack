import { concatBytes } from "../util/binary";
import { buildCanonicalTexHeader } from "./header";
import { A8R8G8B8 } from "./types";

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Resizes RGBA to the next power-of-two dimensions via nearest-neighbor point sampling (no-op if
 *  already power-of-two). Mirrors the ResizeXivTx pre-step (EndwalkerUpgrade.cs:1098). This is a
 *  placeholder resample filter, not the final one; exact byte-parity against the real filter is
 *  deferred to the oracle-comparison work (design spec §6), so this does not claim fidelity beyond
 *  point sampling. */
export function resizeToPowerOfTwo(
  rgba: Uint8Array,
  width: number,
  height: number,
): { rgba: Uint8Array; width: number; height: number } {
  const tw = nextPow2(width),
    th = nextPow2(height);
  if (tw === width && th === height) return { rgba, width, height };
  const out = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / tw));
      const so = (sy * width + sx) * 4,
        o = (y * tw + x) * 4;
      out[o] = rgba[so]!;
      out[o + 1] = rgba[so + 1]!;
      out[o + 2] = rgba[so + 2]!;
      out[o + 3] = rgba[so + 3]!;
    }
  }
  return { rgba: out, width: tw, height: th };
}

/** Full RGBA mip chain to 1x1 via 2x2 box average. The edge clamp (x1/y1 clamped to w-1/h-1) exists
 *  to handle the 1xN / Nx1 plateau at the top of the chain; in the real pipeline all input dimensions
 *  are power-of-two because resizeToPowerOfTwo runs first, so this is not claiming general odd-dimension
 *  box coverage. Structural match to Nvtt's default box filter; exact byte parity is validated later
 *  against a captured oracle tex (design spec §6, tier 2). */
export function generateMipmaps(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array[] {
  const chain: Uint8Array[] = [rgba];
  let src = rgba,
    w = width,
    h = height;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1),
      nh = Math.max(1, h >> 1);
    const dst = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(w - 1, x * 2),
          x1 = Math.min(w - 1, x * 2 + 1);
        const y0 = Math.min(h - 1, y * 2),
          y1 = Math.min(h - 1, y * 2 + 1);
        for (let c = 0; c < 4; c++) {
          const s =
            src[(y0 * w + x0) * 4 + c]! +
            src[(y0 * w + x1) * 4 + c]! +
            src[(y1 * w + x0) * 4 + c]! +
            src[(y1 * w + x1) * 4 + c]!;
          dst[(y * nw + x) * 4 + c] = (s + 2) >> 2; // rounded average
        }
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
