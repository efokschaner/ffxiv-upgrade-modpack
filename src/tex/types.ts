// XivTexFormat values (== their SE "code"), XivTexFormat.cs.
export const L8 = 4400;
export const A8 = 4401;
export const A4R4G4B4 = 5184;
export const A1R5G5B5 = 5185;
export const A8R8G8B8 = 5200;
export const X8R8G8B8 = 5201;
export const R32F = 8528;
export const G16R16F = 8784;
export const G32R32F = 8800;
export const A16B16G16R16F = 9312;
export const A32B32G32R32F = 9328;
export const DXT1 = 13344;
export const DXT3 = 13360;
export const DXT5 = 13361;
export const D16 = 16704;
export const BC4 = 24864;
export const BC5 = 25136;
export const BC7 = 25650;

/** Retained-header model of a raw uncompressed .tex. Holds every header field so serialize replays
 *  it byte-for-byte (see design spec §2). */
export interface XivTex {
  attributes: number; // u32 @0
  format: number; // u32 @4 (XivTexFormat)
  width: number; // u16 @8
  height: number; // u16 @10
  depth: number; // u16 @12
  mipCount: number; // low nibble of byte @14
  mipFlag: number; // high nibble of byte @14
  arraySize: number; // byte @15
  lodMips: [number, number, number]; // u32 x3 @16
  mipMapOffsets: number[]; // u32 x13 @28
  mipData: Uint8Array; // everything after byte 80 (all mips + any trailing bytes)
  filePath?: string; // carried for later transform use; does not affect bytes
}

const COMPRESSED = new Set<number>([DXT1, DXT3, DXT5, BC4, BC5, BC7]);
const BPP: Record<number, number> = {
  [DXT1]: 4,
  [BC4]: 4,
  [DXT5]: 8,
  [BC5]: 8,
  [A8]: 8,
  [BC7]: 8,
  [A1R5G5B5]: 16,
  [A4R4G4B4]: 16,
  [L8]: 32,
  [A8R8G8B8]: 32,
  [X8R8G8B8]: 32,
  [R32F]: 32,
  [G16R16F]: 32,
  [G32R32F]: 32,
  [A16B16G16R16F]: 32,
  [A32B32G32R32F]: 32,
  [DXT3]: 32,
  [D16]: 32,
};

// Ported from xivModdingFramework XivTexFormats (XivTexFormat.cs): IsCompressedFormat (:78-92),
// GetBitsPerPixel (:99-128), GetMipMinDimension (:94-97). The COMPRESSED set / BPP table above are
// the switch arms transcribed into lookups.
export function isCompressed(format: number): boolean {
  return COMPRESSED.has(format);
}
export function bitsPerPixel(format: number): number {
  const b = BPP[format];
  if (b === undefined)
    throw new Error(`tex: no bitsPerPixel for format ${format}`);
  return b;
}
export function minDimension(format: number): number {
  return isCompressed(format) ? 4 : 1;
}

/** Full mip-chain byte sizes down to 1x1. Port of DDS.CalculateMipMapSizes (DDS.cs:380). */
export function texMipSizes(
  format: number,
  width: number,
  height: number,
): number[] {
  const minDim = minDimension(format);
  const bpp = bitsPerPixel(format);
  const sizeOf = (w: number, h: number) =>
    (Math.max(minDim, w) * Math.max(minDim, h) * bpp) / 8;
  const sizes: number[] = [sizeOf(width, height)];
  let w = width,
    h = height;
  while (w > 1 || h > 1) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    sizes.push(sizeOf(w, h));
  }
  return sizes;
}

/** Layers = ArraySize * Depth, min 1 (XivTex.cs:129 / GetRawPixels). */
export function texLayers(tex: XivTex): number {
  const layers = tex.arraySize * tex.depth;
  return layers === 0 ? 1 : layers;
}
