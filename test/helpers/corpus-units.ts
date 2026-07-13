import { corpusPacks } from "./corpus-roots";

// Pure enumeration of corpus work units. Depends ONLY on node:fs/node:path (via corpus-roots) and
// runs NO test registration on import, so the Node-API runner can import it outside any test
// worker. The vitest-dependent dispatch lives in corpus-register.ts (loaded only inside workers).

export type CheckKind =
  | "sqpack"
  | "golden"
  | "mtrl"
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
 * the fixed check order [sqpack, golden, mtrl, tex, mdl, geometry, upgrade, resave]. sqpack is ONE
 * unit (its three tests share one decode via beforeAll). The index into this array is the virtual
 * module's identity.
 *
 * There used to be a ninth, PMP-only "pmp" check (`registerPmpManifestChecks`, formerly
 * corpus-pmp.ts) that compared `writePmp(readPmp(x))` structurally against the SOURCE `x`. Retired
 * (2026-07-13, PMP writer regeneration): its whole premise was that our writer round-trips the
 * source manifest near-verbatim, which is now false BY DESIGN — TexTools itself never round-trips
 * either (PMP.WritePmp regenerates Files/FileSwaps/Manipulations/every typed field from its model,
 * see src/container/pmp.ts), and reproducing that is the fix this branch makes. Its actual PURPOSE
 * — an INDEPENDENT check of PMP manifest fidelity, since `golden` alone can't catch a reader bug
 * that corrupts both sides of its self round-trip identically (see corpus-golden.ts's doc comment,
 * now updated) — is properly superseded by `resave`: it compares our writer against ConsoleTools'
 * OWN independent implementation (real ground truth), not a self-referential "unchanged from
 * source" assumption, so it has no blind spot `pmp` ever closed and is strictly the better check.
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
  }
  return units;
}
