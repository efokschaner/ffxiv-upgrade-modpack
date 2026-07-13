import { corpusPacks } from "./corpus-roots";

// Pure enumeration of corpus work units. Depends ONLY on node:fs/node:path (via corpus-roots) and
// runs NO test registration on import, so the Node-API runner can import it outside any test
// worker. The vitest-dependent dispatch lives in corpus-register.ts (loaded only inside workers).

export type CheckKind =
  | "sqpack"
  | "golden"
  | "mtrl"
  | "pmp"
  | "tex"
  | "mdl"
  | "geometry"
  | "upgrade"
  | "resave";
export interface Unit {
  pack: string;
  check: CheckKind;
}

/**
 * Every (pack × check-family) work unit, in a stable order: packs sorted ascending, then per pack
 * the fixed check order [sqpack, golden, mtrl, tex, mdl, geometry, upgrade, resave, (pmp if .pmp)].
 * sqpack is ONE unit (its three tests share one decode via beforeAll). The index into this array is
 * the virtual module's identity.
 */
export function enumerateUnits(): Unit[] {
  const units: Unit[] = [];
  for (const pack of corpusPacks()) {
    units.push({ pack, check: "sqpack" });
    units.push({ pack, check: "golden" });
    units.push({ pack, check: "mtrl" });
    units.push({ pack, check: "tex" });
    units.push({ pack, check: "mdl" });
    units.push({ pack, check: "geometry" });
    units.push({ pack, check: "upgrade" });
    units.push({ pack, check: "resave" });
    if (pack.toLowerCase().endsWith(".pmp")) units.push({ pack, check: "pmp" });
  }
  return units;
}
