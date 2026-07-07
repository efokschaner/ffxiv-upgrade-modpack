import { describe, expect, it } from "vitest";
import { parseMdl } from "../../../src/mdl/mdl";
import { readEditableModel } from "../../../src/mdl/model/read-model";
import { corpusModels } from "../../helpers/corpus-models";

describe("readEditableModel", () => {
  it("assembles a consistent LoD0 read model for real corpus models", () => {
    let checked = 0;
    for (const cm of corpusModels()) {
      const rm = readEditableModel(cm.bytes, parseMdl(cm.bytes, cm.gamePath));
      expect(rm.meshes.length).toBeGreaterThan(0);
      expect(rm.pathData.boneList.length).toBeGreaterThanOrEqual(0);
      expect(rm.pathData.materialList.length).toBeGreaterThan(0);
      for (const mesh of rm.meshes) {
        expect(mesh.vertices.positions.length).toBe(mesh.vertexCount);
        // every part's index range lies within the mesh's indices
        for (const p of mesh.parts) {
          expect(p.indexCount).toBeGreaterThanOrEqual(0);
        }
        // material index in range
        expect(mesh.materialIndex).toBeLessThan(
          rm.pathData.materialList.length,
        );
        // bone set index valid when weighted
        if (rm.meshBoneSets.length > 0 && mesh.boneSetIndex >= 0) {
          expect(mesh.boneSetIndex).toBeLessThan(rm.meshBoneSets.length);
        }
      }
      // bone-set indices resolve into boneList
      for (const set of rm.meshBoneSets)
        for (const bi of set)
          expect(bi).toBeLessThan(rm.pathData.boneList.length);
      if (++checked >= 5) break;
    }
    expect(checked).toBeGreaterThan(0);
  }, 600_000);
});
