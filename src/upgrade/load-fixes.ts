// TexTools' per-file LOAD fix, ported from WizardData.FromWizardGroup's inner ModsJsons loop, the
// whole body guarded by `if (File.Exists(finfo.RealPath))` (WizardData.cs:685-738) — both the
// `.meta`/`.rgsp` branch (:685-698, this module ports its `.meta` half) and the tex/mdl `else` branch
// (:699-738) — the fix that runs on each file BEFORE it is collapsed into the option's Files dict.
// FromWizardGroup is the load path both /upgrade (ModpackUpgrader.cs:58 -> FromModpack)
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
import { deserializeMeta } from "../meta/deserialize";
import { yieldsManipulations } from "../meta/manipulations";
import { SqPackType } from "../sqpack/sqpack";
import { normalizeModel } from "./model";
import { requireBytes, restore } from "./upgrade";
import { validateTexFileData } from "./validate-tex";

const IS_TEX = /\.tex$/;
const IS_UI = /^ui\//;
const IS_MDL = /\.mdl$/;
const IS_META = /\.meta$/;

/**
 * Build the FromWizardGroup per-file load fix for a TTMP pack whose gates are `gates`:
 *
 * - `.meta` (WizardData.cs:685-691, `mj.FullPath.EndsWith(".meta") || .EndsWith(".rgsp")`, the
 *   `.meta` half of that branch): UNGATED — the C# check at :685 has no `needsTexFix`/`needsMdlFix`
 *   equivalent, and it is a separate `if` from the tex/mdl work, which sits in the `else` at
 *   :699-738. A `.meta` can never reach the tex/mdl branches in the C#, so this branch runs first
 *   and returns before either gate is consulted. TexTools deserializes the meta straight into
 *   `data.Manipulations` (:690-691) and never adds it to `data.Files` at all — so no `.meta`
 *   survives into the loaded pack there, full stop. We cannot reproduce that half (we have no
 *   in-memory Manipulations list a later PMP.ManipulationsToMetadata-equivalent could re-serialize
 *   from for a TTMP pack): instead we keep a manipulation-*bearing* meta as a file, our stand-in for
 *   those manipulations, later re-materialized by `metadataRound` (mirroring the write-side
 *   `PMP.ManipulationsToMetadata`, PMP.cs:1253-1295) — and drop only the manipulation-*less* ones,
 *   the subset TexTools loses permanently either way. Dropping HERE rather than in the transform
 *   keeps `ModpackUpgrader.AnyChanges` (ModpackUpgrader.cs:25-49) parity on a no-op pack: its
 *   per-option file-set baseline is captured from the load result, and in TexTools a
 *   manipulation-less `.meta` was never part of that file set to begin with. That parity is
 *   necessarily partial, though: it only covers the manipulation-*less* case — a manipulation-bearing
 *   `.meta` still gets rewritten by `metadataRound` regardless of whether its bytes actually changed,
 *   so our port can still report a file change on a pack where TexTools' `AnyChanges` would not (see
 *   docs/backlog/2026-07-13-resave-meta-reconstruction-seam.md, the open seam-fidelity gap for
 *   `reconstructMeta` living in the transform rather than load/write). This is also what
 *   makes housing/furniture packs upgrade at all — `bgcommon/hou/**{i,o}####.meta` carries no
 *   segment (housing uses no IMC, chara-only segments don't apply), so `yieldsManipulations` is
 *   false and the file is dropped, exactly as TexTools drops it via the manipulations-only path.
 *   Byte-identical when kept: the load seam must not rewrite meta bytes; `metadataRound` still owns
 *   reconstruction.
 *
 * - `.tex` when `needsTexFix` (WizardData.cs:701-712): runs the full `ValidateTexFileData`
 *   (`validateTexFileData`, port of EndwalkerUpgrade.ValidateTexFileData / TTMP.FixOldTexData) — NPOT
 *   resize-for-merge (Branch A) and mip-offset fixup (Branch B). A BC-compressed NPOT-with-mips source
 *   is resized and emitted as A8R8G8B8 — we have no BC encoder to match TexTools' nvtt re-encode back
 *   to the original BC format, so this is a CONFIRMED divergence (design spec §3.4;
 *   docs/backlog/2026-07-22-bc-encoder-merge-pixel-data.md), not a fail-loud abort: a real corpus pack
 *   (KK_Sportcar) reaches this path and TexTools upgrades it successfully, so aborting the whole pack
 *   would be worse for the user than the format divergence. A decode failure, or a faithful
 *   resize-guard throw (an unsupported format, or a <64px non-BC7 source — MergePixelData's own
 *   guards), DROPS the file (`null`), matching FromWizardGroup's `catch { continue }` on a
 *   majorly-broken or unfixable texture. The `Tex.CompressTexFile`
 *   recompress step remains deferred (invisible to the golden: we always store uncompressed .tex
 *   payloads pre-SqPack-compression, so there is no observable byte difference). The `ui/` exclusion
 *   here does NOT come from FromWizardGroup itself — `WizardData.cs:701`'s gate is
 *   `needsTexFix && path.EndsWith(".tex")`, with no `ui/` check at all. It is carried instead from a
 *   different C# symbol, `MakeFileStorageInformationDictionary` (`TTMP.cs:1367`,
 *   `!FullPath.StartsWith("ui/")`), preserved verbatim from the retired `texFixRound`.
 *
 * - `.mdl` when `needsMdlFix` (WizardData.cs:714-727): run FixOldModel (normalizeModel) — parse,
 *   build the editable TTModel, re-serialize as a v6 uncompressed model, re-wrapped as a Model
 *   (Type-3) entry. ANY throw (undecodable entry, or an unported model structure normalizeModel
 *   rejects) returns `null` to DROP the file, reproducing FixOldModel's catch -> continue
 *   (WizardData.cs:721-727). This is the drop that closes the model-round-throw divergence: a bad
 *   model no longer kills the whole pack.
 *
 * - Everything else: returned unchanged. (`.rgsp` is NOT handled here — out of scope for this
 *   fix; it still passes through unchanged, which is a known gap, not a divergence — see
 *   docs/backlog/2026-07-21-ttmp-load-rgsp-passthrough.md.)
 */
export function makeTtmpLoadFix(gates: LoadFixGates): LoadFix {
  return (gamePath, file) => {
    if (IS_META.test(gamePath)) {
      // requireBytes (not resolveFile): a TTMP `.meta` always carries a compressed blob at this
      // seam — WizardData.cs:687's GetUncompressedFile is unguarded too — so a missing-bytes case
      // here is a corrupt pack, not a legitimate absent-file path. Fail loud, matching
      // metadataRound's own requireBytes call for the same reason.
      const { bytes } = requireBytes(file, gamePath);
      const meta = deserializeMeta(bytes); // ItemMetadata.Deserialize, ItemMetadata.cs:869-921
      return yieldsManipulations(meta) ? file : null;
    }
    if (gates.needsTexFix && IS_TEX.test(gamePath)) {
      // ui/ carve-out from MakeFileStorageInformationDictionary (TTMP.cs:1367), not FromWizardGroup —
      // preserved verbatim from the retired texFixRound; see this module's header comment.
      if (IS_UI.test(gamePath)) return file;
      try {
        // GetUncompressedFile (TTMP.cs:1426): decode the Type-4 entry; a decode failure throws and is
        // caught below → DROP (FixOldTexData's catch → continue on a majorly-broken texture).
        const { bytes } = requireBytes(file, gamePath);
        const fixed = validateTexFileData(bytes);
        return fixed ? restore(file, fixed, SqPackType.Texture) : file;
      } catch {
        return null; // majorly-broken tex, or a resize guard TexTools also aborts on → drop (continue)
      }
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
