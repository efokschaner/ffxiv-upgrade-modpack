// Port of Mdl.MakeUncompressedMdlFile (Mdl.cs:2488-3964). Common chara path
// only: LoD0, weighted or unweighted, no shapes / neck-morph / extra-meshes / furniture
// boxes -- those fail loud (throw) rather than emit a wrong file. Byte-parity against a
// TexTools golden is the next task's job; this stage's gate is re-parseability and
// structural self-consistency (the combinedDataBlockSize self-check below, and
// parseMdl's own section-length walk, both surface an offset/size mistake loudly rather
// than silently corrupting the file).
//
// Split, don't blend: this module only assembles blocks; it reuses the already-ported
// codecs for declarations/encode/bonesets/bbox/model-data rather than re-deriving them.

import { ByteBuilder, concatBytes } from "../../util/binary";
import { serializeVertexDeclarations } from "../geometry/declaration";
import { encodeVertexData } from "../geometry/encode";
import { VertexDataType, VertexUsageType } from "../geometry/format";
import type { TtVertex } from "../geometry/vertex-data";
import { serializeMdlModelData } from "../model-data";
import { HAS_EXTRA_MESHES, type MdlModelData } from "../types";
import { buildV6BoneSetBlock } from "./bone-sets";
import {
  buildBoundingBoxBlock,
  computeExtents,
  computeRadius,
} from "./bounding-box";
import {
  buildDeclarations,
  MAX_VERTEX_BUFFER_SIZE,
  streamEntrySizes,
} from "./build-declarations";
import type { ReadMdl } from "./read-model";
import {
  getAttributeBitmask,
  getMaterialIndex,
  getRawShapeParts,
  hasShapeData,
  hasWeights,
  meshTypeCounts,
  shapeDataCount,
  shapePartCount,
  shapePartCounts,
  type TTModel,
} from "./tt-model";

const MDL_HEADER_SIZE = 68;
const LOD_HEADER_SIZE = 60;
const MESH_HEADER_SIZE = 36;

/** EMeshFlags2.HasBonelessParts (MdlModelData.cs:40). */
const HAS_BONELESS_PARTS = 0x01;
/** EMeshFlags3.UseMaterialChange / UseCrestChange (MdlModelData.cs:54-55). Our internal
 *  meshType tag (0-3, Standard/Water/Shadow/Fog -- see read-model.ts's meshTypeOf) has no
 *  representation for CrestChange/MaterialChange meshes, so those flags are always clear
 *  in this scope (see MdlModelData recompute notes below). */
const USE_MATERIAL_CHANGE = 0x02;
const USE_CREST_CHANGE = 0x04;

function pushCString(out: number[], s: string): void {
  for (const b of new TextEncoder().encode(s)) out.push(b);
  out.push(0);
}

/** Dat.Pad(list, n) (Dat.cs:2062-2070): pad to the next multiple of `n`, no-op if already
 *  aligned (i.e. never adds a full extra block of padding). */
function padTo(out: number[], n: number): void {
  const rem = out.length % n;
  if (rem !== 0) {
    for (let i = 0; i < n - rem; i++) out.push(0);
  }
}

/** Port of MakeUncompressedMdlFile (Mdl.cs:2488-3964). `model.mdlVersion` must already be
 *  6 (the caller's job); `rm` is the ReadMdl this model was built from (for opaque
 *  section copies + scalar flags this stage does not model). */
export function makeUncompressedMdl(model: TTModel, rm: ReadMdl): Uint8Array {
  if (model.mdlVersion !== 6) {
    throw new Error(
      `mdl: makeUncompressedMdl only supports mdlVersion 6 (got ${model.mdlVersion})`,
    );
  }
  const ogMd = rm.og.modelData;
  if ((ogMd.flags2 & HAS_EXTRA_MESHES) !== 0) {
    throw new Error(
      "mdl: HasExtraMeshes source models are out of scope for makeUncompressedMdl",
    );
  }
  if (ogMd.neckMorphTableSize > 0) {
    throw new Error(
      "mdl: neck-morph tables are out of scope for makeUncompressedMdl",
    );
  }

  // Our 4-bucket meshType sort (below) reproduces the real EMeshType ordinal walk for every
  // combination of present types EXCEPT when both Shadow (bucket 2) and Fog (bucket 3) groups
  // exist: EMeshType orders Fog before Shadow, our bucket orders Shadow first, which flips the
  // serialized mesh order (and the meshTypeCounts offsets). Fail loud rather than emit a
  // mis-ordered model. (Mdl.cs:2548 / TTModel.cs:806-816; see meshTypeCounts above.)
  const hasShadow = model.meshGroups.some((g) => g.meshType === 2);
  const hasFog = model.meshGroups.some((g) => g.meshType === 3);
  if (hasShadow && hasFog) {
    throw new Error(
      "mdl: models with both Shadow and Fog meshes are out of scope for makeUncompressedMdl (EMeshType ordering not yet ported)",
    );
  }

  // TTModel.OrderMeshGroupsForImport (Mdl.cs:2548, TTModel.cs:806-816): stable sort by
  // mesh type. Array.prototype.sort is stable per spec. Must run before every helper
  // below that iterates model.meshGroups (declarations/bonesets/bbox/geometry all key off
  // the post-sort order, exactly as the reference mutates ttModel.MeshGroups up front).
  model.meshGroups = [...model.meshGroups].sort(
    (a, b) => a.meshType - b.meshType,
  );

  const weighted = hasWeights(model);
  const useParts = weighted || model.meshGroups.some((g) => g.parts.length > 1);
  const useFurnitureBBs = useParts && !weighted;
  if (useFurnitureBBs) {
    throw new Error(
      "mdl: furniture bounding boxes (unweighted multi-part model) are out of scope for makeUncompressedMdl",
    );
  }

  const meshCount = model.meshGroups.length;
  const decl = buildDeclarations(model);
  const [entry0, entry1, entry2] = streamEntrySizes(decl[0]!);
  const streamCount = Math.max(...decl[0]!.map((e) => e.stream)) + 1;
  const boneWeightIsUByte8 =
    decl[0]!.find((e) => e.usage === VertexUsageType.BoneWeight)?.type ===
    VertexDataType.UByte8;

  // ---- Phase 1: geometry (vertex + index data blocks), per mesh (Mdl.cs:2795-2820,
  // GetBasicGeometryData Mdl.cs:3982-4021, TTMeshGroup.TriangleIndices TTModel.cs:723-737).
  // Built as a chunk list + running length (not a flat number[]) because
  // `arr.push(...bigTypedArray)` blows the call stack once a stream exceeds V8's
  // argument-count limit -- real corpus meshes routinely do.
  const modelHasShapeData = hasShapeData(model);
  const rawShapeParts = modelHasShapeData ? getRawShapeParts(model) : undefined;

  const vertexChunks: Uint8Array[] = [];
  let vertexDataLength = 0;
  const indexDataBlock: number[] = [];
  const meshVertexOffsets: [number, number, number][] = [];
  const meshIndexOffsets: number[] = [];
  const meshVertexCount: number[] = [];
  const meshIndexCount: number[] = [];
  const partIndexOffsets: number[] = [];
  const partIndexCounts: number[] = [];

  for (let mi = 0; mi < meshCount; mi++) {
    const group = model.meshGroups[mi]!;
    const meshVertices: TtVertex[] = [];
    const meshIndices: number[] = [];
    let vOffset = 0;
    const meshIndexOffset = indexDataBlock.length / 2;

    for (const part of group.parts) {
      partIndexOffsets.push(indexDataBlock.length / 2);
      partIndexCounts.push(part.triangleIndices.length);
      for (const ti of part.triangleIndices) {
        const idx = ti + vOffset;
        meshIndices.push(idx);
        indexDataBlock.push(idx & 0xff, (idx >>> 8) & 0xff);
      }
      for (const v of part.vertices) meshVertices.push(v);
      vOffset += part.vertices.length;
    }
    padTo(indexDataBlock, 16); // 8-index inter-mesh padding (Mdl.cs:2819)

    meshIndexOffsets.push(meshIndexOffset);
    meshIndexCount.push(meshIndices.length);

    // Mdl.cs:2778-2793: shape vertices are orphaned (index-less) vertices appended after
    // the mesh's real geometry -- written into the SAME vertex stream buffers, encoded
    // together with the base vertices below. Index data (computed above) is unchanged.
    if (rawShapeParts !== undefined) {
      for (const v of rawShapeParts.vertices[mi] ?? []) meshVertices.push(v);
    }
    meshVertexCount.push(meshVertices.length);

    const { stream0, stream1 } = encodeVertexData(meshVertices, decl[mi]!);
    if (stream0.length !== meshVertices.length * entry0) {
      throw new Error(
        `mdl: mesh ${mi} stream0 size mismatch (${stream0.length} != ${meshVertices.length * entry0})`,
      );
    }
    if (stream1.length !== meshVertices.length * entry1) {
      throw new Error(
        `mdl: mesh ${mi} stream1 size mismatch (${stream1.length} != ${meshVertices.length * entry1})`,
      );
    }

    const off0 = vertexDataLength;
    vertexChunks.push(stream0);
    vertexDataLength += stream0.length;
    const off1 = vertexDataLength;
    vertexChunks.push(stream1);
    vertexDataLength += stream1.length;
    meshVertexOffsets.push([off0, off1, 0]);
  }
  const vertexDataBlock = concatBytes(vertexChunks);

  // Mdl.cs:2822-2825: even after the Half-precision fallback, refuse a vertex buffer that
  // exceeds _MaxVertexBufferSize -- a genuine failure, not something to clamp or truncate.
  if (vertexDataBlock.length > MAX_VERTEX_BUFFER_SIZE) {
    throw new Error(
      `mdl: total Vertex buffer data size is too large (${vertexDataBlock.length} > ${MAX_VERTEX_BUFFER_SIZE}); reduce the model's vertex count`,
    );
  }

  // ---- Phase 2: vertexInfoBlock.
  const vertexInfoBlock = serializeVertexDeclarations(decl);

  // ---- Phase 3.1: pathInfoBlock (Mdl.cs:2830-2925).
  const pathBytes: number[] = [];
  const attributeOffsets: number[] = [];
  for (const s of model.attributes) {
    attributeOffsets.push(pathBytes.length);
    pushCString(pathBytes, s);
  }
  const boneOffsets: number[] = [];
  for (const s of model.bones) {
    boneOffsets.push(pathBytes.length);
    pushCString(pathBytes, s);
  }
  const materialOffsets: number[] = [];
  for (const s of model.materials) {
    materialOffsets.push(pathBytes.length);
    pushCString(pathBytes, s);
  }
  // Mdl.cs:2886-2901: shape names, gated on HasShapeData -- written after materials,
  // before extra paths. Record each name's path-block offset (shapeOffsetList) for the
  // FullShapeDataBlock's shapeInfo sub-block below.
  const shapeOffsetList: number[] = [];
  if (modelHasShapeData) {
    for (const s of model.shapeNames) {
      shapeOffsetList.push(pathBytes.length);
      pushCString(pathBytes, s);
    }
  }
  for (const s of rm.pathData.extraPathList) pushCString(pathBytes, s);
  padTo(pathBytes, 4);

  // Mdl.cs:2833-2917: pathCount increments once per path written, INCLUDING the extra
  // paths loop (`pathCount++` at line 2916) -- it is NOT limited to
  // attributes+bones+materials+shapes, despite that being a natural first read of the
  // count's purpose. Confirmed by direct reading of the reference; flagged for the ratchet.
  const pathCount =
    model.attributes.length +
    model.bones.length +
    model.materials.length +
    (modelHasShapeData ? model.shapeNames.length : 0) +
    rm.pathData.extraPathList.length;

  const pathInfoBlock = concatBytes([
    new ByteBuilder().u32(pathCount).u32(pathBytes.length).toUint8Array(),
    new Uint8Array(pathBytes),
  ]);

  // ---- Phase 3.2: basicModelBlock (the 56-byte MdlModelData; Mdl.cs:2931-3053).
  const ext = computeExtents(model);
  const radius = computeRadius(ext.abs);

  const meshPartCountTotal = model.meshGroups.reduce(
    (n, g) => n + g.parts.length,
    0,
  );

  let boneSetBlock = new Uint8Array(0);
  let boneSetSize = 0;
  if (weighted) {
    const r = buildV6BoneSetBlock(model);
    boneSetBlock = r.block;
    boneSetSize = r.boneSetSize;
  }

  let flags2 = ogMd.flags2;
  flags2 &= ~HAS_EXTRA_MESHES; // ttModel.HasExtraMeshes is always false in this scope
  flags2 &= ~HAS_BONELESS_PARTS; // useFurnitureBBs is always false (else we threw above)

  // Mdl.cs:3000-3018: CrestChange/MaterialChange flags follow whether any mesh group has
  // that MeshType. Our internal tag (0-3) can never equal those types (see the const doc
  // comment above), so both are always cleared here.
  const flags3 = ogMd.flags3 & ~(USE_MATERIAL_CHANGE | USE_CREST_CHANGE);
  const bgChangeMaterialIndex = 0;
  const bgCrestChangeMaterialIndex = 0;

  const md: MdlModelData = {
    radius,
    meshCount,
    attributeCount: model.attributes.length,
    meshPartCount: useParts ? meshPartCountTotal : 0,
    materialCount: model.materials.length,
    boneCount: model.bones.length,
    boneSetCount: weighted ? meshCount : 0,
    shapeCount: modelHasShapeData ? model.shapeNames.length : 0,
    shapePartCount: modelHasShapeData ? shapePartCount(model) : 0,
    shapeDataCount: modelHasShapeData ? shapeDataCount(model) : 0,
    lodCount: 1,
    flags1: ogMd.flags1,
    elementIdCount: ogMd.elementIdCount,
    terrainShadowMeshCount: ogMd.terrainShadowMeshCount,
    flags2,
    modelClipOutDistance: 0,
    shadowClipOutDistance: 0,
    furniturePartBoundingBoxCount: 0,
    terrainShadowPartCount: ogMd.terrainShadowPartCount,
    flags3,
    bgChangeMaterialIndex,
    bgCrestChangeMaterialIndex,
    neckMorphTableSize: 0,
    boneSetSize,
    unknown13: ogMd.unknown13,
    patch72TableSize: 0,
    unknown15: ogMd.unknown15,
    unknown16: ogMd.unknown16,
    unknown17: ogMd.unknown17,
  };
  const basicModelBlock = serializeMdlModelData(md);

  // ---- Phase 3.3: unknownDataBlock0 (opaque; Mdl.cs:3061).
  const unknownDataBlock0 = rm.og.sections.elementIds;

  // ---- Phase 3.6: meshDataBlock (36 B/mesh; Mdl.cs:3070-3193).
  const meshDataBuilder = new ByteBuilder();
  let totalParts = 0;
  for (let mi = 0; mi < meshCount; mi++) {
    const group = model.meshGroups[mi]!;
    const vertexCount = meshVertexCount[mi]!;
    const indexCount = meshIndexCount[mi]!;
    const materialIndex = getMaterialIndex(model, group);
    const partCount = useParts ? group.parts.length : 0;
    const boneSetIndex = weighted ? mi : 255;

    // Mdl.cs:3104-3128: base = source mesh header's own byte @35 (VertexStreamCountUnknown,
    // MeshDataInfo.cs:104), high bits (& 0xF8) preserved, low bits replaced with the
    // stream count, bit 0x04 set iff the BoneWeight element is the 8-weight UByte8 format.
    const srcByte35 =
      rm.og.sections.meshHeaders[mi * MESH_HEADER_SIZE + 35] ?? 0;
    let vertexStreamCountPlusFlags = (srcByte35 & 0xf8) | streamCount;
    vertexStreamCountPlusFlags = boneWeightIsUByte8
      ? vertexStreamCountPlusFlags | 0x04
      : vertexStreamCountPlusFlags & ~0x04;

    meshDataBuilder
      .i32(vertexCount)
      .i32(indexCount)
      .u16(materialIndex)
      .u16(totalParts)
      .u16(partCount)
      .u16(boneSetIndex)
      .i32(meshIndexOffsets[mi]!)
      .i32(meshVertexOffsets[mi]![0])
      .i32(entry1 === 0 ? 0 : meshVertexOffsets[mi]![1])
      .i32(0)
      .u8(entry0)
      .u8(entry1)
      .u8(entry2)
      .u8(vertexStreamCountPlusFlags);
    totalParts += partCount;
  }
  const meshDataBlock = meshDataBuilder.toUint8Array();

  // ---- Phase 3.7: attributePathDataBlock.
  const attributePathBuilder = new ByteBuilder();
  for (const off of attributeOffsets) attributePathBuilder.i32(off);
  const attributePathDataBlock = attributePathBuilder.toUint8Array();

  // ---- Phase 3.8: unknownDataBlock1 (opaque; Mdl.cs:3216).
  const unknownDataBlock1 = rm.og.sections.terrainShadowMeshHeaders;

  // ---- Phase 3.9: meshPartDataBlock (16 B/part; Mdl.cs:3223-3335).
  let meshPartDataBlock = new Uint8Array(0);
  if (useParts) {
    const b = new ByteBuilder();
    let currentBoneOffset = 0;
    let boundingBoxIdx = 0;
    let globalPartIdx = 0;
    // Mdl.cs:3314-3318: on the SOURCE model's HasBonelessParts flag (not our recomputed
    // one, which the reference also reads from the pre-modification `ogMdl.ModelData`) --
    // out of scope here (that's the furniture per-part-bbox path), but the model
    // constructing this file already guarantees useFurnitureBBs is false, which for a
    // weighted chara model implies HasWeights=true; we still mirror the reference's
    // literal (og, not recomputed) flag read for fidelity.
    const sourceHasBonelessParts = (ogMd.flags2 & HAS_BONELESS_PARTS) !== 0;
    for (const group of model.meshGroups) {
      for (const part of group.parts) {
        const indexOffset = partIndexOffsets[globalPartIdx]!;
        const indexCount = partIndexCounts[globalPartIdx]!;
        let attributeMask: number;
        if (sourceHasBonelessParts) {
          attributeMask = boundingBoxIdx;
          boundingBoxIdx++;
        } else {
          attributeMask = getAttributeBitmask(model, part);
        }
        const boneCount = group.bones.length;
        b.i32(indexOffset)
          .i32(indexCount)
          .u32(attributeMask >>> 0)
          .u16(weighted ? currentBoneOffset : -1)
          .u16(boneCount);
        currentBoneOffset += boneCount;
        globalPartIdx++;
      }
    }
    meshPartDataBlock = b.toUint8Array();
  }

  // ---- Phase 3.10: unknownDataBlock2 (opaque; Mdl.cs:3339).
  const unknownDataBlock2 = rm.og.sections.terrainShadowParts;

  // ---- Phase 3.11 / 3.12: matPathOffsetDataBlock / bonePathOffsetDataBlock.
  const matPathBuilder = new ByteBuilder();
  for (const off of materialOffsets) matPathBuilder.i32(off);
  const matPathOffsetDataBlock = matPathBuilder.toUint8Array();

  const bonePathBuilder = new ByteBuilder();
  for (const off of boneOffsets) bonePathBuilder.i32(off);
  const bonePathOffsetDataBlock = bonePathBuilder.toUint8Array();

  // ---- Phase 3.13: boneSetsBlock (already built above, alongside boneSetSize).

  // ---- Phase 3.14: fullShapeDataBlock (Mdl.cs:3459-3555): three concatenated
  // sub-blocks -- per-shape-name info, per-shapeList-entry part descriptors, and the raw
  // (baseIndex, shapeVertex) replacement pairs -- empty when the model carries no shapes.
  let fullShapeDataBlock = new Uint8Array(0);
  if (modelHasShapeData && rawShapeParts !== undefined) {
    const counts = shapePartCounts(model);

    // (a) shapeInfo -- 16 B/shape name: nameOffset (i32) + {partOffset,0,0} (i16 x3,
    // LoD0 only) + {partCount,0,0} (i16 x3, LoD0 only).
    const shapeInfoBuilder = new ByteBuilder();
    let runningPartOffset = 0;
    for (let s = 0; s < model.shapeNames.length; s++) {
      const count = counts[s]!;
      shapeInfoBuilder
        .i32(shapeOffsetList[s]!)
        .u16(runningPartOffset)
        .u16(0)
        .u16(0)
        .u16(count)
        .u16(0)
        .u16(0);
      runningPartOffset += count;
    }

    // (b) shapeParts -- 12 B/`rawShapeParts.shapeList` entry: meshIndexOffset (i32, same
    // u16-units value as that mesh's header), indexCount (i32), shapeDataOffset (i32,
    // running count of replacement pairs written so far).
    const shapePartsBuilder = new ByteBuilder();
    let runningShapeDataOffset = 0;
    for (const entry of rawShapeParts.shapeList) {
      const count = entry.indexReplacements.size;
      shapePartsBuilder
        .i32(meshIndexOffsets[entry.meshId]!)
        .i32(count)
        .i32(runningShapeDataOffset);
      runningShapeDataOffset += count;
    }

    // (c) shapeData -- 4 B/replacement pair: baseIndex (u16) + shapeVertex (u16), in
    // `shapeList` order and, within each entry, Map insertion order.
    const shapeDataBuilder = new ByteBuilder();
    for (const entry of rawShapeParts.shapeList) {
      for (const [baseIndex, shapeVertex] of entry.indexReplacements) {
        if (baseIndex > 0xffff || shapeVertex > 0xffff) {
          throw new Error(
            `mdl: mesh group ${entry.meshId} has too many total vertices/triangle indices for shape data (baseIndex=${baseIndex}, shapeVertex=${shapeVertex})`,
          );
        }
        shapeDataBuilder.u16(baseIndex).u16(shapeVertex);
      }
    }

    fullShapeDataBlock = concatBytes([
      shapeInfoBuilder.toUint8Array(),
      shapePartsBuilder.toUint8Array(),
      shapeDataBuilder.toUint8Array(),
    ]);
  }

  // ---- Phase 3.15: partBoneSetsBlock (Mdl.cs:3564-3585).
  const partBoneSetsData: number[] = [];
  if (weighted) {
    for (const group of model.meshGroups) {
      for (let i = 0; i < group.bones.length; i++) {
        partBoneSetsData.push(i & 0xff, (i >>> 8) & 0xff);
      }
    }
  }
  const partBoneSetsBlock = concatBytes([
    new ByteBuilder().u32(partBoneSetsData.length).toUint8Array(),
    new Uint8Array(partBoneSetsData),
  ]);

  // ---- Phase 3.16 / 3.17: neckMorphDataBlock / unknownPatch72DataBlock -- always empty.
  const neckMorphDataBlock = new Uint8Array(0);
  const unknownPatch72DataBlock = new Uint8Array(0);

  // ---- Phase 3.18: paddingDataBlock (opaque; already includes the leading PaddingSize
  // byte, Mdl.cs:3665-3666).
  const paddingDataBlock = rm.og.sections.padding;

  // ---- Phase 3.19: boundingBoxDataBlock (Mdl.cs:3673-3746; includes the per-bone cubes).
  const boundingBoxDataBlock = buildBoundingBoxBlock(
    model,
    radius,
    ext.min,
    ext.max,
  );

  // ---- Phase 4: LoD0 header (60 B) + LoD1/2 padding (120 B) (Mdl.cs:3817-3875).
  const { offset: typeOffset, count: typeCount } = meshTypeCounts(
    model.meshGroups,
  );
  const lod0Src = rm.og.sections.lodHeaders; // first 60 bytes = LoD0
  const lod0SrcDv = new DataView(
    lod0Src.buffer,
    lod0Src.byteOffset,
    lod0Src.byteLength,
  );
  const unknown6 = lod0SrcDv.getInt32(36, true);
  const unknown7 = lod0SrcDv.getInt32(40, true);

  const combinedDataBlockSize =
    MDL_HEADER_SIZE +
    vertexInfoBlock.length +
    pathInfoBlock.length +
    basicModelBlock.length +
    unknownDataBlock0.length +
    3 * LOD_HEADER_SIZE + // Mdl.cs:3813: `60 * ogMdl.LoDList.Count`, always 3 LoDs
    0 + // extraMeshesBlock: always empty (fail-loud gate above)
    meshDataBlock.length +
    attributePathDataBlock.length +
    unknownDataBlock1.length +
    meshPartDataBlock.length +
    unknownDataBlock2.length +
    matPathOffsetDataBlock.length +
    bonePathOffsetDataBlock.length +
    boneSetBlock.length +
    fullShapeDataBlock.length +
    partBoneSetsBlock.length +
    neckMorphDataBlock.length +
    unknownPatch72DataBlock.length +
    paddingDataBlock.length +
    boundingBoxDataBlock.length;

  const vertexDataOffset = combinedDataBlockSize;
  const vertexDataSize = vertexDataBlock.length;
  const lodIndexDataOffset = vertexDataOffset + vertexDataSize;
  const indexDataSize = indexDataBlock.length;

  const lod0Builder = new ByteBuilder();
  lod0Builder
    .u16(typeOffset[0]!) // Standard offset
    .u16(typeCount[0]!) // Standard count
    .f32(0) // ModelLoDRange
    .f32(100) // TextureLoDRange
    .u16(typeOffset[1]!) // Water offset
    .u16(typeCount[1]!) // Water count
    .u16(typeOffset[2]!) // Shadow offset
    .u16(typeCount[2]!) // Shadow count
    .u16(0) // TerrainShadow offset (not tracked; no chara LoD0 mesh takes this tag)
    .u16(0) // TerrainShadow count
    .u16(typeOffset[3]!) // Fog offset
    .u16(typeCount[3]!) // Fog count
    .i32(0) // edgeGeometrySize
    .i32(lodIndexDataOffset) // edgeGeometryDataOffset
    .i32(unknown6)
    .i32(unknown7)
    .i32(vertexDataSize)
    .i32(indexDataSize)
    .i32(vertexDataOffset)
    .i32(lodIndexDataOffset);
  const lodDataBlock = concatBytes([
    lod0Builder.toUint8Array(),
    new Uint8Array(120), // LoD1/2, blank (Mdl.cs:3875)
  ]);

  // ---- Phase 5: final modelDataBlock concatenation (Mdl.cs:3883-3906) + self-check.
  const modelDataBlock = concatBytes([
    pathInfoBlock,
    basicModelBlock,
    unknownDataBlock0,
    lodDataBlock,
    new Uint8Array(0), // extraMeshesBlock
    meshDataBlock,
    attributePathDataBlock,
    unknownDataBlock1,
    meshPartDataBlock,
    unknownDataBlock2,
    matPathOffsetDataBlock,
    bonePathOffsetDataBlock,
    boneSetBlock,
    fullShapeDataBlock,
    partBoneSetsBlock,
    neckMorphDataBlock,
    unknownPatch72DataBlock,
    paddingDataBlock,
    boundingBoxDataBlock,
  ]);

  if (
    combinedDataBlockSize !==
    modelDataBlock.length + MDL_HEADER_SIZE + vertexInfoBlock.length
  ) {
    throw new Error("mdl: model-data block offset calculation invalid");
  }

  // ---- Phase 6: 68-byte file header (Mdl.cs:3916-3961).
  const vBuffer0Offset =
    MDL_HEADER_SIZE + vertexInfoBlock.length + modelDataBlock.length;
  const iBuffer0Offset = vBuffer0Offset + vertexDataBlock.length;
  const vBuffer1Offset = iBuffer0Offset + indexDataBlock.length;

  const header = new ByteBuilder()
    .u16(6) // version
    .u16(256)
    .u32(vertexInfoBlock.length)
    .u32(modelDataBlock.length)
    .u16(meshCount)
    .u16(model.materials.length)
    // Vertex buffer offsets
    .i32(vBuffer0Offset)
    .i32(vBuffer1Offset)
    .i32(vBuffer1Offset)
    // Index buffer offsets
    .i32(iBuffer0Offset)
    .i32(vBuffer1Offset)
    .i32(vBuffer1Offset)
    // Vertex buffer sizes
    .i32(vertexDataBlock.length)
    .i32(0)
    .i32(0)
    // Index buffer sizes
    .i32(indexDataBlock.length)
    .i32(0)
    .i32(0)
    .u8(1) // lodCount
    .u8(0x01) // flags: index streaming
    .u8(0)
    .u8(0)
    .toUint8Array();

  // ---- Final assembly (Mdl.cs:3964).
  return concatBytes([
    header,
    vertexInfoBlock,
    modelDataBlock,
    vertexDataBlock,
    new Uint8Array(indexDataBlock),
  ]);
}
