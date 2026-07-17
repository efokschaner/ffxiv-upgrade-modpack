import { describe, expect, it } from "vitest";
import { dx11Path } from "../../src/mtrl/dx11-path";

describe("dx11Path", () => {
  it("returns the path unchanged when the DX9 flag (0x8000) is clear", () => {
    expect(dx11Path({ texturePath: "chara/a/b_n.tex", flags: 0 })).toBe(
      "chara/a/b_n.tex",
    );
  });

  it("splices the -- marker onto the filename when the DX9 flag is set", () => {
    expect(dx11Path({ texturePath: "chara/a/b_n.tex", flags: 0x8000 })).toBe(
      "chara/a/--b_n.tex",
    );
  });

  it("handles a path with no slash", () => {
    expect(dx11Path({ texturePath: "b_n.tex", flags: 0x8000 })).toBe(
      "/--b_n.tex",
    );
  });
});
