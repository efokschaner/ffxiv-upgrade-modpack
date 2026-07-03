// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { BinaryReader } from "../util/binary";
import { parseTexHeader } from "./header";
import type { XivTex } from "./types";

/** Parses a raw uncompressed .tex into a lossless XivTex. Port of XivTex.FromUncompressedTex
 *  (XivTex.cs:94) but retaining all header fields (design spec §2). */
export function parseTex(bytes: Uint8Array, filePath = ""): XivTex {
  const r = new BinaryReader(bytes);
  const header = parseTexHeader(r);
  return { ...header, mipData: bytes.slice(80), filePath };
}
