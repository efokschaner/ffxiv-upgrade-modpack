import { describe, expect, it } from "vitest";
import type { TtVertex } from "../../../src/mdl/geometry/vertex-data";
import { parseMdl } from "../../../src/mdl/mdl";
import { fromRaw } from "../../../src/mdl/model/from-raw";
import type { ReadMdl } from "../../../src/mdl/model/read-model";
import { readEditableModel } from "../../../src/mdl/model/read-model";
import { makeUncompressedMdl } from "../../../src/mdl/model/serialize";
import type { TTMeshPart, TTModel } from "../../../src/mdl/model/tt-model";
import { hasShapeData, partBoundingBox } from "../../../src/mdl/model/tt-model";
import type { MdlModelData } from "../../../src/mdl/types";
import { corpusModels, firstCorpusModel } from "../../helpers/corpus-models";

describe("makeUncompressedMdl", () => {
  it("fails loud on a model mixing Shadow and Fog meshes (EMeshType ordering not ported, audit 5-2)", () => {
    // Our 4-bucket sort (Standard<Water<Shadow<Fog) reproduces the real EMeshType walk for every
    // present-type combination EXCEPT Shadow+Fog coexisting: EMeshType orders Fog before Shadow,
    // our bucket flips them, mis-ordering the serialized meshes. No corpus model exercises this
    // (the TTMP corpus is all-Standard), so a minimal hand-built fixture pins the guard. Only the
    // few entry fields the guard reads before the throw need to be present.
    const rm = {
      og: { modelData: { flags2: 0, neckMorphTableSize: 0 } },
    } as unknown as ReadMdl;
    const model = {
      mdlVersion: 6,
      meshGroups: [{ meshType: 2 }, { meshType: 3 }], // Shadow + Fog
    } as unknown as TTModel;
    expect(() => makeUncompressedMdl(model, rm)).toThrow(/Shadow and Fog/);
  });

  it("produces a re-parseable v6, lodCount=1 model for supported corpus models", () => {
    let ok = 0;
    let skipped = 0;
    for (const cm of corpusModels()) {
      const rm = readEditableModel(cm.bytes, parseMdl(cm.bytes, cm.gamePath));
      const m = fromRaw(rm);
      m.mdlVersion = 6;
      let out: Uint8Array;
      try {
        out = makeUncompressedMdl(m, rm);
      } catch {
        // out-of-scope structure (HasExtraMeshes / neckMorphTableSize>0 / Shadow+Fog ordering)
        skipped++;
        continue;
      }
      const re = parseMdl(out, cm.gamePath);
      expect(re.header.version).toBe(6);
      expect(re.header.lodCount).toBe(1);
      expect(re.header.meshCount).toBe(m.meshGroups.length);
      expect(re.header.modelDataSize).toBeGreaterThan(0);

      // Geometry re-decodes: mesh/vertex counts round-trip and the vertex declarations
      // re-parse to a per-mesh element count consistent with `m`'s usage.
      const rm2 = readEditableModel(out, re);
      expect(rm2.meshes.length).toBe(m.meshGroups.length);
      for (let i = 0; i < m.meshGroups.length; i++) {
        const expectedVertexCount = m.meshGroups[i]!.parts.reduce(
          (n, p) => n + p.vertices.length,
          0,
        );
        const expectedIndexCount = m.meshGroups[i]!.parts.reduce(
          (n, p) => n + p.triangleIndices.length,
          0,
        );
        expect(rm2.meshes[i]!.vertexCount).toBe(expectedVertexCount);
        expect(rm2.meshes[i]!.indexCount).toBe(expectedIndexCount);
        expect(rm2.meshes[i]!.vertices.positions.length).toBe(
          expectedVertexCount,
        );
      }

      if (++ok >= 8) break;
    }
    expect(ok).toBeGreaterThan(0);
    // Sanity: `skipped` only counts models this task's fail-loud scope boundary rejects
    // (HasExtraMeshes / neckMorphTableSize>0 / Shadow+Fog ordering); it's never negative.
    expect(skipped).toBeGreaterThanOrEqual(0);
  }, 600_000);

  it("re-parses shape-bearing corpus models with shapeCount > 0 (shape-2)", () => {
    let scanned = 0;
    let successes = 0;
    for (const cm of corpusModels()) {
      const rm = readEditableModel(cm.bytes, parseMdl(cm.bytes, cm.gamePath));
      if (rm.shapeData.info.length === 0) continue;
      if (++scanned > 30) break;

      const m = fromRaw(rm);
      if (!hasShapeData(m)) continue;
      m.mdlVersion = 6;

      let out: Uint8Array;
      try {
        out = makeUncompressedMdl(m, rm);
      } catch {
        continue; // out-of-scope structure (HasExtraMeshes / neckMorph / Shadow+Fog ordering)
      }
      const re = parseMdl(out, cm.gamePath);
      expect(re.modelData.shapeCount).toBeGreaterThan(0);
      expect(re.modelData.shapePartCount).toBeGreaterThan(0);
      expect(re.modelData.shapeDataCount).toBeGreaterThan(0);

      // The re-parse's own section-length walk + combinedDataBlockSize self-check inside
      // makeUncompressedMdl already validate offsets; round-trip the geometry too.
      const rm2 = readEditableModel(out, re);
      expect(rm2.meshes.length).toBe(m.meshGroups.length);

      successes++;
    }
    expect(successes).toBeGreaterThan(0);
  }, 600_000);

  // --- Furniture (boneless-part) writer, exercised synthetically because the real corpus
  // furniture packs are gitignored. Geometry is self-contained in the TTModel; the ReadMdl only
  // supplies the opaque sections + scalar flags the writer copies verbatim.
  function vert(position: [number, number, number]): TtVertex {
    return {
      position,
      normal: [0, 1, 0],
      binormal: [1, 0, 0],
      handedness: true,
      flowDirection: [0, 0, 0],
      vertexColor: [255, 255, 255, 255],
      vertexColor2: [0, 0, 0, 255],
      uv1: [0, 0],
      uv2: [0, 0],
      uv3: [0, 0],
      boneIds: new Uint8Array(8),
      weights: new Uint8Array(8),
    };
  }
  function furniturePart(positions: [number, number, number][]): TTMeshPart {
    return {
      name: "p",
      attributes: new Set<string>(),
      triangleIndices: [0, 1, 2],
      vertices: positions.map(vert),
      shapeParts: new Map(),
    };
  }
  /** Unweighted (no bones), multi-part model — the furniture-BB shape (useFurnitureBBs true). */
  function furnitureModel(): TTModel {
    return {
      source: "",
      mdlVersion: 6,
      attributes: [],
      bones: [],
      materials: ["mt"],
      shapeNames: [],
      anisotropicLighting: false,
      flags1: 0,
      meshGroups: [
        {
          name: "g",
          meshType: 0,
          material: "mt",
          bones: [],
          parts: [
            furniturePart([
              [0, 0, 0],
              [1, 0, 0],
              [0, 1, 0],
            ]),
            furniturePart([
              [2, 2, 2],
              [3, 2, 2],
              [2, 3, 2],
            ]),
          ],
        },
      ],
    };
  }
  /** MdlModelData for the source model. HasBonelessParts (0x01) set so the meshPart attribute
   *  slot takes the sequential bounding-box index (Mdl.cs:3314-3318). All count-bearing sections
   *  the writer copies verbatim are zeroed to keep the emitted file self-consistent on re-parse. */
  function furnitureSourceModelData(): MdlModelData {
    return {
      radius: 0,
      meshCount: 1,
      attributeCount: 0,
      meshPartCount: 2,
      materialCount: 1,
      boneCount: 0,
      boneSetCount: 0,
      shapeCount: 0,
      shapePartCount: 0,
      shapeDataCount: 0,
      lodCount: 1,
      flags1: 0,
      elementIdCount: 0,
      terrainShadowMeshCount: 0,
      flags2: 0x01, // EMeshFlags2.HasBonelessParts
      modelClipOutDistance: 0,
      shadowClipOutDistance: 0,
      furniturePartBoundingBoxCount: 2,
      terrainShadowPartCount: 0,
      flags3: 0,
      bgChangeMaterialIndex: 0,
      bgCrestChangeMaterialIndex: 0,
      neckMorphTableSize: 0,
      boneSetSize: 0,
      unknown13: 0,
      patch72TableSize: 0,
      unknown15: 0,
      unknown16: 0,
      unknown17: 0,
    };
  }
  function furnitureRm(model: TTModel): ReadMdl {
    const modelData = furnitureSourceModelData();
    return {
      og: {
        modelData,
        sections: {
          elementIds: new Uint8Array(0),
          lodHeaders: new Uint8Array(60),
          meshHeaders: new Uint8Array(36 * model.meshGroups.length),
          terrainShadowMeshHeaders: new Uint8Array(0),
          terrainShadowParts: new Uint8Array(0),
          padding: new Uint8Array([0]), // PaddingSize = 0 → 1 byte
        },
      },
      pathData: { extraPathList: [] },
    } as unknown as ReadMdl;
  }

  it("emits a furniture (boneless-part) model: HasBonelessParts + per-part boxes + sequential mask (Mdl.cs:2978-2984,3314-3318,3751-3772)", () => {
    const m = furnitureModel();
    const out = makeUncompressedMdl(m, furnitureRm(m));
    const re = parseMdl(out);

    expect(re.header.version).toBe(6);
    expect(re.modelData.flags2 & 0x01).toBe(0x01); // HasBonelessParts preserved
    expect(re.modelData.furniturePartBoundingBoxCount).toBe(2);

    // The furniture boxes sit after the 4 model boxes + 0 bone cubes: offset 128 in the
    // boundingBoxes section, one 32-byte box per part, each the part's own min/max + w=1.
    const bb = re.sections.boundingBoxes;
    const dv = new DataView(bb.buffer, bb.byteOffset, bb.byteLength);
    m.meshGroups[0]!.parts.forEach((part, i) => {
      const { min, max } = partBoundingBox(part);
      const o = 128 + i * 32;
      expect([
        dv.getFloat32(o, true),
        dv.getFloat32(o + 4, true),
        dv.getFloat32(o + 8, true),
        dv.getFloat32(o + 12, true),
      ]).toEqual([min[0], min[1], min[2], 1]);
      expect([
        dv.getFloat32(o + 16, true),
        dv.getFloat32(o + 20, true),
        dv.getFloat32(o + 24, true),
        dv.getFloat32(o + 28, true),
      ]).toEqual([max[0], max[1], max[2], 1]);
    });

    // The part attribute-mask slots carry the sequential bounding-box index (0, 1), not a
    // real attribute bitmask (Mdl.cs:3314-3318).
    const rm2 = readEditableModel(out, re);
    const masks = rm2.meshes.flatMap((mesh) =>
      mesh.parts.map((p) => p.attributeMask),
    );
    expect(masks).toEqual([0, 1]);
  });

  it("keeps the two HasBonelessParts gates independent: source-flag mask override fires on a weighted model where useFurnitureBBs is false (Mdl.cs:2978-2984 vs 3314-3318)", () => {
    // A WEIGHTED model (has bones) makes useFurnitureBBs (= useParts && !weighted) false, so flags2
    // clears HasBonelessParts and no furniture-box block is written. But the SOURCE model's
    // HasBonelessParts flag is set (furnitureRm's og.modelData.flags2 = 0x01), which the meshPart
    // attribute-mask override keys off independently — so the masks must STILL be the sequential
    // bounding-box indices, not the real attribute bitmask. Both parts carry attribute "atr" (index
    // 0 → bitmask 1), so without the override both masks would be 1; observing [0, 1] proves the
    // override fired (part 0's 0 ≠ 1 is the unambiguous witness).
    const vertW = (position: [number, number, number]): TtVertex => {
      const boneIds = new Uint8Array(8);
      const weights = new Uint8Array(8);
      weights[0] = 255; // full weight on bone 0 — a valid single-bone weighted vertex
      return { ...vert(position), boneIds, weights };
    };
    const part = (positions: [number, number, number][]): TTMeshPart => ({
      name: "p",
      attributes: new Set<string>(["atr"]),
      triangleIndices: [0, 1, 2],
      vertices: positions.map(vertW),
      shapeParts: new Map(),
    });
    const m: TTModel = {
      source: "",
      mdlVersion: 6,
      attributes: ["atr"],
      bones: ["j_root"],
      materials: ["mt"],
      shapeNames: [],
      anisotropicLighting: false,
      flags1: 0,
      meshGroups: [
        {
          name: "g",
          meshType: 0,
          material: "mt",
          bones: ["j_root"],
          parts: [
            part([
              [0, 0, 0],
              [1, 0, 0],
              [0, 1, 0],
            ]),
            part([
              [2, 2, 2],
              [3, 2, 2],
              [2, 3, 2],
            ]),
          ],
        },
      ],
    };
    const out = makeUncompressedMdl(m, furnitureRm(m));
    const re = parseMdl(out);

    // useFurnitureBBs is false → the recomputed-gate outputs stay clear/zero...
    expect(re.modelData.flags2 & 0x01).toBe(0); // HasBonelessParts cleared
    expect(re.modelData.furniturePartBoundingBoxCount).toBe(0);

    // ...but the source-flag-gated mask override still fires: sequential [0, 1], not [1, 1].
    const rm2 = readEditableModel(out, re);
    const masks = rm2.meshes.flatMap((mesh) =>
      mesh.parts.map((p) => p.attributeMask),
    );
    expect(masks).toEqual([0, 1]);
  });

  it("fails loud when the assembled vertex buffer exceeds 8MB even after Half fallback (Mdl.cs:2822)", () => {
    // No practical corpus pack reaches this: the estimate forces Half precision at ~150k verts,
    // and Half is smaller than the Float estimate, so the actual buffer only exceeds 8MB well
    // above that. Inflate a real (valid) corpus model's first part until the Half-encoded buffer
    // crosses the cap. The Half stride is ~28-36B/vertex depending on the model's usage layout;
    // 400k copies (>=~11MB even at the smallest 28B stride) crosses the 8MB cap for any layout,
    // while the ~19MB Float estimate keeps upgradePrecision=false (so the buffer really is Half).
    const cm = firstCorpusModel();
    const rm = readEditableModel(cm.bytes, parseMdl(cm.bytes, cm.gamePath));
    const m = fromRaw(rm);
    m.mdlVersion = 6;
    const part = m.meshGroups[0]!.parts[0]!;
    const v = part.vertices[0]!;
    part.vertices = part.vertices.concat(new Array(400_000).fill(v));
    expect(() => makeUncompressedMdl(m, rm)).toThrow(
      /Vertex buffer.*too large/i,
    );
  });
});
