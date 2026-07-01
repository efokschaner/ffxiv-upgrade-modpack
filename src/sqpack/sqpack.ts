// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { decodeType2, encodeType2 } from "./type2";
import { decodeType3, encodeType3 } from "./type3";
import { decodeType4, encodeType4 } from "./type4";

export enum SqPackType { Standard = 2, Model = 3, Texture = 4 }

export interface DecodedFile { type: SqPackType; data: Uint8Array; }

/** Decompress a SQPack entry, dispatching on the fileType int32 at offset 4. Mirrors Dat.ReadSqPackFile (Dat.cs:1016). */
export function decodeSqPackFile(entry: Uint8Array): DecodedFile {
  const type = new DataView(entry.buffer, entry.byteOffset, entry.byteLength).getInt32(4, true);
  switch (type) {
    case SqPackType.Standard: return { type, data: decodeType2(entry) };
    case SqPackType.Model: return { type, data: decodeType3(entry) };
    case SqPackType.Texture: return { type, data: decodeType4(entry) };
    default: throw new Error(`sqpack: unsupported entry type ${type}`);
  }
}

/** Compress already-uncompressed bytes into a SQPack entry of the given type. */
export function encodeSqPackFile(data: Uint8Array, type: SqPackType): Uint8Array {
  switch (type) {
    case SqPackType.Standard: return encodeType2(data);
    case SqPackType.Model: return encodeType3(data);
    case SqPackType.Texture: return encodeType4(data);
    default: throw new Error(`sqpack: unsupported type ${type}`);
  }
}

/** Convenience: choose an entry type from a game path. Mirrors CreateCompressedFile's detection intent. */
export function detectTypeFromGamePath(gamePath: string): SqPackType {
  const lower = gamePath.toLowerCase();
  if (lower.endsWith(".mdl")) return SqPackType.Model;
  if (lower.endsWith(".tex")) return SqPackType.Texture;
  return SqPackType.Standard;
}
