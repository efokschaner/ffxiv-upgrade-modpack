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
});
