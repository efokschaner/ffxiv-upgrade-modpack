import { describe, expect, it } from "vitest";
import {
  emptyVertexData,
  type VertexData,
} from "../../../src/mdl/geometry/vertex-data";
import { confirmDocumentedDivergence } from "../../helpers/geometry-divergence";

// A realistic single-vertex VertexData: a Half4 Normal (W dropped by decode), a Ubyte4n Binormal
// with handedness, a Color, and a Half4 UV whose first component decodes to NaN (source stored a
// non-canonical NaN half like 0xFFFF). This is exactly the shape of the 3 corpus meshes that hit
// the documented divergence.
function baseVertex(): VertexData {
  const vd = emptyVertexData();
  vd.positions.push([1, 2, 3]);
  vd.normals.push([0.25, -0.5, 0.75]);
  vd.biNormals.push([-1, 0, 1]);
  vd.biNormalHandedness.push(62); // non-canonical source byte ∉ {0,255}
  vd.flowDirections.push([0, 0, 1]);
  vd.flowHandedness.push(255);
  vd.colors.push([10, 20, 30, 40]);
  vd.colors2.push([1, 2, 3, 4]);
  vd.textureCoordinates0.push([Number.NaN, 0.5]); // NaN-UV (both decodes yield NaN)
  vd.textureCoordinates1.push([0.1, 0.2]);
  vd.textureCoordinates2.push([0.3, 0.4]);
  vd.boneWeights.push([255, 0, 0, 0]);
  vd.boneIndices.push([1, 0, 0, 0]);
  vd.indices.push(0, 1, 2);
  return vd;
}

/** Structured clone of a VertexData (arrays of tuples), so a mutation to one is isolated. */
function clone(vd: VertexData): VertexData {
  return {
    positions: vd.positions.map((v) => [...v] as [number, number, number]),
    normals: vd.normals.map((v) => [...v] as [number, number, number]),
    biNormals: vd.biNormals.map((v) => [...v] as [number, number, number]),
    biNormalHandedness: [...vd.biNormalHandedness],
    flowDirections: vd.flowDirections.map(
      (v) => [...v] as [number, number, number],
    ),
    flowHandedness: [...vd.flowHandedness],
    colors: vd.colors.map((v) => [...v] as [number, number, number, number]),
    colors2: vd.colors2.map((v) => [...v] as [number, number, number, number]),
    textureCoordinates0: vd.textureCoordinates0.map(
      (v) => [...v] as [number, number],
    ),
    textureCoordinates1: vd.textureCoordinates1.map(
      (v) => [...v] as [number, number],
    ),
    textureCoordinates2: vd.textureCoordinates2.map(
      (v) => [...v] as [number, number],
    ),
    boneWeights: vd.boneWeights.map((v) => [...v]),
    boneIndices: vd.boneIndices.map((v) => [...v]),
    indices: [...vd.indices],
  };
}

describe("confirmDocumentedDivergence", () => {
  it("(a) identical VertexData → ok:true", () => {
    const src = baseVertex();
    const re = clone(src);
    expect(confirmDocumentedDivergence(src, re)).toEqual({ ok: true });
  });

  it("(b) differ ONLY in handedness + NaN-UV canonicalization → ok:true", () => {
    // Source: handedness 62 and a NaN UV (bit pattern irrelevant post-decode: it is NaN).
    // Re-decode: handedness canonicalized to 255, UV still decodes to NaN (canonical half NaN).
    // The NaN-aware UV equality + handedness-ignore are the whole point — both must be exercised.
    const src = baseVertex();
    const re = clone(src);
    re.biNormalHandedness[0] = 255; // canonicalized on re-encode; must be IGNORED
    re.textureCoordinates0[0] = [Number.NaN, 0.5]; // still NaN — NaN-aware equality must pass
    const verdict = confirmDocumentedDivergence(src, re);
    expect(verdict.ok).toBe(true);
    // Sanity: a plain strict compare of the UV would fail (NaN !== NaN), proving tolerance is real.
    expect(
      src.textureCoordinates0[0]![0] === re.textureCoordinates0[0]![0],
    ).toBe(false);
  });

  it("(c) differ in a real position component → ok:false with reason", () => {
    const src = baseVertex();
    const re = clone(src);
    re.positions[0] = [1, 2, 9]; // 3 → 9 is a genuine geometry corruption
    const verdict = confirmDocumentedDivergence(src, re);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("positions");
  });

  it("(d) differ in a color byte → ok:false", () => {
    const src = baseVertex();
    const re = clone(src);
    re.colors[0] = [10, 20, 30, 41]; // 40 → 41
    const verdict = confirmDocumentedDivergence(src, re);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("colors");
  });

  it("also catches a real UV divergence (not just NaN) → ok:false", () => {
    const src = baseVertex();
    const re = clone(src);
    re.textureCoordinates1[0] = [0.1, 0.9]; // 0.2 → 0.9 real UV change
    const verdict = confirmDocumentedDivergence(src, re);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("textureCoordinates1");
  });

  it("also catches a bone-index divergence → ok:false", () => {
    const src = baseVertex();
    const re = clone(src);
    re.boneIndices[0] = [2, 0, 0, 0]; // 1 → 2
    const verdict = confirmDocumentedDivergence(src, re);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("boneIndices");
  });
});
