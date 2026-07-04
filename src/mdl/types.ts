// Structural model of a decompressed runtime .mdl. The header and MdlModelData are parsed into
// fields; every other model-data section is carried as a named byte slice (design spec §4). Ported
// from xivModdingFramework Mdl.cs / MdlModelData.cs (GPL-3.0).

export const MDL_HEADER = 68; // Mdl._MdlHeaderSize (0x44)
export const VERTEX_DATA_HEADER = 136; // Mdl._VertexDataHeaderSize (0x88)
export const LOD_HEADER = 60;
export const MESH_HEADER = 36;
export const BOUNDING_BOX = 32;
export const MDL_MODEL_DATA = 56;
export const HAS_EXTRA_MESHES = 0x10; // EMeshFlags2.HasExtraMeshes

/** The retained 68-byte MDL header: parsed fields for the walk + the raw bytes for byte-exact replay. */
// NOTE: `serializeMdlHeader` replays `bytes` verbatim (preserving the ~60 header bytes this stage
// does not model). The scalar fields below are READ-ONLY conveniences for the walk — assigning to them
// does NOT change the output. A later mutation (e.g. the deferred v5->v6 transform setting version=6 /
// lodCount=1) must write into `bytes` directly (or rebuild it), not into these fields.
export interface MdlHeader {
  bytes: Uint8Array; // all 68 header bytes, retained for verbatim serialize (source of truth on write)
  version: number; // u16 @0
  vertexInfoSize: number; // u32 @4
  modelDataSize: number; // u32 @8
  meshCount: number; // u16 @12
  lodCount: number; // u8 @64
  flags: number; // u8 @65
}

/** The fixed 56-byte model-data struct (MdlModelData.cs). All fields retained; Read/Write are inverses. */
export interface MdlModelData {
  radius: number;
  meshCount: number;
  attributeCount: number;
  meshPartCount: number;
  materialCount: number;
  boneCount: number;
  boneSetCount: number;
  shapeCount: number;
  shapePartCount: number;
  shapeDataCount: number;
  lodCount: number;
  flags1: number;
  elementIdCount: number;
  terrainShadowMeshCount: number;
  flags2: number;
  modelClipOutDistance: number;
  shadowClipOutDistance: number;
  furniturePartBoundingBoxCount: number;
  terrainShadowPartCount: number;
  flags3: number;
  bgChangeMaterialIndex: number;
  bgCrestChangeMaterialIndex: number;
  neckMorphTableSize: number;
  boneSetSize: number;
  unknown13: number;
  patch72TableSize: number;
  unknown15: number;
  unknown16: number;
  unknown17: number;
}

/** The 20 named model-data sections + the trailing gap, carried as opaque byte slices (order = spec §3). */
export interface MdlSections {
  pathData: Uint8Array;
  elementIds: Uint8Array;
  lodHeaders: Uint8Array;
  extraMeshHeader: Uint8Array;
  meshHeaders: Uint8Array;
  attributeOffsets: Uint8Array;
  terrainShadowMeshHeaders: Uint8Array;
  meshParts: Uint8Array;
  terrainShadowParts: Uint8Array;
  materialOffsets: Uint8Array;
  boneOffsets: Uint8Array;
  boneSets: Uint8Array;
  shapeInfo: Uint8Array;
  shapeParts: Uint8Array;
  shapeData: Uint8Array;
  partBoneSet: Uint8Array;
  neckMorphTable: Uint8Array;
  patch72: Uint8Array;
  padding: Uint8Array;
  boundingBoxes: Uint8Array;
  trailing: Uint8Array; // opaque bytes between boundingBoxes and geometry (usually empty; spec §2)
}

/** A parsed runtime .mdl. serializeMdl replays this byte-for-byte. */
export interface XivMdl {
  header: MdlHeader;
  vertexInfo: Uint8Array; // opaque vertex-declaration headers (136 · meshCount)
  modelData: MdlModelData;
  sections: MdlSections;
  geometry: Uint8Array; // opaque vertex + index buffers
  filePath?: string; // carried for later transform use; does not affect bytes
}
