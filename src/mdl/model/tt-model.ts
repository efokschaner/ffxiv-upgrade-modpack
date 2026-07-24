// TTModel container types + TTModel members, ported from xivModdingFramework
// Models/DataContainers/TTModel.cs (container shape; GetUsageInfo :1308-1367; Getv6BoneSet
// :1373-1391; TTShapePart :357-386; GetPartRelevantVertexInformation :514-534;
// GetMeshTypeOffset/GetMeshTypeCount :903-947; HasShapeData :953-959; ShapeNames :964-982;
// ShapePartCount :987-1007; ShapeDataCount :1012-1045; ShapePartCounts :1051-1074;
// Materials/Attributes/Bones getters :845-900; GetMaterialIndex :1419-1430;
// GetAttributeBitmask :1437-1462; GetRawShapeParts :1089-1245).
// Split, don't blend: this holds only the TTModel container + its own methods, no
// serializer/read logic (see src/mdl/geometry for the codec this builds on).

import type { Rgba, TtVertex, Vec2, Vec3 } from "../geometry/vertex-data";

/** Port of TTModel.cs TTShapePart (:357-386): one shape's contribution to a single
 *  TTMeshPart -- the new vertices it introduces, and which part-local vertex index each
 *  replaces. `vertexReplacements` is a `Map` (not a plain object) because insertion order
 *  matters: it must mirror .NET `Dictionary<int,int>` enumeration order (insertion order in
 *  practice), which `GetRawShapeParts`/serialization-order code depends on. */
export interface TTShapePart {
  name: string;
  vertices: TtVertex[];
  vertexReplacements: Map<number, number>;
}

export interface TTMeshPart {
  name: string;
  vertices: TtVertex[];
  triangleIndices: number[];
  attributes: Set<string>;
  shapeParts: Map<string, TTShapePart>;
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

/** Port of TTModel.HasWeights (TTModel.cs:1251-1264): true iff any mesh group carries bones.
 *  Keyed off Bones.Count, NOT a per-vertex weight scan — a group with a bone list but all-zero
 *  weights still counts as weighted (and so drives the weighted vertex declaration + bone tables in
 *  makeUncompressedMdl). For valid models the two predicates agree (weights reference bones); the
 *  bones-count form is the faithful one. */
export function hasWeights(m: TTModel): boolean {
  return m.meshGroups.some((group) => group.bones.length > 0);
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

/** Port of TTModel.GetMeshTypeOffset/GetMeshTypeCount (TTModel.cs:903-947) specialized to
 *  our 4-bucket meshType tag (0=Standard,1=Water,2=Shadow,3=Fog; read-model.ts's
 *  meshTypeOf). ASSUMPTION: after the stable sort in makeUncompressedMdl, groups of the same
 *  tag are contiguous, so offset(type) is simply the cumulative count of lower-tag-value
 *  groups. This matches the reference exactly for the common case (all-Standard, or a single
 *  extra type) but is not a faithful port of the reference's true EMeshType-ordinal walk
 *  (real ordinal order is Standard<Water<Fog<...<Shadow<TerrainShadow, which differs from
 *  our bucket order Standard<Water<Shadow<Fog). The only present-type combination that
 *  actually reorders is Shadow+Fog coexisting (EMeshType puts Fog first, our bucket puts
 *  Shadow first); makeUncompressedMdl now fails loud on that shape, so this helper is only
 *  ever reached on combinations where bucket order == EMeshType order. */
export function meshTypeCounts(groups: { meshType: number }[]): {
  offset: number[];
  count: number[];
} {
  const count = [0, 0, 0, 0];
  for (const g of groups) count[g.meshType] = (count[g.meshType] ?? 0) + 1;
  const offset = [
    0,
    count[0]!,
    count[0]! + count[1]!,
    count[0]! + count[1]! + count[2]!,
  ];
  return { offset, count };
}

// R8: .NET SortedSet<string>/List<string>.Sort use the culture-sensitive default comparer.
// For ASCII identifiers this usually matches en-US linguistic order. Centralized here (moved
// from model-modifiers.ts, which re-exports it) so every sorted-unique projection -- model
// lists and shape names alike -- uses the one comparator.
export function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, "en-US");
}

/** Port of TTModel.HasShapeData (TTModel.cs:953-959): true iff any part carries a
 *  "shp"-prefixed shapePart. */
export function hasShapeData(m: TTModel): boolean {
  return m.meshGroups.some((g) =>
    g.parts.some((p) =>
      [...p.shapeParts.keys()].some((k) => k.startsWith("shp")),
    ),
  );
}

/** Port of TTModel.ShapeNames (TTModel.cs:964-982): sorted-unique "shp"-prefixed
 *  shapePart keys across every part in the model. */
export function shapeNames(m: TTModel): string[] {
  const names = new Set<string>();
  for (const g of m.meshGroups) {
    for (const p of g.parts) {
      for (const key of p.shapeParts.keys()) {
        if (key.startsWith("shp")) names.add(key);
      }
    }
  }
  return [...names].sort(compareStrings);
}

/** Port of TTModel.ShapePartCount (TTModel.cs:987-1007): sum, over mesh groups, of the
 *  count of distinct "shp"-prefixed shape names used by that group's parts. */
export function shapePartCount(m: TTModel): number {
  let sum = 0;
  for (const g of m.meshGroups) {
    const names = new Set<string>();
    for (const p of g.parts) {
      for (const key of p.shapeParts.keys()) {
        if (key.startsWith("shp")) names.add(key);
      }
    }
    sum += names.size;
  }
  return sum;
}

/** Port of TTModel.ShapeDataCount (TTModel.cs:1012-1045): total (triangle index, shape)
 *  replacement pairs across the whole model. Throws if it would exceed a ushort. */
export function shapeDataCount(m: TTModel): number {
  let sum = 0;
  for (const g of m.meshGroups) {
    for (const p of g.parts) {
      for (const index of p.triangleIndices) {
        for (const [key, shp] of p.shapeParts) {
          if (!key.startsWith("shp")) continue;
          if (shp.vertexReplacements.has(index)) sum++;
        }
      }
    }
  }
  if (sum > 65535) {
    throw new Error(
      `Model exceeds the maximum possible shape data indices.\n\nCurrent: ${sum}\nMaximum: 65535`,
    );
  }
  return sum;
}

/** Port of TTModel.ShapePartCounts (TTModel.cs:1051-1074): per shape name (in
 *  `shapeNames` order), the count of mesh groups where any part carries that shape. */
export function shapePartCounts(m: TTModel): number[] {
  const names = shapeNames(m);
  return names.map(
    (name) =>
      m.meshGroups.filter((g) => g.parts.some((p) => p.shapeParts.has(name)))
        .length,
  );
}

/** Port of TTModel.GetMaterialIndex (TTModel.cs:1419-1430): the group's material's index
 *  into the model's material list. Preserves the reference's `index > 0 ? index : 0` quirk
 *  verbatim (note: `> 0`, not `>= 0`), which also folds a not-found `indexOf` of -1 to 0. */
export function getMaterialIndex(model: TTModel, group: TTMeshGroup): number {
  const matIdx = model.materials.indexOf(group.material);
  return matIdx > 0 ? matIdx : 0;
}

/** Port of TTModel.GetAttributeBitmask (TTModel.cs:1437-1462): the u32 bitmask of a part's
 *  attributes by their index into the model's attribute list. Includes the reference's
 *  >32-attribute fail-loud guard (TTModel.cs:1440-1443): the mask is a u32 and JS
 *  `1 << 32` wraps to bit 0, so throw rather than emit a wrong mask. */
export function getAttributeBitmask(model: TTModel, part: TTMeshPart): number {
  if (model.attributes.length > 32) {
    throw new Error("mdl: model cannot have more than 32 total attributes");
  }
  let attributeMask = 0;
  for (const attr of part.attributes) {
    const ai = model.attributes.indexOf(attr);
    if (ai >= 0) attributeMask |= (1 << ai) >>> 0;
  }
  return attributeMask;
}

/** Port of TTMeshPart.GetBoundingBox (TTModel.cs:304-328): the per-axis min/max over the
 *  part's own vertex positions. Seeds are the reference's literal 9999/-9999 (NOT ±Infinity),
 *  so a part with no vertices yields the inverted seed box verbatim -- reproduced faithfully
 *  because the furniture-BB write path (Mdl.cs:3751-3772) serializes whatever this returns. */
export function partBoundingBox(part: TTMeshPart): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [9999, 9999, 9999];
  const max: Vec3 = [-9999, -9999, -9999];
  for (const v of part.vertices) {
    const p = v.position;
    for (let c = 0; c < 3; c++) {
      const x = p[c]!;
      min[c] = min[c]! < x ? min[c]! : x;
      max[c] = max[c]! > x ? max[c]! : x;
    }
  }
  return { min, max };
}

/** Port of TTMeshGroup.GetPartRelevantVertexInformation (TTModel.cs:514-534): given a
 *  vertex id, walks `group.parts` in order accumulating vertex counts to find which part
 *  "owns" it and its offset within that part. NOTE (ported faithfully, not "fixed"): the
 *  caller passes the pre-weld/raw mesh vertex id here, not a post-weld part-local one --
 *  this only lines up because each part's welded vertex list is assumed to exactly cover a
 *  contiguous slice of the mesh's raw vertex id space, which holds for real FFXIV meshes. */
export function getPartRelevantVertexInformation(
  group: TTMeshGroup,
  vertexId: number,
): { partId: number; partRelevantOffset: number } {
  let verticesSoFar = 0;
  for (let pIdx = 0; pIdx < group.parts.length; pIdx++) {
    const count = group.parts[pIdx]!.vertices.length;
    if (vertexId >= verticesSoFar + count) {
      verticesSoFar += count;
      continue;
    }
    return { partId: pIdx, partRelevantOffset: vertexId - verticesSoFar };
  }
  return { partId: -1, partRelevantOffset: -1 };
}

function groupVertexCount(g: TTMeshGroup): number {
  return g.parts.reduce((sum, p) => sum + p.vertices.length, 0);
}

function groupIndexCount(g: TTMeshGroup): number {
  return g.parts.reduce((sum, p) => sum + p.triangleIndices.length, 0);
}

/** Port of TTMeshGroup.TriangleIndices (TTModel.cs:723-739): per-part triangle indices
 *  concatenated with each part's indices offset by the running vertex count -- i.e.
 *  mesh-relevant (not part-relevant) triangle indices. */
function groupTriangleIndices(g: TTMeshGroup): number[] {
  const indices: number[] = [];
  let vertCount = 0;
  for (const p of g.parts) {
    for (const idx of p.triangleIndices) indices.push(idx + vertCount);
    vertCount += p.vertices.length;
  }
  return indices;
}

export interface RawShapeEntry {
  shapeName: string;
  meshId: number;
  /** [mesh-relevant triangle index] -> [mesh-relevant vertex id, i.e. the shape vertex
   *  block appended after the mesh's real vertices]. */
  indexReplacements: Map<number, number>;
}

export interface RawShapeParts {
  shapeList: RawShapeEntry[];
  /** Per mesh, the ordered block of shape vertices appended after its real vertices. */
  vertices: TtVertex[][];
}

interface VertexReplacementInfo {
  meshVertexId: number;
  vertexData: TtVertex;
  shapeName: string;
  shapeVertexId: number;
}

/** Port of TTModel.GetRawShapeParts (TTModel.cs:1089-1245): converts the editable
 *  per-part `shapeParts` into the raw, per-mesh form the serializer writes -- an ordered
 *  vertex block appended after each mesh's real vertices, and per-shape triangle-index ->
 *  appended-vertex-id replacement maps. NOT yet consumed by the serializer (shape-2); no
 *  corpus model exercises this path in this task, so treat it as unverified against the
 *  byte-exact oracle until shape-2's serializer tests cover it. */
export function getRawShapeParts(m: TTModel): RawShapeParts {
  const shapeList: RawShapeEntry[] = [];
  const finalVertices: TtVertex[][] = [];

  m.meshGroups.forEach((group, meshId) => {
    const meshIndices = groupTriangleIndices(group);
    const indexCount = groupIndexCount(group);

    const vertexToIndex = new Map<number, number[]>();
    for (let i = 0; i < indexCount; i++) {
      const vertId = meshIndices[i]!;
      let list = vertexToIndex.get(vertId);
      if (list === undefined) {
        list = [];
        vertexToIndex.set(vertId, list);
      }
      list.push(i);
    }

    const perShape = new Map<
      string,
      { data: VertexReplacementInfo[]; minTargetVertex: number }
    >();
    let partVertexOffset = 0;
    for (const part of group.parts) {
      for (const [shapeName, shape] of part.shapeParts) {
        if (!shapeName.startsWith("shp")) continue;

        const dataList: VertexReplacementInfo[] = [];
        let minVert = Number.MAX_SAFE_INTEGER;
        for (const [partVertexId, shapeVertexIdx] of shape.vertexReplacements) {
          const meshVertexId = partVertexOffset + partVertexId;
          dataList.push({
            meshVertexId,
            vertexData: shape.vertices[shapeVertexIdx]!,
            shapeName,
            shapeVertexId: -1,
          });
          if (meshVertexId < minVert) minVert = meshVertexId;
        }

        const existing = perShape.get(shapeName);
        if (existing === undefined) {
          perShape.set(shapeName, { data: dataList, minTargetVertex: minVert });
        } else {
          existing.data.push(...dataList);
          if (minVert < existing.minTargetVertex) {
            existing.minTargetVertex = minVert;
          }
        }
      }
      partVertexOffset += part.vertices.length;
    }

    // Vertex write order: by each shape's min target vertex, tie-broken by shape name.
    const sorted = [...perShape.values()].sort((a, b) => {
      if (a.minTargetVertex !== b.minTargetVertex) {
        return a.minTargetVertex - b.minTargetVertex;
      }
      return compareStrings(a.data[0]!.shapeName, b.data[0]!.shapeName);
    });

    const vertexList: TtVertex[] = [];
    for (const val of sorted) {
      for (const replacement of val.data) {
        replacement.shapeVertexId = vertexList.length;
        vertexList.push(replacement.vertexData);
      }
    }
    finalVertices.push(vertexList);

    const meshVertexCount = groupVertexCount(group);
    for (const [shapeName, val] of perShape) {
      const replacements = new Map<number, number>();
      for (const data of val.data) {
        const meshRelevantShapeVertexId = data.shapeVertexId + meshVertexCount;
        const indexesUsedByVertex = vertexToIndex.get(data.meshVertexId);
        if (indexesUsedByVertex === undefined) {
          throw new Error(
            `getRawShapeParts: no indices reference mesh-relevant vertex ${data.meshVertexId}`,
          );
        }
        for (const meshRelevantIndex of indexesUsedByVertex) {
          if (replacements.has(meshRelevantIndex)) {
            throw new Error(
              `getRawShapeParts: duplicate index replacement for index ${meshRelevantIndex}`,
            );
          }
          replacements.set(meshRelevantIndex, meshRelevantShapeVertexId);
        }
      }
      shapeList.push({ shapeName, meshId, indexReplacements: replacements });
    }
  });

  shapeList.sort((a, b) => {
    const cmp = compareStrings(a.shapeName, b.shapeName);
    if (cmp !== 0) return cmp;
    return a.meshId - b.meshId;
  });

  return { shapeList, vertices: finalVertices };
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

/** Mirrors the TTModel computed getters `Materials`/`Attributes`/`Bones`/`ShapeNames`
 *  (TTModel.cs:845-900,964-982): sorted-unique projections over the mesh groups/parts. */
export function computeModelLists(model: TTModel): void {
  model.materials = sortedUnique(
    model.meshGroups.map((g) => g.material).filter((mat) => mat !== ""),
  );
  model.attributes = sortedUnique(
    model.meshGroups.flatMap((g) => g.parts.flatMap((p) => [...p.attributes])),
  );
  model.bones = sortedUnique(model.meshGroups.flatMap((g) => g.bones));
  // Port of TTModel.ShapeNames (TTModel.cs:964-982): flips shapes "on" for the serializer
  // (shape-2) -- the path block, basicModelBlock counts, and FullShapeDataBlock all key off
  // `hasShapeData(model)`, which reads `model.shapeNames`/`p.shapeParts` directly.
  model.shapeNames = shapeNames(model);
}
