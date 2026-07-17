import { describe, expect, it } from "vitest";
import {
  drawImageSrcAtop,
  drawImageSrcOver,
} from "../../../src/tex/imagesharp/compose";

describe("drawImageSrcOver", () => {
  it("opaque source fully replaces the destination over the overlap", () => {
    const dst = new Uint8Array([0, 0, 0, 255]);
    const src = new Uint8Array([10, 20, 30, 255]);
    drawImageSrcOver(dst, 1, 1, src, 1, 1, 0, 0, 1);
    expect([...dst]).toEqual([10, 20, 30, 255]);
  });
  it("fully transparent source leaves the destination unchanged", () => {
    const dst = new Uint8Array([10, 20, 30, 255]);
    const src = new Uint8Array([99, 99, 99, 0]);
    drawImageSrcOver(dst, 1, 1, src, 1, 1, 0, 0, 1);
    expect([...dst]).toEqual([10, 20, 30, 255]);
  });
  it("respects the offset (source only touches the addressed pixel)", () => {
    const dst = new Uint8Array(2 * 1 * 4); // two black transparent pixels
    const src = new Uint8Array([50, 60, 70, 255]);
    drawImageSrcOver(dst, 2, 1, src, 1, 1, 1, 0, 1); // draw at x=1
    expect([...dst.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...dst.slice(4, 8)]).toEqual([50, 60, 70, 255]);
  });
  it("weighted-averages color for a fractional source alpha over an opaque backdrop", () => {
    const dst = new Uint8Array([200, 0, 0, 255]); // opaque red
    const src = new Uint8Array([0, 0, 200, 128]); // blue at ~half alpha
    drawImageSrcOver(dst, 1, 1, src, 1, 1, 0, 0, 1);
    expect([...dst]).toEqual([100, 0, 100, 255]);
  });
});

describe("drawImageSrcAtop", () => {
  it("keeps the backdrop alpha; opaque backdrop takes the source color", () => {
    const dst = new Uint8Array([0, 0, 0, 255]);
    const src = new Uint8Array([10, 20, 30, 255]);
    drawImageSrcAtop(dst, src, 1, 1, 1);
    expect([...dst]).toEqual([10, 20, 30, 255]);
  });
  it("transparent backdrop stays transparent regardless of source", () => {
    const dst = new Uint8Array([0, 0, 0, 0]);
    const src = new Uint8Array([10, 20, 30, 255]);
    drawImageSrcAtop(dst, src, 1, 1, 1);
    expect(dst[3]).toBe(0); // alpha = backdrop alpha = 0
  });
});
