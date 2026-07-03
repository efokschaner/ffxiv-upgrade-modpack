// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.
//
// Uncompressed unpacks are ported from DDS.ConvertPixelData (DDS.cs:453). Block decoders are
// ported from MIT richgel999/bc7enc_rdo (rgbcx.h), not the Ms-PL FNA DxtUtil.

import {
  A1R5G5B5,
  A4R4G4B4,
  A8,
  A8R8G8B8,
  A16B16G16R16F,
  BC4,
  BC5,
  DXT1,
  DXT3,
  DXT5,
  L8,
  texLayers,
  type XivTex,
} from "./types";

/** Decodes the top mip of a texture to RGBA8888 at width x (height*layers). Port of the dispatch in
 *  DDS.ConvertPixelData (DDS.cs:453) + XivTex.GetRawPixels. `layer >= 0` returns that layer only. */
export function decodeToRgba(tex: XivTex, layer = -1): Uint8Array {
  const layers = texLayers(tex);
  const w = tex.width;
  const h = tex.height * layers;
  const src = tex.mipData;

  let out: Uint8Array;
  switch (tex.format) {
    case A8R8G8B8:
      out = unpackA8R8G8B8(src, w, h);
      break;
    case A4R4G4B4:
      out = unpack4444(src, w, h);
      break;
    case A1R5G5B5:
      out = unpack5551(src, w, h);
      break;
    case L8:
    case A8:
      out = unpack8bit(src, w, h);
      break;
    case A16B16G16R16F:
      out = unpackHalfFloat(src, w, h);
      break;
    case DXT1:
      out = decodeDxt1(src, w, h);
      break;
    case DXT3:
      out = decodeDxt3(src, w, h);
      break;
    case DXT5:
      out = decodeDxt5(src, w, h);
      break;
    case BC4:
      out = decodeBc4(src, w, h);
      break;
    case BC5:
      out = decodeBc5(src, w, h);
      break;
    default:
      throw new Error(`tex: unsupported decode format ${tex.format}`);
  }

  if (layer >= 0) {
    const bytesPerLayer = out.length / layers;
    return out.slice(bytesPerLayer * layer, bytesPerLayer * (layer + 1));
  }
  return out;
}

/** A8R8G8B8: stored B,G,R,A -> RGBA. DDS.SwapRBColors (DDS.cs:688). */
function unpackA8R8G8B8(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h * 4; i += 4) {
    out[i] = src[i + 2]!;
    out[i + 1] = src[i + 1]!;
    out[i + 2] = src[i]!;
    out[i + 3] = src[i + 3]!;
  }
  return out;
}

/** A4R4G4B4: u16 per pixel, emitted B,G,R,A (faithful to DDS.Read4444Image, DDS.cs:574). */
function unpack4444(src: Uint8Array, w: number, h: number): Uint8Array {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const out = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const px = dv.getUint16(p * 2, true);
    out[p * 4] = ((px & 0x0f00) >> 8) * 16; // blue
    out[p * 4 + 1] = ((px & 0x00f0) >> 4) * 16; // green
    out[p * 4 + 2] = (px & 0x000f) * 16; // red
    out[p * 4 + 3] = ((px & 0xf000) >> 12) * 16; // alpha
  }
  return out;
}

/** A1R5G5B5: u16 per pixel, emitted R,G,B,A (faithful to DDS.Read5551Image, DDS.cs:532). */
function unpack5551(src: Uint8Array, w: number, h: number): Uint8Array {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const out = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const px = dv.getUint16(p * 2, true);
    // Reference uses 0x7E00 (DDS.cs:548); bit 9 (0x0200) is shifted out by >>10 either way,
    // so this is numerically identical to 0x7C00, but kept literal for fidelity.
    out[p * 4] = ((px & 0x7e00) >> 10) * 8; // red
    out[p * 4 + 1] = ((px & 0x03e0) >> 5) * 8; // green
    out[p * 4 + 2] = (px & 0x001f) * 8; // blue
    out[p * 4 + 3] = ((px & 0x8000) >> 15) * 255; // alpha
  }
  return out;
}

/** L8 / A8: one byte per pixel -> gray RGB, opaque. DDS.Read8bitImage (DDS.cs:614). */
function unpack8bit(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const v = src[p]!;
    out[p * 4] = v;
    out[p * 4 + 1] = v;
    out[p * 4 + 2] = v;
    out[p * 4 + 3] = 255;
  }
  return out;
}

/** A16B16G16R16F: four halfs per pixel -> round(h*255) clamped. DDS.ReadHalfFloatImage (DDS.cs:643). */
function unpackHalfFloat(src: Uint8Array, w: number, h: number): Uint8Array {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const out = new Uint8Array(w * h * 4);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let p = 0; p < w * h; p++) {
    for (let c = 0; c < 4; c++) {
      out[p * 4 + c] = clamp(halfToFloat(dv.getUint16(p * 8 + c * 2, true)));
    }
  }
  return out;
}

/** IEEE-754 half -> float. */
function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * 2 ** -14 * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 1024);
}

// --- Block (S3TC/RGTC) decoders, ported from MIT richgel999/bc7enc_rdo (rgbcx.h /
// rgbcx.cpp: unpack_bc1_block_colors, unpack_bc1, unpack_bc4, unpack_bc3). See NOTICE.

/** 565 -> 888 via bit-replication (standard S3TC / rgbcx expansion). */
function rgb565(c: number): [number, number, number] {
  const r5 = (c >> 11) & 0x1f;
  const g6 = (c >> 5) & 0x3f;
  const b5 = c & 0x1f;
  return [(r5 << 3) | (r5 >> 2), (g6 << 2) | (g6 >> 4), (b5 << 3) | (b5 >> 2)];
}

function forEachBlock(
  w: number,
  h: number,
  fn: (bx: number, by: number) => void,
): void {
  const bxCount = (w + 3) >> 2;
  const byCount = (h + 3) >> 2;
  for (let y = 0; y < byCount; y++) {
    for (let x = 0; x < bxCount; x++) fn(x, y);
  }
}

/**
 * Writes the 4x4 color block at (bx,by) into `out`, given the two 565 endpoint colors and the
 * 32-bit 2-bit-per-texel index table. Rgbcx.unpack_bc1_block_colors: when c0 > c1 the block is
 * 4-color/opaque (idx2/idx3 are 2/3 and 1/3 blends); when c0 <= c1 it is 3-color punch-through
 * (idx2 is the 1/2 blend, idx3 is transparent black) -- DXT3/DXT5 always force the opaque mode.
 */
function writeColorBlock(
  out: Uint8Array,
  w: number,
  h: number,
  bx: number,
  by: number,
  c0: number,
  c1: number,
  indices: number,
  punchThrough: boolean,
  alphaFor: (texel: number) => number,
): void {
  const [r0, g0, b0] = rgb565(c0);
  const [r1, g1, b1] = rgb565(c1);
  const usePunchThrough = punchThrough && c0 <= c1;

  let r2: number, g2: number, b2: number, r3: number, g3: number, b3: number;
  if (usePunchThrough) {
    r2 = ((r0 + r1) / 2) | 0;
    g2 = ((g0 + g1) / 2) | 0;
    b2 = ((b0 + b1) / 2) | 0;
    r3 = 0;
    g3 = 0;
    b3 = 0;
  } else {
    r2 = ((2 * r0 + r1) / 3) | 0;
    g2 = ((2 * g0 + g1) / 3) | 0;
    b2 = ((2 * b0 + b1) / 3) | 0;
    r3 = ((r0 + 2 * r1) / 3) | 0;
    g3 = ((g0 + 2 * g1) / 3) | 0;
    b3 = ((b0 + 2 * b1) / 3) | 0;
  }

  for (let ty = 0; ty < 4; ty++) {
    const py = by * 4 + ty;
    if (py >= h) continue;
    for (let tx = 0; tx < 4; tx++) {
      const px = bx * 4 + tx;
      if (px >= w) continue;
      const texel = ty * 4 + tx;
      const idx = (indices >>> (2 * texel)) & 0x3;
      let r: number, g: number, b: number, a: number;
      switch (idx) {
        case 0:
          r = r0;
          g = g0;
          b = b0;
          a = alphaFor(texel);
          break;
        case 1:
          r = r1;
          g = g1;
          b = b1;
          a = alphaFor(texel);
          break;
        case 2:
          r = r2;
          g = g2;
          b = b2;
          a = alphaFor(texel);
          break;
        default: // idx === 3
          r = r3;
          g = g3;
          b = b3;
          a = usePunchThrough ? 0 : alphaFor(texel);
          break;
      }
      const o = (py * w + px) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
}

/** DXT1 / BC1: 8-byte blocks (color0,color1,indices), 1-bit punch-through alpha. */
function decodeDxt1(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  forEachBlock(w, h, (bx, by) => {
    const off = (by * ((w + 3) >> 2) + bx) * 8;
    const c0 = dv.getUint16(off, true);
    const c1 = dv.getUint16(off + 2, true);
    const indices = dv.getUint32(off + 4, true);
    writeColorBlock(out, w, h, bx, by, c0, c1, indices, true, () => 255);
  });
  return out;
}

/** DXT3 / BC2: 16-byte blocks (8 bytes explicit 4-bit alpha, then a DXT1-style color block,
 *  always in 4-color mode). */
function decodeDxt3(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  forEachBlock(w, h, (bx, by) => {
    const off = (by * ((w + 3) >> 2) + bx) * 16;
    const alpha = (texel: number) => {
      const nib = (src[off + (texel >> 1)]! >> ((texel & 1) * 4)) & 0x0f;
      return (nib << 4) | nib;
    };
    const c0 = dv.getUint16(off + 8, true);
    const c1 = dv.getUint16(off + 10, true);
    const indices = dv.getUint32(off + 12, true);
    writeColorBlock(out, w, h, bx, by, c0, c1, indices, false, alpha);
  });
  return out;
}

/** Decodes an 8-byte BC3/BC4-style interpolated 8-value channel block. Returns per-texel values. */
function decodeInterpolatedChannel(src: Uint8Array, off: number): number[] {
  const e0 = src[off]!;
  const e1 = src[off + 1]!;
  let bits = 0n;
  for (let i = 0; i < 6; i++)
    bits |= BigInt(src[off + 2 + i]!) << BigInt(8 * i);
  const vals: number[] = [];
  for (let t = 0; t < 16; t++) {
    const idx = Number((bits >> BigInt(3 * t)) & 0x7n);
    let v: number;
    if (idx === 0) v = e0;
    else if (idx === 1) v = e1;
    else if (e0 > e1) v = (((8 - idx) * e0 + (idx - 1) * e1) / 7) | 0;
    else if (idx === 6) v = 0;
    else if (idx === 7) v = 255;
    else v = (((6 - idx) * e0 + (idx - 1) * e1) / 5) | 0;
    vals.push(v);
  }
  return vals;
}

/** DXT5 / BC3: 16-byte blocks (8-byte interpolated alpha, then a DXT1-style color block, always
 *  in 4-color mode). */
function decodeDxt5(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  forEachBlock(w, h, (bx, by) => {
    const off = (by * ((w + 3) >> 2) + bx) * 16;
    const a = decodeInterpolatedChannel(src, off);
    const c0 = dv.getUint16(off + 8, true);
    const c1 = dv.getUint16(off + 10, true);
    const indices = dv.getUint32(off + 12, true);
    writeColorBlock(out, w, h, bx, by, c0, c1, indices, false, (t) => a[t]!);
  });
  return out;
}

/** BC4: single 8-byte interpolated channel -> gray RGB, opaque. */
function decodeBc4(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  forEachBlock(w, h, (bx, by) => {
    const off = (by * ((w + 3) >> 2) + bx) * 8;
    const v = decodeInterpolatedChannel(src, off);
    for (let t = 0; t < 16; t++) {
      const px = bx * 4 + (t & 3);
      const py = by * 4 + (t >> 2);
      if (px < w && py < h) {
        const o = (py * w + px) * 4;
        out[o] = v[t]!;
        out[o + 1] = v[t]!;
        out[o + 2] = v[t]!;
        out[o + 3] = 255;
      }
    }
  });
  return out;
}

/** BC5: two interpolated channels. Matches Bc5Sharp.Decode (R=ch0,G=ch1,B=0,A=255) followed by
 *  DxtUtil.SwapRedBlue (R<->B). Net: R=0, G=ch1, B=ch0, A=255. */
function decodeBc5(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  forEachBlock(w, h, (bx, by) => {
    const base = (by * ((w + 3) >> 2) + bx) * 16;
    const ch0 = decodeInterpolatedChannel(src, base);
    const ch1 = decodeInterpolatedChannel(src, base + 8);
    for (let t = 0; t < 16; t++) {
      const px = bx * 4 + (t & 3);
      const py = by * 4 + (t >> 2);
      if (px < w && py < h) {
        const o = (py * w + px) * 4;
        out[o] = 0; // R (was channel0 before swap)
        out[o + 1] = ch1[t]!; // G
        out[o + 2] = ch0[t]!; // B (channel0 after swap)
        out[o + 3] = 255; // A
      }
    }
  });
  return out;
}
