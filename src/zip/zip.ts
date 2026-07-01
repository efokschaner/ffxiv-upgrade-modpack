// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { unzipSync, zipSync, type Zippable } from "fflate";

export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const files = unzipSync(bytes);
  for (const [name, data] of Object.entries(files)) {
    // Skip directory entries (fflate yields zero-length entries for them).
    if (name.endsWith("/")) continue;
    out.set(name.replace(/\\/g, "/"), data);
  }
  return out;
}

export function writeZip(
  entries: Map<string, Uint8Array>,
  opts: { store?: boolean } = {},
): Uint8Array {
  const store = opts.store ?? true;
  const zippable: Zippable = {};
  for (const [name, data] of entries) {
    zippable[name.replace(/\\/g, "/")] = [data, { level: store ? 0 : 6 }];
  }
  return zipSync(zippable);
}
