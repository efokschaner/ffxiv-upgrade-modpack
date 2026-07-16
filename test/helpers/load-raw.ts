import { detectFormat } from "../../src/container/detect";
import { readPmp } from "../../src/container/pmp";
import { readLegacyTtmp } from "../../src/container/ttmp-legacy";
import { readTtmp2 } from "../../src/container/ttmp2";
import { type ModpackData, ModpackFormat } from "../../src/model/modpack";

/**
 * Load a pack WITHOUT TexTools' load-time fixes.
 *
 * `loadModpack` (src/index.ts) now fuses FixOldTexData / FixOldModel into the read seam, so for an
 * old pack (TTMP major < 2 — 49 of the 57 corpus packs) it hands back models normalized to v6 and
 * malformed textures dropped. That is the correct behaviour for the /upgrade and /resave pipelines,
 * but WRONG for the codec-fidelity corpus checks: those must exercise OUR decode/encode/round-trip
 * against the pack's ORIGINAL bytes, not against our own FixOldModel output. Reading through the
 * container readers with no LoadFix factory (the readers' documented "no fix" path) reproduces the
 * pre-fusion load exactly, so those checks are unaffected by the fusion.
 */
export function loadRawModpack(name: string, bytes: Uint8Array): ModpackData {
  switch (detectFormat(name)) {
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
