import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameIndex } from "../../scripts/lib/game-index";

const SQPACK =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online\\game\\sqpack\\ffxiv";

describe("GameIndex", () => {
  it("resolves known-present and known-absent chara paths", () => {
    if (!existsSync(`${SQPACK}\\040000.win32.index`)) {
      // Game absent (fresh clone / CI). This reader is dev-only tooling; the real proof of the
      // extracted table is the /upgrade golden (Task 8). Skip cleanly.
      return;
    }
    const idx = GameIndex.load(SQPACK);
    // _SampleHair — guaranteed to exist (EndwalkerUpgrade.cs:56).
    expect(
      idx.fileExists(
        "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl",
      ),
    ).toBe(true);
    expect(
      idx.fileExists(
        "chara/human/c0801/obj/hair/h9999/material/v0001/mt_c0801h9999_hir_a.mtrl",
      ),
    ).toBe(false);
  });
});
