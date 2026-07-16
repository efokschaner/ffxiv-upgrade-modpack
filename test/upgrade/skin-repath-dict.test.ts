import { describe, expect, it } from "vitest";
import { SKIN_REPATH_DICT } from "../../src/upgrade/skin-repath-dict";

describe("SKIN_REPATH_DICT", () => {
  it("holds exactly the 36 active EndwalkerUpgrade.SkinRepathDict entries", () => {
    expect(SKIN_REPATH_DICT.size).toBe(36);
  });

  it("maps a base-game body diffuse to its _base rename", () => {
    expect(
      SKIN_REPATH_DICT.get(
        "chara/human/c0201/obj/body/b0001/texture/--c0201b0001_d.tex",
      ),
    ).toBe("chara/human/c0201/obj/body/b0001/texture/c0201b0001_base.tex");
  });

  it("maps a Bibo diffuse", () => {
    expect(SKIN_REPATH_DICT.get("chara/bibo/midlander_d.tex")).toBe(
      "chara/bibo_mid_base.tex",
    );
  });

  it("maps a TBSE entry by stripping only the -- prefix", () => {
    expect(
      SKIN_REPATH_DICT.get(
        "chara/human/c0101/obj/body/b0001/texture/--c0101b0001_b_d.tex",
      ),
    ).toBe("chara/human/c0101/obj/body/b0001/texture/c0101b0001_b_d.tex");
  });

  it("maps an Au Ra tail diffuse", () => {
    expect(
      SKIN_REPATH_DICT.get(
        "chara/human/c1401/obj/tail/t0104/texture/--c1401t0104_etc_d.tex",
      ),
    ).toBe("chara/human/c1401/obj/tail/t0104/texture/c1401t0104_etc_base.tex");
  });

  it("does NOT port the inactive commented-out normal (_n) entries", () => {
    expect(
      SKIN_REPATH_DICT.has(
        "chara/human/c0201/obj/body/b0001/texture/--c0201b0001_n.tex",
      ),
    ).toBe(false);
    expect(SKIN_REPATH_DICT.has("chara/bibo/midlander_n.tex")).toBe(false);
  });
});
