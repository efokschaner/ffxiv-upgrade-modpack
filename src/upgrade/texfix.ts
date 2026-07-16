// Load-time texture-fix GATE (upgrade layer). Mirrors TTMP.cs DoesModpackNeedFix
// (TTMP.cs:916-930) — the version gate (TTMP major < 2, or major==2 && minor==0, needs the tex
// fix; PMP never does, per WizardData.cs's PMP bypass and the sibling needsMdlFix rule).
//
// The per-.tex DROP that used to live here (`texFixRound`) has moved to the fused load seam:
// makeTtmpLoadFix's `.tex` branch in load-fixes.ts, which reproduces FromWizardGroup's
// fix-before-collapse ordering (WizardData.cs:700-737). This module now owns only the gate,
// exposed two ways: `ttmpNeedsTexFix(version)` (pure, for a reader that has only the parsed
// TTMPVersion string) and `needsTexFix(data)` (for a whole ModpackData); the latter delegates to
// the former so there is one source of truth.
import { type ModpackData, ModpackFormat } from "../model/modpack";

/** Parse a TTMPVersion like "1.3w"/"2.1s"/"2.0" to its integer minor component (leading digits only). */
function ttmpMinor(v: string): number {
  const m = /^(\d+)/.exec(v);
  return m ? Number(m[1]) : 0;
}

/**
 * Pure version gate: true when a TTMP pack of TTMPVersion `version` gets FixOldTexData at load —
 * major < 2, or major == 2 && minor == 0. Mirrors DoesModpackNeedFix (TTMP.cs:916-930): an
 * empty/missing version is treated as "0.0". This is the TTMP-only half of `needsTexFix` (PMP is
 * gated out by the caller), so a reader that only has the parsed version string can call it directly.
 */
export function ttmpNeedsTexFix(version: string | undefined): boolean {
  const parts = (version || "0.0").split(".");
  const major = Number.parseInt(parts[0]!, 10) || 0;
  const minor = parts.length > 1 ? ttmpMinor(parts[1]!) : 0;
  if (major < 2) return true;
  if (major === 2 && minor === 0) return true;
  return false;
}

/**
 * True when the pack's `.tex` files get FixOldTexData at load. PMP never does; a TTMP delegates to
 * `ttmpNeedsTexFix` over its parsed TTMPVersion. Mirrors DoesModpackNeedFix (TTMP.cs:916-930).
 */
export function needsTexFix(data: ModpackData): boolean {
  if (
    data.sourceFormat === ModpackFormat.Pmp ||
    data.sourceFormat === ModpackFormat.PmpFolder
  ) {
    return false;
  }
  return ttmpNeedsTexFix(data.meta.sourceTtmpVersion);
}
