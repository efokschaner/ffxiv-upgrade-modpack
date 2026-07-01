// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { BinaryReader, ByteBuilder } from "../util/binary";

/**
 * Reads the colorset as colorDataSize/2 raw half-float uint16s (Half.RawValue), byte-exact.
 * Mirrors the Half list read inside Mtrl.GetXivMtrl (Mtrl.cs:274).
 */
export function readColorset(r: BinaryReader, colorDataSize: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < colorDataSize / 2; i++) out.push(r.readUint16());
  return out;
}

/** Writes each raw half-float uint16 back verbatim. Mirrors Mtrl.XivMtrlToUncompressedMtrl (Mtrl.cs:677). */
export function writeColorset(b: ByteBuilder, colorSetData: number[]): void {
  for (const v of colorSetData) b.u16(v);
}
