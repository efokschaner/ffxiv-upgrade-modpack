import { registerAssetChecks } from "./corpus-assets";
import { registerGoldenCheck } from "./corpus-golden";
import { registerResaveCheck } from "./corpus-resave";
import { type CheckKind, enumerateUnits } from "./corpus-units";
import { registerUpgradeCheck } from "./corpus-upgrade";

// Loaded ONLY inside a Vitest worker (via the virtual corpus-unit module). Statically imports the
// vitest-dependent check helpers, so it must never be imported from the runner — keep enumeration
// (corpus-units.ts) separate for that reason.
//
// `assets` fans out to the five asset-level families (sqpack/mtrl/tex/mdl/geometry) over one shared
// decode; see corpus-assets.ts.
const DISPATCH: Record<CheckKind, (pack: string) => void> = {
  assets: registerAssetChecks,
  golden: registerGoldenCheck,
  upgrade: registerUpgradeCheck,
  resave: registerResaveCheck,
};

/** Register the checks for the unit at `index` in enumerateUnits(). Called by the virtual module
 * the runner creates for that index. Throws on a stale/out-of-range index. */
export function registerUnit(index: number): void {
  const units = enumerateUnits();
  const unit = units[index];
  if (!unit) {
    throw new Error(
      `corpus unit index ${index} out of range (have ${units.length})`,
    );
  }
  DISPATCH[unit.check](unit.pack);
}
