import { describe, expect, it } from "vitest";
import type {
  TtVertex,
  Vec2,
  Vec3,
} from "../../../src/mdl/geometry/vertex-data";
import { calculateTangentsForMesh } from "../../../src/mdl/model/model-modifiers";
import type { TTMeshGroup, TTMeshPart } from "../../../src/mdl/model/tt-model";

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

describe("calculateTangentsForMesh", () => {
  it("recomputes binormal + handedness for a binormal-less mesh", () => {
    const N: Vec3 = [0, 0, 1];
    const verts = [
      mkVert([0, 0, 0], [0, 0], N),
      mkVert([1, 0, 0], [1, 0], N),
      mkVert([0, 1, 0], [0, 1], N),
    ];
    const g = group(verts, [0, 1, 2]);
    calculateTangentsForMesh(g);
    for (const v of g.parts[0]!.vertices) {
      expect(v.binormal[0]).toBeCloseTo(0, 5);
      expect(v.binormal[1]).toBeCloseTo(-1, 5);
      expect(v.binormal[2]).toBeCloseTo(0, 5);
      expect(v.handedness).toBe(false);
    }
  });

  it("leaves binormals untouched when the mesh already has them (fast path)", () => {
    const N: Vec3 = [0, 0, 1];
    const B: Vec3 = [0.5, 0.5, 0.5];
    const verts = [
      { ...mkVert([0, 0, 0], [0, 0], N), binormal: [...B] as Vec3 },
      { ...mkVert([1, 0, 0], [1, 0], N), binormal: [...B] as Vec3 },
      { ...mkVert([0, 1, 0], [0, 1], N), binormal: [...B] as Vec3 },
    ];
    const g = group(verts, [0, 1, 2]);
    calculateTangentsForMesh(g);
    for (const v of g.parts[0]!.vertices) {
      expect(v.binormal).toEqual(B); // unchanged
    }
  });
});
