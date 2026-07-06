import { describe, expect, it } from "vitest";
import {
  ESamplerId,
  getDefaultColorsetRow,
  SHPK_CHARACTER_GLASS,
  SHPK_CHARACTER_LEGACY,
  samplerIdToTexUsage,
  XivTexType,
} from "../../src/mtrl/shader";
import type { XivMtrl } from "../../src/mtrl/types";
import { floatToHalf } from "../../src/util/float16";

function mtrl(
  shpk: string,
  keys: { keyId: number; value: number }[] = [],
): XivMtrl {
  return {
    signature: 0x00000301,
    shaderPackRaw: shpk,
    additionalData: new Uint8Array(4),
    textures: [],
    uvMapStrings: [],
    colorsetStrings: [],
    colorSetData: [],
    colorSetDyeData: new Uint8Array(0),
    shaderKeys: keys,
    shaderConstants: [],
    materialFlags: 0,
    materialFlags2: 0,
    mtrlPath: "",
  };
}

describe("samplerIdToTexUsage", () => {
  it("maps the character-material samplers", () => {
    const m = mtrl("character.shpk");
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerNormal, m)).toBe(
      XivTexType.Normal,
    );
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerMask, m)).toBe(
      XivTexType.Mask,
    );
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerIndex, m)).toBe(
      XivTexType.Index,
    );
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerDiffuse, m)).toBe(
      XivTexType.Diffuse,
    );
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerSpecular, m)).toBe(
      XivTexType.Specular,
    );
  });

  it("treats a legacy mask-as-spec material's mask sampler as specular", () => {
    // ShaderHelpers.cs:435 — CharacterLegacy + key 0xB616DC5A==0x600EF9DF
    const m = mtrl(SHPK_CHARACTER_LEGACY, [
      { keyId: 0xb616dc5a, value: 0x600ef9df },
    ]);
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerMask, m)).toBe(
      XivTexType.Specular,
    );
  });

  it("keeps a legacy material's mask as Mask when the mask-as-spec override key is present", () => {
    // ShaderHelpers.cs:436 — override key 0xC8BD1DEF==0xA02F4828 suppresses the mask->spec remap
    const m = mtrl(SHPK_CHARACTER_LEGACY, [
      { keyId: 0xb616dc5a, value: 0x600ef9df },
      { keyId: 0xc8bd1def, value: 0xa02f4828 },
    ]);
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerMask, m)).toBe(
      XivTexType.Mask,
    );
  });
});

describe("getDefaultColorsetRow", () => {
  it("fills the shared base fields", () => {
    const row = getDefaultColorsetRow(SHPK_CHARACTER_LEGACY);
    expect(row.length).toBe(32);
    for (let i = 0; i < 8; i++) expect(row[i]).toBe(floatToHalf(1.0)); // diffuse+spec base
    expect(row[6 * 4 + 2]).toBe(floatToHalf(1.0)); // tile opacity
    expect(row[7 * 4 + 0]).toBe(floatToHalf(16.0));
    expect(row[7 * 4 + 3]).toBe(floatToHalf(16.0));
  });

  it("adds glass-only fields", () => {
    const row = getDefaultColorsetRow(SHPK_CHARACTER_GLASS);
    expect(row[3 * 4 + 2]).toBe(floatToHalf(2.5)); // fresnel term
    expect(row[4 * 4 + 0]).toBe(floatToHalf(0.5)); // roughness
    expect(row[6 * 4 + 3]).toBe(floatToHalf(5)); // submat unknown
  });
});
