import { describe, expect, it } from "vitest";
import { parseMetaRoot } from "./root";

describe("parseMetaRoot", () => {
  it("parses an equipment met meta (Head est)", () => {
    expect(parseMetaRoot("chara/equipment/e0208/e0208_met.meta")).toEqual({
      primaryId: 208,
      slot: "met",
      itemType: "equipment",
      estType: "Head",
      race: null,
    });
  });
  it("parses an equipment top meta (Body est)", () => {
    expect(parseMetaRoot("chara/equipment/e0724/e0724_top.meta")).toEqual({
      primaryId: 724,
      slot: "top",
      itemType: "equipment",
      estType: "Body",
      race: null,
    });
  });
  it("parses an equipment slot with no EST (e.g. glasses)", () => {
    expect(parseMetaRoot("chara/equipment/e0100/e0100_glp.meta")).toEqual({
      primaryId: 100,
      slot: "glp",
      itemType: "equipment",
      estType: null,
      race: null,
    });
  });
  it("parses an accessory (no est)", () => {
    expect(parseMetaRoot("chara/accessory/a0038/a0038_nek.meta")).toEqual({
      primaryId: 38,
      slot: "nek",
      itemType: "accessory",
      estType: null,
      race: null,
    });
  });
  it("parses a hair meta (Hair est), capturing the c#### character race", () => {
    const r = parseMetaRoot(
      "chara/human/c0201/obj/hair/h0135/c0201h0135_hir.meta",
    );
    expect(r.estType).toBe("Hair");
    expect(r.slot).toBe("hir");
    expect(r.primaryId).toBe(135);
    expect(r.race).toBe(201);
  });
  it("parses a face meta (Face est), capturing the c#### character race", () => {
    const r = parseMetaRoot(
      "chara/human/c0301/obj/face/f0001/c0301f0001_fac.meta",
    );
    expect(r.estType).toBe("Face");
    expect(r.slot).toBe("fac");
    expect(r.primaryId).toBe(1);
    expect(r.race).toBe(301);
  });
  it("throws on an unrecognized path", () => {
    expect(() => parseMetaRoot("chara/weapon/w0001/w0001b0001.meta")).toThrow();
  });
});
