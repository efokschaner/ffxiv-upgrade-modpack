// Port of TTModel.FromRaw (TTModel.cs:2695-2729). Builds the editable TTModel from a
// ReadMdl. Tangent calculation (ModelModifiers.CalculateTangents, TTModel.cs:2728) is
// omitted for BASE vertices -- the fast path only writes the (unserialized) Tangent and
// leaves base binormal/handedness untouched (R2, confirmed by the Task 3 corpus binormals
// scan). Its shape-vertex binormal/handedness copy IS byte-affecting, so that one piece is
// ported as copyShapeBinormals (run below).

import {
  clearShapeData,
  copyShapeBinormals,
  fixUpSkinReferences,
  mergeAttributeData,
  mergeFlags,
  mergeGeometryData,
  mergeMaterialData,
  mergeShapeData,
} from "./model-modifiers";
import type { ReadMdl } from "./read-model";
import { computeModelLists, type TTModel } from "./tt-model";

/** Builds and returns a fully-populated `TTModel` from a `ReadMdl` (TTModel.FromRaw,
 *  TTModel.cs:2695-2729). Order matters: geometry/attribute/material merges run before
 *  `computeModelLists`; `source`/`mdlVersion` are set before `fixUpSkinReferences`, which
 *  reads `model.source`. `mergeShapeData` is wrapped in try/catch -> `clearShapeData`,
 *  mirroring FromRaw's own try/catch around `MergeShapeData` (TTModel.cs:2711-2718): an
 *  unexpected structural problem in the shape data drops all shapeParts rather than failing
 *  the whole model load. Skin-reference fixup is a no-op that is byte-parity-correct here: the
 *  `/upgrade` path always feeds it an empty MdlPath, so C# no-ops too (see its doc comment in
 *  model-modifiers.ts). */
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
  fixUpSkinReferences(model, rm.source); // no-op: inert in /upgrade (MdlPath="", see model-modifiers)
  mergeFlags(model, rm);
  // UVState = SE_Space (implicit). CalculateTangents (TTModel.cs:2728) is omitted for base
  // vertices (no byte effect, R2), but its shape-vertex binormal/handedness copy IS byte-
  // affecting, so we run just that piece.
  copyShapeBinormals(model);
  computeModelLists(model);
  return model;
}
