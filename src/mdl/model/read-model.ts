// Finishes Mdl.GetXivMdl (Mdl.cs:349-995) over the opaque section slices 3a (parseMdl) carries,
// plus the LoD0 geometry decode, into a single structured ReadMdl. Reads only -- no weld, no
// TTModel construction (that is the next task's job; "split, don't blend").

import type { Vec3, VertexData } from "../geometry/vertex-data";
import {
  decodeVertexData,
  parseGeometryLayout,
  parseVertexDeclarations,
} from "../mdl";
import type { XivMdl } from "../types";

export interface ReadPart {
  indexOffset: number;
  indexCount: number;
  attributeMask: number; // u32 at byte 8 of the 16-byte mesh-part header (Mdl.cs:1362-1373)
}

export interface ReadMesh {
  vertices: VertexData; // decoded via decodeVertexData
  vertexCount: number;
  indexCount: number;
  indexDataOffset: number; // in u16 units (mesh header @16)
  materialIndex: number; // mesh header @8 (i16)
  boneSetIndex: number; // mesh header @14 (i16)
  meshType: number; // 0=Standard,1=Water,2=Shadow,3=Fog (from LoD0 header ranges; chara = all 0)
  parts: ReadPart[];
}

export interface ReadShapeInfo {
  name: string;
  lods: { partOffset: number; partCount: number }[];
}

export interface ReadShapePart {
  meshIndexOffset: number;
  indexCount: number;
  shapeDataOffset: number;
}

export interface ReadShapeEntry {
  baseIndex: number;
  shapeVertex: number;
}

export interface ReadShapeData {
  info: ReadShapeInfo[];
  parts: ReadShapePart[];
  data: ReadShapeEntry[];
}

export interface ReadNeckMorph {
  positionAdjust: Vec3;
  unknown: number;
  normalAdjust: Vec3;
  bones: number[];
}

export interface ReadMdl {
  mdlVersion: number;
  source: string; // = mdl.filePath
  flags2: number; // modelData.flags2 (weld fakePart check)
  meshes: ReadMesh[]; // LoD0 only
  meshBoneSets: number[][]; // per bone set: bone indices into pathData.boneList
  pathData: {
    attributeList: string[];
    boneList: string[];
    materialList: string[];
    shapeList: string[];
    extraPathList: string[];
  };
  shapeData: ReadShapeData;
  neckMorph: ReadNeckMorph[];
  modelBoundingBoxes: number[][]; // 4 boxes, each [minX,minY,minZ,minW,maxX,maxY,maxZ,maxW]
  og: XivMdl; // the source, for the serializer's opaque copies + scalar flags
}

/** Reads a NUL-terminated ASCII string at `pos` from `bytes`; returns the string and the
 *  position just past the terminator (IOUtil.ReadNullTerminatedString(br, utf8: false)).
 *  The scan is bounded by `bytes.length`: a malformed/truncated path block with no terminator
 *  throws rather than running off the end of the slice (the reference's BinaryReader.ReadByte
 *  throws on EOF; we surface loudly rather than corrupt output -- see mdl/parse.ts). */
export function readAsciiCString(
  bytes: Uint8Array,
  pos: number,
): { value: string; next: number } {
  let end = pos;
  while (end < bytes.length && bytes[end] !== 0) end++;
  if (end >= bytes.length) {
    throw new Error(
      "mdl: unterminated string in path block (no NUL before end of section)",
    );
  }
  let value = "";
  for (let i = pos; i < end; i++) value += String.fromCharCode(bytes[i]!);
  return { value, next: end + 1 };
}

/** Path strings block (Mdl.cs:374-450). `pathData` = PathCount i32 @0, PathBlockSize i32 @4,
 *  then the string block @8. */
function readPathData(mdl: XivMdl): ReadMdl["pathData"] {
  const bytes = mdl.sections.pathData;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pathBlockSize = dv.getInt32(4, true);
  const md = mdl.modelData;

  const attributeList: string[] = [];
  const boneList: string[] = [];
  const materialList: string[] = [];
  const shapeList: string[] = [];
  const extraPathList: string[] = [];

  let cursor = 8;
  for (let i = 0; i < md.attributeCount; i++) {
    const r = readAsciiCString(bytes, cursor);
    attributeList.push(r.value);
    cursor = r.next;
  }
  for (let i = 0; i < md.boneCount; i++) {
    const r = readAsciiCString(bytes, cursor);
    boneList.push(r.value);
    cursor = r.next;
  }
  for (let i = 0; i < md.materialCount; i++) {
    const r = readAsciiCString(bytes, cursor);
    cursor = r.next;
    if (r.value.startsWith("shp")) {
      shapeList.push(r.value);
    } else {
      materialList.push(r.value);
    }
  }
  for (let i = 0; i < md.shapeCount; i++) {
    const r = readAsciiCString(bytes, cursor);
    shapeList.push(r.value);
    cursor = r.next;
  }

  const blockStart = 8;
  const remaining = pathBlockSize - (cursor - blockStart);
  if (remaining > 2) {
    while (cursor - blockStart < pathBlockSize) {
      const r = readAsciiCString(bytes, cursor);
      cursor = r.next;
      if (r.value.trim().length > 0) extraPathList.push(r.value);
    }
  }

  return { attributeList, boneList, materialList, shapeList, extraPathList };
}

/** Bone sets (Mdl.cs:738-799). v6: header table of [i16 offset][i16 count] then per-set i16
 *  indices (odd count consumes one extra i16 for 4-byte alignment). v5: fixed 64 i16 + i32 count
 *  per set (132 B/set). */
function readBoneSets(mdl: XivMdl): number[][] {
  const bytes = mdl.sections.boneSets;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = mdl.modelData.boneSetCount;
  const sets: number[][] = [];

  if (mdl.header.version >= 6) {
    const counts: number[] = [];
    let pos = 0;
    for (let i = 0; i < count; i++) {
      // offset (unused on read) @pos, count @pos+2
      counts.push(dv.getInt16(pos + 2, true));
      pos += 4;
    }
    for (let i = 0; i < count; i++) {
      const boneCount = counts[i]!;
      const indices: number[] = [];
      for (let j = 0; j < boneCount; j++) {
        indices.push(dv.getInt16(pos, true));
        pos += 2;
      }
      if (boneCount % 2 === 1) pos += 2; // eat one i16 for alignment
      sets.push(indices);
    }
    // trailing bytes to boneSetEnd are ignored (section slice length already stops there)
  } else {
    let pos = 0;
    for (let i = 0; i < count; i++) {
      const all: number[] = [];
      for (let j = 0; j < 64; j++) {
        all.push(dv.getInt16(pos, true));
        pos += 2;
      }
      const boneIndexCount = dv.getInt32(pos, true);
      pos += 4;
      sets.push(all.slice(0, boneIndexCount));
    }
  }
  return sets;
}

const LOD0_TYPE_RANGES: { type: number; offset: number; count: number }[] = [
  { type: 0, offset: 0, count: 2 }, // Standard
  { type: 1, offset: 12, count: 14 }, // Water
  { type: 2, offset: 16, count: 18 }, // Shadow
  { type: 3, offset: 24, count: 26 }, // Fog
];

/** Assigns a mesh (0-based within LoD0) to Standard/Water/Shadow/Fog from the LoD0 header's
 *  [offset,count) ranges (Mdl.cs:482-503); default Standard (0). */
function meshTypeOf(lod0Header: Uint8Array, meshIndexInLod0: number): number {
  const dv = new DataView(
    lod0Header.buffer,
    lod0Header.byteOffset,
    lod0Header.byteLength,
  );
  for (const r of LOD0_TYPE_RANGES) {
    const index = dv.getUint16(r.offset, true);
    const cnt = dv.getUint16(r.count, true);
    if (meshIndexInLod0 >= index && meshIndexInLod0 < index + cnt) {
      return r.type;
    }
  }
  return 0;
}

/** Shapes (Mdl.cs:801-892). shapeInfo: 16 B/entry (i32 nameOffset, 3x u16 offsets, 3x i16
 *  counts -- offsets-then-counts, not interleaved). shapeParts: 12 B/entry. shapeData: 4 B/entry.
 *  `shapeList` is `pathData.shapeList`, needed to resolve each shape info's `name`. */
function readShapeData(mdl: XivMdl, shapeList: string[]): ReadShapeData {
  const md = mdl.modelData;

  const infoBytes = mdl.sections.shapeInfo;
  const infoDv = new DataView(
    infoBytes.buffer,
    infoBytes.byteOffset,
    infoBytes.byteLength,
  );
  const info: ReadShapeInfo[] = [];
  for (let i = 0; i < md.shapeCount; i++) {
    const o = i * 16;
    const offsets = [
      infoDv.getUint16(o + 4, true),
      infoDv.getUint16(o + 6, true),
      infoDv.getUint16(o + 8, true),
    ];
    const counts = [
      infoDv.getInt16(o + 10, true),
      infoDv.getInt16(o + 12, true),
      infoDv.getInt16(o + 14, true),
    ];
    info.push({
      name: shapeList[i] ?? "",
      lods: offsets.map((partOffset, j) => ({
        partOffset,
        partCount: counts[j]!,
      })),
    });
  }

  const partsBytes = mdl.sections.shapeParts;
  const partsDv = new DataView(
    partsBytes.buffer,
    partsBytes.byteOffset,
    partsBytes.byteLength,
  );
  const parts: ReadShapePart[] = [];
  for (let i = 0; i < md.shapePartCount; i++) {
    const o = i * 12;
    parts.push({
      meshIndexOffset: partsDv.getInt32(o, true),
      indexCount: partsDv.getInt32(o + 4, true),
      shapeDataOffset: partsDv.getInt32(o + 8, true),
    });
  }

  const dataBytes = mdl.sections.shapeData;
  const dataDv = new DataView(
    dataBytes.buffer,
    dataBytes.byteOffset,
    dataBytes.byteLength,
  );
  const data: ReadShapeEntry[] = [];
  for (let i = 0; i < md.shapeDataCount; i++) {
    const o = i * 4;
    data.push({
      baseIndex: dataDv.getUint16(o, true),
      shapeVertex: dataDv.getUint16(o + 2, true),
    });
  }

  return { info, parts, data };
}

/** Neck-morph table (Mdl.cs:912-944): 32 B/entry (Vec3 positionAdjust, u32 unknown, Vec3
 *  normalAdjust, 4 raw bone-index bytes resolved through meshBoneSets[0]). */
function readNeckMorph(mdl: XivMdl, meshBoneSets: number[][]): ReadNeckMorph[] {
  const bytes = mdl.sections.neckMorphTable;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: ReadNeckMorph[] = [];
  const count = mdl.modelData.neckMorphTableSize;
  for (let i = 0; i < count; i++) {
    const o = i * 32;
    const positionAdjust: Vec3 = [
      dv.getFloat32(o, true),
      dv.getFloat32(o + 4, true),
      dv.getFloat32(o + 8, true),
    ];
    const unknown = dv.getUint32(o + 12, true);
    const normalAdjust: Vec3 = [
      dv.getFloat32(o + 16, true),
      dv.getFloat32(o + 20, true),
      dv.getFloat32(o + 24, true),
    ];
    const bones: number[] = [];
    const first = meshBoneSets[0];
    for (let j = 0; j < 4; j++) {
      const raw = bytes[o + 28 + j]!;
      if (j >= 2 && raw === 0) break; // early terminator (slots 0,1 always kept)
      if (first !== undefined && raw < first.length) {
        bones.push(first[raw]!);
      }
    }
    out.push({ positionAdjust, unknown, normalAdjust, bones });
  }
  return out;
}

/** First 4 bounding boxes (Mdl.cs:969-975), 32 B/box: [minX,minY,minZ,minW,maxX,maxY,maxZ,maxW]. */
function readModelBoundingBoxes(mdl: XivMdl): number[][] {
  const bytes = mdl.sections.boundingBoxes;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const o = i * 32;
    const box: number[] = [];
    for (let k = 0; k < 8; k++) box.push(dv.getFloat32(o + k * 4, true));
    boxes.push(box);
  }
  return boxes;
}

/** Finishes Mdl.GetXivMdl (Mdl.cs:349-995): turns the opaque section slices + LoD0 geometry into
 *  a structured ReadMdl. `bytes` must be the whole decompressed .mdl (decodeVertexData's offsets
 *  are absolute into the file, not `mdl.geometry`). */
export function readEditableModel(bytes: Uint8Array, mdl: XivMdl): ReadMdl {
  const pathData = readPathData(mdl);
  const meshBoneSets = readBoneSets(mdl);
  const shapeData = readShapeData(mdl, pathData.shapeList);
  const neckMorph = readNeckMorph(mdl, meshBoneSets);
  const modelBoundingBoxes = readModelBoundingBoxes(mdl);

  const layout = parseGeometryLayout(mdl);
  const decls = parseVertexDeclarations(mdl.vertexInfo, mdl.header.meshCount);
  const lod0 = layout.lods[0]!;

  const meshHeaderBytes = mdl.sections.meshHeaders;
  const meshHeaderDv = new DataView(
    meshHeaderBytes.buffer,
    meshHeaderBytes.byteOffset,
    meshHeaderBytes.byteLength,
  );
  const meshPartsBytes = mdl.sections.meshParts;
  const meshPartsDv = new DataView(
    meshPartsBytes.buffer,
    meshPartsBytes.byteOffset,
    meshPartsBytes.byteLength,
  );

  // Mirror the reference's null-material guard (Mdl.cs:639-642): an out-of-range material index
  // (e.g. one that pointed at a "shp"-diverted entry) is clamped to 0.
  const totalNonNullMaterials = pathData.materialList.length;

  const meshes: ReadMesh[] = [];
  let meshIndexInLod0 = 0;
  for (let m = 0; m < layout.meshes.length; m++) {
    if (layout.meshLod[m] !== 0) continue;
    const mesh = layout.meshes[m]!;
    const vertices = decodeVertexData(
      bytes,
      mesh,
      decls[m]!,
      lod0.vertexDataOffset,
      lod0.indexDataOffset,
    );
    const o = m * 36;
    let materialIndex = meshHeaderDv.getInt16(o + 8, true);
    if (materialIndex >= totalNonNullMaterials) materialIndex = 0;
    const boneSetIndex = meshHeaderDv.getInt16(o + 14, true);
    const parts = layout.parts
      .slice(mesh.meshPartIndex, mesh.meshPartIndex + mesh.meshPartCount)
      .map((p, localIdx) => ({
        indexOffset: p.indexOffset,
        indexCount: p.indexCount,
        attributeMask: meshPartsDv.getUint32(
          (mesh.meshPartIndex + localIdx) * 16 + 8,
          true,
        ),
      }));
    const meshType = meshTypeOf(mdl.sections.lodHeaders, meshIndexInLod0);
    meshes.push({
      vertices,
      vertexCount: mesh.vertexCount,
      indexCount: mesh.indexCount,
      indexDataOffset: mesh.indexDataOffset,
      materialIndex,
      boneSetIndex,
      meshType,
      parts,
    });
    meshIndexInLod0++;
  }

  return {
    mdlVersion: mdl.header.version,
    source: mdl.filePath ?? "",
    flags2: mdl.modelData.flags2,
    meshes,
    meshBoneSets,
    pathData,
    shapeData,
    neckMorph,
    modelBoundingBoxes,
    og: mdl,
  };
}
