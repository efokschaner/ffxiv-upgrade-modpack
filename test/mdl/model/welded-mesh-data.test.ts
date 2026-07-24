import { describe, expect, it } from "vitest";
import type {
  TtVertex,
  Vec2,
  Vec3,
} from "../../../src/mdl/geometry/vertex-data";
import { getWeldedMeshData } from "../../../src/mdl/model/model-modifiers";
import type { TTMeshGroup, TTMeshPart } from "../../../src/mdl/model/tt-model";

/** Minimal TtVertex with only the fields the weld gate reads (position, uv1, normal) set;
 *  everything else at a harmless default. */
function mkVert(position: Vec3, uv1: Vec2, normal: Vec3): TtVertex {
  return {
    position,
    normal,
    binormal: [0, 0, 0],
    handedness: false,
    flowDirection: [0, 0, 0],
    vertexColor: [255, 255, 255, 255],
    vertexColor2: [0, 0, 0, 255],
    uv1,
    uv2: [0, 0],
    uv3: [0, 0],
    boneIds: new Uint8Array(8),
    weights: new Uint8Array(8),
  };
}

function group(vertices: TtVertex[], triangleIndices: number[]): TTMeshGroup {
  const part: TTMeshPart = {
    name: "Part 0",
    vertices,
    triangleIndices,
    attributes: new Set(),
    shapeParts: new Map(),
  };
  return {
    name: "Group 0",
    meshType: 0,
    material: "",
    parts: [part],
    bones: [],
  };
}

describe("getWeldedMeshData", () => {
  // Two triangles; verts 3 and 4 are value-identical to verts 0 and 1 (pos/uv/normal),
  // connected and non-mirror, so they weld. Vert 5 is distinct.
  it("welds value-identical connected vertices", () => {
    const N: Vec3 = [0, 0, 1];
    const verts = [
      mkVert([0, 0, 0], [0, 0], N), // 0
      mkVert([1, 0, 0], [1, 0], N), // 1
      mkVert([0, 1, 0], [0, 1], N), // 2
      mkVert([0, 0, 0], [0, 0], N), // 3 == 0
      mkVert([1, 0, 0], [1, 0], N), // 4 == 1
      mkVert([2, 2, 0], [2, 2], N), // 5 distinct
    ];
    const w = getWeldedMeshData(group(verts, [0, 1, 2, 3, 4, 5]));
    // 3 welds into 0, 4 welds into 1 -> 4 welded vertices.
    expect(w.vertexTable.length).toBe(4);
    // The entry that holds original vert 0 also holds vert 3.
    const entryWith0 = w.vertexTable.find((e) => e.includes(verts[0]!))!;
    expect(entryWith0).toContain(verts[3]);
    // Indices remapped: [0,1,2, 0,1,3].
    expect(w.indices).toEqual([0, 1, 2, 0, 1, 3]);
  });

  // Same geometry, but vert 4 shares vert 1's UV1 with a DIFFERENT position, making vert 3 a
  // mirror point of vert 0 (a connected neighbor pair with equal UV1, differing position).
  it("does not weld across a UV-seam mirror point", () => {
    const N: Vec3 = [0, 0, 1];
    const verts = [
      mkVert([0, 0, 0], [0, 0], N), // 0
      mkVert([1, 0, 0], [1, 0], N), // 1
      mkVert([0, 1, 0], [0, 1], N), // 2
      mkVert([0, 0, 0], [0, 0], N), // 3 == 0 by value
      mkVert([9, 9, 0], [1, 0], N), // 4: vert 1's UV1, different position -> mirror trigger
      mkVert([2, 2, 0], [2, 2], N), // 5 distinct
    ];
    const w = getWeldedMeshData(group(verts, [0, 1, 2, 3, 4, 5]));
    // Vert 3 must NOT weld into vert 0.
    const entryWith0 = w.vertexTable.find((e) => e.includes(verts[0]!))!;
    expect(entryWith0).not.toContain(verts[3]);
  });
});
