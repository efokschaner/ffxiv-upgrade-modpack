import { describe, expect, it } from "vitest";
import { decodeToRgba } from "../../src/tex/decode";
import {
  A1R5G5B5,
  A4R4G4B4,
  A8,
  A8R8G8B8,
  A16B16G16R16F,
  BC4,
  BC5,
  BC7,
  DXT1,
  DXT3,
  DXT5,
  L8,
  X8R8G8B8,
  type XivTex,
} from "../../src/tex/types";
import { buildBc7Mode6SolidBlock } from "./make-tex";

function texOf(
  format: number,
  width: number,
  height: number,
  mipData: Uint8Array,
): XivTex {
  return {
    attributes: 0,
    format,
    width,
    height,
    depth: 1,
    mipCount: 1,
    mipFlag: 0,
    arraySize: 1,
    lodMips: [0, 0, 0],
    mipMapOffsets: new Array(13).fill(0),
    mipData,
  };
}

describe("tex decode: uncompressed", () => {
  it("A8R8G8B8 swaps B<->R into RGBA", () => {
    // One pixel stored B,G,R,A = 10,20,30,40 -> RGBA 30,20,10,40.
    const out = decodeToRgba(
      texOf(A8R8G8B8, 1, 1, new Uint8Array([10, 20, 30, 40])),
    );
    expect(Array.from(out)).toEqual([30, 20, 10, 40]);
  });

  it("A8/L8 decode to gray (v,v,v,255)", () => {
    const out = decodeToRgba(texOf(A8, 1, 1, new Uint8Array([77])));
    expect(Array.from(out)).toEqual([77, 77, 77, 255]);
    const out2 = decodeToRgba(texOf(L8, 1, 1, new Uint8Array([200])));
    expect(Array.from(out2)).toEqual([200, 200, 200, 255]);
  });

  it("A4R4G4B4 decodes to RGBA in blue,green,red,alpha nibble order", () => {
    // u16 0x1234 LE bytes [0x34, 0x12] -> blue=2*16, green=3*16, red=4*16, alpha=1*16.
    const out = decodeToRgba(
      texOf(A4R4G4B4, 1, 1, new Uint8Array([0x34, 0x12])),
    );
    expect(Array.from(out)).toEqual([32, 48, 64, 16]);
  });

  it("A1R5G5B5 decodes to RGBA", () => {
    // u16 0xFC00 LE bytes [0x00, 0xFC] -> red=31*8, green=0, blue=0, alpha=255.
    const out = decodeToRgba(
      texOf(A1R5G5B5, 1, 1, new Uint8Array([0x00, 0xfc])),
    );
    expect(Array.from(out)).toEqual([248, 0, 0, 255]);
  });

  it("A16B16G16R16F decodes halfs to rounded 0-255 RGBA", () => {
    // R=1.0, G=0, B=0.5, A=1.0 (little-endian half floats) -> [255, 0, 128, 255].
    const out = decodeToRgba(
      texOf(
        A16B16G16R16F,
        1,
        1,
        new Uint8Array([0x00, 0x3c, 0x00, 0x00, 0x00, 0x38, 0x00, 0x3c]),
      ),
    );
    expect(Array.from(out)).toEqual([255, 0, 128, 255]);
  });

  it("throws on an unsupported (not-yet-implemented) format", () => {
    // X8R8G8B8 has no decoder yet; decode rejects it clearly.
    expect(() =>
      decodeToRgba(texOf(X8R8G8B8, 1, 1, new Uint8Array(4))),
    ).toThrow(/unsupported/i);
  });

  it("throws a clear 'truncated' error for undersized uncompressed mip data", () => {
    // A8R8G8B8 2x2 needs 16 bytes; only 8 given.
    expect(() =>
      decodeToRgba(texOf(A8R8G8B8, 2, 2, new Uint8Array(8))),
    ).toThrow(/truncated/i);
  });
});

// A 4x4 block whose color0=white(0xFFFF), color1=black(0x0000), all color indices 0.
// c0 > c1, index 0 -> color0 = white. 8-byte DXT1 block.
function whiteDxt1Block(): Uint8Array {
  return new Uint8Array([0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

describe("tex decode: block formats", () => {
  it("DXT1 decodes a solid-white block to opaque white", () => {
    const out = decodeToRgba(texOf(DXT1, 4, 4, whiteDxt1Block()));
    // All 16 texels white/opaque.
    for (let i = 0; i < 16; i++) {
      expect(Array.from(out.slice(i * 4, i * 4 + 4))).toEqual([
        255, 255, 255, 255,
      ]);
    }
  });

  it("DXT1 decodes a punch-through block with transparent index 3", () => {
    // color0=black(0x0000) <= color1=white(0xFFFF) -> punch-through mode. Indices packed
    // little-endian 2 bits per texel (texel0 in the lowest 2 bits): texel0=0 (black,opaque),
    // texel1=1 (white,opaque), texel2=2 (avg,opaque), texel3=3 (transparent) -> byte 0xE4.
    const block = new Uint8Array([
      0x00, 0x00, 0xff, 0xff, 0xe4, 0x00, 0x00, 0x00,
    ]);
    const out = decodeToRgba(texOf(DXT1, 4, 4, block));
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 255]); // texel0: color0
    expect(Array.from(out.slice(4, 8))).toEqual([255, 255, 255, 255]); // texel1: color1
    expect(Array.from(out.slice(8, 12))).toEqual([127, 127, 127, 255]); // texel2: avg = (0+255)/2 floor
    expect(Array.from(out.slice(12, 16))).toEqual([0, 0, 0, 0]); // texel3: transparent black
  });

  it("DXT5 decodes solid white color with alpha0 for all texels", () => {
    // alpha0=255, alpha1=0, alphaMask=0 -> alphaIndex 0 -> a=255. Color as DXT1 white.
    const block = new Uint8Array(16);
    block[0] = 255;
    block[1] = 0; // alpha endpoints; bytes 2..7 alphaMask = 0
    block[8] = 0xff;
    block[9] = 0xff; // color0 white; color1 black; indices 0
    const out = decodeToRgba(texOf(DXT5, 4, 4, block));
    expect(Array.from(out.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it("BC4 decodes a solid block to gray(red0) with opaque alpha", () => {
    // red0=200, red1=100, lookup=0 -> all texels index 0 -> r=200 -> (200,200,200,255).
    const block = new Uint8Array([200, 100, 0, 0, 0, 0, 0, 0]);
    const out = decodeToRgba(texOf(BC4, 4, 4, block));
    expect(Array.from(out.slice(0, 4))).toEqual([200, 200, 200, 255]);
  });

  it("DXT3 decodes explicit alpha nibble + color0", () => {
    // alpha nibbles all 0xF -> a = 0xFF; color0 white, indices 0.
    const block = new Uint8Array(16).fill(0);
    for (let i = 0; i < 8; i++) block[i] = 0xff; // explicit 4-bit alpha, all max
    block[8] = 0xff;
    block[9] = 0xff; // color0 white; color1 black; indices 0
    const out = decodeToRgba(texOf(DXT3, 4, 4, block));
    expect(Array.from(out.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it("DXT3 always uses 4-color mode even when color0 <= color1", () => {
    // color0=black(0x0000) <= color1=white(0xFFFF). Unlike DXT1, BC2/BC3 never punch-through:
    // idx2 -> (2*c0+c1)/3, idx3 -> (c0+2*c1)/3, both opaque via the explicit alpha channel.
    const block = new Uint8Array(16).fill(0);
    for (let i = 0; i < 8; i++) block[i] = 0xff; // alpha all max
    block[8] = 0x00;
    block[9] = 0x00; // color0 black
    block[10] = 0xff;
    block[11] = 0xff; // color1 white
    block[12] = 0xe4; // texel0=0,texel1=1,texel2=2,texel3=3
    const out = decodeToRgba(texOf(DXT3, 4, 4, block));
    expect(Array.from(out.slice(8, 12))).toEqual([85, 85, 85, 255]); // texel2: (2*0+255)/3=85
    expect(Array.from(out.slice(12, 16))).toEqual([170, 170, 170, 255]); // texel3: (0+2*255)/3=170
  });
});

describe("tex decode: BC5", () => {
  it("decodes two channels with the BcnSharp+SwapRedBlue layout", () => {
    // Block A (bytes 0..7): channel0, endpoints [180,20], lookup 0 -> all 180.
    // Block B (bytes 8..15): channel1, endpoints [60,10], lookup 0 -> all 60.
    const block = new Uint8Array(16);
    block[0] = 180;
    block[1] = 20;
    block[8] = 60;
    block[9] = 10;
    const out = decodeToRgba(texOf(BC5, 4, 4, block));
    // channel0=180 -> after swap lands in Blue; channel1=60 in Green; Red=0; Alpha=255.
    expect(Array.from(out.slice(0, 4))).toEqual([0, 60, 180, 255]);
  });
});

describe("tex decode: truncated mip data", () => {
  it("throws a clear 'truncated' error for undersized BC7 block data", () => {
    // BC7 8x8 needs 4 blocks x 16 bytes = 64 bytes; only 16 given.
    expect(() => decodeToRgba(texOf(BC7, 8, 8, new Uint8Array(16)))).toThrow(
      /truncated/i,
    );
  });
});

describe("tex decode: BC7", () => {
  it("decodes a mode-6 solid block to the encoded color (with R/B swap)", () => {
    // comps 0x7F, pbit 1 -> (0x7F<<1)|1 = 0xFF = 255 for R,G,B; alpha comps 0x7F pbit1 -> 255.
    const block = buildBc7Mode6SolidBlock(0x7f, 0x7f, 0x7f, 0x7f, 1);
    const out = decodeToRgba(texOf(BC7, 4, 4, block));
    // Solid white is swap-invariant.
    for (let i = 0; i < 16; i++) {
      expect(Array.from(out.slice(i * 4, i * 4 + 4))).toEqual([
        255, 255, 255, 255,
      ]);
    }
  });

  it("applies the red/blue swap on a non-gray solid block", () => {
    // Mode 6 solid block: every channel value = (comp7<<1)|pbit (both endpoints equal, index 0).
    // r7=0x40,g7=0x20,b7=0x10,a7=0x7f, pbit=1 ->
    //   R=(0x40<<1)|1=129, G=(0x20<<1)|1=65, B=(0x10<<1)|1=33, A=(0x7f<<1)|1=255.
    // Pre-swap RGBA = (129,65,33,255); after R<->B swap -> (33,65,129,255).
    const block = buildBc7Mode6SolidBlock(0x40, 0x20, 0x10, 0x7f, 1);
    const out = decodeToRgba(texOf(BC7, 4, 4, block));
    for (let i = 0; i < 16; i++) {
      expect(Array.from(out.slice(i * 4, i * 4 + 4))).toEqual([
        33, 65, 129, 255,
      ]);
    }
  });
});
