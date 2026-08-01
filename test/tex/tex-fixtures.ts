import { DXT5 } from "../../src/tex/types";

// One solid, fully-opaque DXT5 block (16 bytes): alpha endpoints 255/255 (all texels alpha 255),
// color0=color1=0x8410, all indices 0 → uniform color. Enough for decodeToRgba to decode without error.
const SOLID_DXT5_BLOCK = new Uint8Array([
  255, 255, 0, 0, 0, 0, 0, 0, 0x10, 0x84, 0x10, 0x84, 0, 0, 0, 0,
]);

function dxt5Mip(w: number, h: number): Uint8Array {
  const bx = Math.ceil(w / 4);
  const by = Math.ceil(h / 4);
  const out = new Uint8Array(bx * by * 16);
  for (let i = 0; i < bx * by; i++) out.set(SOLID_DXT5_BLOCK, i * 16);
  return out;
}

/** A minimal but fully decodable DXT5 .tex with 2 mips at the given dims. Used to exercise the
 *  load-seam BC-abort path (Branch A on a compressed source). Header layout per Tex.TexHeader
 *  (Tex.cs:71-130): format@4, width@8, height@10, depth@12, mipCount=low nibble of byte@14,
 *  mip offsets u32 x13 @28. */
export function makeSolidDxt5Tex(width: number, height: number): Uint8Array {
  const mip0 = dxt5Mip(width, height);
  const mip1 = dxt5Mip(Math.max(1, width >> 1), Math.max(1, height >> 1));
  const header = new Uint8Array(80);
  const dv = new DataView(header.buffer);
  dv.setUint32(4, DXT5, true);
  dv.setUint16(8, width, true);
  dv.setUint16(10, height, true);
  dv.setUint16(12, 1, true); // depth
  dv.setUint8(14, 2); // mipCount (low nibble)
  dv.setUint32(28, 80, true); // mip0 offset
  dv.setUint32(32, 80 + mip0.length, true); // mip1 offset
  const out = new Uint8Array(80 + mip0.length + mip1.length);
  out.set(header, 0);
  out.set(mip0, 80);
  out.set(mip1, 80 + mip0.length);
  return out;
}
