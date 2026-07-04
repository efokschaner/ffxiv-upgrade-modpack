import { describe, expect, it } from "vitest";
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";
import { buildMinimalMtrl } from "./make-mtrl";

describe("mtrl round-trip", () => {
  it("serializeMtrl(parseMtrl(x)) === x for the hand-built canonical file", () => {
    const x = buildMinimalMtrl();
    const out = serializeMtrl(parseMtrl(x));
    expect(out).toEqual(x);
  });

  it("is exported from the package index", async () => {
    const idx = await import("../../src/index");
    expect(typeof idx.parseMtrl).toBe("function");
    expect(typeof idx.serializeMtrl).toBe("function");
  });
});
