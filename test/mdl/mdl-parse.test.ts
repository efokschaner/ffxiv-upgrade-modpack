import { describe, expect, it } from "vitest";
import { parseMdl } from "../../src/mdl/parse";
import { buildMinimalMdl } from "./make-mdl";

describe("parseMdl structural walk", () => {
  it("parses header + MdlModelData fields (v5)", () => {
    const mdl = parseMdl(buildMinimalMdl(5), "chara/x/model/test.mdl");
    expect(mdl.header.version).toBe(5);
    expect(mdl.header.meshCount).toBe(1);
    expect(mdl.header.modelDataSize).toBe(673);
    expect(mdl.modelData.boneCount).toBe(2);
    expect(mdl.modelData.boneSetCount).toBe(1);
    expect(mdl.modelData.boneSetSize).toBe(64);
    expect(mdl.modelData.radius).toBeCloseTo(1.5, 5);
    expect(mdl.filePath).toBe("chara/x/model/test.mdl");
  });

  it("slices each section at its computed length", () => {
    const mdl = parseMdl(buildMinimalMdl(5));
    const s = mdl.sections;
    expect(mdl.vertexInfo).toHaveLength(136);
    expect(s.pathData).toHaveLength(8);
    expect(s.elementIds).toHaveLength(32);
    expect(s.lodHeaders).toHaveLength(180);
    expect(s.extraMeshHeader).toHaveLength(0);
    expect(s.meshHeaders).toHaveLength(36);
    expect(s.attributeOffsets).toHaveLength(4);
    expect(s.terrainShadowMeshHeaders).toHaveLength(0);
    expect(s.meshParts).toHaveLength(16);
    expect(s.terrainShadowParts).toHaveLength(0);
    expect(s.materialOffsets).toHaveLength(4);
    expect(s.boneOffsets).toHaveLength(8);
    expect(s.boneSets).toHaveLength(132);
    expect(s.shapeInfo).toHaveLength(0);
    expect(s.partBoneSet).toHaveLength(4);
    expect(s.padding).toHaveLength(1);
    expect(s.boundingBoxes).toHaveLength(192);
    expect(s.trailing).toHaveLength(0);
    expect(mdl.geometry).toHaveLength(16);
  });

  it("parses a v6 file (version-agnostic bone-set slicing)", () => {
    const mdl = parseMdl(buildMinimalMdl(6));
    expect(mdl.header.version).toBe(6);
    expect(mdl.sections.boneSets).toHaveLength(132);
  });

  it("parses the 120-byte extra-mesh header when HAS_EXTRA_MESHES is set", () => {
    const mdl = parseMdl(buildMinimalMdl(6, true));
    expect(mdl.sections.extraMeshHeader).toHaveLength(120);
  });

  it("throws when the named sections OVERRUN modelDataSize", () => {
    const bytes = buildMinimalMdl(5);
    // Corrupt modelDataSize (u32 @8) DOWN so the real sections overrun the (too-small) block end.
    new DataView(bytes.buffer).setUint32(8, 100, true);
    expect(() => parseMdl(bytes)).toThrow(/overran modelDataSize/i);
  });

  it("captures a trailing gap opaquely (modelDataSize > named sections)", () => {
    // Splice a real 48-byte gap between the named model-data sections and the geometry tail (the
    // fixture's own geometry is only 16 B, too small to grow modelDataSize into), and bump
    // modelDataSize by 48 so the walk carries the gap as `trailing`.
    const base = buildMinimalMdl(5);
    const baseDv = new DataView(base.buffer);
    const modelDataStart = 68 + baseDv.getUint32(4, true);
    const modelDataEnd = modelDataStart + baseDv.getUint32(8, true);
    const gap = new Uint8Array(48).map((_, i) => (i * 3 + 5) & 0xff);
    const grown = new Uint8Array(base.length + 48);
    grown.set(base.subarray(0, modelDataEnd), 0);
    grown.set(gap, modelDataEnd);
    grown.set(base.subarray(modelDataEnd), modelDataEnd + 48);
    new DataView(grown.buffer).setUint32(
      8,
      baseDv.getUint32(8, true) + 48,
      true,
    );
    expect(parseMdl(grown).sections.trailing).toEqual(gap);
  });
});
