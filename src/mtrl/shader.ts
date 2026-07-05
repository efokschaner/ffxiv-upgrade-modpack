import { floatToHalf } from "../util/half";
import type { XivMtrl } from "./types";

export const SHPK_CHARACTER = "character.shpk";
export const SHPK_CHARACTER_LEGACY = "characterlegacy.shpk";
export const SHPK_CHARACTER_GLASS = "characterglass.shpk";
export const SHPK_HAIR = "hair.shpk";
export const SHPK_SKIN = "skin.shpk";

// ShaderHelpers.cs:480-524 — raw sampler CRCs used by the character/hair transform.
export const ESamplerId = {
  g_SamplerNormal: 0x0c5ec1f1,
  g_SamplerNormalMap0: 0xaab4d9e9,
  g_SamplerNormalMap1: 0xddb3e97f,
  g_SamplerNormal2: 0x0261cdcb,
  g_SamplerTileNormal: 0x92f03e53,
  g_SamplerSpecular: 0x2b99e025,
  g_SamplerSpecularMap0: 0x1bbc2f12,
  g_SamplerSpecularMap1: 0x6cbb1f84,
  g_SamplerDiffuse: 0x115306be,
  g_SamplerColorMap0: 0x1e6fef9c,
  g_SamplerColorMap1: 0x6968df0a,
  g_SamplerMask: 0x8a4e82b6,
  g_SamplerWrinklesMask: 0xb3f13975,
  g_SamplerTileOrb: 0x800be99b,
  g_SamplerIndex: 0x565f8fd8,
} as const;

export enum XivTexType {
  Other = 0,
  Diffuse,
  Normal,
  Specular,
  Mask,
  Index,
}

// ShaderHelpers.cs:432-474 — the chara-relevant subset of SamplerIdToTexUsage.
export function samplerIdToTexUsage(
  samplerId: number,
  mtrl: XivMtrl,
): XivTexType {
  // CharacterLegacy compat (:435-442): a mask sampler reads as specular, UNLESS the
  // explicit mask-as-spec override key 0xC8BD1DEF==0xA02F4828 is also present.
  if (
    mtrl.shaderPackRaw === SHPK_CHARACTER_LEGACY &&
    mtrl.shaderKeys.some(
      (k) => k.keyId === 0xb616dc5a && k.value === 0x600ef9df,
    ) &&
    !mtrl.shaderKeys.some(
      (k) => k.keyId === 0xc8bd1def && k.value === 0xa02f4828,
    ) &&
    samplerId === ESamplerId.g_SamplerMask
  ) {
    return XivTexType.Specular;
  }
  switch (samplerId) {
    case ESamplerId.g_SamplerNormal:
    case ESamplerId.g_SamplerNormal2:
    case ESamplerId.g_SamplerNormalMap0:
    case ESamplerId.g_SamplerNormalMap1:
    case ESamplerId.g_SamplerTileNormal:
      return XivTexType.Normal;
    case ESamplerId.g_SamplerMask:
    case ESamplerId.g_SamplerWrinklesMask:
    case ESamplerId.g_SamplerTileOrb:
      return XivTexType.Mask;
    case ESamplerId.g_SamplerIndex:
      return XivTexType.Index;
    case ESamplerId.g_SamplerDiffuse:
    case ESamplerId.g_SamplerColorMap0:
    case ESamplerId.g_SamplerColorMap1:
      return XivTexType.Diffuse;
    case ESamplerId.g_SamplerSpecular:
    case ESamplerId.g_SamplerSpecularMap0:
    case ESamplerId.g_SamplerSpecularMap1:
      return XivTexType.Specular;
    default:
      return XivTexType.Other;
  }
}

// EndwalkerUpgrade.cs:1229-1282
export function getDefaultColorsetRow(shpk: string): number[] {
  const row = new Array<number>(32).fill(0);
  for (let i = 0; i < 8; i++) row[i] = floatToHalf(1.0);
  row[6 * 4 + 2] = floatToHalf(1.0); // tile opacity
  row[7 * 4 + 0] = floatToHalf(16.0);
  row[7 * 4 + 3] = floatToHalf(16.0);
  if (shpk === SHPK_CHARACTER_GLASS) {
    row[1 * 4 + 3] = floatToHalf(0);
    row[2 * 4 + 3] = floatToHalf(1);
    row[3 * 4 + 0] = floatToHalf(1);
    row[3 * 4 + 1] = floatToHalf(0);
    row[3 * 4 + 2] = floatToHalf(2.5);
    row[4 * 4 + 0] = floatToHalf(0.5);
    row[5 * 4 + 1] = floatToHalf(1);
    row[6 * 4 + 3] = floatToHalf(5);
  }
  return row;
}
