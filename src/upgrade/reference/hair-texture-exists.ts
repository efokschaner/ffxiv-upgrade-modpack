// Runtime FileExists oracle for the hair/zear/tail texture namespace, used by RepathHairMashups
// (src/upgrade/repath-hair-mashups.ts). Ports HashGenerator.ComputeCRC (HashGenerator.cs:154-205)
// and IndexFile.FileExists' hash membership check (IndexFile.cs:516-621) over the bundled,
// namespace-scoped set (hair-texture-index.ts). A miss == the file is absent in-game.
import { base64ToBytes } from "../../util/base64";
import { HAIR_TEX_INDEX_PACKED } from "./hair-texture-index";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC32 of the lowercased path bytes (init -1, no final XOR), matching HashGenerator.ComputeCRC. */
export function computeHash(path: string): number {
  let crc = 0xffffffff;
  const s = path.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    crc = CRC_TABLE[(crc ^ s.charCodeAt(i)) & 0xff]! ^ (crc >>> 8);
  }
  return crc >>> 0;
}

const ENTRIES = (() => {
  const bin = base64ToBytes(HAIR_TEX_INDEX_PACKED);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const set = new Set<string>();
  for (let p = 0; p + 8 <= bin.byteLength; p += 8) {
    set.add(`${dv.getUint32(p, true)}:${dv.getUint32(p + 4, true)}`);
  }
  return set;
})();

/** True iff `path` (folder + "/" + file) is in the bundled hair/zear/tail texture index. Reproduces
 *  rtx.FileExists for the paths RepathHairMashups tests; out-of-namespace paths are a faithful miss. */
export function hairTextureExists(path: string): boolean {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return false;
  const fh = computeHash(path.slice(0, slash));
  const xh = computeHash(path.slice(slash + 1));
  return ENTRIES.has(`${fh}:${xh}`);
}
