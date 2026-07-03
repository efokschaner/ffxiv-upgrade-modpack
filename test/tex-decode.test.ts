// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, expect, it } from "vitest";
import { decodeToRgba } from "../src/tex/decode";
import { A8, A8R8G8B8, L8, type XivTex } from "../src/tex/types";

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

  it("throws on an unsupported (not-yet-implemented) format", () => {
    // BC5 is added in a later task; until then decode rejects it clearly.
    expect(() => decodeToRgba(texOf(25136, 4, 4, new Uint8Array(16)))).toThrow(
      /unsupported/i,
    );
  });
});
