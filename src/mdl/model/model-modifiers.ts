// Ported from xivModdingFramework Models/Helpers/ModelModifiers.cs: MergeGeometryData
// (:376-576), MergeAttributeData (:578-623), MergeMaterialData (:626-655), MergeShapeData
// (:658-846), ClearShapeData (:848-860), MergeFlags (:2284-2295). FixUpSkinReferences
// (:2309) is a deferred stub (see its doc comment below) -- "split, don't blend".

import type {
  Rgba,
  TtVertex,
  Vec2,
  Vec3,
  VertexData,
} from "../geometry/vertex-data";
import type { ReadMdl, ReadMesh } from "./read-model";
import { resolveShapeLod0Parts } from "./shape-data";
import {
  getPartRelevantVertexInformation,
  type TTMeshGroup,
  type TTMeshPart,
  type TTModel,
  type TTShapePart,
} from "./tt-model";

/** HasBonelessParts (EMeshFlags2, ModelModifiers.cs:416). */
const HAS_BONELESS_PARTS = 0x01;

/** Per-vertex SoA -> AoS copy used by the weld (ModelModifiers.cs:450-558). Differs from
 *  vertex-data.ts's `transpose` in exactly the ways the weld needs: UV2/UV3 NaN clamp
 *  (505-529) and the bone weight/id copy that skips null (zero) weights (532-554). */
function buildTtVertex(vd: VertexData, oldVertexId: number): TtVertex {
  const uv2Raw = vd.textureCoordinates1[oldVertexId] ?? [0, 0];
  const uv2: Vec2 = [
    Number.isNaN(uv2Raw[0]) ? 0 : uv2Raw[0],
    Number.isNaN(uv2Raw[1]) ? 0 : uv2Raw[1],
  ];
  const uv3Raw = vd.textureCoordinates2[oldVertexId] ?? [0, 0];
  const uv3: Vec2 = [
    Number.isNaN(uv3Raw[0]) ? 0 : uv3Raw[0],
    Number.isNaN(uv3Raw[1]) ? 0 : uv3Raw[1],
  ];

  const weights = new Uint8Array(8);
  const boneIds = new Uint8Array(8);
  const w = vd.boneWeights[oldVertexId];
  const b = vd.boneIndices[oldVertexId];
  if (w !== undefined) {
    // ModelModifiers.cs:532-554: loop bound is the mesh's VertexBoneArraySize (4 or 8),
    // which is exactly how many entries decodeVertexData put in `w` for this vertex.
    const limit = Math.min(8, w.length);
    for (let k = 0; k < limit; k++) {
      // "No more weights for this vertex" (line 540) -> break, not continue.
      if (b === undefined || b.length <= k) break;
      // "Null weight for this bone" (line 543) -> continue, leaving the zero default.
      if (w[k] === 0) continue;
      boneIds[k] = b[k]!;
      weights[k] = Math.round(w[k]! * 255);
    }
  }

  return {
    position: vd.positions[oldVertexId] ?? [0, 0, 0],
    normal: vd.normals[oldVertexId] ?? [0, 0, 0],
    binormal: vd.biNormals[oldVertexId] ?? [0, 0, 0],
    // R2 proved binormals (hence handedness) are always present in practice; the ?? 0
    // keeps the C# TTVertex default of `false` if a source array were ever short.
    handedness: (vd.biNormalHandedness[oldVertexId] ?? 0) !== 0,
    flowDirection: vd.flowDirections[oldVertexId] ?? [0, 0, 0],
    vertexColor: vd.colors[oldVertexId] ?? [255, 255, 255, 255],
    vertexColor2: vd.colors2[oldVertexId] ?? [0, 0, 0, 255],
    uv1: vd.textureCoordinates0[oldVertexId] ?? [0, 0],
    uv2,
    uv3,
    weights,
    boneIds,
  };
}

/** De-duplicated bone list for one mesh's bone set (ModelModifiers.cs:396-409): the
 *  first-seen-order-preserving unique set of bone names named by `meshBoneSet`. */
function buildMeshBones(rm: ReadMdl, mesh: ReadMesh): string[] {
  const set = rm.meshBoneSets[mesh.boneSetIndex];
  if (set === undefined) return [];
  const seen = new Set<string>();
  const bones: string[] = [];
  for (const boneIndex of set) {
    const boneName = rm.pathData.boneList[boneIndex]!;
    if (!seen.has(boneName)) {
      seen.add(boneName);
      bones.push(boneName);
    }
  }
  return bones;
}

interface PartSpan {
  indexStart: number;
  indexCount: number;
}

/** Part spans for one mesh (ModelModifiers.cs:411-433): either the mesh's real parts, or
 *  (for boneless-part meshes with no mesh bone sets) one synthetic part over the whole mesh. */
function buildPartSpans(rm: ReadMdl, mesh: ReadMesh): PartSpan[] {
  const fakePart =
    (rm.flags2 & HAS_BONELESS_PARTS) === 0 && rm.meshBoneSets.length === 0;
  if (fakePart) {
    return [{ indexStart: 0, indexCount: mesh.indexCount }];
  }
  return mesh.parts.map((p) => ({
    indexStart: p.indexOffset - mesh.indexDataOffset,
    indexCount: p.indexCount,
  }));
}

/** Welds, sorts, dedupes and remaps one part's vertices/indices (ModelModifiers.cs:428-565). */
function buildMeshPart(
  mesh: ReadMesh,
  span: PartSpan,
  partIdx: number,
): TTMeshPart {
  const indices = mesh.vertices.indices.slice(
    span.indexStart,
    span.indexStart + span.indexCount,
  );

  // Ascending numeric sort: this ordering IS the new compact vertex order.
  const unique = [...new Set(indices)].sort((a, b) => a - b);

  const vertices: TtVertex[] = [];
  const vertMap: number[] = [];
  for (const oldVertexId of unique) {
    vertices.push(buildTtVertex(mesh.vertices, oldVertexId));
    vertMap[oldVertexId] = vertices.length - 1;
  }

  const triangleIndices = indices.map((oldVertexId) => vertMap[oldVertexId]!);

  return {
    name: `Part ${partIdx}`,
    vertices,
    triangleIndices,
    attributes: new Set(),
    shapeParts: new Map(),
  };
}

/** Port of ModelModifiers.MergeGeometryData (ModelModifiers.cs:376-576): rebuilds
 *  `model.meshGroups` from the LoD0 meshes of `rm`, welding each part's vertices to a
 *  unique-ascending-sorted, per-part-local vertex list with remapped triangle indices. */
export function mergeGeometryData(model: TTModel, rm: ReadMdl): void {
  model.meshGroups = [];

  rm.meshes.forEach((mesh, meshIdx) => {
    const group: TTMeshGroup = {
      name: `Group ${meshIdx}`,
      meshType: mesh.meshType,
      material: "",
      parts: [],
      bones: rm.meshBoneSets.length > 0 ? buildMeshBones(rm, mesh) : [],
    };

    const spans = buildPartSpans(rm, mesh);
    group.parts = spans.map((span, partIdx) =>
      buildMeshPart(mesh, span, partIdx),
    );

    model.meshGroups.push(group);
  });
}

/** Port of ModelModifiers.MergeAttributeData (ModelModifiers.cs:578-623): for each LoD0
 *  mesh/part, decode the part's attribute bitmask into `attributeList` names and add them
 *  to the matching `TTMeshPart.attributes`. Only loops meshes/parts that already exist on
 *  `model` (built by `mergeGeometryData`), mirroring the reference's bounds checks. */
export function mergeAttributeData(model: TTModel, rm: ReadMdl): void {
  const attributes = rm.pathData.attributeList;
  rm.meshes.forEach((mesh, mIdx) => {
    const localMesh = model.meshGroups[mIdx];
    if (localMesh === undefined) return;

    mesh.parts.forEach((part, pIdx) => {
      const localPart = localMesh.parts[pIdx];
      if (localPart === undefined) return;

      const mask = part.attributeMask >>> 0;
      for (let i = 0; i < 32; i++) {
        const bit = (1 << i) >>> 0;
        if ((mask & bit) === 0) continue;
        // Can't add attributes that don't exist (should never be hit, but sanity).
        if (i >= attributes.length) continue;
        localPart.attributes.add(attributes[i]!);
      }
    });
  });
}

/** Port of ModelModifiers.MergeMaterialData (ModelModifiers.cs:626-655): sets each LoD0
 *  mesh group's material from `materialList[materialIndex]`, falling back to
 *  `materialList[0]` when the index is out of range (read-model.ts already clamps this on
 *  read, so this is a belt-and-braces mirror of the reference, not the primary guard). */
export function mergeMaterialData(model: TTModel, rm: ReadMdl): void {
  rm.meshes.forEach((mesh, mIdx) => {
    const localMesh = model.meshGroups[mIdx];
    if (localMesh === undefined) return;

    const matIdx = mesh.materialIndex;
    localMesh.material =
      rm.pathData.materialList[matIdx] ?? rm.pathData.materialList[0] ?? "";
  });
}

/** Port of ModelModifiers.ClearShapeData (ModelModifiers.cs:848-860): drops every part's
 *  shapeParts. Used by fromRaw as the failure fallback around `mergeShapeData`, mirroring
 *  FromRaw's `try { MergeShapeData(...) } catch { ClearShapeData(...) }` (TTModel.cs:2711-2718). */
export function clearShapeData(model: TTModel): void {
  for (const g of model.meshGroups) {
    for (const p of g.parts) {
      p.shapeParts.clear();
    }
  }
}

/** Copies each shape vertex's binormal + handedness from the base part vertex it replaces
 *  (ModelModifiers.CopyShapeTangentsForPart, ModelModifiers.cs:2257-2270). This is the ONLY
 *  byte-affecting part of the otherwise-omitted CalculateTangents fast path (R2): base-vertex
 *  binormals are left untouched, but a shape vertex's own decoded binormal is discarded in
 *  favour of the base vertex's — so this must run for shape-bearing models. (Tangent is also
 *  copied in the reference but is never serialized, so it is not modelled here.) */
export function copyShapeBinormals(model: TTModel): void {
  for (const g of model.meshGroups) {
    for (const p of g.parts) {
      for (const sp of p.shapeParts.values()) {
        for (const [partIdx, shapeIdx] of sp.vertexReplacements) {
          const shpV = sp.vertices[shapeIdx];
          const baseV = p.vertices[partIdx];
          if (shpV && baseV) {
            shpV.binormal = baseV.binormal;
            shpV.handedness = baseV.handedness;
          }
        }
      }
    }
  }
}

/** Per-mesh, non-deduplicated old bone names indexed by raw bone id (ModelModifiers.cs:
 *  700-706): unlike `buildMeshBones` (which de-dupes for `TTMeshGroup.Bones`), shape vertex
 *  bone remap indexes this list directly by the vertex's raw per-mesh bone id, so it must
 *  preserve the meshBoneSet's exact order/duplicates. */
function buildRawMeshBoneNames(rm: ReadMdl, mesh: ReadMesh): string[] {
  const set = rm.meshBoneSets[mesh.boneSetIndex];
  if (set === undefined) return [];
  return set.map((boneIndex) => rm.pathData.boneList[boneIndex]!);
}

/** Builds one new shape TTVertex from the mesh's raw VertexData at `vId` (ModelModifiers.cs:
 *  746-786). Distinct from both `buildTtVertex` (the weld) and `transpose`: color/color2
 *  default to zero (not white/[0,0,0,255]) when the source array is short, UV3 is never set
 *  (left at the TTVertex default (0,0) -- the C# code has no UV3 assignment here at all,
 *  ported faithfully, not "fixed"), and the bone loop remaps old bone id -> old bone NAME ->
 *  new index in `group.bones` (appending to `group.bones` if the name isn't there yet). */
function buildShapeVertex(
  vd: VertexData,
  vId: number,
  oldBoneNames: string[],
  group: TTMeshGroup,
): TtVertex {
  const color: Rgba = vd.colors[vId] ?? [0, 0, 0, 0];
  const color2: Rgba = vd.colors2[vId] ?? [0, 0, 0, 0];

  const weights = new Uint8Array(8);
  const boneIds = new Uint8Array(8);
  // ModelModifiers.cs:768: unguarded `BoneWeights[vId]` -- a missing entry is a genuine
  // structural surprise in the source data, so this throws (propagates to fromRaw's
  // try/catch -> clearShapeData) rather than silently defaulting, mirroring the C# behavior.
  const w = vd.boneWeights[vId];
  if (w === undefined) {
    throw new Error(`mergeShapeData: vertex ${vId} has no bone weight entry`);
  }
  const b = vd.boneIndices[vId];
  for (let i = 0; i < w.length; i++) {
    if (i >= 8) {
      throw new Error(
        `mergeShapeData: vertex ${vId} has more than 8 bone weights`,
      );
    }
    const oldBoneId = b?.[i];
    if (oldBoneId === undefined) {
      throw new Error(`mergeShapeData: vertex ${vId} missing bone index ${i}`);
    }
    const boneName = oldBoneNames[oldBoneId];
    if (boneName === undefined) {
      throw new Error(
        `mergeShapeData: old bone id ${oldBoneId} out of range for the mesh's bone set`,
      );
    }
    let newBoneId = group.bones.indexOf(boneName);
    if (newBoneId < 0) {
      group.bones.push(boneName);
      newBoneId = group.bones.length - 1;
    }
    weights[i] = Math.round(w[i]! * 255);
    boneIds[i] = newBoneId;
  }

  return {
    position: vd.positions[vId] ?? [0, 0, 0],
    normal: vd.normals[vId] ?? [0, 0, 0],
    binormal: vd.biNormals[vId] ?? [0, 0, 0],
    handedness: (vd.biNormalHandedness[vId] ?? 0) !== 0,
    flowDirection: vd.flowDirections[vId] ?? [0, 0, 0],
    vertexColor: color,
    vertexColor2: color2,
    uv1: vd.textureCoordinates0[vId] ?? [0, 0],
    uv2: vd.textureCoordinates1[vId] ?? [0, 0],
    uv3: [0, 0],
    weights,
    boneIds,
  };
}

function cloneVertex(v: TtVertex): TtVertex {
  return {
    position: [...v.position] as Vec3,
    normal: [...v.normal] as Vec3,
    binormal: [...v.binormal] as Vec3,
    handedness: v.handedness,
    flowDirection: [...v.flowDirection] as Vec3,
    vertexColor: [...v.vertexColor] as Rgba,
    vertexColor2: [...v.vertexColor2] as Rgba,
    uv1: [...v.uv1] as Vec2,
    uv2: [...v.uv2] as Vec2,
    uv3: [...v.uv3] as Vec2,
    boneIds: v.boneIds.slice(),
    weights: v.weights.slice(),
  };
}

/** Port of ModelModifiers.MergeShapeData (ModelModifiers.cs:658-846): populates each
 *  `TTMeshPart.shapeParts` from the read shape data. LoD0 only. For every shape, for every
 *  mesh group: resolve which of the shape's parts belong to this mesh (see
 *  `resolveShapeLod0Parts`); for each such part, build the new shape vertices and an
 *  old-vertex-id -> shape-vertex-id replacement map (skipping -- "badPart" -- a shape part
 *  whose data references an out-of-range triangle index, ModelModifiers.cs:738-742); then
 *  attribute each replaced vertex to the TTMeshPart that owns it
 *  (`getPartRelevantVertexInformation`) and add/merge a `TTShapePart` there, seeding an
 *  "original" identity shapePart the first time any part gains shape data
 *  (ModelModifiers.cs:821-833).
 *
 *  Unexpected structural errors (e.g. a vertex missing bone-weight data, or a raw bone id
 *  with no name in the mesh's bone set) are allowed to throw, matching the C#'s unguarded
 *  array accesses in the same spots -- the caller (fromRaw) is responsible for the
 *  try/catch -> `clearShapeData` fallback (TTModel.cs:2711-2718), not this function. */
export function mergeShapeData(model: TTModel, rm: ReadMdl): void {
  if (rm.shapeData.info.length === 0) {
    return;
  }

  for (const info of rm.shapeData.info) {
    const name = info.name;
    const resolvedParts = resolveShapeLod0Parts(rm, info);

    for (let mIdx = 0; mIdx < model.meshGroups.length; mIdx++) {
      // "No shape data for groups that don't exist in the old model" (ModelModifiers.cs:709).
      if (mIdx >= rm.meshes.length) break;

      const mesh = rm.meshes[mIdx]!;
      const group = model.meshGroups[mIdx]!;
      const oldBoneNames = buildRawMeshBoneNames(rm, mesh);

      const shpParts = resolvedParts.filter((r) => r.meshNumber === mIdx);
      if (shpParts.length === 0) continue;

      for (const { part } of shpParts) {
        const data = rm.shapeData.data.slice(
          part.shapeDataOffset,
          part.shapeDataOffset + part.indexCount,
        );

        const vertices = new Map<number, TtVertex>();
        // Old (pre-weld, raw mesh) vertex id -> shape vertex id. Insertion-order-sensitive
        // (mirrors .NET Dictionary<int,int>), and `.Add` throws on a duplicate key in C# --
        // mirror that with an explicit throw rather than Map's silent overwrite.
        const vertexReplacements = new Map<number, number>();
        let badPart = false;

        for (const d of data) {
          const vId = d.shapeVertex;
          if (vertices.has(vId)) continue;

          if (d.baseIndex >= mesh.vertices.indices.length) {
            badPart = true;
            break;
          }
          const oldVertexId = mesh.vertices.indices[d.baseIndex]!;
          if (vertexReplacements.has(oldVertexId)) {
            throw new Error(
              `mergeShapeData: duplicate vertex replacement for old vertex ${oldVertexId}`,
            );
          }
          vertexReplacements.set(oldVertexId, vId);

          vertices.set(
            vId,
            buildShapeVertex(mesh.vertices, vId, oldBoneNames, group),
          );
        }

        if (badPart) continue;

        const shapePartsByPartId = new Map<number, TTShapePart>();
        for (const [oldVertexId, vId] of vertexReplacements) {
          const info2 = getPartRelevantVertexInformation(group, oldVertexId);
          let shp = shapePartsByPartId.get(info2.partId);
          if (shp === undefined) {
            shp = { name, vertices: [], vertexReplacements: new Map() };
            shapePartsByPartId.set(info2.partId, shp);
          }
          const newShapeVertexId = shp.vertices.length;
          shp.vertexReplacements.set(
            info2.partRelevantOffset,
            newShapeVertexId,
          );
          shp.vertices.push(vertices.get(vId)!);
        }

        for (const [partId, shp] of shapePartsByPartId) {
          if (partId === -1) continue;
          const ttPart = group.parts[partId]!;
          if (ttPart.shapeParts.size === 0) {
            // Guarantee we can always restore back to the original shape.
            const original: TTShapePart = {
              name: "original",
              vertices: ttPart.vertices.map(cloneVertex),
              vertexReplacements: new Map(
                ttPart.vertices.map((_, i) => [i, i] as [number, number]),
              ),
            };
            ttPart.shapeParts.set("original", original);
          }
          ttPart.shapeParts.set(shp.name, shp);
        }
      }
    }
  }
}

/** No-op — and byte-parity-correct as such. C# `ModelModifiers.FixUpSkinReferences`
 *  (ModelModifiers.cs:2309-2399) rewrites skin/hair material race codes, but in the `/upgrade`
 *  pipeline it never fires: `EndwalkerUpgrade.FixOldModel` (EndwalkerUpgrade.cs:194) builds the model
 *  via `Mdl.GetXivMdl(uncomp)` with no path, and `GetXivMdl(byte[], string mdlPath = "")` (Mdl.cs:349)
 *  defaults `MdlPath` to `""`. `TTModel.FromRaw` then calls `FixUpSkinReferences(ttModel, "")`, whose
 *  `(c[0-9]{4})` path regex fails to match `""` and returns immediately. So the fixup is inert
 *  throughout `/upgrade` and our no-op matches the golden byte-for-byte — there is no divergence to
 *  reproduce. (Audit 6-1 originally flagged this as a HIGH-severity silent divergence on the assumption
 *  that MdlPath carried the racial path here; that assumption was wrong. A full faithful port of
 *  GetSkinRace + the rewrite + hairFix was built and then reverted once the MdlPath="" quirk was
 *  confirmed — see git history, branch feat/skin-reference-fixup. Investigated & reverted 2026-07-09.) */
export function fixUpSkinReferences(
  _model: TTModel,
  _sourcePath: string,
): void {
  // Intentionally no-op: inert in /upgrade because FixOldModel passes MdlPath="" (see doc comment).
}

/** Port of ModelModifiers.MergeFlags (ModelModifiers.cs:2284-2295): anisotropic lighting is
 *  enabled iff any LoD0 mesh's vertex declaration carried a Flow usage (mirrored here by
 *  the presence of decoded flow-direction data); flags1 is copied verbatim. */
export function mergeFlags(model: TTModel, rm: ReadMdl): void {
  model.anisotropicLighting = rm.meshes.some(
    (mesh) => mesh.vertices.flowDirections.length > 0,
  );
  model.flags1 = rm.og.modelData.flags1;
}
