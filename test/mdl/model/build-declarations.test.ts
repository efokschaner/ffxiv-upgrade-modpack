import { describe, expect, it } from "vitest";
import {
  VertexDataType as T,
  VertexUsageType as U,
} from "../../../src/mdl/geometry/format";
import {
  buildDeclarations,
  streamEntrySizes,
} from "../../../src/mdl/model/build-declarations";
import type { TTModel } from "../../../src/mdl/model/tt-model";

function oneVertModel(over: Partial<any> = {}): TTModel {
  const w = new Uint8Array(8);
  w[0] = 255; // hasWeights
  const v = {
    position: [0, 0, 0],
    normal: [0, 0, 0],
    binormal: [0, 0, 0],
    handedness: true,
    flowDirection: [0, 0, 0],
    vertexColor: [255, 255, 255, 255],
    vertexColor2: [0, 0, 0, 255],
    uv1: [0, 0],
    uv2: [0.5, 0],
    uv3: [0, 0],
    boneIds: new Uint8Array(8),
    weights: w,
    ...over,
  };
  return {
    source: "",
    mdlVersion: 6,
    attributes: [],
    bones: [],
    materials: [],
    shapeNames: [],
    anisotropicLighting: false,
    flags1: 0,
    meshGroups: [
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
            vertices: [v],
          },
        ],
      },
    ],
  } as unknown as TTModel;
}

describe("buildDeclarations", () => {
  it("emits Float-upgraded elements in canonical order with running offsets", () => {
    const decl = buildDeclarations(oneVertModel())[0]!; // maxUv=2 (uv2 set), no vColor2, 4 weights, no flow
    expect(decl).toEqual([
      { stream: 0, offset: 0, type: T.Float3, usage: U.Position, count: 0 },
      { stream: 0, offset: 12, type: T.Ubyte4n, usage: U.BoneWeight, count: 0 },
      { stream: 0, offset: 16, type: T.Ubyte4, usage: U.BoneIndex, count: 0 },
      { stream: 1, offset: 0, type: T.Float3, usage: U.Normal, count: 0 },
      { stream: 1, offset: 12, type: T.Ubyte4n, usage: U.Binormal, count: 0 },
      { stream: 1, offset: 16, type: T.Ubyte4n, usage: U.Color, count: 0 },
      {
        stream: 1,
        offset: 20,
        type: T.Float4,
        usage: U.TextureCoordinate,
        count: 0,
      },
    ]);
    expect(streamEntrySizes(decl)).toEqual([20, 36, 0]);
  });

  it("adds vColor2, a second UV, and 8-wide weights when usage demands", () => {
    const w = new Uint8Array(8);
    w[5] = 10; // slot >=4 -> needsEightWeights
    const decl = buildDeclarations(
      oneVertModel({
        weights: w,
        vertexColor2: [1, 0, 0, 255],
        uv3: [0, 0.2],
      }),
    )[0]!; // maxUv=3, vColor2, 8 weights
    expect(decl.map((e) => [e.usage, e.type, e.count])).toEqual([
      [U.Position, T.Float3, 0],
      [U.BoneWeight, T.UByte8, 0],
      [U.BoneIndex, T.UByte8, 0],
      [U.Normal, T.Float3, 0],
      [U.Binormal, T.Ubyte4n, 0],
      [U.Color, T.Ubyte4n, 0],
      [U.Color, T.Ubyte4n, 1],
      [U.TextureCoordinate, T.Float4, 0],
      [U.TextureCoordinate, T.Float2, 1],
    ]);
  });
});
