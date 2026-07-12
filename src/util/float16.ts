const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** float32 -> IEEE-754 binary16 raw uint16, round-to-nearest-even (matches .NET's System.Half
 *  `(Half)` cast). NOTE: this is NOT the universally-correct half packer for TexTools output --
 *  its *model* vertex writers use SharpDX Half, which TRUNCATES, so the geometry encoder uses
 *  floatToHalfTruncate instead. This RTNE function is kept for the colorset path
 *  (mtrl/shader.ts, upgrade/colorset-upgrade.ts), which stays byte-correct only because its
 *  injected constants are exactly-representable / tie-free halves where RTNE and truncation
 *  agree (golden-verified). */
export function floatToHalf(value: number): number {
  f32[0] = value;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp32 = (x >>> 23) & 0xff;
  const mant32 = x & 0x007fffff;

  if (exp32 === 0xff) {
    // Inf (mant 0) or NaN (mant != 0, kept quiet).
    return sign | 0x7c00 | (mant32 ? 0x0200 : 0);
  }

  const exp = exp32 - 127 + 15; // rebias into half's exponent range

  if (exp >= 0x1f) return sign | 0x7c00; // overflow -> Inf

  if (exp <= 0) {
    // Subnormal or zero in half.
    if (exp < -10) return sign; // too small -> signed zero
    const m = mant32 | 0x00800000; // restore implicit leading 1
    const shift = 14 - exp; // bits to drop (14..24)
    const dropped = m & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    let result = m >>> shift;
    // round-to-nearest-even: round up if past halfway, or exactly halfway and result is odd
    if (dropped > halfway || (dropped === halfway && (result & 1) === 1))
      result += 1;
    return sign | result; // a carry from 0x3ff -> 0x400 is the smallest normal — correct
  }

  // Normal number: keep top 10 mantissa bits, drop low 13, round-to-nearest-even.
  const dropped = mant32 & 0x1fff;
  let result = (exp << 10) | (mant32 >>> 13);
  if (dropped > 0x1000 || (dropped === 0x1000 && (result & 1) === 1)) {
    // carry propagates mantissa -> exponent automatically (exp lives in the high bits);
    // if it overflows to exp 0x1f the value becomes Inf, which is the correct rounded result.
    result += 1;
  }
  return sign | result;
}

/** float32 -> IEEE-754 binary16 by TRUNCATION toward zero (drop low mantissa bits, no
 *  rounding). Matches TexTools' model vertex writer, which packs via SharpDX `new Half()`
 *  (Mdl.cs:4121-4154 WriteVectorData / :4251-4256 UV1-UV2, :4271-4272 UV3) -- SharpDX
 *  truncates, unlike .NET's
 *  round-to-nearest `(Half)`. Distinct from floatToHalf (RTNE), which the colorset path
 *  keeps. Verified byte-exact against the ConsoleTools /upgrade golden for a Half-format
 *  model (Spring Florals c0201e6016_top.mdl). */
export function floatToHalfTruncate(value: number): number {
  f32[0] = value;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp32 = (x >>> 23) & 0xff;
  const mant32 = x & 0x007fffff;
  if (exp32 === 0xff) return sign | 0x7c00 | (mant32 ? 0x0200 : 0); // Inf / quiet NaN
  const exp = exp32 - 127 + 15; // rebias into half exponent range
  if (exp >= 0x1f) return sign | 0x7c00; // overflow -> Inf
  if (exp <= 0) {
    if (exp < -10) return sign; // too small -> signed zero
    const m = mant32 | 0x00800000; // restore implicit leading 1
    const shift = 14 - exp;
    return sign | (m >>> shift); // subnormal: truncate (no rounding)
  }
  return sign | (exp << 10) | (mant32 >>> 13); // normal: truncate low 13 mantissa bits
}

/** IEEE-754 binary16 raw uint16 -> number. Exact (every half is representable). */
export function halfToFloat(raw: number): number {
  const sign = raw & 0x8000 ? -1 : 1;
  const exp = (raw >> 10) & 0x1f;
  const mant = raw & 0x3ff;
  if (exp === 0) {
    // Zero or subnormal: value = mant * 2^-24.
    return sign * mant * 2 ** -24;
  }
  if (exp === 0x1f) {
    return mant === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  }
  // Normal: value = (1 + mant/1024) * 2^(exp-15).
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}
