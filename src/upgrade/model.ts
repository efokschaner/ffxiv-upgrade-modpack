// Model-normalizer gate + entry (upgrade layer). Mirrors EndwalkerUpgrade/TTMP
// DoesModpackNeedFix (TTMP.cs:918): FixOldModel runs on .mdl when TTMP major < 2.
// The normalizer itself is EndwalkerUpgrade.FixOldModel (EndwalkerUpgrade.cs:190):
// GetXivMdl -> TTModel.FromRaw -> MakeUncompressedMdlFile, emitting a v6 model.
import { parseMdl } from "../mdl/mdl";
import { fromRaw } from "../mdl/model/from-raw";
import { readEditableModel } from "../mdl/model/read-model";
import { makeUncompressedMdl } from "../mdl/model/serialize";
import { type ModpackData, ModpackFormat } from "../model/modpack";

/** Parse a TTMPVersion like "1.3w"/"2.1s"/"2.0" to its integer major component. */
function ttmpMajor(v: string | undefined): number {
  if (!v) return 1; // legacy .ttmp predates the 2.x format → needs the fix
  const m = /^(\d+)/.exec(v);
  return m ? Number(m[1]) : 1;
}

/** True when the pack's models get FixOldModel: TTMP (any legacy/v1) with major < 2. PMP never does. */
export function needsMdlFix(data: ModpackData): boolean {
  if (
    data.sourceFormat === ModpackFormat.Pmp ||
    data.sourceFormat === ModpackFormat.PmpFolder
  ) {
    return false;
  }
  return ttmpMajor(data.meta.sourceTtmpVersion) < 2;
}

/**
 * Normalize one decompressed `.mdl` the way FixOldModel does: parse, build the editable
 * TTModel (LoD0 weld + merges), then re-serialize as a v6 uncompressed model. Returns the
 * normalized uncompressed bytes. Throws (fail-loud) on model structures not yet ported
 * (extra meshes, neck-morph, furniture boxes) — see makeUncompressedMdl.
 */
export function normalizeModel(bytes: Uint8Array, path: string): Uint8Array {
  const rm = readEditableModel(bytes, parseMdl(bytes, path));
  const model = fromRaw(rm);
  model.mdlVersion = 6; // FixOldModel emits v6 (R1: caller-set, ShrinkRay.cs:108)
  return makeUncompressedMdl(model, rm);
}
