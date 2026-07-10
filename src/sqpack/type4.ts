import { texMipSizes } from "../tex/types";
import { BinaryReader, ByteBuilder, concatBytes } from "../util/binary";
import { compressData, readBlock } from "./blocks";

const TEX_HEADER_SIZE = 80;

// Re-exported so existing importers (test/sqpack-type4.test.ts, test/helpers/corpus-sqpack.ts)
// keep resolving texMipSizes from this module. The single source of truth is src/tex/types.
export { texMipSizes };

/**
 * Decompress a Type 4 (Texture) SQPack entry. Mirrors Dat.ReadSqPackType4 (Dat.cs:877).
 *
 * Honors `uncompressedFileSize` the way Dat.cs:908-909 does: the output buffer is
 * preallocated at exactly that size, and the tex header is copied into it via a
 * fixed-size `Array.Copy`. A malformed entry whose declared `uncompressedFileSize`
 * can't even hold the 80-byte tex header throws, just as `Array.Copy` throws
 * `ArgumentException` in C#. TexTools relies on this throw to detect-and-drop
 * malformed placeholder textures at load.
 *
 * Mip data, by contrast, is copied via CompleteReadCompressedBlocks (Dat.cs:2437-2460),
 * which grows the buffer (reallocate-and-copy) rather than throwing whenever a block
 * would overflow it — so an `uncompressedFileSize` too small for the mip chain does
 * NOT throw; the output simply ends up longer than declared. Conversely, a declared
 * size larger than the actual header+mip content leaves the output zero-padded at the
 * tail (untouched preallocated bytes), rather than trimmed the way the previous
 * concatBytes-based implementation behaved.
 */
export function decodeType4(entry: Uint8Array): Uint8Array {
  const r = new BinaryReader(entry);
  const headerLength = r.readInt32();
  const fileType = r.readInt32();
  if (fileType !== 4)
    throw new Error(`sqpack: not a Type 4 entry (fileType=${fileType})`);
  const uncompressedFileSize = r.readInt32();
  r.readInt32(); // ikd1
  r.readInt32(); // ikd2
  const mipCount = r.readInt32();

  const endOfHeader = headerLength;

  let out = new Uint8Array(uncompressedFileSize);
  const texHeader = entry.slice(endOfHeader, endOfHeader + TEX_HEADER_SIZE);
  if (texHeader.length > uncompressedFileSize) {
    throw new Error(
      `sqpack: type4 uncompressedFileSize ${uncompressedFileSize} < tex header size ${TEX_HEADER_SIZE} (malformed) — Dat.cs:908-909`,
    );
  }
  out.set(texHeader, 0);
  let decompOffset = texHeader.length;

  const MIP_HEADER = 20;
  for (let i = 0; i < mipCount; i++) {
    r.seek(24 + MIP_HEADER * i);
    const offsetFromHeaderEnd = r.readInt32();
    r.readInt32(); // mipMapLength
    r.readInt32(); // mipMapSize
    r.readInt32(); // mipMapStart
    const mipParts = r.readInt32();

    r.seek(endOfHeader + offsetFromHeaderEnd);
    for (let p = 0; p < mipParts; p++) {
      const block = readBlock(r);
      // Mirrors CompleteReadCompressedBlocks' grow-on-overflow (Dat.cs:2448-2453):
      // reallocate to fit exactly rather than throwing.
      if (decompOffset + block.length > out.length) {
        const grown = new Uint8Array(decompOffset + block.length);
        grown.set(out, 0);
        out = grown;
      }
      out.set(block, decompOffset);
      decompOffset += block.length;
    }
  }
  return out;
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
  // Guard mirrors DDS.CompressDDSBody (DDS.cs:412-419): mipCount cannot exceed the formula chain,
  // otherwise mipSizes[i] would be undefined and we would emit a silently malformed entry.
  if (mipSizes.length < mipCount) {
    throw new Error(
      `sqpack: tex mipCount ${mipCount} exceeds mip chain (${mipSizes.length}) for ${width}x${height} format ${format}`,
    );
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
    hb.i32(mipCompressedOffset)
      .i32(compressedSize)
      .i32(mipSizes[i]!)
      .i32(dataBlockOffset)
      .i32(ddsParts[i]!.length);
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
