import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareToBaseline,
  loadBaseline,
  saveBaseline,
} from "./upgrade-baseline";
import type { FileDiff } from "./upgrade-diff";

describe("ratchet idOf / compareToBaseline", () => {
  it("treats a kind-less baseline entry as a payload entry (backward compat)", () => {
    const legacy = [
      { gamePath: "a.tex", index: 0, status: "mismatch" },
    ] as unknown as FileDiff[];
    const actual: FileDiff[] = [
      { kind: "payload", gamePath: "a.tex", index: 0, status: "mismatch" },
    ];
    expect(compareToBaseline(actual, legacy).ok).toBe(true);
  });

  it("does NOT let a payload baseline entry excuse a manifest regression at the same path", () => {
    const baseline: FileDiff[] = [
      { kind: "payload", gamePath: "meta.json", index: 0, status: "mismatch" },
    ];
    const actual: FileDiff[] = [
      { kind: "manifest", gamePath: "meta.json", index: 0, status: "mismatch" },
    ];
    expect(compareToBaseline(actual, baseline).ok).toBe(false);
  });
});

describe("saveBaseline: an empty diff set removes the file", () => {
  const diff: FileDiff[] = [
    { kind: "payload", gamePath: "a.tex", index: 0, status: "mismatch" },
  ];

  it("writes nothing for a pack with no divergences", () => {
    const dir = mkdtempSync(join(tmpdir(), "baseline-"));
    try {
      saveBaseline("k", [], dir);
      expect(existsSync(join(dir, "k.json"))).toBe(false);
      // Absent and empty must assert the SAME thing -- this is what makes not writing safe.
      expect(loadBaseline("k", dir) ?? []).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("REMOVES an existing baseline when its last divergence is fixed (burn-down terminal state)", () => {
    const dir = mkdtempSync(join(tmpdir(), "baseline-"));
    try {
      saveBaseline("k", diff, dir);
      expect(loadBaseline("k", dir)).toEqual(diff);

      saveBaseline("k", [], dir); // re-bless after the fix
      expect(existsSync(join(dir, "k.json"))).toBe(false);
      // And the now-absent baseline rejects any future divergence outright.
      expect(compareToBaseline(diff, loadBaseline("k", dir) ?? []).ok).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
