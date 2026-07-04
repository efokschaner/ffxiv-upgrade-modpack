import { describe, expect, it } from "vitest";
import { parseMdl, serializeMdl } from "../../src/mdl/mdl";
import { buildMinimalMdl } from "./make-mdl";

describe("mdl parse/serialize round-trip", () => {
  it("serializeMdl(parseMdl(x)) === x for a v5 file", () => {
    const x = buildMinimalMdl(5);
    expect(serializeMdl(parseMdl(x))).toEqual(x);
  });

  it("serializeMdl(parseMdl(x)) === x for a v6 file", () => {
    const x = buildMinimalMdl(6);
    expect(serializeMdl(parseMdl(x))).toEqual(x);
  });

  it("is exported from the package index", async () => {
    const idx = await import("../../src/index");
    expect(typeof idx.parseMdl).toBe("function");
    expect(typeof idx.serializeMdl).toBe("function");
  });
});
