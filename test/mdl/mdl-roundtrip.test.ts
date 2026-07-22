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

  it("round-trips a model with a trailing gap (modelDataSize > named sections)", () => {
    // Splice a real 48-byte gap between the named model-data sections and the geometry tail (the
    // fixture's own geometry is only 16 B, too small to grow modelDataSize into), and bump
    // modelDataSize by 48 so it must be carried opaquely as `trailing` for the round-trip to hold.
    const base = buildMinimalMdl(5);
    const baseDv = new DataView(base.buffer);
    const modelDataStart = 68 + baseDv.getUint32(4, true);
    const modelDataEnd = modelDataStart + baseDv.getUint32(8, true);
    const gap = new Uint8Array(48).map((_, i) => (i * 3 + 5) & 0xff);
    const grown = new Uint8Array(base.length + 48);
    grown.set(base.subarray(0, modelDataEnd), 0);
    grown.set(gap, modelDataEnd);
    grown.set(base.subarray(modelDataEnd), modelDataEnd + 48);
    new DataView(grown.buffer).setUint32(
      8,
      baseDv.getUint32(8, true) + 48,
      true,
    );
    expect(serializeMdl(parseMdl(grown))).toEqual(grown);
  });

  it("round-trips a model whose declared boneless-part boxes are absent (Mdl.cs:1003-1014)", () => {
    const x = buildMinimalMdl(5, false, { count: 3, omitBoxes: true });
    expect(serializeMdl(parseMdl(x))).toEqual(x);
  });

  it("is exported from the package index", async () => {
    const idx = await import("../../src/index");
    expect(typeof idx.parseMdl).toBe("function");
    expect(typeof idx.serializeMdl).toBe("function");
  });
});
