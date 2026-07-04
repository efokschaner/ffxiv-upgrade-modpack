import { describe, expect, it } from "vitest";
import { applyChannelMap, bc7BlockMode } from "./golden-util";

describe("applyChannelMap", () => {
  it("none returns the pixels unchanged", () => {
    expect(
      Array.from(applyChannelMap(new Uint8Array([10, 20, 30, 40]), "none")),
    ).toEqual([10, 20, 30, 40]);
  });

  it("swapRB swaps red<->blue, keeps green and alpha", () => {
    expect(
      Array.from(applyChannelMap(new Uint8Array([10, 20, 30, 40]), "swapRB")),
    ).toEqual([30, 20, 10, 40]);
  });

  it("grayFromR replicates red across RGB and forces opaque alpha", () => {
    expect(
      Array.from(applyChannelMap(new Uint8Array([77, 0, 0, 12]), "grayFromR")),
    ).toEqual([77, 77, 77, 255]);
  });
});

describe("bc7BlockMode", () => {
  it("reads mode 6 (first byte 0x40) — matches the make-tex mode-6 builder", () => {
    expect(bc7BlockMode(new Uint8Array([0x40]))).toBe(6);
  });

  it("reads mode 0 (first byte 0x01)", () => {
    expect(bc7BlockMode(new Uint8Array([0x01]))).toBe(0);
  });

  it("honors the offset (0x08 at index 1 -> mode 3)", () => {
    expect(bc7BlockMode(new Uint8Array([0x00, 0x08]), 1)).toBe(3);
  });

  it("returns -1 for the reserved all-zero-first-byte block", () => {
    expect(bc7BlockMode(new Uint8Array([0x00]))).toBe(-1);
  });
});
