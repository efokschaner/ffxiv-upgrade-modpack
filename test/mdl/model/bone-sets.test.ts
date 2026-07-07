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

describe("buildV6BoneSetBlock", () => {
  it("assembles one group's header + padded data", () => {
    const { block, boneSetSize } = buildV6BoneSetBlock(
      model([{ bones: ["b5", "b12", "b7"] }]),
    );
    // header: offset=1 (dwords -> points at byte 4), count=3 ; data: 05 00 0c 00 07 00 + 2 pad
    expect(Array.from(block)).toEqual([
      0x01, 0, 0x03, 0, 0x05, 0, 0x0c, 0, 0x07, 0, 0, 0,
    ]);
    expect(boneSetSize).toBe(4); // (12 - 4) / 2
  });

  it("assembles two groups with correct offsets and even/odd padding", () => {
    // group0: 2 bones [1,2] (4 bytes packed, no pad). group1: 1 bone [3] (2 bytes packed, +2 pad).
    const { block, boneSetSize } = buildV6BoneSetBlock(
      model([{ bones: ["b1", "b2"] }, { bones: ["b3"] }]),
    );
    // headers (8 bytes): g0 offset,count ; g1 offset,count
    //   g0 data starts at byte 8 -> offset (8-0)/4 = 2, count 2
    //   g1 data starts at byte 8+4=12 -> offset (12-4)/4 = 2, count 1
    // data: g0 [01 00 02 00] (even, no pad) ; g1 [03 00] + [00 00] pad
    expect(Array.from(block)).toEqual([
      0x02,
      0,
      0x02,
      0,
      0x02,
      0,
      0x01,
      0, // headers
      0x01,
      0,
      0x02,
      0, // g0 data
      0x03,
      0,
      0,
      0, // g1 data + pad
    ]);
    expect(boneSetSize).toBe((block.length - 8) / 2); // data region shorts
  });
});
