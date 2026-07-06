// Decoded-geometry containers. SoA VertexData mirrors xivModdingFramework's VertexData
// (MdlVertexReader output); AoS TtVertex mirrors TTVertex (WriteVertex input). The
// transpose is the identity seam sub-project B replaces with MergeGeometryData (GPL-3.0).

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Rgba = [number, number, number, number];

export interface VertexData {
  positions: Vec3[];
  normals: Vec3[];
  biNormals: Vec3[];
  biNormalHandedness: number[];
  flowDirections: Vec3[];
  flowHandedness: number[];
  colors: Rgba[];
  colors2: Rgba[];
  textureCoordinates0: Vec2[];
  textureCoordinates1: Vec2[];
  textureCoordinates2: Vec2[];
  boneWeights: number[][];
  boneIndices: number[][];
  indices: number[];
}

export function emptyVertexData(): VertexData {
  return {
    positions: [],
    normals: [],
    biNormals: [],
    biNormalHandedness: [],
    flowDirections: [],
    flowHandedness: [],
    colors: [],
    colors2: [],
    textureCoordinates0: [],
    textureCoordinates1: [],
    textureCoordinates2: [],
    boneWeights: [],
    boneIndices: [],
    indices: [],
  };
}

export interface TtVertex {
  position: Vec3;
  normal: Vec3;
  binormal: Vec3;
  handedness: boolean;
  flowDirection: Vec3;
  vertexColor: Rgba;
  vertexColor2: Rgba;
  uv1: Vec2;
  uv2: Vec2;
  uv3: Vec2;
  boneIds: Uint8Array; // length 8
  weights: Uint8Array; // length 8
}

/** Straight, order-preserving SoA -> AoS copy (TTVertex defaults for absent usages).
 *  Distinct from B's weld: no dedup/sort, no zero-weight skip, no UV NaN clamp. */
export function transpose(vd: VertexData): TtVertex[] {
  const n = vd.positions.length;
  const out: TtVertex[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const weights = new Uint8Array(8);
    const boneIds = new Uint8Array(8);
    const w = vd.boneWeights[i];
    const b = vd.boneIndices[i];
    if (w && b) {
      for (let k = 0; k < w.length && k < 8; k++) {
        weights[k] = Math.round(w[k]! * 255);
        boneIds[k] = b[k]!;
      }
    }
    out[i] = {
      position: vd.positions[i] ?? [0, 0, 0],
      normal: vd.normals[i] ?? [0, 0, 0],
      binormal: vd.biNormals[i] ?? [0, 0, 0],
      handedness:
        vd.biNormalHandedness[i] === undefined
          ? true
          : vd.biNormalHandedness[i] !== 0,
      flowDirection: vd.flowDirections[i] ?? [0, 0, 0],
      vertexColor: vd.colors[i] ?? [255, 255, 255, 255],
      vertexColor2: vd.colors2[i] ?? [0, 0, 0, 255],
      uv1: vd.textureCoordinates0[i] ?? [0, 0],
      uv2: vd.textureCoordinates1[i] ?? [0, 0],
      uv3: vd.textureCoordinates2[i] ?? [0, 0],
      weights,
      boneIds,
    };
  }
  return out;
}
