// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, expect, it } from "vitest";
import {
  A8R8G8B8,
  BC5,
  BC7,
  bitsPerPixel,
  DXT1,
  isCompressed,
  minDimension,
  texLayers,
  texMipSizes,
  type XivTex,
} from "../src/tex/types";

function baseTex(): XivTex {
  return {
    attributes: 0,
    format: A8R8G8B8,
    width: 4,
    height: 4,
    depth: 1,
    mipCount: 1,
    mipFlag: 0,
    arraySize: 1,
    lodMips: [0, 0, 0],
    mipMapOffsets: new Array(13).fill(0),
    mipData: new Uint8Array(0),
  };
}

describe("tex format helpers", () => {
  it("reports bits-per-pixel and compression", () => {
    expect(bitsPerPixel(BC5)).toBe(8);
    expect(bitsPerPixel(DXT1)).toBe(4);
    expect(bitsPerPixel(A8R8G8B8)).toBe(32);
    expect(isCompressed(BC7)).toBe(true);
    expect(isCompressed(A8R8G8B8)).toBe(false);
    expect(minDimension(BC5)).toBe(4);
    expect(minDimension(A8R8G8B8)).toBe(1);
  });

  it("computes the full mip chain (matches CalculateMipMapSizes)", () => {
    // BC5, 8x8: 8*8*8/8=64, then 4x4 clamped=16, 2x2->16, 1x1->16.
    expect(texMipSizes(BC5, 8, 8)).toEqual([64, 16, 16, 16]);
    // A8R8G8B8 4x4: 4*4*4=64, 2x2=16, 1x1=4.
    expect(texMipSizes(A8R8G8B8, 4, 4)).toEqual([64, 16, 4]);
  });

  it("computes layers as arraySize*depth (min 1)", () => {
    const t = baseTex();
    expect(texLayers(t)).toBe(1);
    t.arraySize = 0;
    t.depth = 0;
    expect(texLayers(t)).toBe(1);
    t.arraySize = 2;
    t.depth = 3;
    expect(texLayers(t)).toBe(6);
  });
});
