import { serializeMdlModelData } from "../../src/mdl/model-data";
import { HAS_EXTRA_MESHES, type MdlModelData } from "../../src/mdl/types";
import { ByteBuilder, concatBytes } from "../../src/util/binary";

/** Deterministic non-zero filler so slices are distinguishable in tests. */
function filler(len: number, seed: number): Uint8Array {
  return new Uint8Array(len).map((_, i) => (i * 7 + seed) & 0xff);
}

/**
 * A hand-built, structurally-complete runtime .mdl: 1 mesh, a 673-byte model-data block, 136-byte
 * vertexInfo, 16-byte geometry. All section counts are chosen so every section is present at a known
 * size (design spec §3). v5 and v6 differ only in the header version field — the walker slices the
 * bone-set block by formula, so its internal layout is opaque and identical here.
 */
export function buildMinimalMdl(
  version: number,
  withExtraMeshes = false,
): Uint8Array {
  const md: MdlModelData = {
    radius: 1.5,
    meshCount: 1,
    attributeCount: 1,
    meshPartCount: 1,
    materialCount: 1,
    boneCount: 2,
    boneSetCount: 1,
    shapeCount: 0,
    shapePartCount: 0,
    shapeDataCount: 0,
    lodCount: 1,
    flags1: 0,
    elementIdCount: 1,
    terrainShadowMeshCount: 0,
    flags2: withExtraMeshes ? HAS_EXTRA_MESHES : 0,
    modelClipOutDistance: 0,
    shadowClipOutDistance: 0,
    furniturePartBoundingBoxCount: 0,
    terrainShadowPartCount: 0,
    flags3: 0,
    bgChangeMaterialIndex: 0,
    bgCrestChangeMaterialIndex: 0,
    neckMorphTableSize: 0,
    boneSetSize: 64, // formula: 64·2 + 1·4 = 132-byte bone-set block
    unknown13: 0,
    patch72TableSize: 0,
    unknown15: 0,
    unknown16: 0,
    unknown17: 0,
  };

  const pathData = new ByteBuilder().u32(0).u32(0).toUint8Array(); // PathCount=0, PathBlockSize=0 → 8 B
  const modelData = serializeMdlModelData(md); // 56 B

  const lodHeaders = filler(60 * 3, 2); // 180 B
  // LoD0 terrain-shadow mesh count lives at offset 22 of the LoD0 header; keep it 0 so section 8 is empty.
  lodHeaders[22] = 0;
  lodHeaders[23] = 0;

  const sections = [
    pathData, // 1
    modelData, // 2
    filler(32 * md.elementIdCount, 1), // 3 elementIds (32)
    lodHeaders, // 4 (180)
    withExtraMeshes
      ? filler(120, 2) // 5 extraMeshHeader (HAS_EXTRA_MESHES set)
      : new Uint8Array(0), // 5 extraMeshHeader (flags2 has no HAS_EXTRA_MESHES)
    filler(36 * md.meshCount, 3), // 6 meshHeaders (36)
    filler(4 * md.attributeCount, 4), // 7 attributeOffsets (4)
    new Uint8Array(0), // 8 terrainShadowMeshHeaders (tsCount 0)
    filler(16 * md.meshPartCount, 5), // 9 meshParts (16)
    new Uint8Array(0), // 10 terrainShadowParts (0)
    filler(4 * md.materialCount, 6), // 11 materialOffsets (4)
    filler(4 * md.boneCount, 7), // 12 boneOffsets (8)
    filler(md.boneSetSize * 2 + md.boneSetCount * 4, 8), // 13 boneSets (132)
    new Uint8Array(0), // 14 shapeInfo (0)
    new Uint8Array(0), // 15 shapeParts (0)
    new Uint8Array(0), // 16 shapeData (0)
    new ByteBuilder().u32(0).toUint8Array(), // 17 partBoneSet: BoneIndexCount=0 → 4 B
    new Uint8Array(0), // 18 neckMorphTable (0)
    new Uint8Array(0), // 19 patch72 (0)
    new Uint8Array([0]), // 20 padding: PaddingSize=0 → 1 B
    filler(32 * (4 + md.boneCount + md.furniturePartBoundingBoxCount), 9), // 21 boundingBoxes (192)
  ];
  const modelDataBlock = concatBytes(sections);

  const vertexInfo = filler(136 * md.meshCount, 10); // 136 B
  const geometry = filler(16, 11); // 16 B

  const header = new Uint8Array(68);
  const hv = new DataView(header.buffer);
  hv.setUint16(0, version, true);
  hv.setUint32(4, vertexInfo.length, true);
  hv.setUint32(8, modelDataBlock.length, true);
  hv.setUint16(12, md.meshCount, true);
  header[64] = md.lodCount;
  header[65] = 0;

  return concatBytes([header, vertexInfo, modelDataBlock, geometry]);
}
