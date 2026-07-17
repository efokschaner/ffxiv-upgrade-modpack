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
  it("premultiplies before convolving so a transparent pixel's garbage RGB does not bleed in", () => {
    // 2x1, radius 1: p0 opaque red, p1 fully transparent with garbage RGB (99,99,99).
    // Premultiplied: p0=(1,0,0,a=1); p1's 99s are scaled by a=0 -> (0,0,0,a=0).
    // Horizontal (edge-clamp, weight=1/3):
    //   out0 taps {clamp(-1)=p0, p0, p1}: premR=(1+1+0)/3=2/3, a=(1+1+0)/3=2/3
    //     -> unpremul R=(2/3)/(2/3)=1->255, a=round(2/3*255)=170
    //   out1 taps {p0, p1, clamp(2)=p1}: premR=1/3, a=1/3
    //     -> unpremul R=(1/3)/(1/3)=1->255, a=round(1/3*255)=85
    // height=1 so the vertical pass is a no-op (every tap clamps to the same row).
    // If premultiply were missing/wrong, p1's 99 green/blue would leak into out0/out1.
    const src = new Uint8Array([255, 0, 0, 255, 99, 99, 99, 0]);
    const out = boxBlur(src, 2, 1, 1);
    expect([...out]).toEqual([255, 0, 0, 170, 255, 0, 0, 85]);
  });
  it("blurs a 1-D opaque step down a column (radius 1) — exercises the vertical pass", () => {
    // 1x3 opaque column: R = [0, 255, 0], radius 1, edge-clamp.
    // Width=1 so the horizontal pass is a no-op (every tap clamps to the same column);
    // the vertical pass does the actual blending, mirroring the existing 3x1 row test transposed.
    // row0 taps {clamp(-1)=p0, p0, p1}: mean(0,0,255)=85
    // row1 taps {p0, p1, p2}: mean(0,255,0)=85
    // row2 taps {p1, p2, clamp(3)=p2}: mean(255,0,0)=85
    const src = new Uint8Array([
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]);
    const out = boxBlur(src, 1, 3, 1);
    expect(out[0]).toBe(85); // row 0 R
    expect(out[4]).toBe(85); // row 1 R
    expect(out[8]).toBe(85); // row 2 R
  });
});
