// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { BinaryReader, ByteBuilder, concatBytes } from "../util/binary";
import { readBlock, compressData } from "./blocks";

/** Decompress a Type 2 (Standard/binary) SQPack entry. Mirrors Dat.ReadSqPackType2 (Dat.cs:623). */
export function decodeType2(entry: Uint8Array): Uint8Array {
  const r = new BinaryReader(entry);
  const headerLength = r.readInt32();
  const fileType = r.readInt32();
  if (fileType !== 2) throw new Error(`sqpack: not a Type 2 entry (fileType=${fileType})`);
  r.readInt32(); // uncompressedSize (unused; we concat actual block outputs)
  r.readInt32(); // bufferInfoA
  r.readInt32(); // bufferInfoB
  const blockCount = r.readInt32();

  const out: Uint8Array[] = [];
  for (let i = 0; i < blockCount; i++) {
    // Block table entry: int dataBlockOffset at (24 + 8*i); (short size, short uncompSize follow, unused here).
    r.seek(24 + 8 * i);
    const dataBlockOffset = r.readInt32();
    r.seek(headerLength + dataBlockOffset);
    out.push(readBlock(r));
  }
  return concatBytes(out);
}

/** Compress raw binary data into a Type 2 SQPack entry. Mirrors Dat.CompressType2Data (Dat.cs:520). */
export function encodeType2(data: Uint8Array): Uint8Array {
  const blocks = compressData(data);

  // Data section + block table entries.
  const dataBlocks: Uint8Array[] = [];
  const table = new ByteBuilder();
  let dataOffset = 0;
  const total = data.length;
  let remaining = total;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const partUncomp = Math.min(remaining, 16000);
    dataBlocks.push(block);
    table.i32(dataOffset).u16(block.length).u16(partUncomp);
    dataOffset += block.length;
    remaining -= 16000;
  }
  const totalCompSize = dataOffset;

  // Header: [headerLength][2][uncompLen][totalCompSize/128][totalCompSize/128][partCount] then table.
  const preHeader = new ByteBuilder()
    .i32(0) // headerLength placeholder (fixed below)
    .i32(2)
    .i32(total)
    .i32(Math.floor(totalCompSize / 128))
    .i32(Math.floor(totalCompSize / 128))
    .i32(blocks.length)
    .bytes(table.toUint8Array())
    .toUint8Array();

  const headerLength = pad128Header(preHeader.length);
  const header = new Uint8Array(headerLength);
  header.set(preHeader, 0);
  new DataView(header.buffer).setInt32(0, headerLength, true);

  return concatBytes([header, ...dataBlocks]);
}

function pad128Header(len: number): number {
  const r = len % 128;
  return r === 0 ? len : len + (128 - r);
}
