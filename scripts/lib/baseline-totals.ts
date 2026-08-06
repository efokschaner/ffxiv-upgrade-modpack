// Totals across the three ratchet baselines, so a porting step has a number that must go down.
// Reporting only — deliberately NOT part of the test gate (the gate stays unbrittle).

export type BaselineEntry = {
  /** sha256(input pack) — the baseline filename stem. */
  key: string;
  /** Number of FileDiff entries recorded for that pack. */
  count: number;
};

export type BaselineSummary = {
  name: string;
  /** Packs still diverging (a baseline file with at least one entry). */
  packs: number;
  /** Total recorded divergences. */
  diffs: number;
};

/** A pack counts as diverging only if it has at least one recorded diff. saveBaseline deletes a
 *  file whose diff set is empty (test/helpers/upgrade-baseline.ts:76-88), so a `[]` file is
 *  off-spec; treat it as clean rather than inflating the pack count. */
export function summarize(
  name: string,
  entries: BaselineEntry[],
): BaselineSummary {
  return {
    name,
    packs: entries.filter((e) => e.count > 0).length,
    diffs: entries.reduce((n, e) => n + e.count, 0),
  };
}

export function formatReport(summaries: BaselineSummary[]): string {
  const width = Math.max(9, ...summaries.map((s) => s.name.length));
  const row = (name: string, packs: string, diffs: string) =>
    `  ${name.padEnd(width)}  ${packs.padStart(5)}  ${diffs.padStart(6)}`;
  const lines = [
    row("baseline", "packs", "diffs"),
    `  ${"-".repeat(width)}  ${"-".repeat(5)}  ${"-".repeat(6)}`,
  ];
  for (const s of summaries) {
    lines.push(row(s.name, String(s.packs), String(s.diffs)));
  }
  const packs = summaries.reduce((n, s) => n + s.packs, 0);
  const diffs = summaries.reduce((n, s) => n + s.diffs, 0);
  lines.push(row("TOTAL", String(packs), String(diffs)));
  return lines.join("\n");
}
