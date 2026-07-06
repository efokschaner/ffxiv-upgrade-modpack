import { describe, expect, it } from "vitest";
import {
  SHPK_CHARACTER_GLASS,
  SHPK_CHARACTER_LEGACY,
} from "../../src/mtrl/shader";
import {
  upgradeColorsetData,
  upgradeDyeData,
} from "../../src/upgrade/colorset-upgrade";
import { floatToHalf } from "../../src/util/float16";

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

  it("copies every row-0 field with the legacy spec-power/gloss swaps (raw halves preserved)", () => {
    const old = new Array<number>(256).fill(0);
    for (let k = 0; k < 16; k++) old[k] = 0x1000 + k; // distinct non-zero raw halves in row 0
    const out = upgradeColorsetData(old, SHPK_CHARACTER_LEGACY);
    // diffuse rgb + legacy diffuse-alpha = old specular-power slot (index 7)
    expect(out.slice(0, 4)).toEqual([0x1000, 0x1001, 0x1002, 0x1007]);
    // specular rgb + legacy specular-alpha = old diffuse-gloss slot (index 3)
    expect(out.slice(4, 8)).toEqual([0x1004, 0x1005, 0x1006, 0x1003]);
    // emissive rgb
    expect(out.slice(8, 11)).toEqual([0x1008, 0x1009, 0x100a]);
    // unknown/subsurface-material-id: out[25] = old[11]; out[26] = 1.0 (injected constant)
    expect(out[25]).toBe(0x100b);
    expect(out[26]).toBe(floatToHalf(1.0));
    // subsurface scaling copies old[12..15]
    expect(out.slice(28, 32)).toEqual([0x100c, 0x100d, 0x100e, 0x100f]);
  });

  it("injects the glass specular constant and copies diffuse for CharacterGlass", () => {
    const old = new Array<number>(256).fill(0);
    old[0] = 0x2001;
    old[1] = 0x2002;
    old[2] = 0x2003; // diffuse rgb
    const out = upgradeColorsetData(old, SHPK_CHARACTER_GLASS);
    expect(out.slice(0, 3)).toEqual([0x2001, 0x2002, 0x2003]); // diffuse copied verbatim
    const glassSpec = floatToHalf(0.8100586);
    expect(out.slice(4, 7)).toEqual([glassSpec, glassSpec, glassSpec]); // glass specular constant
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
