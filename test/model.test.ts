// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { emptyMeta, allFiles, ModpackFormat, FileStorageType, type ModpackData } from "../src/model/modpack";

describe("model", () => {
  it("emptyMeta has all string fields blank and tags empty", () => {
    const m = emptyMeta();
    expect(m.name).toBe("");
    expect(m.tags).toEqual([]);
    expect(m.minimumFrameworkVersion).toBe("1.0.0.0");
  });

  it("allFiles flattens every option's files", () => {
    const data: ModpackData = {
      sourceFormat: ModpackFormat.Ttmp2,
      isSimple: true,
      meta: emptyMeta(),
      groups: [{
        name: "g", description: "", image: "", page: 0, priority: 0,
        selectionType: "Single", defaultSettings: 0,
        options: [
          { name: "o1", description: "", image: "", priority: 0, fileSwaps: {}, manipulations: [],
            files: [{ gamePath: "a.mdl", data: new Uint8Array([1]), storage: FileStorageType.SqPackCompressed }] },
          { name: "o2", description: "", image: "", priority: 0, fileSwaps: {}, manipulations: [],
            files: [{ gamePath: "b.mtrl", data: new Uint8Array([2]), storage: FileStorageType.SqPackCompressed }] },
        ],
      }],
    };
    expect(allFiles(data).map((f) => f.gamePath)).toEqual(["a.mdl", "b.mtrl"]);
  });
});
