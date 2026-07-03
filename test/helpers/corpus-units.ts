import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Pure enumeration of corpus work units. Depends ONLY on node:fs/node:path and runs NO test
// registration on import, so the Node-API runner can import it outside any test worker. The
// vitest-dependent dispatch lives in corpus-register.ts (loaded only inside workers).

export type CheckKind = "sqpack" | "golden" | "mtrl" | "pmp";
export interface Unit {
  pack: string;
  check: CheckKind;
}

// Mirrors oracle.ts CORPUS_INPUTS, but SORTED so the unit order is deterministic and identical
// between the runner (which imports this to count specs) and the workers (which index into it).
const CORPUS_INPUTS = join(__dirname, "..", "corpus", "inputs");

function sortedPacks(): string[] {
  if (!existsSync(CORPUS_INPUTS)) return [];
  return readdirSync(CORPUS_INPUTS)
    .filter((f) => /\.(ttmp2?|pmp)$/i.test(f))
    .sort() // deterministic order (single source of truth)
    .map((f) => join(CORPUS_INPUTS, f));
}

/**
 * Every (pack × check-family) work unit, in a stable order: packs sorted ascending, then per pack
 * the fixed check order [sqpack, golden, mtrl, (pmp if .pmp)]. sqpack is ONE unit (its three its
 * share one decode via beforeAll). The index into this array is the virtual module's identity.
 */
export function enumerateUnits(): Unit[] {
  const units: Unit[] = [];
  for (const pack of sortedPacks()) {
    units.push({ pack, check: "sqpack" });
    units.push({ pack, check: "golden" });
    units.push({ pack, check: "mtrl" });
    if (pack.toLowerCase().endsWith(".pmp")) units.push({ pack, check: "pmp" });
  }
  return units;
}
