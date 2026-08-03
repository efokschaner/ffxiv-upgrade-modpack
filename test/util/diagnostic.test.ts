import { describe, expect, it } from "vitest";
import { mergeGapContext } from "../../src/util/diagnostic";
import { UnportedGapError } from "../../src/util/errors";

describe("UnportedGapError context", () => {
  it("starts empty and accumulates frames pushed as the error unwinds", () => {
    const err = new UnportedGapError("no bundled data for ui/uld/dummy_id.tex");
    expect(err.context).toEqual([]);
    err.context.push({ gamePath: "ui/uld/dummy_id.tex" });
    err.context.push({ material: "chara/.../mt_c0201e0194_top_a.mtrl" });
    expect(err.context).toHaveLength(2);
  });

  it("keeps the message untouched — identifying detail never goes in message", () => {
    const err = new UnportedGapError("verbatim TexTools text");
    err.context.push({ material: "m.mtrl" });
    expect(err.message).toBe("verbatim TexTools text");
  });
});

describe("mergeGapContext", () => {
  it("merges frames innermost-first so outer frames win on conflict", () => {
    // Frames are pushed as the error unwinds: index 0 is the INNERMOST (deepest) frame.
    // The outer frame knows more about placement (which option), so it takes precedence.
    const merged = mergeGapContext([
      { gamePath: "inner.tex" },
      { material: "outer.mtrl", group: "G", option: "O" },
    ]);
    expect(merged).toEqual({
      gamePath: "inner.tex",
      material: "outer.mtrl",
      group: "G",
      option: "O",
    });
  });

  it("returns an empty frame for no context", () => {
    expect(mergeGapContext([])).toEqual({});
  });
});
