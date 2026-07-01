// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMtrl, serializeMtrl } from "../src/mtrl/mtrl";

const dir = join(__dirname, "fixtures");
const cases = [
  { name: "default_material.mtrl", label: "Endwalker-format" },
  { name: "default_material_dt.mtrl", label: "Dawntrail-format" },
];

for (const c of cases) {
  const path = join(dir, c.name);
  describe.skipIf(!existsSync(path))(`mtrl fixture (${c.label})`, () => {
    it(`self round-trips ${c.name} byte-identical`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const out = serializeMtrl(parseMtrl(bytes, c.name));
      expect(out).toEqual(bytes);
    });
  });
}
