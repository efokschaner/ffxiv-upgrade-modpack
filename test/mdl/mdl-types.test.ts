import { describe, expect, it } from "vitest";
import {
  parseMdlModelData,
  serializeMdlModelData,
} from "../../src/mdl/model-data";
import {
  BOUNDING_BOX,
  LOD_HEADER,
  MDL_HEADER,
  MDL_MODEL_DATA,
  type MdlModelData,
  MESH_HEADER,
  VERTEX_DATA_HEADER,
} from "../../src/mdl/types";
import { BinaryReader } from "../../src/util/binary";

function distinctiveModelData(): MdlModelData {
  return {
    radius: 2.5,
    meshCount: 3,
    attributeCount: 4,
    meshPartCount: 5,
    materialCount: 6,
    boneCount: 7,
    boneSetCount: 8,
    shapeCount: 9,
    shapePartCount: 10,
    shapeDataCount: 11,
    lodCount: 1,
    flags1: 0x21,
    elementIdCount: 12,
    terrainShadowMeshCount: 2,
    flags2: 0x10,
    modelClipOutDistance: 100.5,
    shadowClipOutDistance: -3.25,
    furniturePartBoundingBoxCount: 13,
    terrainShadowPartCount: 14,
    flags3: 0x04,
    bgChangeMaterialIndex: 1,
    bgCrestChangeMaterialIndex: 2,
    neckMorphTableSize: 3,
    boneSetSize: 512,
    unknown13: 15,
    patch72TableSize: 16,
    unknown15: 17,
    unknown16: 18,
    unknown17: 19,
  };
}

describe("mdl layout constants", () => {
  it("has the reference layout sizes", () => {
    expect(MDL_HEADER).toBe(68);
    expect(VERTEX_DATA_HEADER).toBe(136);
    expect(LOD_HEADER).toBe(60);
    expect(MESH_HEADER).toBe(36);
    expect(BOUNDING_BOX).toBe(32);
    expect(MDL_MODEL_DATA).toBe(56);
  });
});

describe("MdlModelData codec", () => {
  it("serializes to exactly 56 bytes", () => {
    expect(serializeMdlModelData(distinctiveModelData())).toHaveLength(56);
  });

  it("Read and Write are exact inverses", () => {
    const md = distinctiveModelData();
    const bytes = serializeMdlModelData(md);
    const parsed = parseMdlModelData(new BinaryReader(bytes));
    expect(parsed).toEqual(md);
  });
});
