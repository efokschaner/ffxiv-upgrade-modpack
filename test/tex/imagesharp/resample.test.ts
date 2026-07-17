import { describe, expect, it } from "vitest";
import {
  resizeBicubic,
  resizeNearestNeighbor,
} from "../../../src/tex/imagesharp/resample";

function solid(
  w: number,
  h: number,
  c: [number, number, number, number],
): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set(c, i * 4);
  return out;
}

describe("resizeNearestNeighbor", () => {
  it("2x2 -> 4x4 replicates each source pixel into a 2x2 block (trunc mapping)", () => {
    // pixels: (0,0)=A (1,0)=B (0,1)=C (1,1)=D, distinct reds
    const src = new Uint8Array([
      10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255,
    ]);
    const out = resizeNearestNeighbor(src, 2, 2, 4, 4);
    const red = (x: number, y: number) => out[(y * 4 + x) * 4]!;
    // factor=0.5; srcX=trunc(x*0.5): x=0,1->0 ; x=2,3->1. Same for y.
    expect([red(0, 0), red(1, 0), red(2, 0), red(3, 0)]).toEqual([
      10, 10, 20, 20,
    ]);
    expect([red(0, 3), red(1, 3), red(2, 3), red(3, 3)]).toEqual([
      30, 30, 40, 40,
    ]);
  });
  it("same-size request returns an equal copy (not the same reference)", () => {
    const src = solid(2, 2, [1, 2, 3, 4]);
    const out = resizeNearestNeighbor(src, 2, 2, 2, 2);
    expect([...out]).toEqual([...src]);
    expect(out).not.toBe(src);
  });
});

describe("resizeBicubic", () => {
  it("preserves a solid color on upscale (kernel weights sum to 1)", () => {
    const src = solid(4, 4, [123, 45, 67, 200]);
    const out = resizeBicubic(src, 4, 4, 9, 9);
    for (let i = 0; i < 9 * 9; i++) {
      expect([...out.slice(i * 4, i * 4 + 4)]).toEqual([123, 45, 67, 200]);
    }
  });
  it("preserves a solid color on downscale", () => {
    const src = solid(8, 8, [10, 20, 30, 40]);
    const out = resizeBicubic(src, 8, 8, 3, 3);
    for (let i = 0; i < 3 * 3; i++) {
      expect([...out.slice(i * 4, i * 4 + 4)]).toEqual([10, 20, 30, 40]);
    }
  });
  it("same-size request returns an equal copy", () => {
    const src = solid(3, 3, [5, 6, 7, 8]);
    const out = resizeBicubic(src, 3, 3, 3, 3);
    expect([...out]).toEqual([...src]);
  });

  it("guards the float inter-pass intermediate on a non-uniform resize (regression)", () => {
    // A solid-color fixture rounds identically whether the byte conversion happens once
    // (correct, per ResizeWorker.cs · CalculateFirstPassValues / FillDestinationPixels — the
    // horizontal pass writes a float Vector4 intermediate, the vertical pass reads it as float
    // and only the *final* write converts to bytes) or twice (once per pass — a regression this
    // test exists to catch). It cannot distinguish the two, so it can't guard against
    // reintroducing per-pass rounding. This fixture uses a non-uniform 4x4 source (every pixel a
    // distinct RGBA value) upscaled to 6x6, so the horizontal pass produces fractional
    // intermediates that differ depending on whether they get rounded to a byte before the
    // vertical pass consumes them.
    //
    // Expected output was captured from the current, corpus-validated resizeBicubic (verified
    // against real ImageSharp goldens: eye 2->1 px delta, Eliza 11->1 px delta, after commit
    // cdf91db "keep resize intermediate in float between passes"). This is a
    // characterization/regression guard, not an independently-derived expected value — it would
    // fail if per-pass byte rounding were reintroduced into resizeAxisX (confirmed by
    // temporarily reintroducing such rounding locally and observing this test fail; see
    // task-2-report.md).
    const srcW = 4;
    const srcH = 4;
    const src = new Uint8Array(srcW * srcH * 4);
    for (let i = 0; i < srcW * srcH; i++) {
      const r = (i * 17 + 3) % 256;
      const g = (i * 29 + 11) % 256;
      const b = (250 - i * 13 + 256) % 256;
      const a = (i * 7 + 100) % 256;
      src.set([r, g, b, a], i * 4);
    }
    const out = resizeBicubic(src, srcW, srcH, 6, 6);
    // biome-ignore format: one row per output pixel would be noisy; keep the captured array compact.
    expect([...out]).toEqual([
      0, 1, 254, 98, 6, 15, 248, 101, 18, 37, 238, 106, 30, 57, 230, 111, 43, 78, 220, 116, 51, 92,
      214, 120, 30, 56, 229, 111, 38, 78, 223, 114, 51, 109, 213, 120, 62, 127, 205, 124, 75, 149,
      195, 130, 83, 163, 189, 133, 81, 150, 190, 132, 89, 145, 184, 136, 102, 147, 174, 141, 113,
      168, 166, 146, 128, 191, 156, 151, 138, 204, 149, 154, 127, 252, 156, 151, 135, 137, 149, 154,
      147, 18, 140, 160, 158, 49, 131, 164, 180, 74, 121, 169, 196, 87, 115, 173, 178, 183, 116, 172,
      186, 124, 110, 175, 200, 66, 100, 181, 218, 92, 92, 185, 151, 115, 82, 191, 87, 129, 76, 194,
      210, 91, 91, 185, 218, 114, 85, 189, 234, 145, 75, 194, 255, 164, 67, 199, 111, 186, 57, 204,
      0, 200, 51, 207,
    ]);
  });
});
