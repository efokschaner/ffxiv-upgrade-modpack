// Test-only helpers for the BCn golden-fixture decode tests. Not shipped in src/.

export type ChannelMap = "none" | "swapRB" | "grayFromR";

/**
 * Maps a STANDARD-order RGBA buffer (texconv's decode output) into our decoder's TexTools channel
 * convention, so a texconv golden can be compared byte-for-byte against decodeToRgba's output:
 *   - none:      BC1/BC2/BC3 — standard RGBA, unchanged.
 *   - swapRB:    BC5/BC7 — R<->B swap (TexTools SwapRedBlue).
 *   - grayFromR: BC4 — TexTools replicates the single red channel across RGB, opaque (R,R,R,255).
 */
export function applyChannelMap(rgba: Uint8Array, map: ChannelMap): Uint8Array {
  if (map === "none") return rgba;
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const a = rgba[i + 3]!;
    if (map === "swapRB") {
      out[i] = b;
      out[i + 1] = g;
      out[i + 2] = r;
      out[i + 3] = a;
    } else {
      out[i] = r;
      out[i + 1] = r;
      out[i + 2] = r;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * BC7 block mode = index of the least-significant set bit of the block's first byte (mode m encodes as
 * m zero bits followed by a 1). Returns 0..7, or -1 for the reserved all-zero-first-byte case.
 */
export function bc7BlockMode(block: Uint8Array, offset = 0): number {
  const b = block[offset]!;
  for (let m = 0; m < 8; m++) if ((b >> m) & 1) return m;
  return -1;
}
