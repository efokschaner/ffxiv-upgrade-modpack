import { describe, expect, it } from "vitest";
import {
  computeHash,
  fileExists,
} from "../../src/upgrade/reference/file-exists";

describe("fileExists", () => {
  // In the old bundled namespace (hair/zear/tail textures): c0101 h0001, a real DT hair.
  const hairDt =
    "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_norm.tex";
  const hairOld =
    "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
  // OUTSIDE it: a face texture. Measured against the live 040000 index (2026-07-31) — the pair the
  // synthetic repro pack is built from.
  const faceDt =
    "chara/human/c0101/obj/face/f0001/texture/c0101f0001_fac_norm.tex";
  const faceOld =
    "chara/human/c0101/obj/face/f0001/texture/c0101f0001_fac_n.tex";

  it("returns true for an existing DT hair texture", () => {
    expect(fileExists(hairDt)).toBe(true);
  });
  it("returns false for the removed old-suffix hair texture", () => {
    expect(fileExists(hairOld)).toBe(false);
  });
  it("answers out-of-namespace paths from the real index, not a hard false", () => {
    expect(fileExists(faceDt)).toBe(true);
    expect(fileExists(faceOld)).toBe(false);
  });
  it("covers chara/common, which the old namespace-scoped table could not", () => {
    expect(fileExists("chara/common/texture/catchlight_1.tex")).toBe(true);
    expect(fileExists("chara/common/texture/dummy.tex")).toBe(false);
  });

  // ModTransaction.FileExists' pre-checks (ModTransaction.cs:1127-1134).
  it("returns false for a blank path (IsNullOrWhiteSpace)", () => {
    expect(fileExists("")).toBe(false);
    expect(fileExists("   ")).toBe(false);
  });
  it("returns false for a path with characters _InvalidRegex rejects", () => {
    // IOUtil.cs:550 — [^a-z0-9./\-_{}], so any uppercase character disqualifies the path.
    expect(fileExists(hairDt.toUpperCase())).toBe(false);
    expect(fileExists("chara/human/c0101/obj/hair/h0001/texture/a b.tex")).toBe(
      false,
    );
  });
  it("returns false for a path under no XivDataFile folder key", () => {
    expect(fileExists("mymod/textures/foo.tex")).toBe(false);
  });

  // Only 040000 is bundled; a real FFXIV path in another category is an honest gap, not a false.
  it("throws for a valid FFXIV path outside the chara category", () => {
    expect(() =>
      fileExists("bgcommon/hou/indoor/general/0000/texture/foo.tex"),
    ).toThrow(/only the chara \(040000\) category is bundled/);
  });

  it("computeHash matches HashGenerator (init -1, no final XOR, lowercased)", () => {
    // Same primitive as scripts/lib/game-index.ts; a stable known value guards regressions.
    expect(computeHash("")).toBe(0xffffffff);
  });
});
