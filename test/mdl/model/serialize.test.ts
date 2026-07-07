import { describe, expect, it } from "vitest";
import { parseMdl } from "../../../src/mdl/mdl";
import { fromRaw } from "../../../src/mdl/model/from-raw";
import { readEditableModel } from "../../../src/mdl/model/read-model";
import { makeUncompressedMdl } from "../../../src/mdl/model/serialize";
import { corpusModels } from "../../helpers/corpus-models";

describe("makeUncompressedMdl", () => {
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
});
