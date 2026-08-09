import { describe, expect, it } from "vitest";
import {
  buildCanonicalTexHeader,
  fixUpBrokenMipOffsets,
  parseTexHeader,
  serializeTexHeader,
} from "../../src/tex/header";
import { A8R8G8B8, BC5, type XivTex } from "../../src/tex/types";
import { BinaryReader } from "../../src/util/binary";

describe("tex header codec", () => {
  it("round-trips a full 80-byte header byte-exact", () => {
    // Hand-build an 80-byte header with distinctive field values.
    const buf = new Uint8Array(80);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0x00800000, true); // attributes
    dv.setUint32(4, BC5, true); // format
    dv.setUint16(8, 128, true); // width
    dv.setUint16(10, 64, true); // height
    dv.setUint16(12, 1, true); // depth
    buf[14] = (0xa << 4) | 0x8; // mipFlag=0xa, mipCount=8
    buf[15] = 3; // arraySize
    dv.setUint32(16, 0, true);
    dv.setUint32(20, 1, true);
    dv.setUint32(24, 2, true); // lodMips
    for (let i = 0; i < 13; i++)
      dv.setUint32(28 + i * 4, i === 0 ? 80 : 80 + i * 100, true);

    const h = parseTexHeader(new BinaryReader(buf));
    expect(h.attributes).toBe(0x00800000);
    expect(h.format).toBe(BC5);
    expect(h.width).toBe(128);
    expect(h.height).toBe(64);
    expect(h.mipCount).toBe(8);
    expect(h.mipFlag).toBe(0xa);
    expect(h.arraySize).toBe(3);
    expect(h.lodMips).toEqual([0, 1, 2]);
    expect(h.mipMapOffsets[2]).toBe(80 + 200);

    const tex: XivTex = { ...h, mipData: new Uint8Array(0) };
    expect(serializeTexHeader(tex)).toEqual(buf);
  });

  it("builds a canonical header matching CreateTexFileHeader", () => {
    // A8R8G8B8 8x8, 4 mips. Sizes: 256, 64, 16, 4 -> offsets 80, 336, 400, 416.
    const h = buildCanonicalTexHeader(A8R8G8B8, 8, 8, 4);
    expect(h.length).toBe(80);
    const dv = new DataView(h.buffer);
    expect(dv.getUint32(0, true)).toBe(0x00800000); // 0 | (128<<16)
    expect(dv.getUint16(4, true)).toBe(A8R8G8B8);
    expect(dv.getUint16(6, true)).toBe(0);
    expect(dv.getUint16(8, true)).toBe(8); // width
    expect(dv.getUint16(10, true)).toBe(8); // height
    expect(dv.getUint16(12, true)).toBe(1); // depth
    expect(dv.getUint16(14, true)).toBe(4); // mipCount (as short)
    expect(dv.getUint32(16, true)).toBe(0); // LoD0
    expect(dv.getUint32(20, true)).toBe(1); // LoD1
    expect(dv.getUint32(24, true)).toBe(2); // LoD2
    expect(dv.getUint32(28, true)).toBe(80); // mip0 offset
    expect(dv.getUint32(32, true)).toBe(336); // mip1 offset (80+256)
    expect(dv.getUint32(36, true)).toBe(400); // mip2 offset (336+64)
    expect(dv.getUint32(40, true)).toBe(416); // mip3 offset (400+16)
    expect(dv.getUint32(44, true)).toBe(0); // padding
  });
});

describe("fixUpBrokenMipOffsets", () => {
  // A8R8G8B8 mip sizes for 4x4: [64, 16, 4] (32bpp; min dim 1; halves 4x4=64, 2x2=16, 1x1=4).
  it("rewrites a broken first offset and trims trailing data", () => {
    const header = {
      format: A8R8G8B8,
      width: 4,
      height: 4,
      mipCount: 1,
      lodMips: [0, 0, 0] as [number, number, number],
      mipMapOffsets: [999, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    // File claims 80 header + 64 mip0 + 40 trailing garbage = 184.
    const res = fixUpBrokenMipOffsets(header, 184);
    expect(header.mipMapOffsets[0]).toBe(80); // first offset forced to 80
    expect(res.headerChanged).toBe(true);
    expect(res.calculatedTexSize).toBe(80 + 64); // trailing 40 bytes trimmed
  });

  it("leaves mipCount untouched on the passed header (struct-copy quirk)", () => {
    // A file whose header claims 3 mips but only mip0 fits: the loop reduces the LOCAL mip count,
    // but the caller's header.mipCount must stay 3 (C# passes TexHeader by value; scalar writes to
    // MipCount do not escape). Tex.cs:159-234 + ValidateTexFileData's use at EndwalkerUpgrade.cs:2121.
    const header = {
      format: A8R8G8B8,
      width: 4,
      height: 4,
      mipCount: 3,
      lodMips: [2, 2, 2] as [number, number, number],
      mipMapOffsets: [80, 144, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    // Only mip0 (64 bytes) fits in an 80+64 = 144-byte file; mip1 would need 16 more.
    const res = fixUpBrokenMipOffsets(header, 144);
    expect(header.mipCount).toBe(3); // UNCHANGED — the quirk
    expect(res.calculatedTexSize).toBe(144);
    expect(header.lodMips).toEqual([0, 0, 0]); // clamped to localMipCount(1) - 1 = 0
    expect(res.headerChanged).toBe(true);
  });

  it("raises a non-ascending LoDMips entry to its predecessor (Tex.cs:213-218, added by 1993bf6)", () => {
    // 4x4 A8R8G8B8 mip sizes are [64, 16, 4] -> offsets 80, 144, 160 and a 164-byte file, so all
    // three mips fit and the local mip count stays 3. That isolates the ascending clamp: the
    // `>= mipCount` clamp above it cannot fire for any of [0, 2, 1].
    const header = {
      format: A8R8G8B8,
      width: 4,
      height: 4,
      mipCount: 3,
      lodMips: [0, 2, 1] as [number, number, number],
      mipMapOffsets: [80, 144, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    const res = fixUpBrokenMipOffsets(header, 164);
    expect(header.lodMips).toEqual([0, 2, 2]);
    expect(res.headerChanged).toBe(true);
    expect(res.calculatedTexSize).toBe(164);
  });

  it("leaves an already-ascending LoDMips table alone", () => {
    // The negative of the case above: nothing else in the fixture is broken, so if the clamp
    // over-fires this reports headerChanged and the whole .tex gets needlessly rewritten.
    const header = {
      format: A8R8G8B8,
      width: 4,
      height: 4,
      mipCount: 3,
      lodMips: [0, 1, 2] as [number, number, number],
      mipMapOffsets: [80, 144, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    const res = fixUpBrokenMipOffsets(header, 164);
    expect(header.lodMips).toEqual([0, 1, 2]);
    expect(res.headerChanged).toBe(false);
  });
});
