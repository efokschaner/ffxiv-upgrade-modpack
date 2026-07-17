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
  it("requantizes to bytes between the horizontal and vertical passes (2-D, non-opaque, both passes non-trivial)", () => {
    // 3x3, radius 1: background (0,0,0,5) everywhere except center (1,1)=(165,0,0,15) — a single
    // non-opaque "impulse" pixel amid a uniform non-opaque background. Chosen (and hand-verified via
    // exact-fraction arithmetic, not by running boxBlur) so ImageSharp's actual per-pass structure
    // (premultiply -> convolve -> un-premultiply -> round to 8-bit bytes, independently for EACH
    // pass, per Convolution2PassProcessor{TPixel}'s Buffer2D<TPixel> inter-pass intermediate) diverges
    // from a float-throughout implementation by a full integer in R, with both landing exactly on an
    // integer (no rounding-boundary risk):
    //
    // Horizontal pass: every row's taps are edge-clamp {left,center,right}. Row1 (the impulse row) has
    // taps {bg,impulse,bg} for x=1, and edge-clamp just repeats bg for x=0/x=2 — bg==bg, so all three
    // x positions in row1 see the same {bg,bg,impulse} multiset. Premultiplied: bg=(0,1/51),
    // impulse=(11/289,1/17) [premulR=165*15/65025=11/289 in lowest terms]. Averaging: premulR=11/867,
    // premulA=5/153. Un-premultiply+round: R=(11/867)/(5/153)*255=33/85*255=99 exactly (255/85=3),
    // A=(5/153)*255=25/3->round 8. So EVERY x in row1 becomes the intermediate byte (99,0,0,8); rows
    // 0/2 pass through unchanged as (0,0,0,5) (averaging 3 identical bg values is exact, no rounding).
    //
    // Vertical pass re-premultiplies FROM THOSE BYTES: every column's y taps are edge-clamp
    // {top,center,bottom} = {(0,5),(99,8),(0,5)} for every x (rows 0/2 identical, same clamp-repeats-bg
    // argument as above). Premultiplied: (0,5)->(0,1/51); (99,8)->(792/65025,8/255). Averaging:
    // premulR=792/195075, premulA=18/765=2/85. Un-premultiply+round: R=(792/195075)/(2/85)*255
    // = (748/4335)*255 = 44/255*255 = 44 EXACTLY (no fractional remainder at all); A=(2/85)*255=6
    // exactly. So every one of the 9 output pixels is (44,0,0,6).
    //
    // Cross-check (the seam this test targets): the float-throughout ("too precise") algorithm never
    // rounds the horizontal blend to 99/8 — it carries the exact float (premulR=11/867, premulA=5/153)
    // straight into the vertical pass instead. That gives premulR_V=11/2601, premulA_V=11/459, and
    // R=(11/2601)/(11/459)*255=(3/17)*255=45 EXACTLY (255/17=15), A=55/9=6.11->round 6 — R differs by
    // a full integer (44 vs 45) from the per-pass-requantized result; A coincides (6 either way).
    const bg = [0, 0, 0, 5];
    const impulse = [165, 0, 0, 15];
    const src = new Uint8Array(3 * 3 * 4);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        src.set(x === 1 && y === 1 ? impulse : bg, (y * 3 + x) * 4);
      }
    }
    const out = boxBlur(src, 3, 3, 1);
    for (let i = 0; i < 9; i++) {
      expect([...out.slice(i * 4, i * 4 + 4)]).toEqual([44, 0, 0, 6]);
    }
  });
});
