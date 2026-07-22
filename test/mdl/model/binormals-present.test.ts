import { describe, expect, it } from "vitest";
import { VertexUsageType } from "../../../src/mdl/geometry/format";
import {
  parseGeometryLayout,
  parseMdl,
  parseVertexDeclarations,
} from "../../../src/mdl/mdl";
import { corpusModels } from "../../helpers/corpus-models";

/**
 * R2 — the corpus scan that justifies omitting ModelModifiers.CalculateTangents for base vertices
 * (`src/mdl/model/from-raw.ts`). CalculateTangentsForMesh (ModelModifiers.cs:2102-2138) branches on
 * whether the mesh has binormals: with them it takes the fast path, which writes only the
 * *unserialized* Tangent plus CopyShapeTangentsForPart (ported as `copyShapeBinormals`) — byte-neutral.
 * WITHOUT them it falls through to the full recompute (ModelModifiers.cs:2140-2253), which writes
 * Binormal and Handedness back onto every welded base vertex — byte-affecting, and unported.
 *
 * So this scan is the evidence that the unported branch is unreachable over the corpus. It is no
 * longer unanimous: the 2026-07-21 furniture corpus expansion added one counterexample, which is
 * listed below and tracked in docs/backlog/2026-07-21-unported-tangent-recompute.md. The test asserts
 * the exception set EXACTLY — a newly-added pack that lacks binormals anywhere else fails here, which
 * is the point: it means the unported branch just became reachable somewhere new.
 *
 * Scope note: this checks the vertex DECLARATION for a Binormal element, while the C# tests decoded
 * VALUES (`x.Binormal != Vector3.Zero`). No-element implies all-zero, so every mesh flagged here is a
 * true positive; a mesh that declares binormals but stores all zeros would take the unported branch
 * without being caught. That residual blind spot is recorded in the backlog item.
 */
const KNOWN_WITHOUT_BINORMALS = new Set([
  // SM-Cherry Blossom Upscale.ttmp2. Its /upgrade golden is a no-op, so no golden bytes exist that
  // could prove or disprove our output for it — the divergence is latent, not observed.
  "bgcommon/hou/outdoor/general/0112/bgparts/gar_b0_m0112.mdl mesh 0",
]);

describe("R2: corpus LoD0 meshes carry binormals, except the tracked exceptions", () => {
  it("keeps the unported tangent recompute unreachable (fast path leaves binormal untouched)", () => {
    let meshes = 0;
    const without: string[] = [];
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
        if (!hasBinormal) without.push(`${model.gamePath} mesh ${m}`);
        meshes++;
      }
    }
    // Subset, not equality: the corpus is gitignored and machine-local, so a clone that lacks the
    // pack carrying an exception must not fail. A mesh NOT in the set always fails.
    expect(without.filter((w) => !KNOWN_WITHOUT_BINORMALS.has(w))).toEqual([]);
    expect(meshes).toBeGreaterThan(0);
  }, 1_200_000);
});
