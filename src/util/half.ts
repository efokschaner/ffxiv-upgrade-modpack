const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** float32 -> IEEE-754 binary16 raw uint16 (round-to-nearest-even). */
export function floatToHalf(value: number): number {
  f32[0] = value;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  let exp = (x >>> 23) & 0xff;
  let mant = x & 0x007fffff;

  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x0200 : 0); // Inf/NaN
  exp = exp - 127 + 15;
  if (exp >= 0x1f) return sign | 0x7c00; // overflow -> Inf
  if (exp <= 0) {
    if (exp < -10) return sign; // underflow -> signed zero
    mant |= 0x00800000;
    const shift = 14 - exp;
    let half = mant >> shift;
    if ((mant >> (shift - 1)) & 1) half += 1; // round to nearest even
    return sign | half;
  }
  let half = sign | (exp << 10) | (mant >> 13);
  if (mant & 0x00001000) half += 1; // round to nearest even
  return half;
}
