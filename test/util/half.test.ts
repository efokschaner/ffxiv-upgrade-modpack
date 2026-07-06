import { describe, expect, it } from "vitest";
import { floatToHalf, halfToFloat } from "../../src/util/half";

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
