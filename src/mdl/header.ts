import { MDL_HEADER, type MdlHeader } from "./types";

/** Parses the 68-byte runtime MDL header (Mdl.cs). Retains all 68 bytes for byte-exact replay and
 *  extracts the fields the structural walk needs. */
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

/** Replays the retained 68 header bytes verbatim. Byte-exact. */
export function serializeMdlHeader(h: MdlHeader): Uint8Array {
  return h.bytes;
}
