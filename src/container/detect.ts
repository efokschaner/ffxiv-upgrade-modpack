// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { ModpackFormat } from "../model/modpack";

export function detectFormat(name: string): ModpackFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pmp") || lower.endsWith(".json")) return ModpackFormat.Pmp;
  if (lower.endsWith(".ttmp2")) return ModpackFormat.Ttmp2;
  if (lower.endsWith(".ttmp")) return ModpackFormat.TtmpLegacy;
  return null;
}
