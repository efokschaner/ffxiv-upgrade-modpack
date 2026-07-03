// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, expect, it } from "vitest";
import { decodeToRgba } from "../src/tex/decode";
import {
  A1R5G5B5,
  A4R4G4B4,
  A8,
  A8R8G8B8,
  A16B16G16R16F,
  L8,
  type XivTex,
} from "../src/tex/types";

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
    // BC5 is added in a later task; until then decode rejects it clearly.
    expect(() => decodeToRgba(texOf(25136, 4, 4, new Uint8Array(16)))).toThrow(
      /unsupported/i,
    );
  });
});
