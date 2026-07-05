import { describe, expect, it } from "vitest";
import {
  ESamplerId,
  SHPK_CHARACTER,
  SHPK_CHARACTER_GLASS,
  SHPK_CHARACTER_LEGACY,
  SHPK_HAIR,
} from "../../src/mtrl/shader";
import type { MtrlTexture, XivMtrl } from "../../src/mtrl/types";
import {
  doesMtrlNeedDawntrailUpdate,
  upgradeMaterial,
} from "../../src/upgrade/material";
import {
  GLASS_ADDITIONAL_DATA,
  GLASS_SHADER_KEYS,
} from "../../src/upgrade/reference/glass-shader-params";
import { HAIR_ADDITIONAL_DATA } from "../../src/upgrade/reference/hair-shader-params";
import { INDEX_PATH_OVERRIDES } from "../../src/upgrade/reference/index-path-overrides";
import { EUpgradeTextureUsage } from "../../src/upgrade/upgrade-info";

function tex(path: string, samplerId: number): MtrlTexture {
  return {
    texturePath: path,
    flags: 0,
    sampler: { samplerIdRaw: samplerId, samplerSettingsRaw: 0 },
  };
}
function characterColorsetMtrl(): XivMtrl {
  return {
    signature: 0x00000301,
    shaderPackRaw: SHPK_CHARACTER,
    additionalData: new Uint8Array(4),
    textures: [tex("chara/x/tex/foo_n.tex", ESamplerId.g_SamplerNormal)],
    uvMapStrings: [{ value: "", flags: 0 }],
    colorsetStrings: [],
    colorSetData: new Array<number>(256).fill(0),
    colorSetDyeData: new Uint8Array(0),
    shaderKeys: [],
    shaderConstants: [],
    materialFlags: 0,
    materialFlags2: 0,
    mtrlPath: "chara/x/mat/mt_foo.mtrl",
  };
}

describe("doesMtrlNeedDawntrailUpdate", () => {
  it("flags a 256-length colorset", () => {
    expect(doesMtrlNeedDawntrailUpdate(characterColorsetMtrl())).toBe(true);
  });
  it("leaves an already-1024 colorset alone", () => {
    const m = characterColorsetMtrl();
    m.colorSetData = new Array<number>(1024).fill(0);
    expect(doesMtrlNeedDawntrailUpdate(m)).toBe(false);
  });
});

describe("upgradeMaterial (colorset branch)", () => {
  it("switches character->legacy, expands colorset, adds an index sampler, records IndexMaps", () => {
    const m = characterColorsetMtrl();
    const infos = upgradeMaterial(m);
    expect(m.shaderPackRaw).toBe(SHPK_CHARACTER_LEGACY);
    expect(m.colorSetData.length).toBe(1024);
    expect(Array.from(m.additionalData)).toEqual([0x34, 0x05, 0, 0]);
    const idTex = m.textures.find(
      (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerIndex,
    );
    expect(idTex?.texturePath).toBe("chara/x/tex/foo_id.tex");
    const idInfo = infos.find(
      (i) => i.usage === EUpgradeTextureUsage.IndexMaps,
    );
    expect(idInfo?.files).toEqual({
      normal: "chara/x/tex/foo_n.tex",
      index: "chara/x/tex/foo_id.tex",
    });
  });

  it("applies the base-game idPath override for a material in the override table (EndwalkerUpgrade.cs:923-936)", () => {
    const entry = Object.entries(INDEX_PATH_OVERRIDES)[0];
    expect(entry).toBeDefined();
    const [overridePath, overrideIdx] = entry!;
    const m = characterColorsetMtrl();
    m.mtrlPath = overridePath;
    // A normal whose CONVENTION idPath ("..._id.tex") would differ from the override, proving the
    // table wins over the naming convention.
    m.textures = [tex("chara/x/tex/custom_n.tex", ESamplerId.g_SamplerNormal)];
    const infos = upgradeMaterial(m);
    const idTex = m.textures.find(
      (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerIndex,
    );
    expect(idTex?.texturePath).toBe(overrideIdx);
    const idInfo = infos.find(
      (i) => i.usage === EUpgradeTextureUsage.IndexMaps,
    );
    expect(idInfo?.files.index).toBe(overrideIdx);
  });

  it("bakes the DX9 '--' marker into the path and clears the flag (EndwalkerUpgrade.cs:757-771)", () => {
    const m = characterColorsetMtrl();
    m.textures.push({
      texturePath: "chara/x/tex/foo_s.tex",
      flags: 0x8000,
      sampler: {
        samplerIdRaw: ESamplerId.g_SamplerSpecular,
        samplerSettingsRaw: 0,
      },
    });
    upgradeMaterial(m);
    const specTex = m.textures.find((t) => t.texturePath.includes("foo_s"));
    expect(specTex?.texturePath).toBe("chara/x/tex/--foo_s.tex");
    expect(specTex && (specTex.flags & 0x8000) === 0).toBe(true);
  });

  it("retypes a legacy mask-as-spec setup: specular+diffuse -> mask sampler + compat shader keys", () => {
    const m = characterColorsetMtrl();
    m.textures.push(
      tex("chara/x/tex/foo_d.tex", ESamplerId.g_SamplerDiffuse),
      tex("chara/x/tex/foo_s.tex", ESamplerId.g_SamplerSpecular),
    );
    upgradeMaterial(m);
    const specTex = m.textures.find(
      (t) => t.texturePath === "chara/x/tex/foo_s.tex",
    );
    expect(specTex?.sampler?.samplerIdRaw).toBe(ESamplerId.g_SamplerMask);
    expect(m.shaderKeys).toContainEqual({
      keyId: 0xc8bd1def,
      value: 0x198d11cd,
    });
    expect(m.shaderKeys).toContainEqual({
      keyId: 0xb616dc5a,
      value: 0x600ef9df,
    });
  });

  it("records a GearMaskLegacy upgrade info for a legacy mask sampler (not mask-as-spec)", () => {
    const m = characterColorsetMtrl();
    m.textures.push(tex("chara/x/tex/foo_m.tex", ESamplerId.g_SamplerMask));
    const infos = upgradeMaterial(m);
    const maskInfo = infos.find(
      (i) => i.usage === EUpgradeTextureUsage.GearMaskLegacy,
    );
    expect(maskInfo?.files).toEqual({
      mask_old: "chara/x/tex/foo_m.tex",
      mask_new: "chara/x/tex/foo_m.tex",
    });
  });
});

describe("upgradeMaterial (glass branch)", () => {
  it("overwrites shader keys/constants/additionalData, clears flag bits 0x0004/0x0008, records GearMaskNew", () => {
    const m = characterColorsetMtrl();
    m.shaderPackRaw = SHPK_CHARACTER_GLASS;
    m.materialFlags = 0x0004 | 0x0008 | 0x0010;
    m.textures.push(tex("chara/x/tex/foo_m.tex", ESamplerId.g_SamplerMask));
    const infos = upgradeMaterial(m);
    expect(m.shaderPackRaw).toBe(SHPK_CHARACTER_GLASS);
    expect(m.shaderKeys).toEqual(GLASS_SHADER_KEYS);
    expect(Array.from(m.additionalData)).toEqual(GLASS_ADDITIONAL_DATA);
    expect(m.materialFlags).toBe(0x0010);
    const maskInfo = infos.find(
      (i) => i.usage === EUpgradeTextureUsage.GearMaskNew,
    );
    expect(maskInfo?.files).toEqual({
      mask_old: "chara/x/tex/foo_m.tex",
      mask_new: "chara/x/tex/foo_m.tex",
    });
  });
});

describe("upgradeMaterial (hair branch)", () => {
  function hairMtrl(): XivMtrl {
    return {
      signature: 0x00000301,
      shaderPackRaw: SHPK_HAIR,
      additionalData: new Uint8Array(4),
      textures: [
        tex("chara/hair/h0001/tex/h_n.tex", ESamplerId.g_SamplerNormal),
        tex("chara/hair/h0001/tex/h_m.tex", ESamplerId.g_SamplerMask),
      ],
      uvMapStrings: [{ value: "", flags: 0 }],
      colorsetStrings: [],
      colorSetData: [],
      colorSetDyeData: new Uint8Array(0),
      shaderKeys: [],
      shaderConstants: [
        { constantId: 0x36080ad0, values: [1] },
        { constantId: 0x992869ab, values: [4] },
        { constantId: 0x29ac0223, values: [0.6] },
      ],
      materialFlags: 0,
      materialFlags2: 0,
      mtrlPath: "chara/hair/h0001/material/mt_h.mtrl",
    };
  }

  it("swaps shader constants/additionalData, preserves the alpha threshold, records HairMaps", () => {
    const m = hairMtrl();
    const infos = upgradeMaterial(m);
    expect(Array.from(m.additionalData)).toEqual(HAIR_ADDITIONAL_DATA);
    const alpha = m.shaderConstants.find((c) => c.constantId === 0x29ac0223);
    expect(alpha?.values).toEqual([0.6]);
    const info = infos.find((i) => i.usage === EUpgradeTextureUsage.HairMaps);
    expect(info?.files).toEqual({
      normal: "chara/hair/h0001/tex/h_n.tex",
      mask: "chara/hair/h0001/tex/h_m.tex",
    });
  });

  it("no-ops when only one of normal/mask is resolvable", () => {
    const m = hairMtrl();
    m.textures = [
      tex("chara/hair/h0001/tex/h_n.tex", ESamplerId.g_SamplerNormal),
    ];
    expect(upgradeMaterial(m)).toEqual([]);
  });
});

describe("upgradeMaterial (no-op)", () => {
  it("returns [] and does not mutate an already-upgraded material", () => {
    const m = characterColorsetMtrl();
    m.colorSetData = new Array<number>(1024).fill(0);
    const before = JSON.stringify(m, (_k, v) =>
      v instanceof Uint8Array ? Array.from(v) : v,
    );
    expect(upgradeMaterial(m)).toEqual([]);
    const after = JSON.stringify(m, (_k, v) =>
      v instanceof Uint8Array ? Array.from(v) : v,
    );
    expect(after).toBe(before);
  });
});
