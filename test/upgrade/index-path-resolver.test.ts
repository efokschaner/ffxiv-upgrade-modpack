import { describe, expect, it } from "vitest";
import {
  idTexExists,
  resolveStolenIndexPath,
} from "../../src/upgrade/reference/index-path-resolver";

describe("index-path-resolver", () => {
  it("drops the variant letter where the game does (e0194)", () => {
    // Confirmed against the committed index-table.ts: regular entry, version=1, keepLetter=false.
    expect(
      resolveStolenIndexPath(
        "chara/equipment/e0194/material/v0001/mt_c0201e0194_top_a.mtrl",
      ),
    ).toBe("chara/equipment/e0194/texture/v01_c0201e0194_top_id.tex");
  });
  it("keeps the variant letter where the game does (e0100)", () => {
    // Confirmed against the committed index-table.ts: regular entry, version=1, keepLetter=true.
    expect(
      resolveStolenIndexPath(
        "chara/equipment/e0100/material/v0001/mt_c0101e0100_top_a.mtrl",
      ),
    ).toBe("chara/equipment/e0100/texture/v01_c0101e0100_top_a_id.tex");
  });
  it("resolves a cross-root exception (accessory ear -> chara/common/texture)", () => {
    // Confirmed against the committed index-table.ts INDEX_EXCEPTIONS map.
    expect(
      resolveStolenIndexPath(
        "chara/accessory/a0011/material/v0003/mt_c0101a0011_ear_a.mtrl",
      ),
    ).toBe("chara/common/texture/id_16.tex");
  });
  it("folds case on the material path (a TTMP2 keys on raw FullPath, no lowercasing)", () => {
    // The hashed table folds case via computeHash and the C# resolution (FileExists/GetXivMtrl) is
    // case-insensitive, so the EXCEPTIONS lookup and the reconstructed output must fold case too.
    // Exception path, mixed case:
    expect(
      resolveStolenIndexPath(
        "chara/accessory/A0011/material/v0003/MT_c0101a0011_EAR_a.mtrl",
      ),
    ).toBe("chara/common/texture/id_16.tex");
    // Regular (packed) path, mixed case — reconstructed output must still be lowercase:
    expect(
      resolveStolenIndexPath(
        "CHARA/equipment/e0194/material/v0001/mt_c0201e0194_top_a.mtrl",
      ),
    ).toBe("chara/equipment/e0194/texture/v01_c0201e0194_top_id.tex");
  });
  it("returns undefined for a non-base material path", () => {
    expect(
      resolveStolenIndexPath(
        "chara/equipment/e9999/material/v0001/mt_c0101e9999_xyz_a.mtrl",
      ),
    ).toBeUndefined();
  });
  it("idTexExists is true for a real base index texture, false otherwise", () => {
    expect(
      idTexExists("chara/equipment/e0194/texture/v01_c0201e0194_top_id.tex"),
    ).toBe(true);
    expect(idTexExists("chara/equipment/e0194/texture/made_up_a_id.tex")).toBe(
      false,
    );
  });
});
