// TexTools' per-file LOAD fix, ported from WizardData.FromWizardGroup's inner ModsJsons loop
// (WizardData.cs:700-737) — the fix that runs on each file BEFORE it is collapsed into the option's
// Files dict. FromWizardGroup is the load path both /upgrade (ModpackUpgrader.cs:58 -> FromModpack)
// and /resave (Program.cs:204) actually take, so these fixes are part of "load", not "upgrade".
//
// `makeTtmpLoadFix` is the factory the TTMP readers call (via the LoadFixFactory seam in
// container/load-fix.ts) once they have parsed the version and computed the tex/mdl gates. The
// reader threads the returned LoadFix through its per-entry loop and applies it BEFORE the
// last-write-wins `.set`, so a file the fix DROPS (returns null for) never overwrites an earlier
// duplicate — exactly FromWizardGroup's `catch { continue }` skipping the `data.Files.Add` below it.
//
// The gate LOGIC (which versions need which fix) lives with each fix's owner — ttmpNeedsTexFix in
// texfix.ts, ttmpNeedsMdlFix in model.ts — and is computed by the reader; this module only performs
// the fix the gates select.
import type { LoadFix, LoadFixGates } from "../container/load-fix";
import { decodeSqPackFile, SqPackType } from "../sqpack/sqpack";
import { normalizeModel } from "./model";
import { requireBytes, restore } from "./upgrade";

const IS_TEX = /\.tex$/;
const IS_UI = /^ui\//;
const IS_MDL = /\.mdl$/;

/**
 * Build the FromWizardGroup per-file load fix for a TTMP pack whose gates are `gates`:
 *
 * - `.tex` when `needsTexFix` (WizardData.cs:701-712): a validity check ONLY. Decode the compressed
 *   Type-4 entry; a decode failure returns `null` to DROP the file (FixOldTexData's catch -> continue
 *   — a majorly-broken texture). A decodable `.tex` is returned UNCHANGED: our FixOldTexData subset
 *   never rewrites bytes (NPOT-resize / mip-fixup / recompress are deferred — see
 *   docs/backlog/2026-07-10-fixoldtexdata-load-round.md). The `ui/` exclusion is inherited from the
 *   sibling load function MakeFileStorageInformationDictionary (TTMP.cs:1367) and preserved verbatim
 *   from the retired `texFixRound`; FromWizardGroup itself (:701) omits it, but the difference is
 *   latent (no golden moves either way) and preserving it keeps this a behaviour-neutral relocation.
 *
 * - `.mdl` when `needsMdlFix` (WizardData.cs:714-727): run FixOldModel (normalizeModel) — parse,
 *   build the editable TTModel, re-serialize as a v6 uncompressed model, re-wrapped as a Model
 *   (Type-3) entry. ANY throw (undecodable entry, or an unported model structure normalizeModel
 *   rejects) returns `null` to DROP the file, reproducing FixOldModel's catch -> continue
 *   (WizardData.cs:721-727). This is the drop that closes the model-round-throw divergence: a bad
 *   model no longer kills the whole pack.
 *
 * - Everything else: returned unchanged. (`.meta`/`.rgsp` are handled by a separate seam — our TTMP
 *   port keeps `.meta` as a file, reconstructed later by metadataRound — so they are not touched here.)
 */
export function makeTtmpLoadFix(gates: LoadFixGates): LoadFix {
  return (gamePath, file) => {
    if (gates.needsTexFix && IS_TEX.test(gamePath)) {
      if (IS_UI.test(gamePath)) return file; // sibling MakeFileStorageInformationDictionary (:1367)
      try {
        decodeSqPackFile(file.data);
      } catch {
        return null; // majorly-broken texture — FixOldTexData catch -> continue
      }
      return file; // validity check only; stored bytes unchanged
    }
    if (gates.needsMdlFix && IS_MDL.test(gamePath)) {
      try {
        const { bytes, type } = requireBytes(file, gamePath);
        return restore(
          file,
          normalizeModel(bytes, gamePath),
          type ?? SqPackType.Model,
        );
      } catch {
        return null; // FixOldModel throw -> continue (drops the file, not the pack)
      }
    }
    return file;
  };
}
