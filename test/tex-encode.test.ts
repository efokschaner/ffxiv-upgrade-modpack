// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, expect, it } from "vitest";
import { decodeToRgba } from "../src/tex/decode";
import {
  encodeUncompressedTex,
  generateMipmaps,
  resizeToPowerOfTwo,
} from "../src/tex/encode";
import { parseTex } from "../src/tex/tex";
import { A8R8G8B8 } from "../src/tex/types";

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

  it("generates a full mip chain by 2x2 box average, rounded not truncated", () => {
    // Four distinct texels so the 1x1 result is a real average, not an input echo.
    // R channel: 10, 20, 30, 43 -> sum 103 -> (103+2)>>2 = 26. Plain truncation
    // (103>>2 = 25) would give a different value, so this proves the "+2" rounding
    // term is actually applied and that the R inputs are genuinely averaged.
    const rgba = new Uint8Array([
      10, 0, 100, 255, 20, 0, 100, 255, 30, 0, 100, 255, 43, 0, 100, 255,
    ]);
    const chain = generateMipmaps(rgba, 2, 2);
    expect(chain).toHaveLength(2);
    expect(chain[1]).toHaveLength(4);
    expect(Array.from(chain[1]!)).toEqual([26, 0, 100, 255]);
  });

  it("multi-mip encode reports the right mipCount and total size", () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(128);
    const tex = encodeUncompressedTex(rgba, 4, 4, { mips: true });
    const parsed = parseTex(tex);
    expect(parsed.mipCount).toBe(3); // 4x4,2x2,1x1
    expect(parsed.mipData).toHaveLength(64 + 16 + 4);
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
