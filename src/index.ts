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
import { makeTtmpLoadFix } from "./upgrade/load-fixes";

export const VERSION = "0.0.0";
export { detectFormat } from "./container/detect";
export { parseMdl, serializeMdl } from "./mdl/mdl";
export type { MdlModelData, XivMdl } from "./mdl/types";
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
  generateMipmaps,
  parseTex,
  resizeToPowerOfTwo,
  serializeTex,
} from "./tex/tex";
export type { XivTex } from "./tex/types";
export { cloneModpack, upgradeModpack } from "./upgrade/upgrade";
export { EUpgradeTextureUsage, type UpgradeInfo } from "./upgrade/upgrade-info";

// `makeTtmpLoadFix` fuses TexTools' load-time fixes into the read seam: loadModpack now returns
// already-load-fixed data, matching WizardData.FromModpack (the load path both /upgrade and /resave
// take). The upgrade-layer factory (the fix logic) is injected here so the container readers stay
// independent of it — the readers themselves only import the pure gate predicates, never the fix (see
// container/load-fix.ts). PMP has no analogue on this path (needsTexFix/needsMdlFix are false for
// PMP), so readPmp takes no fix.
export function loadModpack(name: string, bytes: Uint8Array): ModpackData {
  const fmt = detectFormat(name);
  switch (fmt) {
    case ModpackFormat.Ttmp2:
      return readTtmp2(bytes, makeTtmpLoadFix);
    case ModpackFormat.TtmpLegacy:
      return readLegacyTtmp(bytes, makeTtmpLoadFix);
    case ModpackFormat.Pmp:
      return readPmp(bytes);
    default:
      throw new Error(`Unsupported modpack: ${name}`);
  }
}

/** `opts.store` is a PMP-only test-speed knob — see writePmp. It is ignored for ttmp2, whose
 * members are already stored (the .mpd carries pre-compressed SQPack payloads). */
export function writeModpack(
  data: ModpackData,
  target: "ttmp2" | "pmp",
  opts: { store?: boolean } = {},
): Uint8Array {
  const needed =
    target === "ttmp2"
      ? FileStorageType.SqPackCompressed
      : FileStorageType.RawUncompressed;
  const bad = allFiles(data).find(({ file }) => file.storage !== needed);
  if (bad) {
    throw new Error(
      `Cross-format conversion is not supported: cannot write a ${bad.file.storage} file ` +
        `("${bad.gamePath}") to ${target}. Same-format re-emit only ` +
        `(ttmp2/ttmp -> ttmp2, pmp -> pmp).`,
    );
  }
  return target === "ttmp2" ? writeTtmp2(data) : writePmp(data, opts);
}
