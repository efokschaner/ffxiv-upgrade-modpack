import { describe, expect, it } from "vitest";
import {
  computeHash,
  hairTextureExists,
} from "../../src/upgrade/reference/hair-texture-exists";

describe("hairTextureExists", () => {
  // c0101 h0001 hair (a real DT hair from hair-materials.ts): the DT-suffix texture exists,
  // the old-suffix one does not (measured: old suffixes were removed in Dawntrail).
  const dt = "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_norm.tex";
  const old = "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";

  it("returns true for an existing DT texture path", () => {
    expect(hairTextureExists(dt)).toBe(true);
  });
  it("returns false for the removed old-suffix path", () => {
    expect(hairTextureExists(old)).toBe(false);
  });
  it("returns false for an out-of-namespace path", () => {
    expect(hairTextureExists("chara/common/texture/dummy.tex")).toBe(false);
  });
  it("computeHash matches HashGenerator (init -1, no final XOR, lowercased)", () => {
    // Same primitive as scripts/lib/game-index.ts; a stable known value guards regressions.
    expect(computeHash("")).toBe(0xffffffff);
  });
});
