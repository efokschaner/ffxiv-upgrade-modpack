import { describe, expect, it } from "vitest";
import type { TtVertex } from "../../../src/mdl/geometry/vertex-data";
import {
  getUsageInfo,
  getV6BoneSet,
  type TTMeshGroup,
  type TTModel,
} from "../../../src/mdl/model/tt-model";

function vert(over: Partial<TtVertex> = {}): TtVertex {
  return {
    position: [0, 0, 0],
    normal: [0, 0, 0],
    binormal: [0, 0, 0],
    handedness: true,
    flowDirection: [0, 0, 0],
    vertexColor: [255, 255, 255, 255],
    vertexColor2: [0, 0, 0, 255],
    uv1: [0, 0],
    uv2: [0, 0],
    uv3: [0, 0],
    boneIds: new Uint8Array(8),
    weights: new Uint8Array(8),
    ...over,
  };
}
function model(groups: TTMeshGroup[]): TTModel {
  return {
    source: "",
    mdlVersion: 6,
    meshGroups: groups,
    attributes: [],
    bones: [],
    materials: [],
    shapeNames: [],
    anisotropicLighting: false,
    flags1: 0,
  };
}

describe("getUsageInfo", () => {
  it("detects maxUv, vColor2, eight-weights", () => {
    const w = new Uint8Array(8);
    w[5] = 3; // nonzero weight in slot 5 (>=4)
    const m = model([
      {
        name: "g",
        meshType: 0,
        material: "m",
        bones: [],
        parts: [
          {
            name: "p",
            attributes: new Set<string>(),
            triangleIndices: [],
            vertices: [
              vert({
                uv2: [0.5, 0],
                vertexColor2: [1, 0, 0, 255],
                weights: w,
              }),
            ],
            shapeParts: new Map(),
          },
        ],
      },
    ]);
    expect(getUsageInfo(m)).toEqual({
      usesVColor2: true,
      maxUv: 2,
      needsEightWeights: true,
    });
  });
  it("defaults to maxUv 1, no vColor2, four weights", () => {
    const m = model([
      {
        name: "g",
        meshType: 0,
        material: "m",
        bones: [],
        parts: [
          {
            name: "p",
            attributes: new Set<string>(),
            triangleIndices: [],
            vertices: [vert()],
            shapeParts: new Map(),
          },
        ],
      },
    ]);
    expect(getUsageInfo(m)).toEqual({
      usesVColor2: false,
      maxUv: 1,
      needsEightWeights: false,
    });
  });
  it("climbs maxUv to 3 when uv3 is used", () => {
    const m = model([
      {
        name: "g",
        meshType: 0,
        material: "m",
        bones: [],
        parts: [
          {
            name: "p",
            attributes: new Set<string>(),
            triangleIndices: [],
            vertices: [vert({ uv3: [0, 0.2] })],
            shapeParts: new Map(),
          },
        ],
      },
    ]);
    expect(getUsageInfo(m).maxUv).toBe(3);
  });
});

describe("getV6BoneSet", () => {
  it("packs group bones as LE i16 indices into the model bone list", () => {
    const m = model([
      {
        name: "g",
        meshType: 0,
        material: "m",
        bones: ["b5", "b12", "b7"],
        parts: [],
      },
    ]);
    m.bones = Array.from({ length: 13 }, (_, i) => `b${i}`);
    expect(Array.from(getV6BoneSet(m, 0))).toEqual([0x05, 0, 0x0c, 0, 0x07, 0]);
  });
});
