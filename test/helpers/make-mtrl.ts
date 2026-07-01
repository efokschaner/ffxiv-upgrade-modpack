// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { ByteBuilder } from "../../src/util/binary";
import { SAMPLER_NORMAL_MAP_0 } from "../../src/mtrl/types";

const enc = new TextEncoder();

/**
 * A hand-built canonical single-UV .mtrl in the exact layout serializeMtrl produces:
 * header, texture/uv offset tables, string block (padded to 4), additionalData,
 * EW colorset (512 bytes) + EW dye (32 bytes), shader block (1 key, 1 constant),
 * one NormalMap0 sampler on texture 0, then the 4-byte float data block.
 */
export function buildMinimalMtrl(): Uint8Array {
  // String block: "test.tex\0" @0 (9), "uv1\0" @9 (4), "character.shpk\0" @13 (15) = 28 (already %4).
  const stringBlockSize = 28;
  const shaderNameOffset = 13;

  const b = new ByteBuilder();
  b.i32(0x00000301);        // signature
  const fileSizePos = b.length;
  b.u16(0);                 // fileSize (backfilled below)
  b.u16(544);               // colorSetDataSize = 512 colorset + 32 EW dye
  b.u16(stringBlockSize);
  b.u16(shaderNameOffset);
  b.u8(1);                  // texCount
  b.u8(1);                  // mapCount
  b.u8(0);                  // colorsetCount
  b.u8(4);                  // additionalDataSize

  // Offset/flag tables.
  b.u16(0).u16(0);          // texture[0]: offset 0, flags 0
  b.u16(9).u16(0);          // uvMap[0]:  offset 9, flags 0

  // String block.
  b.bytes(enc.encode("test.tex")).u8(0);
  b.bytes(enc.encode("uv1")).u8(0);
  b.bytes(enc.encode("character.shpk")).u8(0);

  // additionalData: 0x08 set because dye is present.
  b.bytes([0x08, 0, 0, 0]);

  // EW colorset: 256 raw uint16s.
  for (let i = 0; i < 256; i++) b.u16((i * 7) & 0xffff);
  // EW dye: 32 bytes.
  for (let i = 0; i < 32; i++) b.u8((i * 3) & 0xff);

  // Shader block header.
  b.u16(4);                 // shaderConstantsDataSize (1 float)
  b.u16(1);                 // shaderKeyCount
  b.u16(1);                 // shaderConstantsCount
  b.u16(1);                 // textureSamplerCount
  b.u16(0x0011);            // materialFlags
  b.u16(0x0022);            // materialFlags2

  // Shader keys.
  b.u32(0x12345678).u32(0x9abcdef0);
  // Shader-constant descriptor: id, offset 0, size 4.
  b.u32(0xcafebabe).u16(0).u16(4);
  // Sampler: NormalMap0 on texture index 0.
  b.u32(SAMPLER_NORMAL_MAP_0).u32(0x00010203).u8(0).bytes([0, 0, 0]);
  // Float data block: one float, exactly representable.
  b.f32(1.5);

  const out = b.toUint8Array();
  new DataView(out.buffer).setUint16(fileSizePos, out.length & 0xffff, true);
  return out;
}
