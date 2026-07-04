import { describe, expect, it } from "vitest";
import { parseTex, serializeTex } from "../../src/tex/tex";
import { A8R8G8B8 } from "../../src/tex/types";
import { buildMinimalTex } from "./make-tex";

describe("tex parse/serialize round-trip", () => {
  it("parses the hand-built canonical file", () => {
    const t = parseTex(buildMinimalTex(), "chara/x/texture/test.tex");
    expect(t.format).toBe(A8R8G8B8);
    expect(t.width).toBe(2);
    expect(t.height).toBe(2);
    expect(t.mipCount).toBe(1);
    expect(t.filePath).toBe("chara/x/texture/test.tex");
    expect(t.mipData).toHaveLength(16);
  });

  it("serializeTex(parseTex(x)) === x", () => {
    const x = buildMinimalTex();
    expect(serializeTex(parseTex(x))).toEqual(x);
  });

  it("is exported from the package index", async () => {
    const idx = await import("../../src/index");
    expect(typeof idx.parseTex).toBe("function");
    expect(typeof idx.serializeTex).toBe("function");
  });
});
