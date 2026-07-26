import { type BinaryReader, ByteBuilder } from "../util/binary";
import { texMipSizes, type XivTex } from "./types";

/** Reads the 80-byte .tex header (Tex.TexHeader.ReadTexHeader, Tex.cs:98). Advances r to byte 80. */
export function parseTexHeader(
  r: BinaryReader,
): Omit<XivTex, "mipData" | "filePath"> {
  const attributes = r.readUint32();
  const format = r.readUint32();
  const width = r.readUint16();
  const height = r.readUint16();
  const depth = r.readUint16();
  const mipByte = r.readUint8();
  const mipCount = mipByte & 0x0f;
  const mipFlag = mipByte >> 4;
  const arraySize = r.readUint8();
  const lodMips: [number, number, number] = [
    r.readUint32(),
    r.readUint32(),
    r.readUint32(),
  ];
  const mipMapOffsets: number[] = [];
  for (let i = 0; i < 13; i++) mipMapOffsets.push(r.readUint32());
  return {
    attributes,
    format,
    width,
    height,
    depth,
    mipCount,
    mipFlag,
    arraySize,
    lodMips,
    mipMapOffsets,
  };
}

/** Writes the retained 80-byte header verbatim (Tex.TexHeader.ToBytes, Tex.cs:136). Byte-exact. */
export function serializeTexHeader(tex: XivTex): Uint8Array {
  const b = new ByteBuilder();
  b.u32(tex.attributes);
  b.u32(tex.format);
  b.u16(tex.width);
  b.u16(tex.height);
  b.u16(tex.depth);
  b.u8(((tex.mipFlag & 0x0f) << 4) | (tex.mipCount & 0x0f));
  b.u8(tex.arraySize);
  for (const x of tex.lodMips) b.u32(x);
  for (const x of tex.mipMapOffsets) b.u32(x);
  return b.toUint8Array();
}

/** Canonical header for a regenerated texture. Port of Tex.CreateTexFileHeader (Tex.cs:1103). */
export function buildCanonicalTexHeader(
  format: number,
  width: number,
  height: number,
  mipCount: number,
): Uint8Array {
  if (mipCount > 13)
    throw new Error("tex: image has too many mipmaps (max 13)");
  const mipSizes = texMipSizes(format, width, height);
  if (mipSizes.length < mipCount) {
    throw new Error(
      `tex: mipCount ${mipCount} too high for ${width}x${height} format ${format}`,
    );
  }
  const b = new ByteBuilder();
  b.u16(0); // attributes low
  b.u16(128); // attributes high (=> Attributes u32 = 0x00800000)
  b.u16(format); // TextureFormat low
  b.u16(0); // TextureFormat high
  b.u16(width);
  b.u16(height);
  b.u16(1); // depth
  b.u16(mipCount); // MipCount as a short (byte14=mipCount, byte15=0)
  b.i32(0); // LoD 0 mip
  b.i32(mipCount > 1 ? 1 : 0); // LoD 1 mip
  b.i32(mipCount > 2 ? 2 : 0); // LoD 2 mip
  let offset = 80;
  for (let i = 0; i < mipCount; i++) {
    b.i32(offset);
    offset += mipSizes[i]!;
  }
  const out = new Uint8Array(80);
  out.set(b.toUint8Array());
  return out; // remaining bytes are zero-padding to 80
}

type MipOffsetFixable = Pick<
  XivTex,
  "format" | "width" | "height" | "mipCount" | "lodMips" | "mipMapOffsets"
>;

/** Port of Tex.TexHeader.FixUpBrokenMipOffsets (Tex.cs:168-235). Rebuilds a broken mip-offset
 *  table using total file size as a heuristic, returning whether anything changed and the size the
 *  .tex SHOULD be.
 *
 *  STRUCT-COPY QUIRK, load-bearing (docs/TEXTOOLS_BUGS.md #21). C# passes `TexHeader` BY VALUE. Its
 *  writes to the reference-typed `uint[]` fields (`MipMapOffsets`, `LoDMips`) reach the caller
 *  (shared array), but its writes to the scalar `MipCount` stay on the local copy. ValidateTexFileData
 *  then serializes the header with the ORIGINAL `MipCount` and the FIXED offset/lod tables. We
 *  reproduce that exactly: mutate `header.mipMapOffsets` / `header.lodMips` in place and NEVER write
 *  `header.mipCount` (a local `mipCount` mirrors the C# copy's field). Getting this wrong moves bytes
 *  on real corpus packs. */
export function fixUpBrokenMipOffsets(
  header: MipOffsetFixable,
  texSizeIncludingHeader: number,
): { headerChanged: boolean; calculatedTexSize: number } {
  let modified = false;
  let originalMipCount = header.mipCount;
  let mipOffset = 80; // Tex._TexHeaderSize
  if (originalMipCount > 13) originalMipCount = 13;

  // Throws for unknown formats, exactly like DDS.CalculateMipMapSizes (Tex.cs:179 comment).
  const mipSizes = texMipSizes(header.format, header.width, header.height);

  // Local mip count == the C# copy's header.MipCount; deliberately NOT written back to `header`.
  let mipCount = 1;
  if (header.mipMapOffsets[0] !== mipOffset) modified = true;
  header.mipMapOffsets[0] = mipOffset;
  mipOffset += mipSizes[0]!;

  let mipLevel: number;
  for (mipLevel = 1; mipLevel < originalMipCount; ++mipLevel) {
    if (mipLevel >= mipSizes.length) break;
    const mipSize = mipSizes[mipLevel]!;
    if (mipOffset + mipSize > texSizeIncludingHeader) break;
    if (header.mipMapOffsets[mipLevel] !== mipOffset) modified = true;
    header.mipMapOffsets[mipLevel] = mipOffset;
    mipOffset += mipSize;
    mipCount = mipLevel + 1;
  }

  for (let lodLevel = 0; lodLevel < 3; ++lodLevel) {
    if (header.lodMips[lodLevel]! >= mipCount) {
      modified = true;
      header.lodMips[lodLevel] = mipCount - 1;
    }
  }

  for (; mipLevel < 13; ++mipLevel) {
    if (header.mipMapOffsets[mipLevel] !== 0) {
      modified = true;
      header.mipMapOffsets[mipLevel] = 0;
    }
  }

  if (mipCount !== originalMipCount) modified = true;

  return { headerChanged: modified, calculatedTexSize: mipOffset };
}

/** The write-time validation Tex.TexHeader.ToBytes performs before emitting header bytes
 *  (Tex.cs:138-145), messages verbatim. Kept SEPARATE from serializeTexHeader (which writes retained
 *  headers verbatim and must not throw on them); called only where ToBytes' guard is part of the
 *  ported behaviour (validateTexFileData Branch B), where a throw drops the file at the load seam. */
export function assertTexHeaderWritable(
  tex: Pick<XivTex, "lodMips" | "mipCount" | "mipFlag">,
): void {
  if (tex.lodMips[1] < tex.lodMips[0] || tex.lodMips[2] < tex.lodMips[1])
    throw new Error("LoDMips is not in non-descending order.");
  if (tex.lodMips[2] >= tex.mipCount)
    throw new Error("All LoDMips must be strictly lesser than MipCount.");
  if (tex.mipFlag > 15)
    throw new Error("MipFlag must be strictly lesser than 16.");
  if (tex.mipCount > 13)
    throw new Error("MipCount must be strictly lesser than 14.");
}
