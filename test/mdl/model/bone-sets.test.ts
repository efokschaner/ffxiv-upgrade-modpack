import { describe, expect, it } from "vitest";
import { buildV6BoneSetBlock } from "../../../src/mdl/model/bone-sets";
import type { TTModel } from "../../../src/mdl/model/tt-model";

function model(groups: { bones: string[] }[]): TTModel {
  return {
    source: "",
    mdlVersion: 6,
    attributes: [],
    materials: [],
    shapeNames: [],
    anisotropicLighting: false,
    flags1: 0,
    bones: Array.from({ length: 13 }, (_, i) => `b${i}`),
    meshGroups: groups.map((g, i) => ({
      name: `g${i}`,
      meshType: 0,
      material: "m",
      parts: [],
      bones: g.bones,
    })),
  };
}

// The ConsoleTools golden pads each set's data region to a fixed 64 shorts / 128 bytes
// (the v5 static array size), with the [offset][count] header carrying the real bone count.
const SET = 128;
function allZero(block: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (block[i] !== 0) return false;
  return true;
}

describe("buildV6BoneSetBlock", () => {
  it("assembles one group: header + 128-byte zero-padded data region", () => {
    const { block, boneSetSize } = buildV6BoneSetBlock(
      model([{ bones: ["b5", "b12", "b7"] }]),
    );
    expect(block.length).toBe(4 + SET); // 4-byte header + one 128-byte set
    // header: offset=1 (dwords -> byte 4), count=3
    expect(Array.from(block.subarray(0, 4))).toEqual([0x01, 0, 0x03, 0]);
    // data: 3 real bones then zeros to 128
    expect(Array.from(block.subarray(4, 10))).toEqual([
      0x05, 0, 0x0c, 0, 0x07, 0,
    ]);
    expect(allZero(block, 10, 4 + SET)).toBe(true);
    expect(boneSetSize).toBe(64); // 128-byte region / 2
  });

  it("packs two groups compactly (offsets) then zero-extends to 2x128", () => {
    const { block, boneSetSize } = buildV6BoneSetBlock(
      model([{ bones: ["b1", "b2"] }, { bones: ["b3"] }]),
    );
    expect(block.length).toBe(8 + 2 * SET);
    // headers: g0 offset=(8-0)/4=2 count=2 ; g1 data packed COMPACTLY at byte 12 -> offset=(12-4)/4=2 count=1
    expect(Array.from(block.subarray(0, 8))).toEqual([
      0x02, 0, 0x02, 0, 0x02, 0, 0x01, 0,
    ]);
    // g0 data at byte 8 (4 bytes, even -> no pad); g1 data at byte 12
    expect(Array.from(block.subarray(8, 12))).toEqual([0x01, 0, 0x02, 0]);
    expect(Array.from(block.subarray(12, 14))).toEqual([0x03, 0]);
    // g1's 2-byte pad + the whole zero-extension to 2*128 bytes of data region
    expect(allZero(block, 14, block.length)).toBe(true);
    expect(boneSetSize).toBe(128); // 2 sets * 64 shorts
  });
});
