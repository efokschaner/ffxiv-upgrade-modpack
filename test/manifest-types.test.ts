// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { makeTtmp2Simple, makeLegacyTtmp, makePmpZip } from "./helpers/make-packs";

describe("synthetic pack builders", () => {
  it("produce non-empty byte buffers with known files", () => {
    for (const make of [makeTtmp2Simple, makeLegacyTtmp, makePmpZip]) {
      const pack = make();
      expect(pack.bytes.length).toBeGreaterThan(0);
      expect(Object.keys(pack.expectedFiles).length).toBeGreaterThan(0);
    }
  });
});
