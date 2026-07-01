// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { BinaryReader, ByteBuilder } from "../util/binary";

function assertDyeLength(len: number): void {
  if (len !== 0 && len !== 32 && len !== 128) {
    throw new Error(`mtrl: invalid dye length ${len} (expected 0, 32, or 128)`);
  }
}

/**
 * Reads a dye blob of exactly len bytes, kept as a raw Uint8Array like XivMtrl.ColorSetDyeData
 * (a byte[]). The reference does not unpack the dye bitfields; neither do we (Mtrl.cs:294/320).
 */
export function readDye(r: BinaryReader, len: number): Uint8Array {
  assertDyeLength(len);
  return r.readBytes(len);
}

/** Appends the raw dye blob verbatim, validating its length. */
export function writeDye(b: ByteBuilder, dye: Uint8Array): void {
  assertDyeLength(dye.length);
  b.bytes(dye);
}
