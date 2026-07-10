import { A8R8G8B8 } from "../../src/tex/types";

// Registry of INTENTIONAL divergences from TexTools' /upgrade output. Each rule is a
// targeted CONFIRMATION that the divergence on a matching file is exactly the one we
// meant to introduce (e.g. our BCn encoder differs, so compressed blocks differ but the
// tex header/dims and decoded pixels agree within our documented precision loss). It is
// NOT a blanket tolerance: `confirm` must be tight enough that any OTHER difference still
// fails. Files matched by no rule must be byte-identical to the golden. Starts empty; the
// transform sub-projects add rules with cited reasons as generated files land.
export interface DivergenceRule {
  reason: string;
  predicate: (gamePath: string) => boolean;
  confirm: (ours: Uint8Array, golden: Uint8Array) => boolean;
}

// The texture round (docs/superpowers/specs/2026-07-09-texture-round-design.md) generates
// Dawntrail index/gear/hair textures as uncompressed A8R8G8B8 (XivCache.cs:68
// DefaultTextureFormat). When a generation SOURCE texture is BC-compressed (DXT1/BC5/etc.),
// our BC decoder rounds ±1 differently than C#'s — the same implementation-defined
// S3TC/RGTC value-rounding gap already documented+accepted for BC5 in src/tex/decode.ts
// (decodeBc5 header comment, ~line 396-398). That ±1 propagates verbatim into the generated
// output's pixel bytes, so our generated .tex can differ from the golden by up to ±1 per
// byte while being otherwise byte-identical. This rule confirms exactly that shape: same tex
// header (format/dims/mipCount, byte 0-79), format is A8R8G8B8 (so bytes >= 80 are raw BGRA
// pixels, not compressed block data — a byte-wise ±1 check is therefore a genuine per-pixel
// ±1 check), same total length, and every post-header byte within ±1.
const A8R8G8B8_HEADER_LEN = 80;
const A8R8G8B8_FORMAT_OFFSET = 4;
export const DIVERGENCE_RULES: DivergenceRule[] = [
  {
    reason:
      "Generated A8R8G8B8 index/gear/hair texture (XivCache.cs:68 DefaultTextureFormat) whose " +
      "BC-compressed generation source decodes with an implementation-defined ±1 value-rounding " +
      "gap vs C# — the same class of divergence documented for BC5 in src/tex/decode.ts. Header " +
      "(format/dims/mipCount) and length are byte-identical; every post-header pixel byte is " +
      "within ±1.",
    predicate: (gamePath) => gamePath.endsWith(".tex"),
    confirm: (ours, golden) => {
      if (ours.length !== golden.length || ours.length < A8R8G8B8_HEADER_LEN)
        return false;
      for (let i = 0; i < A8R8G8B8_HEADER_LEN; i++) {
        if (ours[i] !== golden[i]) return false;
      }
      const format = new DataView(
        golden.buffer,
        golden.byteOffset,
        golden.byteLength,
      ).getUint32(A8R8G8B8_FORMAT_OFFSET, true);
      if (format !== A8R8G8B8) return false;
      for (let i = A8R8G8B8_HEADER_LEN; i < golden.length; i++) {
        if (Math.abs(ours[i]! - golden[i]!) > 1) return false;
      }
      return true;
    },
  },
];

/** True iff some rule matches `gamePath` and confirms the ours/golden divergence is intended. */
export function confirmDivergence(
  gamePath: string,
  ours: Uint8Array,
  golden: Uint8Array,
  rules: DivergenceRule[] = DIVERGENCE_RULES,
): boolean {
  for (const r of rules) {
    if (r.predicate(gamePath) && r.confirm(ours, golden)) return true;
  }
  return false;
}
