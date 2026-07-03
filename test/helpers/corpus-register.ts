import { enumerateUnits, type CheckKind } from "./corpus-units";
import { registerSqpackChecks } from "./corpus-sqpack";
import { registerGoldenCheck } from "./corpus-golden";
import { registerMtrlChecks } from "./corpus-mtrl";
import { registerPmpManifestChecks } from "./corpus-pmp";

// Loaded ONLY inside a Vitest worker (via the virtual corpus-unit module). Statically imports the
// vitest-dependent check helpers, so it must never be imported from the runner — keep enumeration
// (corpus-units.ts) separate for that reason.
const DISPATCH: Record<CheckKind, (pack: string) => void> = {
  sqpack: registerSqpackChecks,
  golden: registerGoldenCheck,
  mtrl: registerMtrlChecks,
  pmp: registerPmpManifestChecks,
};

/** Register the checks for the unit at `index` in enumerateUnits(). Called by the virtual module
 * the runner creates for that index. Throws on a stale/out-of-range index. */
export function registerUnit(index: number): void {
  const units = enumerateUnits();
  const unit = units[index];
  if (!unit) {
    throw new Error(`corpus unit index ${index} out of range (have ${units.length})`);
  }
  DISPATCH[unit.check](unit.pack);
}
