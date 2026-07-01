// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { parseMtrl } from "../src/mtrl/parse";
import { SAMPLER_NORMAL_MAP_0 } from "../src/mtrl/types";
import { buildMinimalMtrl } from "./helpers/make-mtrl";

describe("parseMtrl", () => {
  it("parses the hand-built canonical file into the expected model", () => {
    const m = parseMtrl(buildMinimalMtrl(), "chara/x/material/test.mtrl");

    expect(m.signature).toBe(0x00000301);
    expect(m.mtrlPath).toBe("chara/x/material/test.mtrl");
    expect(m.shaderPackRaw).toBe("character.shpk");

    expect(m.textures).toHaveLength(1);
    expect(m.textures[0]!.texturePath).toBe("test.tex");
    expect(m.textures[0]!.flags).toBe(0);
    expect(m.textures[0]!.sampler).toEqual({ samplerIdRaw: SAMPLER_NORMAL_MAP_0, samplerSettingsRaw: 0x00010203 });

    expect(m.uvMapStrings).toEqual([{ value: "uv1", flags: 0 }]);
    expect(m.colorsetStrings).toEqual([]);

    expect(m.additionalData).toEqual(new Uint8Array([0x08, 0, 0, 0]));
    expect(m.colorSetData).toHaveLength(256);
    expect(m.colorSetData[1]).toBe(7);
    expect(m.colorSetDyeData).toHaveLength(32);

    expect(m.materialFlags).toBe(0x0011);
    expect(m.materialFlags2).toBe(0x0022);
    expect(m.shaderKeys).toEqual([{ keyId: 0x12345678, value: 0x9abcdef0 }]);
    expect(m.shaderConstants).toEqual([{ constantId: 0xcafebabe, values: [1.5] }]);
  });

  it("throws on an unrecognized colorset size", () => {
    const bytes = buildMinimalMtrl();
    // colorSetDataSize is the u16 at offset 6; 600 -> remainder 88, not in {0,32,128}.
    new DataView(bytes.buffer).setUint16(6, 600, true);
    expect(() => parseMtrl(bytes)).toThrow(/unrecognized colorSetDataSize/);
  });
});
