import { describe, expect, it } from "vitest";
import { decodeToRgba } from "../../src/tex/decode";
import {
  encodeUncompressedTex,
  generateMipmaps,
  resizeToPowerOfTwo,
} from "../../src/tex/encode";
import { parseTex } from "../../src/tex/tex";
import { A8R8G8B8 } from "../../src/tex/types";

describe("tex encode: uncompressed", () => {
  it("round-trips RGBA through encode -> parse -> decode (single mip)", () => {
    const rgba = new Uint8Array([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160,
    ]);
    const tex = encodeUncompressedTex(rgba, 2, 2);
    const parsed = parseTex(tex);
    expect(parsed.format).toBe(A8R8G8B8);
    expect(parsed.width).toBe(2);
    expect(parsed.mipCount).toBe(1);
    expect(Array.from(decodeToRgba(parsed))).toEqual(Array.from(rgba));
  });

  it("downsamples by point-sample decimation (top-left of each 2x2 block), not averaging", () => {
    // 4x4 image, R = the linear texel index (0..15), so each mip texel's R reveals exactly which
    // source texel it copied. Nvtt/box averaging would blend neighbours and produce non-index R
    // values; CreateFast8888DDS instead takes the top-left texel of each 2x2 block.
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      rgba[i * 4] = i; // R = index
      rgba[i * 4 + 3] = 255; // A
    }
    const chain = generateMipmaps(rgba, 4, 4);
    expect(chain).toHaveLength(2); // 4x4, 2x2 — stops at min-dim 2, not 1x1
    // 2x2 mip = top-left texel of each 2x2 block: indices 0, 2, 8, 10.
    expect(Array.from(chain[1]!)).toEqual([
      0, 0, 0, 255, 2, 0, 0, 255, 8, 0, 0, 255, 10, 0, 0, 255,
    ]);
  });

  it("multi-mip encode reports the right mipCount and total size", () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(128);
    const tex = encodeUncompressedTex(rgba, 4, 4, { mips: true });
    const parsed = parseTex(tex);
    expect(parsed.mipCount).toBe(2); // 4x4,2x2 — max(1, floor(log2(4))) levels
    expect(parsed.mipData).toHaveLength(64 + 16);
  });

  it("matches a faithful port of CreateFast8888DDS across sizes (oracle-free parity)", () => {
    // Independent transcription of xivModdingFramework's CreateFast8888DDS mip loop (Tex.cs:823),
    // written to mirror the C# integer offsets literally. Its agreement with generateMipmaps is the
    // parity check that replaces the old captured-oracle fixture (design spec §6): the real filter is
    // a deterministic decimation, not Nvtt, so no oracle capture is needed.
    const reference = (data: Uint8Array, width: number, height: number) => {
      const minDim = Math.min(height, width);
      const mipCount = Math.max(1, Math.trunc(Math.log(minDim) / Math.log(2)));
      const mips: Uint8Array[] = [data];
      let last = data;
      let curw = width;
      let curh = height;
      for (let i = 1; i < mipCount; i++) {
        curw = Math.trunc(curw / 2);
        curh = Math.trunc(curh / 2);
        const mip = new Uint8Array(curw * curh * 4);
        for (let y = 0; y < curh; y++) {
          for (let x = 0; x < curw; x++) {
            const dest = (y * curw + x) * 4;
            const source = (y * 2 * (curw * 2) + x * 2) * 4;
            for (let c = 0; c < 4; c++) mip[dest + c] = last[source + c]!;
          }
        }
        mips.push(mip);
        last = mip;
      }
      return mips;
    };
    const sizes: Array<[number, number]> = [
      [64, 64],
      [128, 32],
      [32, 128],
      [16, 16],
      [8, 4],
      [4, 4],
      [2, 2],
      [256, 64],
    ];
    for (const [w, h] of sizes) {
      const rgba = new Uint8Array(w * h * 4);
      for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 97 + 13) & 0xff;
      const ours = generateMipmaps(rgba, w, h);
      const ref = reference(rgba, w, h);
      expect(ours).toHaveLength(ref.length);
      for (let m = 0; m < ref.length; m++) {
        expect(Array.from(ours[m]!)).toEqual(Array.from(ref[m]!));
      }
    }
  });

  it("resizes via nearest-neighbor point sampling with asserted pixel values", () => {
    // 3x1 image, three distinct pixels -> resized to 4x1. sx = min(w-1, floor(x*width/tw)):
    // x=0 -> 0, x=1 -> floor(3/4)=0, x=2 -> floor(6/4)=1, x=3 -> floor(9/4)=2.
    // So output pixels = [src0, src0, src1, src2].
    const rgba = new Uint8Array([
      11, 12, 13, 14, 21, 22, 23, 24, 31, 32, 33, 34,
    ]);
    const r = resizeToPowerOfTwo(rgba, 3, 1);
    expect(r.width).toBe(4);
    expect(r.height).toBe(1);
    expect(Array.from(r.rgba)).toEqual([
      11, 12, 13, 14, 11, 12, 13, 14, 21, 22, 23, 24, 31, 32, 33, 34,
    ]);
  });

  it("resize is a no-op that returns the same buffer for an already power-of-two image", () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(50);
    const r = resizeToPowerOfTwo(rgba, 4, 4);
    expect(r.rgba).toBe(rgba);
    expect(r.width).toBe(4);
    expect(r.height).toBe(4);
  });
});
