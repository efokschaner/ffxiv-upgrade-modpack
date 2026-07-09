// Ported from xivModdingFramework Models/DataContainers/ShapeData.cs.
// Split, don't blend: this holds ShapeData-owned logic only (the Mesh/Lod number
// assignment), consumed by ModelModifiers.MergeShapeData in model-modifiers.ts.

import type { ReadMdl, ReadShapeInfo, ReadShapePart } from "./read-model";

export interface ShapePartAssignment {
  part: ReadShapePart;
  meshNumber: number;
}

/** Port of ShapeData.AssignMeshAndLodNumbers (ShapeData.cs:52-91), restricted to LoD0 --
 *  the only LoD `MergeShapeData` consumes (ModelModifiers.cs:676, `lIdx = 0`). read-model.ts's
 *  `ReadShapePart` doesn't carry MeshNumber/LodLevel/ShapeName, so this recomputes the
 *  association: for each of a shape's LoD0 parts (sliced by `info.lods[0]`), find the mesh
 *  number by matching the part's `meshIndexOffset` against each LoD0 mesh's
 *  `indexDataOffset` -- LAST match wins (the C# loop has no `break` on match). */
export function resolveShapeLod0Parts(
  rm: ReadMdl,
  info: ReadShapeInfo,
): ShapePartAssignment[] {
  const lod0 = info.lods[0];
  if (lod0 === undefined) return [];
  const slice = rm.shapeData.parts.slice(
    lod0.partOffset,
    lod0.partOffset + lod0.partCount,
  );
  return slice.map((part) => {
    let meshNumber = -1;
    for (let m = 0; m < rm.meshes.length; m++) {
      if (rm.meshes[m]!.indexDataOffset === part.meshIndexOffset) {
        meshNumber = m; // no break: last matching mesh wins
      }
    }
    return { part, meshNumber };
  });
}
