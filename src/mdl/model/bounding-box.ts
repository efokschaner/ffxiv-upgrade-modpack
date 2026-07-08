// Model bounding-box extents/radius/block, ported from xivModdingFramework
// Models/FileTypes/Mdl.cs MakeUncompressedMdlFile: extents/radius (Mdl.cs:2559-2587),
// bounding-box data block (Mdl.cs:3681-3746) (GPL-3.0). The per-bone cube helper
// re-derives reference commit b185e1e's buildRadiusBoundingBox. Split, don't blend:
// furniture-part boxes (Mdl.cs:3748+) are out of scope here -- a later task fails
// loud when they would be required.

import { ByteBuilder, concatBytes } from "../../util/binary";
import type { Vec3 } from "../geometry/vertex-data";
import type { TTModel } from "./tt-model";

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

/** Port of the bounding-box data block (Mdl.cs:3681-3746): box[0] BoundingBox
 *  (origin-clamped), box[1] ModelBoundingBox (real extent), box[2] Water
 *  (zero), box[3] Fog (zero), then one per-bone radius cube per model bone.
 *  Furniture-part boxes are out of scope -- not emitted here. */
export function buildBoundingBoxBlock(
  m: TTModel,
  radius: number,
  min: Vec3,
  max: Vec3,
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
  return concatBytes(parts);
}
