import { describe, expect, it } from "vitest";
import { VertexUsageType } from "../../../src/mdl/geometry/format";
import {
  parseGeometryLayout,
  parseMdl,
  parseVertexDeclarations,
} from "../../../src/mdl/mdl";
import { corpusModels } from "../../helpers/corpus-models";

describe("R2: every corpus LoD0 mesh carries binormals", () => {
  it("lets tangent computation be omitted (fast path leaves binormal untouched)", () => {
    let meshes = 0;
    for (const model of corpusModels()) {
      const mdl = parseMdl(model.bytes, model.gamePath);
      const layout = parseGeometryLayout(mdl);
      const decls = parseVertexDeclarations(
        mdl.vertexInfo,
        mdl.header.meshCount,
      );
      // LoD0 meshes = those with meshLod === 0.
      for (let m = 0; m < layout.meshes.length; m++) {
        if (layout.meshLod[m] !== 0) continue;
        if (layout.meshes[m]!.vertexCount === 0) continue;
        const hasBinormal = decls[m]!.some(
          (e) => e.usage === VertexUsageType.Binormal,
        );
        expect(
          hasBinormal,
          `${model.gamePath} mesh ${m} lacks a binormal`,
        ).toBe(true);
        meshes++;
      }
    }
    expect(meshes).toBeGreaterThan(0);
  }, 1_200_000);
});
