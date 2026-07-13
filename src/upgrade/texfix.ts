// Load-time texture-fix gate + drop (upgrade layer). Mirrors TTMP.cs:
// DoesModpackNeedFix (TTMP.cs:916-930) — the version gate (TTMP major < 2, or
// major==2 && minor==0, needs the tex fix; PMP never does, per WizardData.cs's PMP
// bypass and the sibling needsMdlFix rule); MakeFileStorageInformationDictionary
// (TTMP.cs:1367-1379) — the per-.tex try { FixOldTexData } catch { continue } drop,
// with the `!file.FullPath.StartsWith("ui/")` exclusion. FixOldTexData itself
// (TTMP.cs:1413-1418) no-ops for a file that isn't compressed.
//
// This is the MINIMAL subset of FixOldTexData: a load-time validity check that drops
// a `.tex` whose SqPack Type-4 entry fails to decode (a malformed placeholder
// texture — see decodeType4's Dat.cs:908-909 throw). The rest of FixOldTexData
// (NPOT-resize / mip-offset-fixup / recompress) is deferred — see BACKLOG.md.
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../model/modpack";
import { decodeSqPackFile } from "../sqpack/sqpack";

/** Parse a TTMPVersion like "1.3w"/"2.1s"/"2.0" to its integer minor component (leading digits only). */
function ttmpMinor(v: string): number {
  const m = /^(\d+)/.exec(v);
  return m ? Number(m[1]) : 0;
}

/**
 * True when the pack's `.tex` files get FixOldTexData at load: TTMP (any legacy/v1)
 * with major < 2, or major == 2 && minor == 0. PMP never does. Mirrors
 * DoesModpackNeedFix (TTMP.cs:916-930): empty/missing version is treated as "0.0".
 */
export function needsTexFix(data: ModpackData): boolean {
  if (
    data.sourceFormat === ModpackFormat.Pmp ||
    data.sourceFormat === ModpackFormat.PmpFolder
  ) {
    return false;
  }
  const version = data.meta.sourceTtmpVersion || "0.0";
  const parts = version.split(".");
  const major = Number.parseInt(parts[0]!, 10) || 0;
  const minor = parts.length > 1 ? ttmpMinor(parts[1]!) : 0;
  if (major < 2) return true;
  if (major === 2 && minor === 0) return true;
  return false;
}

const IS_TEX = /\.tex$/;
const IS_UI = /^ui\//;

/**
 * Load-time drop of malformed `.tex` files (MakeFileStorageInformationDictionary,
 * TTMP.cs:1367-1379). When the pack needs the tex fix, every compressed, non-`ui/`
 * `.tex` file is decoded as a validity check; a decode failure drops the file from
 * `option.files` (mirrors the C#'s `catch { continue }`, which skips adding the file
 * to the returned dictionary — omission from a later dictionary read is TTMP's own
 * "gone" semantics, so we drop it here too). This is only a validity check: the kept
 * file's stored bytes are unchanged (the decoded bytes are discarded, not written back).
 * Mutates `option.files` in place for every option in `data`.
 */
export function texFixRound(data: ModpackData): void {
  if (!needsTexFix(data)) return;
  for (const group of data.groups) {
    for (const option of group.options) {
      option.files = option.files.filter((f) => {
        if (!IS_TEX.test(f.gamePath)) return true;
        if (IS_UI.test(f.gamePath)) return true;
        // Narrows `f` to the SqPackCompressed variant, whose `data` is non-optional (model/modpack.ts)
        // — absent files are PMP-only (RawUncompressed) and PMP never needs the tex fix (needsTexFix),
        // so this gate alone already guarantees `f.data` is present below.
        if (f.storage !== FileStorageType.SqPackCompressed) return true;
        try {
          decodeSqPackFile(f.data);
          return true;
        } catch {
          return false;
        }
      });
    }
  }
}
