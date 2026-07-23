import { A8R8G8B8 } from "../../src/tex/types";

// Registry of INTENTIONAL divergences from TexTools' /upgrade output. Each rule is a
// targeted CONFIRMATION that the divergence on a matching file is exactly the one we
// meant to introduce (e.g. our BCn encoder differs, so compressed blocks differ but the
// tex header/dims and decoded pixels agree within our documented precision loss). It is
// NOT a blanket tolerance: `confirm` must be tight enough that any OTHER difference still
// fails. Files matched by no rule must be byte-identical to the golden. Starts empty; the
// transform sub-projects add rules with cited reasons as generated files land.
//
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
// SCOPE NOTE: this rule is *phenomenon-scoped*, not path-scoped — "was the generation source
// BC-compressed?" is unknowable at compare time, so any A8R8G8B8 output whose only difference
// from the golden is a uniform <=±1 is confirmed. A *systematic* ±1 bug in the deterministic
// transforms (a wrong constant, a rounding-mode slip) could in principle hide here; that
// residual surface is instead covered by the byte-exact unit tests on every transform
// (test/tex/tex-helpers.test.ts — the =49 SSS constant, the remapByte→106 value, all
// createIndexTexture cases), which fail long before the golden harness runs. The
// rationale for accepting a programmatic (phenomenon-scoped) exception here, rather than
// the path-scoping the design first envisioned, is written up in the texture-round spec §5
// (docs/superpowers/specs/2026-07-09-texture-round-design.md).
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
  // ---- NPOT BC-source mask divergence (docs/TEXTOOLS_BUGS.md #18, backlog 2026-07-22-...) ----
  // TexTools BC-recompresses the resized mask via MergePixelData — a needless round-trip we skip
  // (resizeToPow2ForMerge) — so our clean resize+gearmask output diverges from the golden whenever
  // the mask SOURCE was BC-compressed AND non-power-of-two. The magnitude is set by the content and
  // by TexTools' own nvtt encoder, so no environment-invariant numeric bound exists. Crucially the
  // resampler+gearmask CORRECTNESS is guarded byte-exactly elsewhere — `npot-mask-a8.ttmp2` (a
  // lossless-source mask, byte-IDENTICAL to its golden, NOT covered by these rules) and the
  // byte-exact unit tests in test/upgrade/texture.test.ts — so these two rules verify only that our
  // output is a structurally valid same-shape A8R8G8B8 mask and then accept the pixel divergence.
  //
  // PATH-SCOPED to the two fixture masks (via endsWith, robust to the prefixed member name the
  // caller passes — see docs/backlog/2026-07-16-archive-diff-prefixed-gamepath.md) so a REAL pack
  // with an NPOT BC mask (a different gamePath) is never covered and shows up as a diff to inspect,
  // and so npot-mask-a8's own mask (top_a) is never covered. This replaced the earlier ratchet-only
  // handling: a committed rule with a cited reason is documentation; a gitignored baseline entry is
  // not (AGENTS.md).
  //   - top_b (npot-mask-dxt5-smooth): realistic smooth content. Bounded delta — a sanity ceiling,
  //     not a claimed divergence bound (measured max 9; NPOT_MASK_BC_BOUND gives headroom for a
  //     different nvtt build). Catches gross breakage without pretending to know the true bound.
  //   - top_c (npot-mask-dxt5): adversarial pseudo-random content (measured max 116). No meaningful
  //     numeric bound, so pixels are exempt — structure only.
  {
    reason:
      "NPOT BC-source gear mask (npot-mask-dxt5-smooth, realistic content): TexTools' needless " +
      "MergePixelData BC round-trip (docs/TEXTOOLS_BUGS.md #18) diverges the golden from our clean " +
      "resize. Same A8R8G8B8 header/dims/length; every pixel byte within the sanity ceiling. " +
      "Correctness guarded byte-exactly by npot-mask-a8 + test/upgrade/texture.test.ts.",
    predicate: (gamePath) => gamePath.endsWith("c9999e9999_top_b_m.tex"),
    confirm: (ours, golden) =>
      isValidSameShapeA8Mask(ours, golden) &&
      withinDelta(ours, golden, NPOT_MASK_BC_BOUND),
  },
  {
    reason:
      "NPOT BC-source gear mask (npot-mask-dxt5, adversarial pseudo-random content): as above, but " +
      "the BC round-trip's error has no meaningful numeric bound on noise content (measured max " +
      "116), so pixels are accepted structure-only. Correctness guarded byte-exactly elsewhere.",
    predicate: (gamePath) => gamePath.endsWith("c9999e9999_top_c_m.tex"),
    confirm: (ours, golden) => isValidSameShapeA8Mask(ours, golden),
  },
];

/** A generous sanity ceiling for the realistic (smooth) NPOT BC mask fixture: measured max delta is
 *  9, and this leaves headroom for a golden regenerated by a different nvtt build. NOT a claim about
 *  the true divergence bound (there isn't one — see the rule comment); a gross regression, which
 *  would also fail the byte-exact npot-mask-a8 guard, is what this catches. */
const NPOT_MASK_BC_BOUND = 32;

/** True iff `ours` is a same-length A8R8G8B8 tex with a byte-identical 80-byte header (so same
 *  format/dims/mipCount/offsets) as `golden`. The structural half shared by both NPOT-mask rules;
 *  it rejects gross breakage (wrong dims, truncation, a crash producing empty) while leaving the
 *  pixel comparison to each rule. */
function isValidSameShapeA8Mask(ours: Uint8Array, golden: Uint8Array): boolean {
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
  return format === A8R8G8B8;
}

/** True iff every post-header byte of `ours` is within `bound` of `golden`. Assumes the header/
 *  length were already checked (isValidSameShapeA8Mask), so bytes >= 80 are raw A8R8G8B8 pixels. */
function withinDelta(
  ours: Uint8Array,
  golden: Uint8Array,
  bound: number,
): boolean {
  for (let i = A8R8G8B8_HEADER_LEN; i < golden.length; i++) {
    if (Math.abs(ours[i]! - golden[i]!) > bound) return false;
  }
  return true;
}

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
