import { describe, expect, it } from "vitest";
import {
  emptyVertexData,
  type VertexData,
} from "../../../src/mdl/geometry/vertex-data";
import { mergeGeometryData } from "../../../src/mdl/model/model-modifiers";
import type { ReadMdl, ReadMesh } from "../../../src/mdl/model/read-model";
import type { TTModel } from "../../../src/mdl/model/tt-model";
import type { XivMdl } from "../../../src/mdl/types";

function vd5(indices: number[], uv2?: [number, number][]): VertexData {
  const v = emptyVertexData();
  for (let i = 0; i < 5; i++) v.positions.push([i, 0, 0]); // position.x === global id
  if (uv2) v.textureCoordinates1 = uv2;
  v.indices = indices;
  return v;
}
function emptyModel(): TTModel {
  return {
    source: "",
    mdlVersion: 6,
    meshGroups: [],
    attributes: [],
    bones: [],
    materials: [],
    shapeNames: [],
    anisotropicLighting: false,
    flags1: 0,
  };
}
function rmOf(mesh: Partial<ReadMesh>, over: Partial<ReadMdl> = {}): ReadMdl {
  const full: ReadMesh = {
    vertices: emptyVertexData(),
    vertexCount: 5,
    indexCount: 0,
    indexDataOffset: 0,
    materialIndex: 0,
    boneSetIndex: 0,
    meshType: 0,
    parts: [],
    ...mesh,
  };
  return {
    mdlVersion: 6,
    source: "",
    flags2: 0,
    meshes: [full],
    meshBoneSets: [[0, 1]], // non-empty -> not a fakePart
    pathData: {
      attributeList: [],
      boneList: ["a", "b"],
      materialList: ["m"],
      shapeList: [],
      extraPathList: [],
    },
    shapeData: { info: [], parts: [], data: [] },
    neckMorph: [],
    modelBoundingBoxes: [],
    og: {} as unknown as XivMdl, // opaque passthrough field, unused by these tests
    ...over,
  } as ReadMdl;
}

describe("mergeGeometryData weld", () => {
  it("welds each part to unique-ascending vertices with remapped indices", () => {
    const rm = rmOf({
      vertices: vd5([2, 4, 2, 0, 4, 2, 3, 1, 4]),
      indexCount: 9,
      parts: [
        { indexOffset: 0, indexCount: 6, attributeMask: 0 },
        { indexOffset: 6, indexCount: 3, attributeMask: 0 },
      ],
    });
    const m = emptyModel();
    mergeGeometryData(m, rm);
    const [g] = m.meshGroups;
    expect(g!.parts[0]!.vertices.map((v) => v.position[0])).toEqual([0, 2, 4]);
    expect(g!.parts[0]!.triangleIndices).toEqual([1, 2, 1, 0, 2, 1]);
    expect(g!.parts[1]!.vertices.map((v) => v.position[0])).toEqual([1, 3, 4]);
    expect(g!.parts[1]!.triangleIndices).toEqual([1, 0, 2]);
    expect(g!.bones).toEqual(["a", "b"]);
  });

  it("fakePart: no bone sets + no HasBonelessParts -> one part over the whole mesh", () => {
    const rm = rmOf(
      { vertices: vd5([0, 1, 2, 2, 3, 4]), indexCount: 6, parts: [] },
      { meshBoneSets: [], flags2: 0 }, // fakePart condition
    );
    const m = emptyModel();
    mergeGeometryData(m, rm);
    expect(m.meshGroups[0]!.parts.length).toBe(1);
    expect(
      m.meshGroups[0]!.parts[0]!.vertices.map((v) => v.position[0]),
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it("clamps NaN UV2 components to 0", () => {
    const uv2: [number, number][] = [
      [Number.NaN, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    const rm = rmOf({
      vertices: vd5([0, 1, 2], uv2),
      indexCount: 3,
      parts: [{ indexOffset: 0, indexCount: 3, attributeMask: 0 }],
    });
    const m = emptyModel();
    mergeGeometryData(m, rm);
    expect(m.meshGroups[0]!.parts[0]!.vertices[0]!.uv2).toEqual([0, 0]);
  });
});
