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
