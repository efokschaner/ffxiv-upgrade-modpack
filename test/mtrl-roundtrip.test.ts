// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { parseMtrl, serializeMtrl } from "../src/mtrl/mtrl";
import { buildMinimalMtrl } from "./helpers/make-mtrl";

describe("mtrl round-trip", () => {
  it("serializeMtrl(parseMtrl(x)) === x for the hand-built canonical file", () => {
    const x = buildMinimalMtrl();
    const out = serializeMtrl(parseMtrl(x));
    expect(out).toEqual(x);
  });

  it("is exported from the package index", async () => {
    const idx = await import("../src/index");
    expect(typeof idx.parseMtrl).toBe("function");
    expect(typeof idx.serializeMtrl).toBe("function");
  });
});
