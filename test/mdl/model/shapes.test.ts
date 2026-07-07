import { describe, expect, it } from "vitest";
import { parseMdl } from "../../../src/mdl/mdl";
import { fromRaw } from "../../../src/mdl/model/from-raw";
import {
  mergeGeometryData,
  mergeShapeData,
} from "../../../src/mdl/model/model-modifiers";
import type { ReadMdl, ReadMesh } from "../../../src/mdl/model/read-model";
import { readEditableModel } from "../../../src/mdl/model/read-model";
import {
  hasShapeData,
  shapeNames,
  type TTModel,
} from "../../../src/mdl/model/tt-model";
import type { XivMdl } from "../../../src/mdl/types";
import { corpusModels } from "../../helpers/corpus-models";

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

/** One mesh, one part covering both real vertices, plus a 3rd vertex slot (index 2) in the
 *  same per-mesh VertexData used as the shape's replacement vertex -- mirrors how real .mdl
 *  files store shape vertices appended after the real ones in the same per-mesh buffer. */
function rmWithOneShape(): ReadMdl {
  const mesh: ReadMesh = {
    vertices: {
      positions: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      normals: [],
      biNormals: [],
      biNormalHandedness: [],
      flowDirections: [],
      flowHandedness: [],
      colors: [],
      colors2: [],
      textureCoordinates0: [],
      textureCoordinates1: [],
      textureCoordinates2: [],
      boneWeights: [[1], [1], [1]],
      boneIndices: [[0], [0], [0]],
      indices: [0, 1],
    },
    vertexCount: 3,
    indexCount: 2,
    indexDataOffset: 0,
    materialIndex: 0,
    boneSetIndex: 0,
    meshType: 0,
    parts: [{ indexOffset: 0, indexCount: 2, attributeMask: 0 }],
  };
  return {
    mdlVersion: 6,
    source: "",
    flags2: 0,
    meshes: [mesh],
    meshBoneSets: [[0]],
    pathData: {
      attributeList: [],
      boneList: ["boneA"],
      materialList: ["m"],
      shapeList: ["shp_test"],
      extraPathList: [],
    },
    shapeData: {
      info: [
        {
          name: "shp_test",
          lods: [
            { partOffset: 0, partCount: 1 },
            { partOffset: 0, partCount: 0 },
            { partOffset: 0, partCount: 0 },
          ],
        },
      ],
      parts: [{ meshIndexOffset: 0, indexCount: 1, shapeDataOffset: 0 }],
      data: [{ baseIndex: 0, shapeVertex: 2 }],
    },
    neckMorph: [],
    modelBoundingBoxes: [],
    og: {} as unknown as XivMdl, // opaque passthrough field, unused by these tests
  };
}

describe("mergeShapeData", () => {
  it("builds an 'original' + named shapePart with the correct vertex replacement", () => {
    const rm = rmWithOneShape();
    const m = emptyModel();
    mergeGeometryData(m, rm);
    mergeShapeData(m, rm);

    const part = m.meshGroups[0]!.parts[0]!;
    expect([...part.shapeParts.keys()]).toEqual(["original", "shp_test"]);

    const original = part.shapeParts.get("original")!;
    expect(original.vertices.map((v) => v.position[0])).toEqual([0, 1]);
    expect([...original.vertexReplacements]).toEqual([
      [0, 0],
      [1, 1],
    ]);

    const shp = part.shapeParts.get("shp_test")!;
    expect(shp.vertices).toHaveLength(1);
    expect(shp.vertices[0]!.position).toEqual([2, 0, 0]);
    expect(shp.vertices[0]!.boneIds[0]).toBe(0);
    expect(shp.vertices[0]!.weights[0]).toBe(255);
    // Part-local vertex 0 (the welded copy of old vertex 0) -> shape-part-local vertex 0.
    expect([...shp.vertexReplacements]).toEqual([[0, 0]]);
  });

  it("no-ops (no shapeParts) when the model carries no shape data", () => {
    const rm = rmWithOneShape();
    rm.shapeData = { info: [], parts: [], data: [] };
    const m = emptyModel();
    mergeGeometryData(m, rm);
    mergeShapeData(m, rm);
    expect(m.meshGroups[0]!.parts[0]!.shapeParts.size).toBe(0);
  });
});

describe("hasShapeData / shapeNames (corpus)", () => {
  // NOTE: not every model with `rm.shapeData.info.length > 0` ends up with populated
  // shapeParts -- some shapes have no LoD0 part at all (lods[0].partCount === 0), and at
  // least one real corpus asset (an Eliza hair model, "shp_hib") hits a genuine upstream
  // edge case: ModelModifiers.MergeShapeData keys `vertexReplacements` by *old vertex id*
  // (`Dictionary<int,int>`, ModelModifiers.cs:729,744), and this file has a raw vertex
  // referenced by two different index-buffer slots that the shape wants to send to two
  // different new vertices -- a genuine `Dictionary.Add` duplicate-key collision in the
  // reference algorithm, not a misread on our part (independently confirmed against the
  // *other* BaseIndex consumer, Mdl.cs:1136-1160, which bounds-checks/dedupes it the same
  // way). FromRaw's try/catch -> ClearShapeData means real TexTools would also silently
  // drop this file's shape data. So this test only requires that *some* shape-bearing
  // corpus models succeed, not all -- see shapes-1 report for the full writeup.
  it("are true/non-empty for corpus models whose shapes resolve at LoD0", () => {
    let scanned = 0;
    let successes = 0;
    for (const cm of corpusModels()) {
      const rm = readEditableModel(cm.bytes, parseMdl(cm.bytes, cm.gamePath));
      if (rm.shapeData.info.length === 0) continue;
      if (++scanned > 30) break;

      const model = fromRaw(rm);
      if (!hasShapeData(model)) continue;

      expect(shapeNames(model).length).toBeGreaterThan(0);
      // shape-2: computeModelLists now flips `model.shapeNames` on to match the getter.
      expect(model.shapeNames).toEqual(shapeNames(model));

      if (++successes >= 3) break;
    }
    expect(successes).toBeGreaterThan(0);
  }, 600_000);
});
