// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
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
