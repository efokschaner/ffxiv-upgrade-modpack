import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Single source of truth for corpus discovery. Depends ONLY on node:fs/node:path (no vitest), so
// both the Node-API runner (corpus-units.ts) and the vitest helpers (oracle.ts) can import it.
// Real mods (test/corpus/real) and authored synthetic packs (test/corpus/synthetic) flow through
// the IDENTICAL pipeline; both roots are gitignored (see .gitignore). See the parity design spec.
const CORPUS_ROOTS = [
  join(__dirname, "..", "corpus", "real"),
  join(__dirname, "..", "corpus", "synthetic"),
];

const PACK_RE = /\.(ttmp2?|pmp)$/i;

/** Every corpus pack (real then synthetic), sorted within each root for a deterministic order. */
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
