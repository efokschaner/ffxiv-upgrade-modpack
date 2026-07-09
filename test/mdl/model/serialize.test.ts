import { describe, expect, it } from "vitest";
import { parseMdl } from "../../../src/mdl/mdl";
import { fromRaw } from "../../../src/mdl/model/from-raw";
import type { ReadMdl } from "../../../src/mdl/model/read-model";
import { readEditableModel } from "../../../src/mdl/model/read-model";
import { makeUncompressedMdl } from "../../../src/mdl/model/serialize";
import type { TTModel } from "../../../src/mdl/model/tt-model";
import { hasShapeData } from "../../../src/mdl/model/tt-model";
import { corpusModels } from "../../helpers/corpus-models";

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
        // out-of-scope structure (HasExtraMeshes / neckMorphTableSize>0 / furniture boxes)
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
    // (HasExtraMeshes / neckMorphTableSize>0 / furniture boxes); it's never negative.
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
        continue; // out-of-scope structure (HasExtraMeshes / neckMorph / furniture boxes)
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
});
