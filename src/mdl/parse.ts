import { BinaryReader } from "../util/binary";
import { parseMdlHeader } from "./header";
import { parseMdlModelData } from "./model-data";
import {
  HAS_EXTRA_MESHES,
  LOD_HEADER,
  MDL_HEADER,
  MESH_HEADER,
  type XivMdl,
} from "./types";

/** Parses a decompressed runtime .mdl into a structured XivMdl by walking the model-data block
 *  (Mdl.GetXivMdl, Mdl.cs:349-995). The header + MdlModelData are parsed into fields; the other 20
 *  sections are carried as byte slices whose lengths come from counts. The walk asserts it consumes
 *  exactly modelDataSize bytes — a wrong section length surfaces loudly rather than corrupting output. */
export function parseMdl(bytes: Uint8Array, filePath = ""): XivMdl {
  const header = parseMdlHeader(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const modelDataStart = MDL_HEADER + header.vertexInfoSize;
  const modelDataEnd = modelDataStart + header.modelDataSize;
  const vertexInfo = bytes.slice(MDL_HEADER, modelDataStart);

  const r = new BinaryReader(bytes);
  r.seek(modelDataStart);

  // 1. pathData: PathCount (u32), PathBlockSize (u32 @+4), then the string block.
  const pathBlockSize = dv.getUint32(r.tell() + 4, true);
  const pathData = r.readBytes(8 + pathBlockSize);

  // 2. MdlModelData (fixed 56-byte struct).
  const modelData = parseMdlModelData(r);
  const md = modelData;

  // 3-21. Count-driven sections (design spec §3).
  const elementIds = r.readBytes(32 * md.elementIdCount);
  const lodHeaders = r.readBytes(LOD_HEADER * 3);
  // 120 = 3 LoD × 10 extra-mesh types (EMeshType.LightShaft..Shadow exclusive) × 4 B (MeshIndexAndCount).
  const extraMeshHeader = r.readBytes(
    (md.flags2 & HAS_EXTRA_MESHES) !== 0 ? 120 : 0,
  );
  const meshHeaders = r.readBytes(MESH_HEADER * header.meshCount);
  const attributeOffsets = r.readBytes(4 * md.attributeCount);
  // Section 8 length comes from the LoD0 header's terrain-shadow mesh count (u16 @22), not MdlModelData.
  const lodView = new DataView(
    lodHeaders.buffer,
    lodHeaders.byteOffset,
    lodHeaders.byteLength,
  );
  const terrainShadowMeshCount = lodView.getUint16(22, true);
  const terrainShadowMeshHeaders = r.readBytes(20 * terrainShadowMeshCount);
  const meshParts = r.readBytes(16 * md.meshPartCount);
  const terrainShadowParts = r.readBytes(12 * md.terrainShadowPartCount);
  const materialOffsets = r.readBytes(4 * md.materialCount);
  const boneOffsets = r.readBytes(4 * md.boneCount);
  // Bone-set block length is VERSION-DEPENDENT: real v5 files store boneSetSize=0 and use fixed
  // 132-byte sets (64 i16 + i32; Mdl.cs:779-797); v6 uses the compact formula (Mdl.cs:741).
  const boneSets = r.readBytes(
    header.version >= 6
      ? md.boneSetSize * 2 + md.boneSetCount * 4
      : 132 * md.boneSetCount,
  );
  const shapeInfo = r.readBytes(16 * md.shapeCount);
  const shapeParts = r.readBytes(12 * md.shapePartCount);
  const shapeData = r.readBytes(4 * md.shapeDataCount);
  // 17. partBoneSet: u32 BoneIndexCount (@+0), then BoneIndexCount/2 shorts.
  const partBoneIndexCount = dv.getInt32(r.tell(), true);
  const partBoneSet = r.readBytes(4 + Math.floor(partBoneIndexCount / 2) * 2);
  const neckMorphTable = r.readBytes(32 * md.neckMorphTableSize);
  const patch72 = r.readBytes(16 * md.patch72TableSize);
  // 20. padding: u8 PaddingSize (@+0), then that many bytes.
  const paddingSize = dv.getUint8(r.tell());
  const padding = r.readBytes(1 + paddingSize);
  const boundingBoxes = r.readBytes(
    32 * (4 + md.boneCount + md.furniturePartBoundingBoxCount),
  );

  const consumed = r.tell();
  if (consumed !== modelDataEnd) {
    throw new Error(
      `mdl: model-data walk consumed ${consumed - modelDataStart} bytes, ` +
        `expected ${header.modelDataSize} (path="${filePath}")`,
    );
  }

  const geometry = bytes.slice(modelDataEnd);

  return {
    header,
    vertexInfo,
    modelData,
    sections: {
      pathData,
      elementIds,
      lodHeaders,
      extraMeshHeader,
      meshHeaders,
      attributeOffsets,
      terrainShadowMeshHeaders,
      meshParts,
      terrainShadowParts,
      materialOffsets,
      boneOffsets,
      boneSets,
      shapeInfo,
      shapeParts,
      shapeData,
      partBoneSet,
      neckMorphTable,
      patch72,
      padding,
      boundingBoxes,
    },
    geometry,
    filePath,
  };
}
