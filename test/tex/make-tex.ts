import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";

/** A hand-built canonical A8R8G8B8 2x2 single-mip .tex: 80-byte canonical header + 16 pixel bytes. */
export function buildMinimalTex(): Uint8Array {
  const header = buildCanonicalTexHeader(A8R8G8B8, 2, 2, 1);
  const pixels = new Uint8Array(2 * 2 * 4).map((_, i) => (i * 11 + 3) & 0xff);
  return concatBytes([header, pixels]);
}

/**
 * Builds a 16-byte BC7 mode-6 block encoding a solid RGBA color.
 * Mode 6 layout (LSB-first): 7 mode bits (bit6=1); then R0 R1 G0 G1 B0 B1 A0 A1 (7 bits each);
 * then P0 P1 (1 bit each); then 16 indices (texel0 = 3 bits, texels 1-15 = 4 bits each).
 * Solid color: set both endpoints equal, both p-bits equal, all indices 0 -> every texel = endpoint0,
 * whose 8-bit value is (comp7 << 1) | pbit. Pass 7-bit comps and a pbit so (comp<<1)|pbit == target.
 */
export function buildBc7Mode6SolidBlock(
  r7: number,
  g7: number,
  b7: number,
  a7: number,
  pbit: number,
): Uint8Array {
  const bytes = new Uint8Array(16);
  let bitPos = 0;
  const put = (value: number, count: number) => {
    for (let i = 0; i < count; i++) {
      if ((value >> i) & 1)
        bytes[(bitPos + i) >> 3]! |= 1 << ((bitPos + i) & 7);
    }
    bitPos += count;
  };
  put(0, 6); // mode prefix zeros (bits 0-5)
  put(1, 1); // mode 6 marker (bit 6)
  // Endpoints R0 R1 G0 G1 B0 B1 A0 A1, 7 bits each, both endpoints equal.
  put(r7, 7);
  put(r7, 7);
  put(g7, 7);
  put(g7, 7);
  put(b7, 7);
  put(b7, 7);
  put(a7, 7);
  put(a7, 7);
  put(pbit, 1);
  put(pbit, 1); // p-bits
  // Indices: texel0 anchor 3 bits, texels 1-15 4 bits each; all 0.
  put(0, 3);
  for (let i = 0; i < 15; i++) put(0, 4);
  return bytes; // bitPos == 128
}
