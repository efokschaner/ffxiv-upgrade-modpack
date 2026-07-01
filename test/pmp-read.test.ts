// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { readPmp } from "../src/container/pmp";
import { allFiles, FileStorageType, ModpackFormat } from "../src/model/modpack";
import { makePmpZip } from "./helpers/make-packs";

describe("readPmp", () => {
  it("reads meta, default mod, and groups with raw files", () => {
    const pack = makePmpZip();
    const data = readPmp(pack.bytes);
    expect(data.sourceFormat).toBe(ModpackFormat.Pmp);
    expect(data.meta.name).toBe("Synth PMP");
    const byPath = new Map(allFiles(data).map((f) => [f.gamePath, f]));
    for (const [path, bytes] of Object.entries(pack.expectedFiles)) {
      expect(byPath.get(path)!.data).toEqual(bytes);
      expect(byPath.get(path)!.storage).toBe(FileStorageType.RawUncompressed);
    }
  });
});
