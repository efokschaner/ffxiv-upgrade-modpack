import { describe, expect, it } from "vitest";
import { floatToHalf } from "../../src/util/half";

describe("floatToHalf", () => {
  it("encodes exact half values", () => {
    expect(floatToHalf(0)).toBe(0x0000);
    expect(floatToHalf(0.5)).toBe(0x3800);
    expect(floatToHalf(1)).toBe(0x3c00);
    expect(floatToHalf(2.5)).toBe(0x4100);
    expect(floatToHalf(16)).toBe(0x4c00);
    expect(floatToHalf(0.8100586)).toBe(0x3a7b);
    expect(floatToHalf(-1)).toBe(0xbc00);
  });
});
