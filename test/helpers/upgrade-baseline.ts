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

function baselinePath(key: string, dir: string): string {
  return join(dir, `${key}.json`);
}

/** Identity for ratchet membership — the cosmetic `detail` (byte lengths) is deliberately excluded. */
function idOf(f: FileDiff): string {
  return `${f.gamePath}#${f.index}:${f.status}`;
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
