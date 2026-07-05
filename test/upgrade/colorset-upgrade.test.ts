import { describe, expect, it } from "vitest";
import { SHPK_CHARACTER_LEGACY } from "../../src/mtrl/shader";
import {
  upgradeColorsetData,
  upgradeDyeData,
} from "../../src/upgrade/colorset-upgrade";
import { floatToHalf } from "../../src/util/half";

describe("upgradeColorsetData", () => {
  it("expands 256 halves to 1024 and places row 0 diffuse", () => {
    const old = new Array<number>(256).fill(0);
    old[0] = floatToHalf(0.25); // diffuse R
    old[1] = floatToHalf(0.5); // diffuse G
    old[2] = floatToHalf(0.75); // diffuse B
    old[7] = floatToHalf(0.9); // legacy gloss -> new diffuse alpha (offset+3)
    const out = upgradeColorsetData(old, SHPK_CHARACTER_LEGACY);
    expect(out.length).toBe(1024);
    expect(out[0]).toBe(floatToHalf(0.25));
    expect(out[1]).toBe(floatToHalf(0.5));
    expect(out[2]).toBe(floatToHalf(0.75));
    expect(out[3]).toBe(floatToHalf(0.9)); // legacy spec-power/gloss swap
    // subsurface alpha default injected at row0 offset 26
    expect(out[26]).toBe(floatToHalf(1.0));
    // untouched extra rows carry the default template
    expect(out[16 * 32 + 7 * 4 + 0]).toBe(floatToHalf(16.0));
  });
});

describe("upgradeDyeData", () => {
  it("remaps a 5-bit template block to 32-bit with +1000 for non-legacy", () => {
    const old = new Uint8Array(32);
    // block 0: template 3, dyebits 0x1F  -> low16 = (3<<5)|0x1F = 0x7F
    old[0] = 0x7f;
    old[1] = 0x00;
    const legacy = upgradeDyeData(old, SHPK_CHARACTER_LEGACY);
    expect(legacy.length).toBe(128);
    const dvL = new DataView(legacy.buffer);
    expect(dvL.getUint32(0, true)).toBe((3 << 16) | 0x1f);
    const nonLegacy = upgradeDyeData(old, "characterglass.shpk");
    const dvN = new DataView(nonLegacy.buffer);
    expect(dvN.getUint32(0, true)).toBe((1003 << 16) | 0x1f);
  });
});
