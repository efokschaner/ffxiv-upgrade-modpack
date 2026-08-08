// Port of TTModel.FromRaw (TTModel.cs:2695-2729). Builds the editable TTModel from a
// ReadMdl. TTModel.cs:2728 calls ModelModifiers.CalculateTangents (ModelModifiers.cs:1871-1912), a
// wrapper that dispatches CalculateTangentsForMesh (ModelModifiers.cs:2122-2273) per group; that
// per-group call is what we port below (see the call site for why the wrapper's extra gating is
// inert here). The fast path (mesh has binormals) leaves base binormals untouched and only copies
// them onto shape vertices; the full recompute (binormal-less mesh) writes Binormal + Handedness
// onto every welded base vertex. Tangent is never serialized and is omitted throughout.

import {
  calculateTangentsForMesh,
  clearShapeData,
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
  // TTModel.cs:2728 calls the wrapper ModelModifiers.CalculateTangents (ModelModifiers.cs:1871-1912),
  // which dispatches CalculateTangentsForMesh per group (ModelModifiers.cs:2122-2273) - that per-group
  // call is what we port below. The wrapper's extra steps are all inert on a fresh FromRaw model: its
  // ApplyShapes(model, [], true) no-ops because ActiveShapes is still the default empty set (:2459-2486);
  // AnyMissingTangentData is always true because Tangent is never populated here (see below), so the
  // wrapper never early-returns; and UVState is SE_Space (set at TTModel.cs:2726), so its guard never
  // throws. The fast path leaves base binormals untouched and copies them to shape vertices (byte-neutral
  // for base verts, R2); the full recompute writes Binormal/Handedness for a binormal-less mesh. Run per
  // group, matching the C# `foreach (m in MeshGroups)`.
  for (const group of model.meshGroups) calculateTangentsForMesh(group);
  computeModelLists(model);
  return model;
}
