import {
  getDefaultColorsetRow,
  SHPK_CHARACTER_GLASS,
  SHPK_CHARACTER_LEGACY,
} from "../mtrl/shader";
import { floatToHalf } from "../util/half";

const HALF_ONE = floatToHalf(1.0);
const HALF_GLASS_SPEC = floatToHalf(0.8100586);

// EndwalkerUpgrade.cs:797-873. `old` is 256 raw half uint16s (16 rows x 16).
export function upgradeColorsetData(old: number[], shpk: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < 32; i++) out.push(...getDefaultColorsetRow(shpk));

  for (let i = 0; i < 16; i++) {
    let pixel = i * 16;
    let offset = i * 8 * 4;

    // Diffuse
    out[offset + 0] = old[pixel + 0]!;
    out[offset + 1] = old[pixel + 1]!;
    out[offset + 2] = old[pixel + 2]!;
    if (shpk === SHPK_CHARACTER_LEGACY) out[offset + 3] = old[pixel + 7]!;

    pixel += 4;
    offset += 4;

    // Specular
    if (shpk === SHPK_CHARACTER_GLASS) {
      out[offset + 0] = HALF_GLASS_SPEC;
      out[offset + 1] = HALF_GLASS_SPEC;
      out[offset + 2] = HALF_GLASS_SPEC;
    } else {
      out[offset + 0] = old[pixel + 0]!;
      out[offset + 1] = old[pixel + 1]!;
      out[offset + 2] = old[pixel + 2]!;
    }
    if (shpk === SHPK_CHARACTER_LEGACY) out[offset + 3] = old[pixel - 1]!;

    pixel += 4;
    offset += 4;

    // Emissive
    out[offset + 0] = old[pixel + 0]!;
    out[offset + 1] = old[pixel + 1]!;
    out[offset + 2] = old[pixel + 2]!;

    offset += 16; // skip 3 pixels + advance to the unknown/subsurface pixel

    out[offset + 1] = old[pixel + 3]!;
    out[offset + 2] = HALF_ONE; // subsurface material alpha

    pixel += 4;
    offset += 4;

    // Subsurface scaling
    out[offset + 0] = old[pixel + 0]!;
    out[offset + 1] = old[pixel + 1]!;
    out[offset + 2] = old[pixel + 2]!;
    out[offset + 3] = old[pixel + 3]!;
  }
  return out;
}

// EndwalkerUpgrade.cs:877-906. `oldDye` is 32 bytes (16 x uint16); output 128 (16 x uint32).
export function upgradeDyeData(oldDye: Uint8Array, shpk: string): Uint8Array {
  const out = new Uint8Array(128);
  const src = new DataView(oldDye.buffer, oldDye.byteOffset, oldDye.byteLength);
  const dst = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) {
    const oldBlock = src.getUint16(i * 2, true);
    const dyeBits = oldBlock & 0x1f;
    let template = oldBlock >>> 5;
    if (shpk !== SHPK_CHARACTER_LEGACY) template += 1000;
    dst.setUint32(i * 4, ((template << 16) | dyeBits) >>> 0, true);
  }
  return out;
}
