import { describe, expect, it } from "vitest";
import {
  type BaselineEntry,
  formatReport,
  summarize,
} from "../../scripts/lib/baseline-totals";

describe("summarize", () => {
  it("counts packs and sums diffs", () => {
    const entries: BaselineEntry[] = [
      { key: "aa", count: 3 },
      { key: "bb", count: 7 },
    ];
    expect(summarize("upgrade", entries)).toEqual({
      name: "upgrade",
      packs: 2,
      diffs: 10,
    });
  });

  it("reports zeroes for an empty baseline dir — the burn-down terminal state", () => {
    expect(summarize("roundtrip", [])).toEqual({
      name: "roundtrip",
      packs: 0,
      diffs: 0,
    });
  });

  it("does not count a zero-length baseline file as a diverging pack", () => {
    // saveBaseline deletes a file when the diff set is empty (upgrade-baseline.ts:76-88), so a
    // `[]` file is off-spec — but if one exists by hand, the pack is not diverging.
    expect(summarize("upgrade", [{ key: "aa", count: 0 }])).toEqual({
      name: "upgrade",
      packs: 0,
      diffs: 0,
    });
  });
});

describe("formatReport", () => {
  it("lists each baseline and a TOTAL", () => {
    const out = formatReport([
      { name: "upgrade", packs: 4, diffs: 312 },
      { name: "resave", packs: 3, diffs: 98 },
      { name: "roundtrip", packs: 1, diffs: 2 },
    ]);
    expect(out).toContain("upgrade");
    expect(out).toContain("312");
    expect(out).toMatch(/TOTAL\s+8\s+412/);
  });

  it("still prints a TOTAL of zero when everything is clean", () => {
    expect(formatReport([{ name: "upgrade", packs: 0, diffs: 0 }])).toMatch(
      /TOTAL\s+0\s+0/,
    );
  });
});
