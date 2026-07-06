import { describe, expect, it } from "vitest";
import {
  emptyVertexData,
  transpose,
} from "../../../src/mdl/geometry/vertex-data";

describe("transpose (identity SoA -> AoS)", () => {
  it("copies each vertex straight across, quantizing weights to bytes", () => {
    const vd = emptyVertexData();
    vd.positions.push([1, 2, 3], [4, 5, 6]);
    vd.normals.push([0, 1, 0], [1, 0, 0]);
    vd.biNormals.push([1, 0, 0], [0, 1, 0]);
    vd.biNormalHandedness.push(255, 0);
    vd.colors.push([10, 20, 30, 40], [50, 60, 70, 80]);
    vd.textureCoordinates0.push([0.25, 0.5], [0.75, 1]);
    vd.boneWeights.push([1, 0, 0, 0], [128 / 255, 127 / 255, 0, 0]);
    vd.boneIndices.push([3, 0, 0, 0], [5, 9, 0, 0]);

    const verts = transpose(vd);
    expect(verts).toHaveLength(2);
    expect(verts[0]!.position).toEqual([1, 2, 3]);
    expect(verts[0]!.handedness).toBe(true); // 255 -> true
    expect(verts[1]!.handedness).toBe(false); // 0 -> false
    expect(verts[0]!.vertexColor).toEqual([10, 20, 30, 40]);
    expect(verts[0]!.uv1).toEqual([0.25, 0.5]);
    expect(Array.from(verts[0]!.weights)).toEqual([255, 0, 0, 0, 0, 0, 0, 0]); // round(1*255)
    expect(Array.from(verts[1]!.weights.slice(0, 2))).toEqual([128, 127]);
    expect(Array.from(verts[1]!.boneIds.slice(0, 2))).toEqual([5, 9]);
  });

  it("fills defaults for absent usages", () => {
    const vd = emptyVertexData();
    vd.positions.push([1, 1, 1]);
    const [v] = transpose(vd);
    expect(v!.normal).toEqual([0, 0, 0]);
    expect(v!.vertexColor).toEqual([255, 255, 255, 255]);
    expect(v!.vertexColor2).toEqual([0, 0, 0, 255]);
    expect(Array.from(v!.weights)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
