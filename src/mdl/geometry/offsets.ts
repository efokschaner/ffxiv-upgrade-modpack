// Structured per-LoD/mesh/part geometry offsets & sizes, read from the already-sliced
// opaque sections of a parsed XivMdl. Field layouts ported from Mdl.GetXivMdl
// (LoD :475-512, mesh :616-634, part :1362-1373) (GPL-3.0).

import { LOD_HEADER, MESH_HEADER, type XivMdl } from "../types";

export interface LodGeometry {
  vertexDataOffset: number; // absolute file offset
  indexDataOffset: number; // absolute file offset
  vertexDataSize: number;
  meshCount: number; // TotalMeshCount = Standard+Water+Shadow+Fog
}

export interface MeshGeometryInfo {
  vertexCount: number;
  indexCount: number;
  meshPartIndex: number;
  meshPartCount: number;
  indexDataOffset: number; // in u16 units
  vertexDataOffset0: number; // relative to the LoD vertex offset
  vertexDataOffset1: number;
  vertexDataEntrySize0: number;
  vertexDataEntrySize1: number;
}

export interface MeshPartRange {
  indexOffset: number;
  indexCount: number;
}

export interface GeometryLayout {
  lods: LodGeometry[];
  meshes: MeshGeometryInfo[];
  parts: MeshPartRange[];
  meshLod: number[]; // meshLod[meshIndex] = owning LoD index
}

const MESH_PART = 16;

export function parseGeometryLayout(mdl: XivMdl): GeometryLayout {
  const lodDv = new DataView(
    mdl.sections.lodHeaders.buffer,
    mdl.sections.lodHeaders.byteOffset,
    mdl.sections.lodHeaders.byteLength,
  );
  const lods: LodGeometry[] = [];
  for (let l = 0; l < 3; l++) {
    const o = l * LOD_HEADER;
    const meshCount =
      lodDv.getUint16(o + 2, true) + // Standard
      lodDv.getUint16(o + 14, true) + // Water
      lodDv.getUint16(o + 18, true) + // Shadow
      lodDv.getUint16(o + 26, true); // Fog
    lods.push({
      vertexDataSize: lodDv.getInt32(o + 44, true),
      vertexDataOffset: lodDv.getInt32(o + 52, true),
      indexDataOffset: lodDv.getInt32(o + 56, true),
      meshCount,
    });
  }

  const meshDv = new DataView(
    mdl.sections.meshHeaders.buffer,
    mdl.sections.meshHeaders.byteOffset,
    mdl.sections.meshHeaders.byteLength,
  );
  const meshes: MeshGeometryInfo[] = [];
  const meshLod: number[] = [];
  let lodCursor = 0;
  let remaining = lods[0]!.meshCount;
  for (let i = 0; i < mdl.header.meshCount; i++) {
    while (remaining <= 0 && lodCursor < 2) {
      lodCursor++;
      remaining = lods[lodCursor]!.meshCount;
    }
    remaining--;
    meshLod.push(lodCursor);
    const o = i * MESH_HEADER;
    meshes.push({
      vertexCount: meshDv.getInt32(o, true),
      indexCount: meshDv.getInt32(o + 4, true),
      meshPartIndex: meshDv.getInt16(o + 10, true),
      meshPartCount: meshDv.getInt16(o + 12, true),
      indexDataOffset: meshDv.getInt32(o + 16, true),
      vertexDataOffset0: meshDv.getInt32(o + 20, true),
      vertexDataOffset1: meshDv.getInt32(o + 24, true),
      vertexDataEntrySize0: meshDv.getUint8(o + 32),
      vertexDataEntrySize1: meshDv.getUint8(o + 33),
    });
  }

  const partDv = new DataView(
    mdl.sections.meshParts.buffer,
    mdl.sections.meshParts.byteOffset,
    mdl.sections.meshParts.byteLength,
  );
  const parts: MeshPartRange[] = [];
  for (let i = 0; i < mdl.modelData.meshPartCount; i++) {
    const o = i * MESH_PART;
    parts.push({
      indexOffset: partDv.getInt32(o, true),
      indexCount: partDv.getInt32(o + 4, true),
    });
  }

  return { lods, meshes, parts, meshLod };
}
