// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { unwrap, wrap, extractGameFile, gameAvailable } from "./helpers/oracle";

describe("oracle sqpack wrappers", () => {
  it("expose callable functions and a boolean gameAvailable", () => {
    expect(typeof unwrap).toBe("function");
    expect(typeof wrap).toBe("function");
    expect(typeof extractGameFile).toBe("function");
    expect(typeof gameAvailable()).toBe("boolean");
  });
});
