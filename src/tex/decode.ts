// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.
//
// Uncompressed unpacks are ported from DDS.ConvertPixelData (DDS.cs:453). Block decoders (added in
// later tasks) are ported from MIT richgel999/bc7enc_rdo (rgbcx.h), not the Ms-PL FNA DxtUtil.

import {
  A1R5G5B5,
  A4R4G4B4,
  A8,
  A8R8G8B8,
  A16B16G16R16F,
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
