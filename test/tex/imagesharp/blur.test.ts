import { describe, expect, it } from "vitest";
import { boxBlur } from "../../../src/tex/imagesharp/blur";

describe("boxBlur", () => {
  it("radius 0 is identity (copy)", () => {
    const src = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
    const out = boxBlur(src, 2, 1, 0);
    expect([...out]).toEqual([...src]);
    expect(out).not.toBe(src);
  });
  it("preserves a solid opaque color (uniform kernel, edge-clamp)", () => {
    const w = 5,
      h = 5;
    const src = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) src.set([80, 90, 100, 255], i * 4);
    const out = boxBlur(src, w, h, 2);
    for (let i = 0; i < w * h; i++) {
      expect([...out.slice(i * 4, i * 4 + 4)]).toEqual([80, 90, 100, 255]);
    }
  });
  it("blurs a 1-D opaque step toward its neighbors (radius 1, fully opaque so premultiply is a no-op)", () => {
    // 3x1 opaque: black, white, black. radius 1, edge-clamp.
    const src = new Uint8Array([
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]);
    const out = boxBlur(src, 3, 1, 1);
    // center = mean(0,255,0)=85 ; left = mean(clamp)= (0+0+255)/3=85 ; right=(255+0+0)/3=85
    expect(out[0]).toBe(85); // left pixel R (clamped self + self + center)
    expect(out[4]).toBe(85); // center pixel R
    expect(out[8]).toBe(85); // right pixel R
  });
});
