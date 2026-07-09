import { MDL_HEADER, type MdlHeader } from "./types";

/** Parses the 68-byte runtime MDL header. TexTools has no dedicated header struct: the read side
 *  pulls only version@0 and meshCount@12 inline in GetXivMdl (Mdl.cs:363, :355); the full 68-byte
 *  field layout read here — vertexInfoSize@4, modelDataSize@8, LoDCount@64, flags@65 — is the one the
 *  writer emits in MakeUncompressedMdlFile's header block (Mdl.cs:3914-3961). Retains all 68 bytes for
 *  byte-exact replay and extracts the fields the structural walk needs. */
export function parseMdlHeader(bytes: Uint8Array): MdlHeader {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    bytes: bytes.slice(0, MDL_HEADER),
    version: dv.getUint16(0, true),
    vertexInfoSize: dv.getUint32(4, true),
    modelDataSize: dv.getUint32(8, true),
    meshCount: dv.getUint16(12, true),
    lodCount: dv.getUint8(64),
    flags: dv.getUint8(65),
  };
}

/** Replays the retained 68 header bytes verbatim. Byte-exact. NOTE: this ignores the parsed scalar
 *  fields (version/meshCount/...) — they are read-only walk conveniences. A future header mutation must
 *  write into `h.bytes` (see the MdlHeader note in types.ts), not the scalar fields. */
export function serializeMdlHeader(h: MdlHeader): Uint8Array {
  return h.bytes;
}
