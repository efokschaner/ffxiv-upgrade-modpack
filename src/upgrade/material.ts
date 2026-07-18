import { dx11Path } from "../mtrl/dx11-path";
import {
  ESamplerId,
  SHPK_CHARACTER,
  SHPK_CHARACTER_GLASS,
  SHPK_CHARACTER_LEGACY,
  SHPK_HAIR,
  samplerIdToTexUsage,
  XivTexType,
} from "../mtrl/shader";
import type { MtrlTexture, XivMtrl } from "../mtrl/types";
import { upgradeColorsetData, upgradeDyeData } from "./colorset-upgrade";
import {
  GLASS_ADDITIONAL_DATA,
  GLASS_SHADER_CONSTANTS,
  GLASS_SHADER_KEYS,
} from "./reference/glass-shader-params";
import {
  HAIR_ADDITIONAL_DATA,
  HAIR_SHADER_CONSTANTS,
} from "./reference/hair-shader-params";
import { INDEX_PATH_OVERRIDES } from "./reference/index-path-overrides";
import { EUpgradeTextureUsage, type UpgradeInfo } from "./upgrade-info";

const OLD_SHADER_CONSTANT_1 = 0x36080ad0;
const OLD_SHADER_CONSTANT_2 = 0x992869ab;

// EndwalkerUpgrade.cs:550
export function doesMtrlNeedDawntrailUpdate(mtrl: XivMtrl): boolean {
  if (mtrl.colorSetData.length === 256) return true;
  if (mtrl.shaderPackRaw === SHPK_HAIR) {
    return (
      mtrl.shaderConstants.some(
        (c) => c.constantId === OLD_SHADER_CONSTANT_1,
      ) &&
      mtrl.shaderConstants.some((c) => c.constantId === OLD_SHADER_CONSTANT_2)
    );
  }
  return false;
}

function findByUsage(
  mtrl: XivMtrl,
  usage: XivTexType,
): MtrlTexture | undefined {
  return mtrl.textures.find(
    (t) =>
      t.sampler && samplerIdToTexUsage(t.sampler.samplerIdRaw, mtrl) === usage,
  );
}

function findBySampler(
  mtrl: XivMtrl,
  samplerId: number,
): MtrlTexture | undefined {
  return mtrl.textures.find((t) => t.sampler?.samplerIdRaw === samplerId);
}

// Tiling mode bits live in the low nibble of samplerSettingsRaw (XivMtrl.cs:822-858):
// bits[0:1] = VTilingMode, bits[2:3] = UTilingMode. Used to transplant the normal sampler's
// tiling onto the new index sampler (EndwalkerUpgrade.cs:962-966).
const TILING_BITS_MASK = 0xf;
const INDEX_SAMPLER_SETTINGS_BASE = 0x000f8340;

function upgradeColorsetMaterial(mtrl: XivMtrl): UpgradeInfo[] {
  const infos: UpgradeInfo[] = [];

  // EndwalkerUpgrade.cs:747-751
  if (mtrl.shaderPackRaw === SHPK_CHARACTER) {
    mtrl.shaderPackRaw = SHPK_CHARACTER_LEGACY;
  }

  // EndwalkerUpgrade.cs:757-771 — bake the DX9 "--" marker into the literal path and drop the
  // flag; DX9 textures are unsupported in Endwalker+ and the flag can cause issues downstream.
  for (const tex of mtrl.textures) {
    if ((tex.flags & 0x8000) !== 0) {
      const path = dx11Path(tex);
      tex.flags &= ~0x8000;
      tex.texturePath = path;
    }
  }

  // EndwalkerUpgrade.cs:773
  mtrl.additionalData = Uint8Array.from([0x34, 0x05, 0, 0]);

  // EndwalkerUpgrade.cs:774-788
  if (mtrl.shaderPackRaw === SHPK_CHARACTER_GLASS) {
    mtrl.shaderKeys = GLASS_SHADER_KEYS.map((k) => ({ ...k }));
    mtrl.shaderConstants = GLASS_SHADER_CONSTANTS.map((c) => ({
      constantId: c.constantId,
      values: [...c.values],
    }));
    mtrl.additionalData = Uint8Array.from(GLASS_ADDITIONAL_DATA);
    mtrl.materialFlags &= ~0x0004;
    mtrl.materialFlags &= ~0x0008;
  }

  // EndwalkerUpgrade.cs:909
  const usesMaskAsSpec = mtrl.shaderKeys.some(
    (k) =>
      k.keyId === 0xc8bd1def &&
      (k.value === 0xa02f4828 || k.value === 0x198d11cd),
  );

  // EndwalkerUpgrade.cs:797-876
  mtrl.colorSetData = upgradeColorsetData(
    mtrl.colorSetData,
    mtrl.shaderPackRaw,
  );

  // EndwalkerUpgrade.cs:877-907
  if (mtrl.colorSetDyeData.length > 0) {
    mtrl.colorSetDyeData = upgradeDyeData(
      mtrl.colorSetDyeData,
      mtrl.shaderPackRaw,
    );
  }

  // EndwalkerUpgrade.cs:912-921. C# dereferences normalTex.Dx11Path UNCONDITIONALLY here, so a
  // colorset material with no resolvable Normal texture throws (NRE) in C# — which the per-material
  // try/catch in UpdateEndwalkerMaterials (:522-539) swallows, leaving that file BYTE-UNTOUCHED
  // (WriteFile at :1069 is never reached). Mirror that exactly: throw so the caller (materialRound)
  // abandons this material and writes nothing.
  const normalTex = findByUsage(mtrl, XivTexType.Normal);
  if (!normalTex) {
    throw new Error("colorset material has no resolvable normal texture");
  }

  const normalPath = dx11Path(normalTex);
  let idPath = normalPath.replaceAll(".tex", "_id.tex");
  if (normalPath.includes("_n.tex")) {
    idPath = normalPath.replaceAll("_n.tex", "_id.tex");
  }

  // EndwalkerUpgrade.cs:923-936 idPath refinement: for a mod overwriting a BASE-GAME material, C#
  // steals that material's OWN index-sampler path (carries the canonical v{NN}_ version prefix and
  // drops the material-variant letter) instead of the naming convention above. That path is not
  // derivable from the mod's bytes, so it is bundled as a base-game material->index table extracted
  // from the game (scripts/extract-index-overrides.ts). Convention holds for every material NOT in it.
  // NOTE: C#'s refinement also gates on the convention idPath NOT already existing in-game; we apply
  // the table UNCONDITIONALLY per materialPath (coarser). The table only holds paths where the golden
  // actually diverged, so this is exact for the corpus; the ratchet would catch a future mod that
  // reuses one of these base paths with a convention idPath that does resolve in-game.
  const idPathOverride = INDEX_PATH_OVERRIDES[mtrl.mtrlPath];
  if (idPathOverride !== undefined) {
    idPath = idPathOverride;
  }

  // EndwalkerUpgrade.cs:954-968
  let samplerSettingsRaw = INDEX_SAMPLER_SETTINGS_BASE;
  if (normalTex.sampler) {
    samplerSettingsRaw =
      (INDEX_SAMPLER_SETTINGS_BASE & ~TILING_BITS_MASK) |
      (normalTex.sampler.samplerSettingsRaw & TILING_BITS_MASK);
  }
  mtrl.textures.push({
    texturePath: idPath,
    flags: 0,
    sampler: {
      samplerIdRaw: ESamplerId.g_SamplerIndex,
      samplerSettingsRaw,
    },
  });

  infos.push({
    usage: EUpgradeTextureUsage.IndexMaps,
    files: { normal: normalPath, index: idPath },
  });

  // EndwalkerUpgrade.cs:973-1027
  if (mtrl.shaderPackRaw === SHPK_CHARACTER_LEGACY) {
    const maskSamp = findBySampler(mtrl, ESamplerId.g_SamplerMask);
    if (maskSamp && !usesMaskAsSpec) {
      const maskPath = dx11Path(maskSamp);
      maskSamp.texturePath = maskPath;
      infos.push({
        usage: EUpgradeTextureUsage.GearMaskLegacy,
        files: { mask_old: maskPath, mask_new: maskPath },
      });
    }
  } else if (mtrl.shaderPackRaw === SHPK_CHARACTER_GLASS) {
    if (!usesMaskAsSpec) {
      const maskSamp = findBySampler(mtrl, ESamplerId.g_SamplerMask);
      if (maskSamp) {
        const maskPath = dx11Path(maskSamp);
        maskSamp.texturePath = maskPath;
        infos.push({
          usage: EUpgradeTextureUsage.GearMaskNew,
          files: { mask_old: maskPath, mask_new: maskPath },
        });
      }
    }
  }

  // EndwalkerUpgrade.cs:1028-1066. Asymmetry vs the mask lookups above: C# scans for spec/diffuse
  // with `x.Sampler.SamplerId` UNGUARDED (:1028-1029) — unlike the mask lookups (:975/:1011, guarded
  // with `x.Sampler != null`) — so a texture that bound no sampler NREs mid-scan and the per-material
  // try/catch (upgrade.ts materialRound) abandons the material BYTE-UNTOUCHED. Reproduce that exactly:
  // scan without `?.`, throwing before a match if a null-sampler texture is reached first (Array.find
  // stops at the first match / first throw, matching FirstOrDefault's enumeration order).
  const findSpecDiffuse = (samplerId: number): MtrlTexture | undefined =>
    mtrl.textures.find((t) => {
      if (!t.sampler) throw new Error("mtrl: texture bound no sampler");
      return t.sampler.samplerIdRaw === samplerId;
    });
  const specTex = findSpecDiffuse(ESamplerId.g_SamplerSpecular);
  const diffuseTex = findSpecDiffuse(ESamplerId.g_SamplerDiffuse);
  if (specTex?.sampler && diffuseTex) {
    specTex.sampler.samplerIdRaw = ESamplerId.g_SamplerMask;

    const maskAsSpecKey = mtrl.shaderKeys.find((k) => k.keyId === 0xc8bd1def);
    if (maskAsSpecKey) {
      maskAsSpecKey.value = 0x198d11cd;
    } else {
      mtrl.shaderKeys.push({ keyId: 0xc8bd1def, value: 0x198d11cd });
    }

    const legacyKey = mtrl.shaderKeys.find((k) => k.keyId === 0xb616dc5a);
    if (legacyKey) {
      legacyKey.value = 0x600ef9df;
    } else {
      mtrl.shaderKeys.push({ keyId: 0xb616dc5a, value: 0x600ef9df });
    }
  }

  return infos;
}

// EndwalkerUpgrade.cs:1115-1173 (files != null slice — no texture creation)
function upgradeHairMaterial(mtrl: XivMtrl): UpgradeInfo[] {
  const normalTex = findByUsage(mtrl, XivTexType.Normal);
  const maskTex = findByUsage(mtrl, XivTexType.Mask);
  if (!normalTex || !maskTex) return [];

  const originalConstants = mtrl.shaderConstants;
  mtrl.shaderConstants = HAIR_SHADER_CONSTANTS.map((c) => ({
    constantId: c.constantId,
    values: [...c.values],
  }));
  mtrl.additionalData = Uint8Array.from(HAIR_ADDITIONAL_DATA);

  // Preserve the alpha threshold, whose functionality is unchanged.
  const alpha = originalConstants.find((c) => c.constantId === 0x29ac0223);
  const alphaDest = mtrl.shaderConstants.find(
    (c) => c.constantId === 0x29ac0223,
  );
  if (alpha && alphaDest) {
    alphaDest.values = [...alpha.values];
  }

  const normalPath = dx11Path(normalTex);
  const maskPath = dx11Path(maskTex);
  return [
    {
      usage: EUpgradeTextureUsage.HairMaps,
      files: { normal: normalPath, mask: maskPath },
    },
  ];
}

export function upgradeMaterial(mtrl: XivMtrl): UpgradeInfo[] {
  if (!doesMtrlNeedDawntrailUpdate(mtrl)) return [];
  if (mtrl.colorSetData.length === 256) return upgradeColorsetMaterial(mtrl);
  if (mtrl.shaderPackRaw === SHPK_HAIR) return upgradeHairMaterial(mtrl);
  return [];
}
