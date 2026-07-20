import { BinaryReader, ByteBuilder, concatBytes } from "../util/binary";
import { compressData, readBlock } from "./blocks";

const MDL_HEADER = 68;

function read3u32(r: BinaryReader): number[] {
  return [r.readUint32(), r.readUint32(), r.readUint32()];
}
function read3u16(r: BinaryReader): number[] {
  return [r.readUint16(), r.readUint16(), r.readUint16()];
}

/** Decompress a Type 3 (Model) SQPack entry into a runtime MDL file. Mirrors Dat.ReadSqPackType3 (Dat.cs:688). */
export function decodeType3(entry: Uint8Array): Uint8Array {
  const r = new BinaryReader(entry);
  const headerLength = r.readInt32();
  const fileType = r.readInt32();
  if (fileType !== 3)
    throw new Error(`sqpack: not a Type 3 entry (fileType=${fileType})`);
  const decompressedSize = r.readInt32();
  r.readInt32(); // buffer1
  r.readInt32(); // buffer2
  const version = r.readInt32();

  const endOfHeader = headerLength;

  r.readInt32(); // vertexInfoSize (uncompressed, unused)
  r.readInt32(); // modelDataSize (uncompressed, unused)
  read3u32(r);
  read3u32(r);
  read3u32(r); // uncompressed vertex/edge/index buffer sizes (unused)
  r.readInt32(); // vertexInfoCompressedSize (unused)
  r.readInt32(); // modelDataCompressedSize (unused)
  read3u32(r);
  read3u32(r);
  read3u32(r); // compressed vertex/edge/index buffer sizes (unused)

  const vertexInfoOffset = r.readInt32();
  const modelDataOffset = r.readInt32();
  const vertexBufferOffsets = read3u32(r);
  read3u32(r); // edgeGeometryVertexBufferOffsets (unused)
  const indexBufferOffsets = read3u32(r);

  r.readInt16();
  r.readInt16(); // vertexInfo / modelData block indexes (unused)
  read3u16(r);
  read3u16(r);
  read3u16(r); // vertex/edge/index block indexes (unused)

  const vertexInfoBlockCount = r.readInt16();
  const modelDataBlockCount = r.readInt16();
  const vertexBufferBlockCounts = read3u16(r);
  const edgeBlockCounts = read3u16(r);
  const indexBufferBlockCounts = read3u16(r);

  const meshCount = r.readUint16();
  const materialCount = r.readUint16();
  const lodCount = r.readUint8();
  const flags = r.readUint8();
  const padding = r.readBytes(2);

  // Edge geometry is part of the Type-3 format but is always empty for real FFXIV models (verified
  // across the corpus), so this port does not read the edge buffers' own offsets. Fail loudly rather
  // than silently mis-decode (readGroup would seek to endOfHeader+0) if a model ever carried it.
  if (edgeBlockCounts.some((c) => c !== 0)) {
    throw new Error(
      `sqpack: Type 3 edge geometry is not supported (edge block counts ${edgeBlockCounts.join(",")})`,
    );
  }

  // Decompress each group by seeking to endOfHeader + its offset and reading its blocks.
  const readGroup = (offset: number, count: number): Uint8Array => {
    if (count === 0) return new Uint8Array(0);
    r.seek(endOfHeader + offset);
    const parts: Uint8Array[] = [];
    for (let i = 0; i < count; i++) parts.push(readBlock(r));
    return concatBytes(parts);
  };

  const vInfo = readGroup(vertexInfoOffset, vertexInfoBlockCount);
  const mData = readGroup(modelDataOffset, modelDataBlockCount);

  const vertexBuffers: Uint8Array[] = [];
  const indexBuffers: Uint8Array[] = [];
  const vertexUncompOffsets = [0, 0, 0];
  const indexUncompOffsets = [0, 0, 0];
  const vertexRealSizes = [0, 0, 0];
  const indexRealSizes = [0, 0, 0];

  // decompOffset starts after the reserved 68-byte header + vInfo + mData.
  //
  // Each offset below is recorded UNCONDITIONALLY, before that LoD's blocks are read (Dat.cs:825,
  // 835) — there is no "unused LoD keeps its stored 0" case. A zero-block LoD therefore takes
  // whatever the cursor currently is, so the trailing unused LoDs of a `lodCount = 1` model come out
  // as the end-of-geometry cursor rather than 0. That is canonical, not a defect: TexTools' own
  // serializer writes the same end-of-geometry value into both unused vertex and both unused index
  // slots (Mdl.cs:3930-3942), as does our port (src/mdl/model/serialize.ts). Consequence worth
  // knowing: a .mdl authored outside TexTools (a raw game file / Penumbra export stores 0) is
  // normalized on decode, so decode(encode(x)) rewrites those four fields. The corpus self
  // round-trip confirms that normalization against the oracle — it hands ConsoleTools /unwrap the
  // entry we compressed and requires its decode to match ours byte-for-byte
  // (test/helpers/corpus-sqpack.ts).
  let decompOffset = MDL_HEADER + vInfo.length + mData.length;
  for (let i = 0; i < 3; i++) {
    vertexUncompOffsets[i] = decompOffset;
    const vb = readGroup(vertexBufferOffsets[i]!, vertexBufferBlockCounts[i]!);
    vertexBuffers.push(vb);
    vertexRealSizes[i] = vb.length;
    decompOffset += vb.length;

    // Edge geometry sits between vertex and index in the layout; guaranteed empty by the guard above.

    indexUncompOffsets[i] = decompOffset;
    const ib = readGroup(indexBufferOffsets[i]!, indexBufferBlockCounts[i]!);
    indexBuffers.push(ib);
    indexRealSizes[i] = ib.length;
    decompOffset += ib.length;
  }

  // Reconstruct the 68-byte runtime header (Dat.cs:842-858).
  const header = new ByteBuilder()
    .i32(version)
    .i32(vInfo.length)
    .i32(mData.length)
    .u16(meshCount)
    .u16(materialCount);
  for (const v of vertexUncompOffsets) header.i32(v);
  for (const v of indexUncompOffsets) header.i32(v);
  for (const v of vertexRealSizes) header.i32(v);
  for (const v of indexRealSizes) header.i32(v);
  header.u8(lodCount).u8(flags).bytes(padding);

  const geometry: Uint8Array[] = [];
  for (let i = 0; i < 3; i++) {
    geometry.push(vertexBuffers[i]!);
    geometry.push(indexBuffers[i]!);
  }

  // Match Dat.ReadSqPackType3 (Dat.cs:801): `new byte[baseHeaderLength + decompressedSize]`. This is
  // a benign TexTools DECODER quirk — a double-count of the 68-byte header — that we reproduce
  // deliberately. `decompressedSize` (entry offset 8) is ALREADY the true model size *including* the
  // 68-byte header: encode writes exactly `68 + content` (Mdl.cs:2259, our encodeType3), which is
  // correct. The decoder then adds `baseHeaderLength` (68) a SECOND time, over-allocating by one
  // header and leaving 68 trailing ZERO bytes that no header field points at.
  //
  // It is a weird internal behaviour with NO externally visible effect. The padding is regenerated on
  // every decode and dropped on every re-encode — encodeType3 slices by the header's offsets/sizes,
  // never reads past `content`, and recomputes `decompressedSize` back to `68 + content` — so it is
  // never stored in a compressed entry and never reaches our /upgrade output (a benign decoder defect,
  // registered as docs/TEXTOOLS_BUGS.md #11 and worth upstreaming). ConsoleTools /unwrap emits the same 68 zeros, so
  // reproducing them is required by the byte-identical-decompressed bar. The one consequence worth
  // knowing: decode(encode(x)) is non-idempotent for a model that entered UN-padded — a PMP stores
  // each .mdl at its true `68 + content` size, so its first decode appends the 68 zeros it lacked.
  // The corpus self-round-trip check tolerates exactly that growth (test/helpers/corpus-sqpack.ts).
  const out = new Uint8Array(MDL_HEADER + decompressedSize);
  out.set(header.toUint8Array(), 0);
  let o = MDL_HEADER;
  for (const part of [vInfo, mData, ...geometry]) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

/** Compress a runtime MDL file into a Type 3 SQPack entry. Mirrors Mdl.CompressMdlFile (Mdl.cs:2148). */
export function encodeType3(data: Uint8Array): Uint8Array {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const signature = dv.getUint32(0, true);
  const vertexInfoSize = dv.getInt32(4, true);
  const modelDataSize = dv.getInt32(8, true);
  const meshCount = dv.getUint16(12, true);
  const materialCount = dv.getUint16(14, true);
  const vertexOffsets = [
    dv.getUint32(16, true),
    dv.getUint32(20, true),
    dv.getUint32(24, true),
  ];
  const indexOffsets = [
    dv.getUint32(28, true),
    dv.getUint32(32, true),
    dv.getUint32(36, true),
  ];
  const vertexSizes = [
    dv.getUint32(40, true),
    dv.getUint32(44, true),
    dv.getUint32(48, true),
  ];
  const indexSizes = [
    dv.getUint32(52, true),
    dv.getUint32(56, true),
    dv.getUint32(60, true),
  ];
  const lodCount = data[64]!;
  const flags = data[65]!;

  const vInfoBlocks = compressData(
    data.slice(MDL_HEADER, MDL_HEADER + vertexInfoSize),
  );
  const mDataBlocks = compressData(
    data.slice(
      MDL_HEADER + vertexInfoSize,
      MDL_HEADER + vertexInfoSize + modelDataSize,
    ),
  );
  const vBlocks: Uint8Array[][] = [];
  const iBlocks: Uint8Array[][] = [];
  for (let i = 0; i < 3; i++) {
    vBlocks.push(
      compressData(
        data.slice(vertexOffsets[i]!, vertexOffsets[i]! + vertexSizes[i]!),
      ),
    );
    iBlocks.push(
      compressData(
        data.slice(indexOffsets[i]!, indexOffsets[i]! + indexSizes[i]!),
      ),
    );
  }

  const sum = (blocks: Uint8Array[]) =>
    blocks.reduce((n, b) => n + b.length, 0);
  const compressedData = concatBytes([
    ...vInfoBlocks,
    ...mDataBlocks,
    ...[0, 1, 2].flatMap((i) => [...vBlocks[i]!, ...iBlocks[i]!]),
  ]);

  const blockCount =
    vInfoBlocks.length +
    mDataBlocks.length +
    vBlocks.reduce((n, b) => n + b.length, 0) +
    iBlocks.reduce((n, b) => n + b.length, 0);
  let headerLength = 256;
  if (blockCount > 24) {
    const extension = Math.floor(((blockCount - 24) * 2) / 128) + 1;
    headerLength = 256 + extension * 128;
  }

  const pad128 = (n: number) => {
    const r = n % 128;
    return r === 0 ? n : n + (128 - r);
  };
  const uncompressedSize =
    MDL_HEADER +
    vertexInfoSize +
    modelDataSize +
    vertexSizes.reduce((a, b) => a + b, 0) +
    indexSizes.reduce((a, b) => a + b, 0);

  const h = new ByteBuilder()
    .i32(headerLength)
    .i32(3)
    .i32(uncompressedSize)
    .i32(Math.floor(compressedData.length / 128) + 16)
    .i32(Math.floor(compressedData.length / 128))
    .i32(signature)
    // Uncompressed sizes (padded): vInfo, mData, vertex×3, edge×3 (0), index×3.
    .i32(pad128(vertexInfoSize))
    .i32(pad128(modelDataSize))
    .i32(pad128(vertexSizes[0]!))
    .i32(pad128(vertexSizes[1]!))
    .i32(pad128(vertexSizes[2]!))
    .i32(0)
    .i32(0)
    .i32(0)
    .i32(pad128(indexSizes[0]!))
    .i32(pad128(indexSizes[1]!))
    .i32(pad128(indexSizes[2]!))
    // Compressed sizes: vInfo, mData, vertex×3, edge×3 (0), index×3.
    .i32(sum(vInfoBlocks))
    .i32(sum(mDataBlocks))
    .i32(sum(vBlocks[0]!))
    .i32(sum(vBlocks[1]!))
    .i32(sum(vBlocks[2]!))
    .i32(0)
    .i32(0)
    .i32(0)
    .i32(sum(iBlocks[0]!))
    .i32(sum(iBlocks[1]!))
    .i32(sum(iBlocks[2]!));

  // Compressed offsets, written [vInfo][mData] then per-LoD [vertex][index].
  const vInfoOff = 0;
  const mDataOff = vInfoOff + sum(vInfoBlocks);
  const vOff0 = mDataOff + sum(mDataBlocks);
  const iOff0 = vOff0 + sum(vBlocks[0]!);
  const vOff1 = iOff0 + sum(iBlocks[0]!);
  const iOff1 = vOff1 + sum(vBlocks[1]!);
  const vOff2 = iOff1 + sum(iBlocks[1]!);
  const iOff2 = vOff2 + sum(vBlocks[2]!);
  h.i32(vInfoOff)
    .i32(mDataOff)
    .i32(vOff0)
    .i32(vOff1)
    .i32(vOff2)
    .i32(0)
    .i32(0)
    .i32(0)
    .i32(iOff0)
    .i32(iOff1)
    .i32(iOff2);

  // Block indexes.
  const vInfoIdx = 0;
  const mDataIdx = vInfoIdx + vInfoBlocks.length;
  const vIdx0 = mDataIdx + mDataBlocks.length;
  const iIdx0 = vIdx0 + vBlocks[0]!.length;
  const vIdx1 = iIdx0 + iBlocks[0]!.length;
  const iIdx1 = vIdx1 + vBlocks[1]!.length;
  const vIdx2 = iIdx1 + iBlocks[1]!.length;
  const iIdx2 = vIdx2 + vBlocks[2]!.length;
  h.u16(vInfoIdx)
    .u16(mDataIdx)
    .u16(vIdx0)
    .u16(vIdx1)
    .u16(vIdx2)
    .u16(iIdx0)
    .u16(iIdx1)
    .u16(iIdx2)
    .u16(iIdx0)
    .u16(iIdx1)
    .u16(iIdx2);

  // Block counts.
  h.u16(vInfoBlocks.length)
    .u16(mDataBlocks.length)
    .u16(vBlocks[0]!.length)
    .u16(vBlocks[1]!.length)
    .u16(vBlocks[2]!.length)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(iBlocks[0]!.length)
    .u16(iBlocks[1]!.length)
    .u16(iBlocks[2]!.length);

  h.u16(meshCount).u16(materialCount).u8(lodCount).u8(flags).u16(0);

  // Per-block compressed sizes, in order: vInfo, mData, then per-LoD [vertex...][index...].
  for (const b of vInfoBlocks) h.u16(b.length);
  for (const b of mDataBlocks) h.u16(b.length);
  for (let l = 0; l < 3; l++) {
    for (const b of vBlocks[l]!) h.u16(b.length);
    for (const b of iBlocks[l]!) h.u16(b.length);
  }

  // Pad header out to headerLength.
  const header = new Uint8Array(headerLength);
  header.set(h.toUint8Array().slice(0, headerLength), 0);
  return concatBytes([header, compressedData]);
}
