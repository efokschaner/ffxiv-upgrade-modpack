// TTModel container types + two TTModel members, ported from xivModdingFramework
// Models/TTModel.cs (container shape; GetUsageInfo :1308-1367; Getv6BoneSet :1373-1391) (GPL-3.0).
// Split, don't blend: this holds only the TTModel container + its own methods, no
// serializer/read logic (see src/mdl/geometry for the codec this builds on).

import type { Rgba, TtVertex, Vec2 } from "../geometry/vertex-data";

export interface TTMeshPart {
  name: string;
  vertices: TtVertex[];
  triangleIndices: number[];
  attributes: Set<string>;
}

export interface TTMeshGroup {
  name: string;
  meshType: number;
  parts: TTMeshPart[];
  material: string;
  bones: string[];
}

export interface TTModel {
  source: string;
  mdlVersion: number;
  meshGroups: TTMeshGroup[];
  attributes: string[];
  bones: string[];
  materials: string[];
  shapeNames: string[];
  anisotropicLighting: boolean;
  flags1: number;
}

export interface UsageInfo {
  usesVColor2: boolean;
  maxUv: number;
  needsEightWeights: boolean;
}

function isZeroVec2(v: Vec2): boolean {
  return v[0] === 0 && v[1] === 0;
}

function isDefaultVColor2(v: Rgba): boolean {
  return v[0] === 0 && v[1] === 0 && v[2] === 0 && v[3] === 255;
}

/** Port of TTModel.GetUsageInfo (TTModel.cs:1308-1367). */
export function getUsageInfo(m: TTModel): UsageInfo {
  let usesVColor2 = false;
  let maxUv = 1;
  let needsEightWeights = false;
  for (const group of m.meshGroups) {
    for (const part of group.parts) {
      for (const v of part.vertices) {
        if (!needsEightWeights) {
          for (let i = 4; i < 8; i++) {
            if (v.weights[i]! > 0 || v.boneIds[i]! > 0) {
              needsEightWeights = true;
              break;
            }
          }
        }
        if (maxUv < 2 && !isZeroVec2(v.uv2)) maxUv = 2;
        if (maxUv < 3 && !isZeroVec2(v.uv3)) maxUv = 3;
        if (!usesVColor2 && !isDefaultVColor2(v.vertexColor2)) {
          usesVColor2 = true;
        }
      }
    }
  }
  return { usesVColor2, maxUv, needsEightWeights };
}

/** True if any vertex in the model carries a nonzero bone weight. */
export function hasWeights(m: TTModel): boolean {
  for (const group of m.meshGroups) {
    for (const part of group.parts) {
      for (const v of part.vertices) {
        for (let i = 0; i < v.weights.length; i++) {
          if (v.weights[i]! > 0) return true;
        }
      }
    }
  }
  return false;
}

/** Port of TTModel.Getv6BoneSet (TTModel.cs:1373-1391): the group's bones packed
 *  as little-endian i16 indices into the model's bone list. Returns only the
 *  packed index bytes -- no header, no padding (block assembly is a later task). */
export function getV6BoneSet(m: TTModel, groupIndex: number): Uint8Array {
  const group = m.meshGroups[groupIndex]!;
  const out = new Uint8Array(group.bones.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < group.bones.length; i++) {
    const idx = m.bones.indexOf(group.bones[i]!);
    dv.setInt16(i * 2, idx, true);
  }
  return out;
}
