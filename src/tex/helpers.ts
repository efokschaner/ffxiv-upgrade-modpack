// Pure per-texel pixel transforms ported from xivModdingFramework
// Textures/TextureHelpers.cs. No ImageSharp, no block compression: every
// function here is deterministic integer math, so its output is byte-exact.

/** C#'s default Math.Round is banker's rounding (round-half-to-even), unlike JS
 *  Math.round (half-up). TextureHelpers.cs:219 / CreateIndexTexture:247 rely on it. */
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
