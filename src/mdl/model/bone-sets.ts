// v6 bone-set block assembly, ported from the v6 branch of
// xivModdingFramework's MakeUncompressedMdlFile (Mdl.cs:3372-3452) (GPL-3.0).
// Split, don't blend: per-group packing lives in getV6BoneSet (tt-model.ts);
// this module only assembles the header table + padded data region around it.

import { getV6BoneSet, type TTModel } from "./tt-model";

export interface V6BoneSetBlock {
  block: Uint8Array;
  boneSetSize: number;
}

/** Port of the v6 bone-set assembly in MakeUncompressedMdlFile (Mdl.cs:3378-3416).
 *  Layout: a 4-byte [i16 offset][i16 count] header per mesh group, contiguous at
 *  the front, followed by each group's packed LE-i16 bone indices (from
 *  getV6BoneSet), each padded to a 4-byte boundary. `offset` is in dwords from
 *  the group's own header to its data. `boneSetSize` is the data region's size
 *  in i16 units (excludes the header table); it back-patches
 *  MdlModelData.BoneSetSize in the serializer (a later task). */
export function buildV6BoneSetBlock(m: TTModel): V6BoneSetBlock {
  const groupCount = m.meshGroups.length;
  const packed = m.meshGroups.map((_, g) => getV6BoneSet(m, g));

  const headerSize = 4 * groupCount;
  const out = new Uint8Array(
    headerSize +
      packed.reduce((n, p) => n + p.length + (p.length % 4 !== 0 ? 2 : 0), 0),
  );
  const dv = new DataView(out.buffer);

  // count (second i16 of each header) can be written up-front; offset needs
  // the running data length, computed as we append each group's data below.
  for (let g = 0; g < groupCount; g++) {
    dv.setInt16(g * 4 + 2, packed[g]!.length / 2, true);
  }

  let cursor = headerSize;
  for (let g = 0; g < groupCount; g++) {
    const headerLoc = g * 4;
    const offset = (cursor - headerLoc) / 4;
    dv.setInt16(headerLoc, offset, true);
    const bytes = packed[g]!;
    out.set(bytes, cursor);
    cursor += bytes.length;
    if (bytes.length % 4 !== 0) {
      cursor += 2; // out is already zero-filled, just advance past the pad
    }
  }

  const boneSetSize = (out.length - headerSize) / 2;
  return { block: out, boneSetSize };
}
