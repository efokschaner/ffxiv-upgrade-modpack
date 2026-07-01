// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { BinaryReader, ByteBuilder, concatBytes } from "../util/binary";
import { readBlock, compressData } from "./blocks";

const TEX_HEADER_SIZE = 80;

// XivTexFormat bits-per-pixel + min dimension, ported from XivTexFormat.cs:94-128.
const BPP: Record<number, number> = {
  13344: 4, 24864: 4,                                 // DXT1, BC4
  13361: 8, 25136: 8, 4401: 8, 25650: 8,              // DXT5, BC5, A8, BC7
  5185: 16, 5184: 16,                                 // A1R5G5B5, A4R4G4B4
  4400: 32, 5200: 32, 5201: 32, 8528: 32, 8784: 32,   // L8, A8R8G8B8, X8R8G8B8, R32F, G16R16F
  8800: 32, 9312: 32, 9328: 32, 13360: 32, 16704: 32, // G32R32F, A16B16G16R16F, A32B32G32R32F, DXT3, D16
};
const COMPRESSED = new Set([13344, 13360, 13361, 24864, 25136, 25650]);

function bitsPerPixel(format: number): number {
  const b = BPP[format];
  if (b === undefined) throw new Error(`sqpack: no bitsPerPixel for texture format ${format}`);
  return b;
}
function minDimension(format: number): number {
  return COMPRESSED.has(format) ? 4 : 1;
}

/** Mirrors DDS.CalculateMipMapSizes (DDS.cs:380). Returns the full mip chain down to 1x1. */
export function texMipSizes(format: number, width: number, height: number): number[] {
  const minDim = minDimension(format);
  const bpp = bitsPerPixel(format);
  const sizes: number[] = [];
  let w = width, h = height;
  const sizeOf = (ww: number, hh: number) => (Math.max(minDim, ww) * Math.max(minDim, hh) * bpp) / 8;
  sizes.push(sizeOf(w, h));
  while (w > 1 || h > 1) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    sizes.push(sizeOf(w, h));
  }
  return sizes;
}

/** Decompress a Type 4 (Texture) SQPack entry. Mirrors Dat.ReadSqPackType4 (Dat.cs:877). */
export function decodeType4(entry: Uint8Array): Uint8Array {
  const r = new BinaryReader(entry);
  const headerLength = r.readInt32();
  const fileType = r.readInt32();
  if (fileType !== 4) throw new Error(`sqpack: not a Type 4 entry (fileType=${fileType})`);
  r.readInt32(); // uncompressedFileSize
  r.readInt32(); // ikd1
  r.readInt32(); // ikd2
  const mipCount = r.readInt32();

  const endOfHeader = headerLength;
  const out: Uint8Array[] = [];
  // Tex file header (80 bytes) sits right after the SQPack header.
  out.push(entry.slice(endOfHeader, endOfHeader + TEX_HEADER_SIZE));

  const MIP_HEADER = 20;
  for (let i = 0; i < mipCount; i++) {
    r.seek(24 + MIP_HEADER * i);
    const offsetFromHeaderEnd = r.readInt32();
    r.readInt32(); // mipMapLength
    r.readInt32(); // mipMapSize
    r.readInt32(); // mipMapStart
    const mipParts = r.readInt32();

    r.seek(endOfHeader + offsetFromHeaderEnd);
    for (let p = 0; p < mipParts; p++) out.push(readBlock(r));
  }
  return concatBytes(out);
}

/**
 * Compress a raw uncompressed .tex (80-byte header + mip pixels) into a Type 4 entry.
 * Mirrors Tex.CompressTexFile (Tex.cs:1300) + Dat.MakeType4DatHeader (Dat.cs:1056).
 */
export function encodeType4(data: Uint8Array): Uint8Array {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const format = dv.getUint32(4, true);
  const width = dv.getUint16(8, true);
  const height = dv.getUint16(10, true);
  const mipCount = data[14]! & 0xf;

  const texHeader = data.slice(0, TEX_HEADER_SIZE);
  const mipSizes = texMipSizes(format, width, height);
  // Guard mirrors DDS.CompressDDSBody (DDS.cs:1079-1080): mipCount cannot exceed the formula chain,
  // otherwise mipSizes[i] would be undefined and we would emit a silently malformed entry.
  if (mipSizes.length < mipCount) {
    throw new Error(`sqpack: tex mipCount ${mipCount} exceeds mip chain (${mipSizes.length}) for ${width}x${height} format ${format}`);
  }

  // Compress each mip's pixel bytes into blocks.
  const ddsParts: Uint8Array[][] = [];
  let cursor = TEX_HEADER_SIZE;
  for (let i = 0; i < mipCount; i++) {
    const size = mipSizes[i]!;
    ddsParts.push(compressData(data.slice(cursor, cursor + size)));
    cursor += size;
  }

  // ---- MakeType4DatHeader (Dat.cs:1056) ----
  const totalParts = ddsParts.reduce((n, m) => n + m.length, 0);
  const headerSizeRaw = 24 + mipCount * 20 + totalParts * 2;
  const headerPadding = 128 - (headerSizeRaw % 128);
  const uncompressedLength = data.length - TEX_HEADER_SIZE;

  const hb = new ByteBuilder()
    .i32(headerSizeRaw + headerPadding)
    .i32(4)
    .i32(uncompressedLength + 80)
    .i32(0)
    .i32(0)
    .i32(mipCount);

  let dataBlockOffset = 0;
  let mipCompressedOffset = 80;
  for (let i = 0; i < mipCount; i++) {
    const compressedSize = ddsParts[i]!.reduce((n, p) => n + p.length, 0);
    hb.i32(mipCompressedOffset).i32(compressedSize).i32(mipSizes[i]!).i32(dataBlockOffset).i32(ddsParts[i]!.length);
    dataBlockOffset += ddsParts[i]!.length;
    mipCompressedOffset += compressedSize;
  }
  // Trailing per-part ushort size list.
  for (const mip of ddsParts) for (const part of mip) hb.u16(part.length);
  hb.bytes(new Uint8Array(headerPadding));

  const pixelData: Uint8Array[] = [];
  for (const mip of ddsParts) for (const part of mip) pixelData.push(part);

  return concatBytes([hb.toUint8Array(), texHeader, ...pixelData]);
}
