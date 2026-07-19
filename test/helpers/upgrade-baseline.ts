import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FileDiff } from "./upgrade-diff";

/** Per-pack ratchet baseline. Under the gitignored test/corpus/ tree (it describes packs that
 * live only there), content-addressed by sha256(input pack) so it self-invalidates on change. */
export const DEFAULT_UPGRADE_BASELINE = join(
  __dirname,
  "..",
  "corpus",
  ".upgrade-baseline",
);

/** Ratchet for the SQPack self round-trip (corpus-sqpack.ts). Same machinery, separate root: these
 * entries record OUR codec contradicting itself (decode(encode(x)) != x), with no oracle involved --
 * see DiffKind's "roundtrip" note. Kept apart from the /upgrade and /resave baselines so a
 * self-consistency defect can never be mistaken for a known TexTools divergence. */
export const DEFAULT_ROUNDTRIP_BASELINE = join(
  __dirname,
  "..",
  "corpus",
  ".roundtrip-baseline",
);

function baselinePath(key: string, dir: string): string {
  return join(dir, `${key}.json`);
}

// Identity for ratchet membership. Deliberately coarse: (gamePath, index, status) only — the
// cosmetic `detail` (byte lengths) AND the actual payload bytes are excluded. This is the right
// granularity for a burn-DOWN ratchet whose whole purpose is to reach an empty baseline:
//   - It reliably catches the regression we care about — a file that currently MATCHES TexTools
//     starting to diverge. Such a file is absent from the baseline, so any new divergence yields a
//     FileDiff not in the allowed set => flagged (see compareToBaseline).
//   - It intentionally does NOT re-check the bytes of an ALREADY-blessed divergent slot. A slot
//     already recorded as `mismatch` is on the known-divergent, to-be-fixed list; letting its wrong
//     bytes change without a re-bless avoids churning the baseline on every transform iteration.
// Once the baseline is burned to empty (all divergences either byte-exact or covered by a content-
// aware DIVERGENCE_RULE), this coarseness is moot: an empty baseline rejects any divergence outright.
// Ratchet identity. `kind` defaults to "payload" so pre-kind baselines (payload-only) still match.
function idOf(f: FileDiff): string {
  return `${f.kind ?? "payload"}|${f.gamePath}#${f.index}:${f.status}`;
}

export function loadBaseline(
  key: string,
  dir: string = DEFAULT_UPGRADE_BASELINE,
): FileDiff[] | null {
  const p = baselinePath(key, dir);
  return existsSync(p)
    ? (JSON.parse(readFileSync(p, "utf8")) as FileDiff[])
    : null;
}

export function saveBaseline(
  key: string,
  files: FileDiff[],
  dir: string = DEFAULT_UPGRADE_BASELINE,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(baselinePath(key, dir), JSON.stringify(files, null, 2));
}

/** PASS when actual ⊆ baseline (by identity). Extra baseline entries are fine (we improved). */
export function compareToBaseline(
  actual: FileDiff[],
  baseline: FileDiff[],
): { ok: boolean; regressions: FileDiff[] } {
  const allowed = new Set(baseline.map(idOf));
  const regressions = actual.filter((f) => !allowed.has(idOf(f)));
  return { ok: regressions.length === 0, regressions };
}
