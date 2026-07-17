// Pure per-texel pixel transforms ported from xivModdingFramework
// Textures/TextureHelpers.cs. No ImageSharp, no block compression: every
// function here is deterministic integer math, so its output is byte-exact.

/** C#'s default Math.Round is banker's rounding (round-half-to-even), unlike JS
 *  Math.round (half-up). RemapByte (TextureHelpers.cs:219) relies on it. */
export function bankersRound(x: number): number {
  const r = Math.round(x);
  // Math.round rounds .5 up; correct only the exact-half case to nearest-even.
  if (Math.abs(x - Math.trunc(x)) === 0.5) {
    const floor = Math.floor(x);
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return r;
}

/** Port of TextureHelpers.ModifyPixels (TextureHelpers.cs:31): calls `fn` with the
 *  byte offset of every pixel, row-major. C# parallelizes per row; we run serially
 *  (the actions are independent and order-insensitive within our single-threaded port). */
export function modifyPixels(
  _rgba: Uint8Array,
  width: number,
  height: number,
  fn: (offset: number) => void,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      fn((width * y + x) * 4);
    }
  }
}

/** Port of TextureHelpers.CreateIndexTexture (TextureHelpers.cs:222). Reads ONLY the
 *  normal's alpha channel; emits an RGBA index map [newRow, newBlend, 0, 255].
 *  (255*blendRem/17 is always an exact integer, so no rounding ambiguity here.) */
export function createIndexTexture(
  normalRgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  modifyPixels(out, width, height, (offset) => {
    const originalCset = normalRgba[offset + 3]!;
    let blendRem = originalCset % 34;
    let originalRow = Math.trunc(originalCset / 17);
    if (blendRem > 17) {
      if (blendRem < 26) {
        blendRem = 17;
      } else {
        blendRem = 0;
        originalRow++;
      }
    }
    const newBlend = 255 - Math.round((blendRem / 17.0) * 255.0);
    const newRow = (Math.trunc(originalRow / 2) * 17 + 4) & 0xff;
    out[offset + 0] = newRow;
    out[offset + 1] = newBlend;
    out[offset + 2] = 0;
    out[offset + 3] = 255;
  });
  return out;
}

/** Port of TextureHelpers.UpgradeGearMask (TextureHelpers.cs:288). Mutates the mask in
 *  place: R<-spec(oldB), G<-roughness, B<-ao(oldR); alpha untouched. Non-legacy inverts
 *  gloss->roughness and floors 0 at 1; legacy keeps gloss as roughness. */
export function upgradeGearMask(
  maskRgba: Uint8Array,
  width: number,
  height: number,
  legacy: boolean,
): void {
  modifyPixels(maskRgba, width, height, (offset) => {
    const ao = maskRgba[offset + 0]!;
    const gloss = maskRgba[offset + 1]!;
    const spec = maskRgba[offset + 2]!;
    let rough = gloss;
    if (!legacy) {
      rough = (255 - gloss) & 0xff;
      if (rough === 0) rough = 1;
    }
    maskRgba[offset + 0] = spec;
    maskRgba[offset + 1] = rough;
    maskRgba[offset + 2] = ao;
  });
}

/** RemapByte (TextureHelpers.cs:216): linear rescale of one byte, banker's-rounded,
 *  clamped to [0,255]. */
function remapByte(
  value: number,
  oldMin: number,
  oldMax: number,
  newMin: number,
  newMax: number,
): number {
  const z = ((value - oldMin) / (oldMax - oldMin)) * (newMax - newMin) + newMin;
  return Math.max(Math.min(bankersRound(z), 255), 0);
}

/** Port of TextureHelpers.CreateHairMaps (TextureHelpers.cs:261). Mutates normal + mask
 *  in place. Reads original mask bytes before overwriting (C# evaluates newGreen and the
 *  normal.B copy from the pre-mutation mask). */
export function createHairMaps(
  normalRgba: Uint8Array,
  maskRgba: Uint8Array,
  width: number,
  height: number,
): void {
  modifyPixels(maskRgba, width, height, (offset) => {
    const m0 = maskRgba[offset + 0]!;
    const m1 = maskRgba[offset + 1]!;
    const m3 = maskRgba[offset + 3]!;
    const newGreen = remapByte((255 - m0) & 0xff, 0, 255, 10, 255);
    normalRgba[offset + 2] = m3; // Normal Blue <- Mask Alpha (highlight color)
    maskRgba[offset + 3] = m0; // Mask Alpha <- old Mask Red (albedo)
    maskRgba[offset + 0] = m1; // Mask Red <- old Mask Green (specular power)
    maskRgba[offset + 1] = newGreen; // Mask Green <- roughness
    maskRgba[offset + 2] = 49; // Mask Blue <- SSS thickness constant
  });
}

/** Port of TextureHelpers.ExpandChannel (TextureHelpers.cs:191): greyscales `channel` across the
 *  first 3 (or 4, if includeAlpha) channels of every texel, in place. */
export function expandChannel(
  data: Uint8Array,
  channel: number,
  width: number,
  height: number,
  includeAlpha = false,
): void {
  const max = includeAlpha ? 4 : 3;
  modifyPixels(data, width, height, (o) => {
    const v = data[o + channel]!;
    for (let z = 0; z < max; z++) data[o + z] = v;
  });
}

/** Port of TextureHelpers.MaskImage (TextureHelpers.cs:88): copies the mask's alpha into base's
 *  alpha. Reproduces the size-mismatch InvalidDataException (:90-95). */
export function maskImage(
  base: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
): void {
  const expected = width * height * 4;
  if (base.length !== expected || mask.length !== expected) {
    throw new Error(
      "tex: maskImage — images were not the expected size (TextureHelpers.cs:90)",
    );
  }
  modifyPixels(base, width, height, (o) => {
    base[o + 3] = mask[o + 3]!;
  });
}

/** Port of TextureHelpers.SwizzleRB (TextureHelpers.cs:172): swap R/B (bytes 0 and 2) per texel. */
export function swizzleRB(
  data: Uint8Array,
  width: number,
  height: number,
): void {
  modifyPixels(data, width, height, (o) => {
    const r = data[o]!;
    data[o] = data[o + 2]!;
    data[o + 2] = r;
  });
}
