// Reports per-baseline pack and diff counts. Reporting only — not part of the gate.
// Usage: npm run baseline:report
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BaselineEntry,
  type BaselineSummary,
  formatReport,
  summarize,
} from "./lib/baseline-totals";

// `__dirname` does not exist in these scripts: they run under plain tsx/ESM, where only Vite's
// test SSR runner injects it. This is the established pattern in scripts/ (see
// scripts/corpus-units-plugin.ts:13).
const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, "..", "test", "corpus");

/** The three ratchets. `roundtrip` records OUR codec contradicting itself with no oracle
 *  involved, so it must NOT move across an oracle re-pin — see the spec §7.2 guard. */
const BASELINES: Array<[string, string]> = [
  ["upgrade", join(CORPUS, ".upgrade-baseline")],
  ["resave", join(CORPUS, ".resave-baseline")],
  ["roundtrip", join(CORPUS, ".roundtrip-baseline")],
];

function readEntries(dir: string): BaselineEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, f), "utf8"));
      return {
        key: f.replace(/\.json$/, ""),
        count: Array.isArray(parsed) ? parsed.length : 0,
      };
    });
}

const summaries: BaselineSummary[] = BASELINES.map(([name, dir]) =>
  summarize(name, readEntries(dir)),
);
console.log(formatReport(summaries));
