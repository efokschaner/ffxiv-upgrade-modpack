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

  it("distinguishes two diagnostics on the same file by code", () => {
    const a: FileDiff = {
      kind: "diagnostic",
      gamePath: "x.tex",
      index: 0,
      status: "added",
      code: "hair-transform-failed",
    };
    const b: FileDiff = {
      kind: "diagnostic",
      gamePath: "x.tex",
      index: 0,
      status: "added",
      code: "unported-gap",
    };
    // b must NOT be allowed by a baseline containing only a — otherwise a regression to a different
    // failure on the same file passes silently.
    expect(compareToBaseline([b], [a]).ok).toBe(false);
    expect(compareToBaseline([a], [a]).ok).toBe(true);
  });

  it("is UNAFFECTED for non-diagnostic kinds by a stray `code` field — old baselines keep matching", () => {
    // `code` is only supposed to participate in identity for kind: "diagnostic". A "payload" entry
    // carrying a `code` field (which should never happen in practice, but the type allows it since
    // `code` is optional on the shared FileDiff) must key EXACTLY as it did before this field
    // existed — otherwise every one of the ~85 existing payload/manifest/structure/roundtrip/
    // transform baseline entries could silently stop matching their recorded baseline.
    const baseline: FileDiff[] = [
      { kind: "payload", gamePath: "a.tex", index: 0, status: "mismatch" },
    ];
    const actualNoCode: FileDiff[] = [
      { kind: "payload", gamePath: "a.tex", index: 0, status: "mismatch" },
    ];
    const actualWithStrayCode: FileDiff[] = [
      {
        kind: "payload",
        gamePath: "a.tex",
        index: 0,
        status: "mismatch",
        code: "some-code",
      },
    ];
    expect(compareToBaseline(actualNoCode, baseline).ok).toBe(true);
    expect(compareToBaseline(actualWithStrayCode, baseline).ok).toBe(true);
  });
});

describe("diagnostic FileDiff round-trips through the baseline store", () => {
  it("saveBaseline -> loadBaseline -> compareToBaseline preserves a diagnostic entry intact", () => {
    const dir = mkdtempSync(join(tmpdir(), "baseline-"));
    try {
      const diagnostic: FileDiff[] = [
        {
          kind: "diagnostic",
          gamePath: "chara/hair/x.tex",
          index: 0,
          status: "added",
          code: "hair-transform-failed",
          detail: "MergePixelData failed: shape mismatch",
        },
      ];
      saveBaseline("k", diagnostic, dir);
      const loaded = loadBaseline("k", dir);
      expect(loaded).toEqual(diagnostic);
      // Round-tripped entry still confirms itself, and still rejects a same-file diagnostic with a
      // different code (the identity-carrying field survived serialization).
      expect(compareToBaseline(diagnostic, loaded ?? []).ok).toBe(true);
      const differentCode: FileDiff[] = [
        { ...diagnostic[0]!, code: "unported-gap" },
      ];
      expect(compareToBaseline(differentCode, loaded ?? []).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
