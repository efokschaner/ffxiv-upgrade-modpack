import { describe, expect, it } from "vitest";
import { floatToHalf, halfToFloat } from "../../src/util/half-float";

describe("floatToHalf", () => {
  it("encodes exact half values", () => {
    expect(floatToHalf(0)).toBe(0x0000);
    expect(floatToHalf(0.5)).toBe(0x3800);
    expect(floatToHalf(1)).toBe(0x3c00);
    expect(floatToHalf(2.5)).toBe(0x4100);
    expect(floatToHalf(16)).toBe(0x4c00);
    expect(floatToHalf(0.8100586)).toBe(0x3a7b);
    expect(floatToHalf(-1)).toBe(0xbc00);
    expect(floatToHalf(-2)).toBe(0xc000);
  });

  it("rounds ties to even (not away from zero)", () => {
    // 1.00048828125 = exact tie between 0x3c00 (even) and 0x3c01 -> 0x3c00
    expect(floatToHalf(1.00048828125)).toBe(0x3c00);
    // 1.00146484375 = exact tie between 0x3c01 (odd) and 0x3c02 (even) -> 0x3c02
    expect(floatToHalf(1.00146484375)).toBe(0x3c02);
    // 2^-25 = exact tie between 0x0000 (even) and 0x0001 -> 0x0000
    expect(floatToHalf(2 ** -25)).toBe(0x0000);
  });

  it("handles subnormals and the subnormal->normal boundary", () => {
    expect(floatToHalf(2 ** -24)).toBe(0x0001); // smallest positive subnormal
    expect(floatToHalf(2 ** -14)).toBe(0x0400); // smallest positive normal
  });

  it("handles overflow, NaN, and signed zero", () => {
    expect(floatToHalf(70000)).toBe(0x7c00); // > 65504 max half -> +Inf
    expect(floatToHalf(-70000)).toBe(0xfc00); // -Inf
    expect(floatToHalf(NaN)).toBe(0x7e00); // quiet NaN
    expect(floatToHalf(-0)).toBe(0x8000); // negative zero
  });
});

describe("halfToFloat", () => {
  it("decodes exact reference bit patterns", () => {
    expect(halfToFloat(0x0000)).toBe(0); // +0
    expect(halfToFloat(0x3c00)).toBe(1); // 1.0
    expect(halfToFloat(0xc000)).toBe(-2); // -2.0
    expect(halfToFloat(0x7c00)).toBe(Number.POSITIVE_INFINITY); // +Inf
    expect(halfToFloat(0xfc00)).toBe(Number.NEGATIVE_INFINITY); // -Inf
    expect(Number.isNaN(halfToFloat(0x7e00))).toBe(true); // NaN
    expect(halfToFloat(0x0001)).toBeCloseTo(5.9604645e-8, 12); // smallest subnormal
  });

  it("round-trips every finite half through floatToHalf (identity)", () => {
    for (let h = 0; h <= 0xffff; h++) {
      const exp = (h >> 10) & 0x1f;
      const mant = h & 0x3ff;
      if (exp === 0x1f) continue; // skip Inf/NaN
      if (mant === 0 && exp === 0 && h & 0x8000) continue; // skip -0 (floatToHalf yields +0)
      expect(floatToHalf(halfToFloat(h))).toBe(h);
    }
  });
});
