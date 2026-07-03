import { detectFormat } from "./container/detect";
import { readPmp, writePmp } from "./container/pmp";
import { readLegacyTtmp } from "./container/ttmp-legacy";
import { readTtmp2, writeTtmp2 } from "./container/ttmp2";
import {
  allFiles,
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "./model/modpack";

export const VERSION = "0.0.0";
export { detectFormat } from "./container/detect";
export * from "./model/modpack";
export { parseMtrl, serializeMtrl } from "./mtrl/mtrl";
export type {
  MtrlString,
  MtrlTexture,
  ShaderConstant,
  ShaderKey,
  TextureSampler,
  XivMtrl,
} from "./mtrl/types";
export {
  type DecodedFile,
  decodeSqPackFile,
  detectTypeFromGamePath,
  encodeSqPackFile,
  SqPackType,
} from "./sqpack/sqpack";
export {
  decodeToRgba,
  encodeUncompressedTex,
  parseTex,
  serializeTex,
} from "./tex/tex";
export type { XivTex } from "./tex/types";

export function loadModpack(name: string, bytes: Uint8Array): ModpackData {
  const fmt = detectFormat(name);
  switch (fmt) {
    case ModpackFormat.Ttmp2:
      return readTtmp2(bytes);
    case ModpackFormat.TtmpLegacy:
      return readLegacyTtmp(bytes);
    case ModpackFormat.Pmp:
      return readPmp(bytes);
    default:
      throw new Error(`Unsupported modpack: ${name}`);
  }
}

export function writeModpack(
  data: ModpackData,
  target: "ttmp2" | "pmp",
): Uint8Array {
  const needed =
    target === "ttmp2"
      ? FileStorageType.SqPackCompressed
      : FileStorageType.RawUncompressed;
  const bad = allFiles(data).find((f) => f.storage !== needed);
  if (bad) {
    throw new Error(
      `Cross-format conversion is not supported: cannot write a ${bad.storage} file ` +
        `("${bad.gamePath}") to ${target}. Same-format re-emit only ` +
        `(ttmp2/ttmp -> ttmp2, pmp -> pmp).`,
    );
  }
  return target === "ttmp2" ? writeTtmp2(data) : writePmp(data);
}
