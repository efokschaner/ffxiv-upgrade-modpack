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
