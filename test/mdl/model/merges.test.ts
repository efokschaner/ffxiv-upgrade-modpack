import { describe, expect, it } from "vitest";
import {
  emptyVertexData,
  type VertexData,
} from "../../../src/mdl/geometry/vertex-data";
import {
  compareStrings,
  computeModelLists,
  mergeAttributeData,
  mergeFlags,
  mergeGeometryData,
  mergeMaterialData,
} from "../../../src/mdl/model/model-modifiers";
import type { ReadMdl, ReadMesh } from "../../../src/mdl/model/read-model";
import type { TTModel } from "../../../src/mdl/model/tt-model";

function vd5(indices: number[]): VertexData {
  const v = emptyVertexData();
  for (let i = 0; i < 5; i++) v.positions.push([i, 0, 0]);
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
function rmOf(
  meshes: Partial<ReadMesh>[],
  over: Partial<ReadMdl> = {},
): ReadMdl {
  const full: ReadMesh[] = meshes.map((mesh) => ({
    vertices: emptyVertexData(),
    vertexCount: 5,
    indexCount: 0,
    indexDataOffset: 0,
    materialIndex: 0,
    boneSetIndex: 0,
    meshType: 0,
    parts: [],
    ...mesh,
  }));
  return {
    mdlVersion: 6,
    source: "",
    flags2: 0,
    meshes: full,
    meshBoneSets: [[0, 1]],
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
    // biome-ignore lint/suspicious/noExplicitAny: test fixture stub for the opaque passthrough field
    og: {} as any,
    ...over,
  } as ReadMdl;
}

describe("mergeAttributeData", () => {
  it("adds attributeList[i] for each set bit in the part's attributeMask", () => {
    const rm = rmOf(
      [
        {
          vertices: vd5([0, 1, 2]),
          indexCount: 3,
          parts: [{ indexOffset: 0, indexCount: 3, attributeMask: 0b101 }],
        },
      ],
      {
        pathData: {
          attributeList: ["atr_one", "atr_two", "atr_three"],
          boneList: ["a", "b"],
          materialList: ["m"],
          shapeList: [],
          extraPathList: [],
        },
      },
    );
    const m = emptyModel();
    mergeGeometryData(m, rm);
    mergeAttributeData(m, rm);
    expect([...m.meshGroups[0]!.parts[0]!.attributes].sort()).toEqual([
      "atr_one",
      "atr_three",
    ]);
  });

  it("ignores bits beyond attributeList.length (sanity guard)", () => {
    const rm = rmOf([
      {
        vertices: vd5([0, 1, 2]),
        indexCount: 3,
        parts: [{ indexOffset: 0, indexCount: 3, attributeMask: 0b10 }],
      },
    ]);
    const m = emptyModel();
    mergeGeometryData(m, rm);
    mergeAttributeData(m, rm);
    expect(m.meshGroups[0]!.parts[0]!.attributes.size).toBe(0);
  });
});

describe("mergeMaterialData", () => {
  it("sets group.material from materialList[materialIndex]", () => {
    const rm = rmOf(
      [
        { vertices: vd5([0, 1, 2]), indexCount: 3, materialIndex: 1 },
        { vertices: vd5([0, 1, 2]), indexCount: 3, materialIndex: 0 },
      ],
      {
        pathData: {
          attributeList: [],
          boneList: ["a", "b"],
          materialList: ["mat_a", "mat_b"],
          shapeList: [],
          extraPathList: [],
        },
      },
    );
    const m = emptyModel();
    mergeGeometryData(m, rm);
    mergeMaterialData(m, rm);
    expect(m.meshGroups[0]!.material).toBe("mat_b");
    expect(m.meshGroups[1]!.material).toBe("mat_a");
  });

  it("falls back to materialList[0] for an out-of-range materialIndex", () => {
    const rm = rmOf(
      [{ vertices: vd5([0, 1, 2]), indexCount: 3, materialIndex: 5 }],
      {
        pathData: {
          attributeList: [],
          boneList: ["a", "b"],
          materialList: ["mat_a"],
          shapeList: [],
          extraPathList: [],
        },
      },
    );
    const m = emptyModel();
    mergeGeometryData(m, rm);
    mergeMaterialData(m, rm);
    expect(m.meshGroups[0]!.material).toBe("mat_a");
  });

  it("computeModelLists produces sorted-unique materials/attributes/bones", () => {
    const rm = rmOf(
      [
        {
          vertices: vd5([0, 1, 2]),
          indexCount: 3,
          materialIndex: 1,
          parts: [{ indexOffset: 0, indexCount: 3, attributeMask: 0b1 }],
        },
        {
          vertices: vd5([0, 1, 2]),
          indexCount: 3,
          materialIndex: 0,
          parts: [{ indexOffset: 0, indexCount: 3, attributeMask: 0b1 }],
        },
      ],
      {
        pathData: {
          attributeList: ["atr_z"],
          boneList: ["zeta", "alpha"],
          materialList: ["mat_z", "mat_a"],
          shapeList: [],
          extraPathList: [],
        },
        meshBoneSets: [[0, 1]],
      },
    );
    const m = emptyModel();
    mergeGeometryData(m, rm);
    mergeAttributeData(m, rm);
    mergeMaterialData(m, rm);
    computeModelLists(m);
    expect(m.materials).toEqual(["mat_a", "mat_z"]);
    expect(m.attributes).toEqual(["atr_z"]);
    expect(m.bones).toEqual(["alpha", "zeta"]);
    expect(m.shapeNames).toEqual([]);
  });
});

describe("mergeFlags", () => {
  it("sets anisotropicLighting true iff some mesh has flowDirections, and copies flags1", () => {
    const withFlow = emptyVertexData();
    withFlow.positions.push([0, 0, 0]);
    withFlow.flowDirections.push([1, 0, 0]);
    withFlow.indices = [0];

    const rm = rmOf(
      [
        { vertices: emptyVertexData(), indexCount: 0 },
        { vertices: withFlow, indexCount: 1 },
      ],
      {
        og: { modelData: { flags1: 42 } } as unknown as ReadMdl["og"],
      },
    );
    const m = emptyModel();
    mergeFlags(m, rm);
    expect(m.anisotropicLighting).toBe(true);
    expect(m.flags1).toBe(42);
  });

  it("sets anisotropicLighting false when no mesh has flowDirections", () => {
    const rm = rmOf([{ vertices: emptyVertexData(), indexCount: 0 }], {
      og: { modelData: { flags1: 0 } } as unknown as ReadMdl["og"],
    });
    const m = emptyModel();
    mergeFlags(m, rm);
    expect(m.anisotropicLighting).toBe(false);
    expect(m.flags1).toBe(0);
  });
});

describe("compareStrings", () => {
  it("orders ASCII identifiers via en-US locale compare", () => {
    const values = ["b", "A", "a", "B"];
    expect([...values].sort(compareStrings)).toEqual(
      [...values].sort((a, b) => a.localeCompare(b, "en-US")),
    );
  });
});
