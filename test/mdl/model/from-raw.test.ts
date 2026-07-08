import { describe, expect, it } from "vitest";
import { parseMdl } from "../../../src/mdl/mdl";
import { fromRaw } from "../../../src/mdl/model/from-raw";
import { readEditableModel } from "../../../src/mdl/model/read-model";
import { shapeNames } from "../../../src/mdl/model/tt-model";
import { corpusModels } from "../../helpers/corpus-models";

describe("fromRaw", () => {
  it("builds a consistent TTModel from real corpus models", () => {
    let checked = 0;
    for (const cm of corpusModels()) {
      const m = fromRaw(
        readEditableModel(cm.bytes, parseMdl(cm.bytes, cm.gamePath)),
      );
      expect(m.meshGroups.length).toBeGreaterThan(0);
      expect(m.materials.length).toBeGreaterThan(0);
      // every triangle index is in range of its part's vertices
      for (const g of m.meshGroups) {
        for (const p of g.parts) {
          for (const ti of p.triangleIndices) {
            expect(ti).toBeLessThan(p.vertices.length);
          }
        }
      }
      // model.bones is sorted-unique
      const sorted = [...m.bones].sort((a, b) => a.localeCompare(b, "en-US"));
      expect(m.bones).toEqual(sorted);
      expect(new Set(m.bones).size).toBe(m.bones.length);
      // computeModelLists (shape-2) flips `shapeNames` on to match the ShapeNames getter.
      expect(m.shapeNames).toEqual(shapeNames(m));
      if (++checked >= 5) break;
    }
    expect(checked).toBeGreaterThan(0);
  }, 600_000);
});
