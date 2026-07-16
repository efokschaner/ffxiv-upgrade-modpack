// Model-normalizer gate + entry (upgrade layer). Mirrors EndwalkerUpgrade/TTMP
// DoesModpackNeedFix (TTMP.cs:916): FixOldModel runs on .mdl when TTMP major < 2.
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

/**
 * Pure version gate: true when a TTMP pack of TTMPVersion `version` gets FixOldModel at load —
 * major < 2 (an absent version is legacy .ttmp, which predates 2.x → needs the fix). This is the
 * TTMP-only half of `needsMdlFix` (PMP is gated out by the caller), so a reader that only has the
 * parsed version string can call it directly. Mirrors DoesModpackNeedFix (TTMP.cs:916).
 */
export function ttmpNeedsMdlFix(version: string | undefined): boolean {
  return ttmpMajor(version) < 2;
}

/** True when the pack's models get FixOldModel: TTMP (any legacy/v1) with major < 2. PMP never does. */
export function needsMdlFix(data: ModpackData): boolean {
  if (
    data.sourceFormat === ModpackFormat.Pmp ||
    data.sourceFormat === ModpackFormat.PmpFolder
  ) {
    return false;
  }
  return ttmpNeedsMdlFix(data.meta.sourceTtmpVersion);
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
