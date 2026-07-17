import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Single source of truth for corpus discovery. Depends ONLY on node:fs/node:path (no vitest), so
// both the Node-API runner (corpus-units.ts) and the vitest helpers (oracle.ts) can import it.
// Real mods (test/corpus/real) and authored synthetic packs (test/corpus/synthetic) flow through
// the IDENTICAL pipeline; all roots are gitignored (see .gitignore). See the parity design spec.
const REAL = join(__dirname, "..", "corpus", "real");
const SYNTHETIC = join(__dirname, "..", "corpus", "synthetic");
/** Packs ConsoleTools /upgrade is EXPECTED to error on (the expected-failure /upgrade test). Scoped
 *  to the `upgrade` check only (see enumerateUnits): they exist to prove our port throws exactly
 *  where the oracle throws, NOT to exercise the writer/codec, so they skip the resave/assets/golden
 *  families (which would only surface unrelated, pre-existing writer/codec gaps on their content). */
const UPGRADE_ERROR = join(__dirname, "..", "corpus", "upgrade-error");
const CORPUS_ROOTS = [REAL, SYNTHETIC, UPGRADE_ERROR];

const PACK_RE = /\.(ttmp2?|pmp)$/i;

/** Every corpus pack (real then synthetic then upgrade-error), sorted within each root for a
 *  deterministic order. */
export function corpusPacks(): string[] {
  const out: string[] = [];
  for (const root of CORPUS_ROOTS) {
    if (!existsSync(root)) continue;
    for (const f of readdirSync(root)
      .filter((n) => PACK_RE.test(n))
      .sort()) {
      out.push(join(root, f));
    }
  }
  return out;
}

/** True iff `pack` lives in the upgrade-error root (an expected-failure /upgrade pack). */
export function isUpgradeErrorPack(pack: string): boolean {
  return dirname(pack) === UPGRADE_ERROR;
}
