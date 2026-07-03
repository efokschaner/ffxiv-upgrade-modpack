import { describe, expect, it } from "vitest";
import { detectFormat } from "../src/container/detect";
import { ModpackFormat } from "../src/model/modpack";

describe("detectFormat", () => {
  it("maps extensions to formats", () => {
    expect(detectFormat("pack.ttmp2")).toBe(ModpackFormat.Ttmp2);
    expect(detectFormat("pack.ttmp")).toBe(ModpackFormat.TtmpLegacy);
    expect(detectFormat("pack.pmp")).toBe(ModpackFormat.Pmp);
    expect(detectFormat("meta.json")).toBe(ModpackFormat.Pmp);
    expect(detectFormat("pack.zip")).toBeNull();
  });
});
