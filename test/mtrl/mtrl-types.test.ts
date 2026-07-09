import { describe, expect, it } from "vitest";
import {
  colorSetDataSize,
  EMPTY_SAMPLER_PREFIX,
  getRealSamplerCount,
  isPrimaryMapSampler,
  SAMPLER_COLOR_MAP_1,
  SAMPLER_NORMAL_MAP_0,
  SAMPLER_NORMAL_MAP_1,
  secondarySamplerId,
  shaderConstantsDataSize,
  type XivMtrl,
} from "../../src/mtrl/types";

function baseMtrl(): XivMtrl {
  return {
    signature: 0x00000301,
    shaderPackRaw: "character.shpk",
    additionalData: new Uint8Array(4),
    textures: [],
    uvMapStrings: [],
    colorsetStrings: [],
    colorSetData: [],
    colorSetDyeData: new Uint8Array(0),
    shaderKeys: [],
    shaderConstants: [],
    materialFlags: 0,
    materialFlags2: 0,
    mtrlPath: "",
  };
}

describe("mtrl computed helpers", () => {
  it("computes colorSetDataSize as data*2 + dye", () => {
    const m = baseMtrl();
    m.colorSetData = new Array(256).fill(0);
    m.colorSetDyeData = new Uint8Array(32);
    expect(colorSetDataSize(m)).toBe(544); // 256*2 + 32
  });

  it("computes shaderConstantsDataSize as sum of values*4", () => {
    const m = baseMtrl();
    m.shaderConstants = [
      { constantId: 1, values: [0, 0, 0] },
      { constantId: 2, values: [0] },
    ];
    expect(shaderConstantsDataSize(m)).toBe(16); // (3 + 1) * 4
  });

  it("maps primary Map0 samplers to their secondary and rejects others", () => {
    expect(isPrimaryMapSampler(SAMPLER_NORMAL_MAP_0)).toBe(true);
    expect(secondarySamplerId(SAMPLER_NORMAL_MAP_0)).toBe(SAMPLER_NORMAL_MAP_1);
    expect(isPrimaryMapSampler(SAMPLER_NORMAL_MAP_1)).toBe(false);
    expect(secondarySamplerId(0x12345678)).toBeUndefined();
  });

  it("single-UV real sampler count is just samplers present", () => {
    const m = baseMtrl();
    m.uvMapStrings = [{ value: "uv1", flags: 0 }];
    m.textures = [
      {
        texturePath: "n.tex",
        flags: 0,
        sampler: { samplerIdRaw: SAMPLER_NORMAL_MAP_0, samplerSettingsRaw: 0 },
      },
    ];
    expect(getRealSamplerCount(m)).toBe(1);
  });

  it("double-UV Map0 sampler is double-counted unless its secondary already exists", () => {
    const m = baseMtrl();
    m.uvMapStrings = [
      { value: "uv1", flags: 0 },
      { value: "uv2", flags: 0 },
    ];
    m.textures = [
      {
        texturePath: "n.tex",
        flags: 0,
        sampler: { samplerIdRaw: SAMPLER_NORMAL_MAP_0, samplerSettingsRaw: 0 },
      },
    ];
    expect(getRealSamplerCount(m)).toBe(2); // primary + regenerated secondary

    // If another texture already carries the secondary, it is not double-counted.
    m.textures.push({
      texturePath: "n2.tex",
      flags: 0,
      sampler: { samplerIdRaw: SAMPLER_NORMAL_MAP_1, samplerSettingsRaw: 0 },
    });
    expect(getRealSamplerCount(m)).toBe(2); // 2 present, no extra double-write
    expect(SAMPLER_COLOR_MAP_1).toBeGreaterThan(0); // constant is exported
  });

  it("counts the secondary double-write for an empty-sampler placeholder, matching C# (audit M2)", () => {
    const m = baseMtrl();
    m.uvMapStrings = [
      { value: "uv1", flags: 0 },
      { value: "uv2", flags: 0 },
    ];
    m.textures = [
      {
        texturePath: EMPTY_SAMPLER_PREFIX + SAMPLER_NORMAL_MAP_0,
        flags: 0,
        sampler: { samplerIdRaw: SAMPLER_NORMAL_MAP_0, samplerSettingsRaw: 0 },
      },
    ];
    // C# GetRealSamplerCount (XivMtrl.cs:262) does NOT special-case placeholders: this one carries a
    // primary NormalMap0 sampler in a 2-UV material with no NormalMap1 present, so it counts the
    // regenerated secondary -> 2. (The prior port skipped placeholders, returning 1 — the M2
    // divergence.) serializeMtrl fails loud on such a material; this asserts the count in isolation.
    expect(getRealSamplerCount(m)).toBe(2);
  });
});
