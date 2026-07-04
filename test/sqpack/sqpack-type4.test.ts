import { describe, expect, it } from "vitest";
import { decodeType4, encodeType4, texMipSizes } from "../../src/sqpack/type4";

const TEX_HEADER_SIZE = 80;
const BC5 = 25136; // 8 bpp, min dimension 4

// Build a minimal but valid uncompressed .tex: 80-byte header (format/width/height/mipCount) + mip pixels.
function makeUncompressedTex(
  width: number,
  height: number,
  mipCount: number,
): Uint8Array {
  const sizes = texMipSizes(BC5, width, height).slice(0, mipCount);
  const total = sizes.reduce((a, b) => a + b, 0);
  const buf = new Uint8Array(TEX_HEADER_SIZE + total);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0, true); // attributes
  dv.setUint32(4, BC5, true); // texture format
  dv.setUint16(8, width, true);
  dv.setUint16(10, height, true);
  dv.setUint16(12, 1, true); // depth
  buf[14] = mipCount & 0xf; // mip count (low nibble)
  // Fill pixel data deterministically.
  for (let i = TEX_HEADER_SIZE; i < buf.length; i++)
    buf[i] = (i * 17 + 3) & 0xff;
  return buf;
}

describe("type 4 codec", () => {
  it("computes BC5 mip sizes down to 1x1", () => {
    // 8x8 BC5: 8*8*8/8=64, 4x4 (min dim 4)=4*4*8/8=16, then 4x4 clamp repeats to 16,16.
    expect(texMipSizes(BC5, 8, 8)).toEqual([64, 16, 16, 16]);
  });

  it("round-trips a single-mip texture", () => {
    const raw = makeUncompressedTex(16, 16, 1);
    const entry = encodeType4(raw);
    expect(new DataView(entry.buffer, entry.byteOffset).getInt32(4, true)).toBe(
      4,
    );
    expect(decodeType4(entry)).toEqual(raw);
  });

  it("round-trips a multi-mip texture", () => {
    const raw = makeUncompressedTex(64, 64, 4);
    expect(decodeType4(encodeType4(raw))).toEqual(raw);
  });
});
