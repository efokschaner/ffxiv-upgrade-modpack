import { describe, expect, it } from "vitest";
import {
  emptyMeta,
  type ModpackData,
  ModpackFormat,
} from "../../src/model/modpack";
import { needsMdlFix } from "../../src/upgrade/model";

function data(format: ModpackFormat, ttmp?: string): ModpackData {
  return {
    sourceFormat: format,
    isSimple: false,
    meta: { ...emptyMeta(), sourceTtmpVersion: ttmp },
    groups: [],
  };
}

describe("needsMdlFix gate", () => {
  it("normalizes TTMP2 below 2.0", () => {
    expect(needsMdlFix(data(ModpackFormat.Ttmp2, "1.3w"))).toBe(true);
    expect(needsMdlFix(data(ModpackFormat.Ttmp2, "1.0s"))).toBe(true);
  });
  it("skips TTMP2 at/above 2.0", () => {
    expect(needsMdlFix(data(ModpackFormat.Ttmp2, "2.1w"))).toBe(false);
    expect(needsMdlFix(data(ModpackFormat.Ttmp2, "2.0"))).toBe(false);
  });
  it("treats legacy .ttmp (no version) as needing the fix", () => {
    expect(needsMdlFix(data(ModpackFormat.TtmpLegacy, undefined))).toBe(true);
  });
  it("never normalizes PMP", () => {
    expect(needsMdlFix(data(ModpackFormat.Pmp, undefined))).toBe(false);
    expect(needsMdlFix(data(ModpackFormat.PmpFolder, undefined))).toBe(false);
  });
});
