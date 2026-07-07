// Model-normalizer gate + entry (upgrade layer). Mirrors EndwalkerUpgrade/TTMP
// DoesModpackNeedFix (TTMP.cs:918): FixOldModel runs on .mdl when TTMP major < 2.
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
