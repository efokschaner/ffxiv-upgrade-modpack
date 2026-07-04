import { type BinaryReader, ByteBuilder } from "../util/binary";
import type { MdlModelData } from "./types";

/** Reads the fixed 56-byte MdlModelData struct (MdlModelData.Read). Advances r by 56 bytes. */
export function parseMdlModelData(r: BinaryReader): MdlModelData {
  return {
    radius: r.readFloat32(),
    meshCount: r.readInt16(),
    attributeCount: r.readInt16(),
    meshPartCount: r.readInt16(),
    materialCount: r.readInt16(),
    boneCount: r.readInt16(),
    boneSetCount: r.readInt16(),
    shapeCount: r.readInt16(),
    shapePartCount: r.readInt16(),
    shapeDataCount: r.readUint16(),
    lodCount: r.readUint8(),
    flags1: r.readUint8(),
    elementIdCount: r.readUint16(),
    terrainShadowMeshCount: r.readUint8(),
    flags2: r.readUint8(),
    modelClipOutDistance: r.readFloat32(),
    shadowClipOutDistance: r.readFloat32(),
    furniturePartBoundingBoxCount: r.readUint16(),
    terrainShadowPartCount: r.readInt16(),
    flags3: r.readUint8(),
    bgChangeMaterialIndex: r.readUint8(),
    bgCrestChangeMaterialIndex: r.readUint8(),
    neckMorphTableSize: r.readUint8(),
    boneSetSize: r.readInt16(),
    unknown13: r.readInt16(),
    patch72TableSize: r.readInt16(),
    unknown15: r.readInt16(),
    unknown16: r.readInt16(),
    unknown17: r.readInt16(),
  };
}

/** Writes MdlModelData back to 56 bytes (MdlModelData.Write). Exact inverse of parseMdlModelData.
 *  ByteBuilder.u16 masks to 16 bits, so signed fields round-trip byte-identically. */
export function serializeMdlModelData(md: MdlModelData): Uint8Array {
  return new ByteBuilder()
    .f32(md.radius)
    .u16(md.meshCount)
    .u16(md.attributeCount)
    .u16(md.meshPartCount)
    .u16(md.materialCount)
    .u16(md.boneCount)
    .u16(md.boneSetCount)
    .u16(md.shapeCount)
    .u16(md.shapePartCount)
    .u16(md.shapeDataCount)
    .u8(md.lodCount)
    .u8(md.flags1)
    .u16(md.elementIdCount)
    .u8(md.terrainShadowMeshCount)
    .u8(md.flags2)
    .f32(md.modelClipOutDistance)
    .f32(md.shadowClipOutDistance)
    .u16(md.furniturePartBoundingBoxCount)
    .u16(md.terrainShadowPartCount)
    .u8(md.flags3)
    .u8(md.bgChangeMaterialIndex)
    .u8(md.bgCrestChangeMaterialIndex)
    .u8(md.neckMorphTableSize)
    .u16(md.boneSetSize)
    .u16(md.unknown13)
    .u16(md.patch72TableSize)
    .u16(md.unknown15)
    .u16(md.unknown16)
    .u16(md.unknown17)
    .toUint8Array();
}
