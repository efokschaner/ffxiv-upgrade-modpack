// v6 bone-set block assembly, ported from the v6 branch of
// xivModdingFramework's MakeUncompressedMdlFile (Mdl.cs:3372-3452) (GPL-3.0).
// Split, don't blend: per-group packing lives in getV6BoneSet (tt-model.ts);
// this module only assembles the header table + padded data region around it.
//
// DIVERGENCE from the vendored reference (confirmed against the ConsoleTools golden):
// the reference's v6 branch emits a COMPACT data region (each set's packed indices padded
// only to a 4-byte boundary) and stops there. The ConsoleTools build that produces our
// goldens packs the data COMPACTLY exactly the same way (so the [offset][count] headers are
// identical), but then ZERO-EXTENDS the whole data region to `groupCount * 128` bytes (64
// shorts per set, the v5 static array size), giving BoneSetSize = groupCount * 64.
// Reproduced empirically: a single 5-bone set -> `01 00 05 00 | <5 shorts> <59 zero shorts>`,
// boneSetSize 64; a 4-set body -> headers [4,19,26,27] (compact offsets), total 528 bytes.

import { getV6BoneSet, type TTModel } from "./tt-model";

export interface V6BoneSetBlock {
  block: Uint8Array;
  boneSetSize: number;
}

const V6_SET_DATA_BYTES = 128; // 64 shorts per set (the v5 static bone-array size)

/** Assemble the v6 bone-set block (Mdl.cs:3378-3416 compact packing + the ConsoleTools
 *  zero-extension — see the file header). A 4-byte [i16 offset][i16 count] header per mesh
 *  group at the front (offset = dwords from the group's header to its compactly-packed data;
 *  count = real bone count), then each group's packed LE-i16 indices (from getV6BoneSet)
 *  padded to a 4-byte boundary, then the whole data region zero-extended to
 *  `groupCount * 128` bytes. `boneSetSize` (= groupCount * 64) feeds MdlModelData.BoneSetSize. */
export function buildV6BoneSetBlock(m: TTModel): V6BoneSetBlock {
  const groupCount = m.meshGroups.length;
  const packed = m.meshGroups.map((_, g) => getV6BoneSet(m, g));
  for (const p of packed) {
    if (p.length > V6_SET_DATA_BYTES) {
      throw new Error("mdl: bone-set exceeds 64 bones (v6 static array size)");
    }
  }

  const headerSize = 4 * groupCount;
  // Buffer sized to the zero-extended data region; compact packing writes into the front of it.
  const out = new Uint8Array(headerSize + groupCount * V6_SET_DATA_BYTES);
  const dv = new DataView(out.buffer);

  let cursor = headerSize;
  for (let g = 0; g < groupCount; g++) {
    const headerLoc = g * 4;
    dv.setInt16(headerLoc, (cursor - headerLoc) / 4, true); // offset (dwords), compact position
    dv.setInt16(headerLoc + 2, packed[g]!.length / 2, true); // real bone count
    out.set(packed[g]!, cursor);
    cursor += packed[g]!.length;
    if (packed[g]!.length % 4 !== 0) cursor += 2; // 4-byte pad (already zero)
  }

  const boneSetSize = (out.length - headerSize) / 2; // = groupCount * 64
  return { block: out, boneSetSize };
}
