// Model bounding-box extents/radius/block, ported from xivModdingFramework
// Models/FileTypes/Mdl.cs MakeUncompressedMdlFile: extents/radius (Mdl.cs:2559-2587),
// bounding-box data block (Mdl.cs:3681-3772, including the boneless "furniture-part"
// boxes at 3751-3772). The per-bone cube helper re-derives reference commit b185e1e's
// buildRadiusBoundingBox. Split, don't blend: the per-part min/max scan itself is
// TTMeshPart.GetBoundingBox (partBoundingBox in tt-model.ts), reused here.

import { ByteBuilder, concatBytes } from "../../util/binary";
import type { Vec3 } from "../geometry/vertex-data";
import { partBoundingBox, type TTModel } from "./tt-model";

export interface ModelExtents {
  min: Vec3;
  max: Vec3;
  abs: Vec3;
}

/** Port of the extents/abs scan (Mdl.cs:2559-2583). */
export function computeExtents(m: TTModel): ModelExtents {
  const min: Vec3 = [9999, 9999, 9999];
  const max: Vec3 = [-9999, -9999, -9999];
  const abs: Vec3 = [0, 0, 0];
  for (const group of m.meshGroups) {
    for (const part of group.parts) {
      for (const v of part.vertices) {
        const p = v.position;
        for (let c = 0; c < 3; c++) {
          const x = p[c]!;
          min[c] = min[c]! < x ? min[c]! : x;
          max[c] = max[c]! > x ? max[c]! : x;
          const ax = Math.abs(x);
          abs[c] = abs[c]! < ax ? ax : abs[c]!;
        }
      }
    }
  }
  return { min, max, abs };
}

/** Port of `absVect.Length()` (Mdl.cs:2585-2587), float32 left-to-right
 *  accumulation to match C#/SharpDX single-precision Vector3.Length(). */
export function computeRadius(abs: Vec3): number {
  const sq = (x: number) => Math.fround(x * x);
  const s = Math.fround(Math.fround(sq(abs[0]) + sq(abs[1])) + sq(abs[2]));
  return Math.fround(Math.sqrt(s));
}

/** Port of the per-bone cube (Mdl.cs:3729-3746 / ref b185e1e's
 *  buildRadiusBoundingBox): 32 bytes, d = radius/20, [-d,-d,-d,1, d,d,d,1] f32 LE. */
export function buildRadiusBoundingBox(radius: number): Uint8Array {
  const d = radius / 20;
  return new ByteBuilder()
    .f32(-d)
    .f32(-d)
    .f32(-d)
    .f32(1)
    .f32(d)
    .f32(d)
    .f32(d)
    .f32(1)
    .toUint8Array();
}

/** Port of the bounding-box data block (Mdl.cs:3681-3772): box[0] BoundingBox
 *  (origin-clamped), box[1] ModelBoundingBox (real extent), box[2] Water
 *  (zero), box[3] Fog (zero), then one per-bone radius cube per model bone, then --
 *  when `useFurnitureBBs` (unweighted multi-part / boneless-part model, Mdl.cs:2552) --
 *  one box per part in mesh-group/part order (Mdl.cs:3751-3772), each the part's own
 *  min/max from partBoundingBox with w=1. */
export function buildBoundingBoxBlock(
  m: TTModel,
  radius: number,
  min: Vec3,
  max: Vec3,
  useFurnitureBBs: boolean,
): Uint8Array {
  const clampMin = (x: number) => (x > 0 ? 0 : x);
  const clampMax = (x: number) => (x < 0 ? 0 : x);
  const b = new ByteBuilder();
  // box[0]: BoundingBox, origin-clamped
  b.f32(clampMin(min[0]))
    .f32(clampMin(min[1]))
    .f32(clampMin(min[2]))
    .f32(1)
    .f32(clampMax(max[0]))
    .f32(clampMax(max[1]))
    .f32(clampMax(max[2]))
    .f32(1);
  // box[1]: ModelBoundingBox, unclamped
  b.f32(min[0]).f32(min[1]).f32(min[2]).f32(1);
  b.f32(max[0]).f32(max[1]).f32(max[2]).f32(1);
  // box[2]: Water (zero), box[3]: Fog (zero)
  b.bytes(new Uint8Array(32));
  b.bytes(new Uint8Array(32));
  const parts = [b.toUint8Array()];
  for (let i = 0; i < m.bones.length; i++) {
    parts.push(buildRadiusBoundingBox(radius));
  }
  // Mdl.cs:3751-3772: boneless "furniture-part" culling boxes, one per part in mesh-group
  // then part order, each 32 B: min.xyz + 1.0f, max.xyz + 1.0f.
  if (useFurnitureBBs) {
    const fb = new ByteBuilder();
    for (const group of m.meshGroups) {
      for (const part of group.parts) {
        const bb = partBoundingBox(part);
        fb.f32(bb.min[0]).f32(bb.min[1]).f32(bb.min[2]).f32(1);
        fb.f32(bb.max[0]).f32(bb.max[1]).f32(bb.max[2]).f32(1);
      }
    }
    parts.push(fb.toUint8Array());
  }
  return concatBytes(parts);
}
