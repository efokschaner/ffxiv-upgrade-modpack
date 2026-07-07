// Ported from xivModdingFramework Models/Helpers/ModelModifiers.cs, MergeGeometryData
// (ModelModifiers.cs:376-576). This module mirrors ModelModifiers.cs; only the per-part
// vertex weld (MergeGeometryData) lives here for now -- the other merges (attribute/
// material/shape/flags) are a later task ("split, don't blend").

import type { TtVertex, Vec2, VertexData } from "../geometry/vertex-data";
import type { ReadMdl, ReadMesh } from "./read-model";
import type { TTMeshGroup, TTMeshPart, TTModel } from "./tt-model";

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
