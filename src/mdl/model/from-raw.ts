// Port of TTModel.FromRaw (TTModel.cs:2695-2729). Builds the editable TTModel from a
// ReadMdl. Tangent calculation (ModelModifiers.CalculateTangents, TTModel.cs:2728) is
// omitted -- the FromRaw fast path only writes the (unserialized) Tangent and leaves
// binormal/handedness untouched (R2, confirmed by the Task 3 corpus binormals scan), so it
// has no effect on output bytes.

import {
  clearShapeData,
  computeModelLists,
  fixUpSkinReferences,
  mergeAttributeData,
  mergeFlags,
  mergeGeometryData,
  mergeMaterialData,
  mergeShapeData,
} from "./model-modifiers";
import type { ReadMdl } from "./read-model";
import type { TTModel } from "./tt-model";

/** Builds and returns a fully-populated `TTModel` from a `ReadMdl` (TTModel.FromRaw,
 *  TTModel.cs:2695-2729). Order matters: geometry/attribute/material merges run before
 *  `computeModelLists`; `source`/`mdlVersion` are set before `fixUpSkinReferences`, which
 *  reads `model.source`. `mergeShapeData` is wrapped in try/catch -> `clearShapeData`,
 *  mirroring FromRaw's own try/catch around `MergeShapeData` (TTModel.cs:2711-2718): an
 *  unexpected structural problem in the shape data drops all shapeParts rather than failing
 *  the whole model load. Skin-reference fixup is a deferred no-op stub (see its doc comment
 *  in model-modifiers.ts). */
export function fromRaw(rm: ReadMdl): TTModel {
  const model: TTModel = {
    source: "",
    mdlVersion: 0,
    meshGroups: [],
    attributes: [],
    bones: [],
    materials: [],
    shapeNames: [],
    anisotropicLighting: false,
    flags1: 0,
  };
  mergeGeometryData(model, rm);
  mergeAttributeData(model, rm);
  mergeMaterialData(model, rm);
  try {
    mergeShapeData(model, rm);
  } catch {
    clearShapeData(model);
  }
  model.source = rm.source;
  model.mdlVersion = rm.mdlVersion;
  fixUpSkinReferences(model, rm.source); // deferred no-op
  mergeFlags(model, rm);
  // UVState = SE_Space (implicit).
  computeModelLists(model);
  return model;
}
