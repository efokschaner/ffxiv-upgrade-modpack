// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { concatBytes } from "../util/binary";
import { serializeTexHeader } from "./header";
import type { XivTex } from "./types";

/** Serializes an XivTex back to raw .tex bytes by replaying the retained header + mip tail. Byte-exact
 *  for parsed inputs (design spec §2). Regenerated textures use encodeUncompressedTex (Task 8) instead. */
export function serializeTex(tex: XivTex): Uint8Array {
  return concatBytes([serializeTexHeader(tex), tex.mipData]);
}
