import { describe, expect, it } from "vitest";
import { bankersRound, modifyPixels } from "../../src/tex/helpers";

describe("bankersRound", () => {
  it("rounds halves to even (matches C# Math.Round default)", () => {
    expect(bankersRound(0.5)).toBe(0);
    expect(bankersRound(1.5)).toBe(2);
    expect(bankersRound(2.5)).toBe(2);
    expect(bankersRound(3.5)).toBe(4);
    expect(bankersRound(-0.5)).toBe(0);
    expect(bankersRound(-1.5)).toBe(-2);
  });
  it("rounds non-halves normally", () => {
    expect(bankersRound(120.0)).toBe(120);
    expect(bankersRound(132.98)).toBe(133);
    expect(bankersRound(2.4)).toBe(2);
  });
});

describe("modifyPixels", () => {
  it("invokes fn at every 4-byte pixel offset in row-major order", () => {
    const rgba = new Uint8Array(2 * 2 * 4);
    const offsets: number[] = [];
    modifyPixels(rgba, 2, 2, (o) => offsets.push(o));
    expect(offsets).toEqual([0, 4, 8, 12]);
  });
});

import { createIndexTexture } from "../../src/tex/helpers";

describe("createIndexTexture", () => {
  // Each pixel's index output depends ONLY on the normal's alpha (byte +3).
  // Derived by hand from TextureHelpers.cs:222 (RGBA out = [newRow, newBlend, 0, 255]).
  const cases: Array<[number, [number, number, number, number]]> = [
    [0, [4, 255, 0, 255]],
    [8, [4, 135, 0, 255]],
    [17, [4, 0, 0, 255]],
    [25, [4, 0, 0, 255]], // blendRem 25>17 & <26 -> clamp to 17
    [26, [21, 255, 0, 255]], // blendRem 26 -> next row
    [34, [21, 255, 0, 255]],
    [255, [123, 0, 0, 255]],
  ];
  it.each(cases)("alpha %i -> index pixel", (alpha, expected) => {
    const normal = new Uint8Array([0, 0, 0, alpha]); // 1x1, only alpha matters
    expect(Array.from(createIndexTexture(normal, 1, 1))).toEqual(expected);
  });
});
