import { detectFormat } from "./container/detect";
import { ModpackFormat, type ModpackData } from "./model/modpack";
import { readTtmp2, writeTtmp2 } from "./container/ttmp2";
import { readLegacyTtmp } from "./container/ttmp-legacy";
import { readPmp, writePmp } from "./container/pmp";

export const VERSION = "0.0.0";
export * from "./model/modpack";
export { detectFormat } from "./container/detect";

export function loadModpack(name: string, bytes: Uint8Array): ModpackData {
  const fmt = detectFormat(name);
  switch (fmt) {
    case ModpackFormat.Ttmp2: return readTtmp2(bytes);
    case ModpackFormat.TtmpLegacy: return readLegacyTtmp(bytes);
    case ModpackFormat.Pmp: return readPmp(bytes);
    default: throw new Error(`Unsupported modpack: ${name}`);
  }
}

export function writeModpack(data: ModpackData, target: "ttmp2" | "pmp"): Uint8Array {
  return target === "ttmp2" ? writeTtmp2(data) : writePmp(data);
}
