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
