import { describe, expect, it } from "vitest";
import { compareToBaseline } from "./upgrade-baseline";
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
