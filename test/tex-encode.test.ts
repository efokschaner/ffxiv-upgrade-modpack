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

  it("generates a full mip chain by 2x2 box average", () => {
    // 2x2 solid (100,100,100,255) -> mip1 is 1x1 average = same.
    const rgba = new Uint8Array(16).map((_, i) => (i % 4 === 3 ? 255 : 100));
    const chain = generateMipmaps(rgba, 2, 2);
    expect(chain).toHaveLength(2);
    expect(chain[1]).toHaveLength(4);
    expect(Array.from(chain[1]!)).toEqual([100, 100, 100, 255]);
  });

  it("multi-mip encode reports the right mipCount and total size", () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(128);
    const tex = encodeUncompressedTex(rgba, 4, 4, { mips: true });
    const parsed = parseTex(tex);
    expect(parsed.mipCount).toBe(3); // 4x4,2x2,1x1
    expect(parsed.mipData).toHaveLength(64 + 16 + 4);
  });

  it("resizes a non-power-of-two image up to the next power of two", () => {
    const rgba = new Uint8Array(3 * 3 * 4).fill(50);
    const r = resizeToPowerOfTwo(rgba, 3, 3);
    expect(r.width).toBe(4);
    expect(r.height).toBe(4);
    expect(r.rgba).toHaveLength(4 * 4 * 4);
  });
});
