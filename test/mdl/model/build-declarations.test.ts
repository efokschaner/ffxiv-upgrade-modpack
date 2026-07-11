import { describe, expect, it } from "vitest";
import {
  VertexDataType as T,
  VertexUsageType as U,
} from "../../../src/mdl/geometry/format";
import type { TtVertex } from "../../../src/mdl/geometry/vertex-data";
import {
  buildDeclarations,
  streamEntrySizes,
} from "../../../src/mdl/model/build-declarations";
import type { TTModel } from "../../../src/mdl/model/tt-model";

function oneVertModel(over: Partial<TtVertex> = {}): TTModel {
  const w = new Uint8Array(8);
  w[0] = 255; // nonzero vertex weight (paired with the mesh-group bone list below)
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
    bones: ["j_root"],
    materials: [],
    shapeNames: [],
    anisotropicLighting: false,
    flags1: 0,
    meshGroups: [
      {
        name: "g",
        meshType: 0,
        material: "m",
        bones: ["j_root"], // hasWeights (TTModel.HasWeights keys off Bones.Count)
        parts: [
          {
            name: "p",
            attributes: new Set<string>(),
            triangleIndices: [],
            vertices: [v],
            shapeParts: new Map(),
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

  it("falls back to a Half-precision declaration (Flow omitted) when the estimate reaches 8MB", () => {
    // upgradePrecision=false path (Mdl.cs:2540-2543 / :2614-2711 / :2655). A shared vertex
    // object filled across a large array reports a big part.vertices.length without allocating
    // ~150k distinct vertices. maxUv=2 (uv2 set) + flow on -> perVertex ~60B; 200k verts
    // (~12MB) trips the >=8MB gate, so Position/Normal become Half4, texcoord Half4, and the
    // Flow element is dropped entirely even though anisotropicLighting is true.
    const m = oneVertModel();
    m.anisotropicLighting = true; // would add a Flow element on the Float path
    const v = m.meshGroups[0]!.parts[0]!.vertices[0]!;
    m.meshGroups[0]!.parts[0]!.vertices = new Array(200_000).fill(v);

    const decl = buildDeclarations(m)[0]!;
    expect(decl.map((e) => [e.usage, e.type, e.count])).toEqual([
      [U.Position, T.Half4, 0],
      [U.BoneWeight, T.Ubyte4n, 0],
      [U.BoneIndex, T.Ubyte4, 0],
      [U.Normal, T.Half4, 0],
      [U.Binormal, T.Ubyte4n, 0],
      [U.Color, T.Ubyte4n, 0],
      [U.TextureCoordinate, T.Half4, 0],
    ]);
    // Half strides: stream0 Half4(8)+Ubyte4n(4)+Ubyte4(4)=16; stream1 Half4(8)+Binormal Ubyte4n(4)
    // +Color Ubyte4n(4)+Texcoord Half4(8)=24 (Flow omitted, no vColor2).
    expect(streamEntrySizes(decl)).toEqual([16, 24, 0]);
  });

  it("counts shape-part vertices (excluding 'original') toward the 8MB gate", () => {
    // Mdl.cs:2536-2538: totalVertexCount = shapeVertCount + VertexCount, where shapeVertCount
    // sums every shapePart EXCEPT the "original" key. perVertex here (maxUv=2, no flow) = 56B.
    const under = oneVertModel(); // base 100k verts -> 5.6MB, below the 8MB gate
    const v = under.meshGroups[0]!.parts[0]!.vertices[0]!;
    const part = under.meshGroups[0]!.parts[0]!;
    part.vertices = new Array(100_000).fill(v);

    // (a) An "original" shapePart of 100k must NOT count: total stays 5.6MB -> Float.
    part.shapeParts = new Map([
      [
        "original",
        {
          name: "original",
          vertices: new Array(100_000).fill(v),
          vertexReplacements: new Map(),
        },
      ],
    ]);
    expect(buildDeclarations(under)[0]![0]!.type).toBe(T.Float3); // Position stays Float

    // (b) A non-"original" shapePart of 100k DOES count: total 200k*56B = 11.2MB -> Half.
    part.shapeParts.set("shp_a", {
      name: "shp_a",
      vertices: new Array(100_000).fill(v),
      vertexReplacements: new Map(),
    });
    expect(buildDeclarations(under)[0]![0]!.type).toBe(T.Half4); // Position flips to Half
  });
});
