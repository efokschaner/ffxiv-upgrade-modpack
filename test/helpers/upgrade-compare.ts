import { decodeToRgba } from "../../src/tex/decode";
import { parseTex } from "../../src/tex/parse";
import { A8R8G8B8, isCompressed } from "../../src/tex/types";

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
  // ---- Load-seam BC-source NPOT resize divergence (docs/TEXTOOLS_BUGS.md #18,
  // backlog 2026-07-22-bc-encoder-merge-pixel-data.md, design spec
  // docs/superpowers/specs/2026-07-25-validate-tex-load-seam-design.md §3.4/§6.2) ----
  // `validateTexFileData`'s Branch A (src/upgrade/validate-tex.ts) resizes an NPOT-with-mips .tex to
  // power-of-two at TTMP LOAD time. For an A8R8G8B8 source this is byte-exact (no rule needed, no
  // rule covers it — the hard guard). For a BC-compressed source (DXT1/DXT5/BC5/BC7/...) TexTools
  // re-encodes the resized pixels back to the source's BC format via nvtt (`MergePixelData`); we have
  // no matching BC encoder, so we emit the resized image as A8R8G8B8 instead — same
  // `MergePixelData`-elision the material-round mask path above already ships, now also reachable at
  // load time. Unlike the mask rules (same A8R8G8B8 format both sides, differing only in resized
  // pixels), here ours and golden differ in FORMAT and LENGTH too — ours is A8R8G8B8, golden is the
  // source's original BC format — so the confirm below cannot compare bytes or same-shape pixels; it
  // decodes BOTH sides to RGBA and checks same dimensions (+ pixels, where a bound is meaningful).
  //
  // The one real pack that reaches this, KK_Sportcar_Final_Hotfix_V1.1.1.ttmp2, carries a DXT1
  // 2048x2048 NPOT-with-mips demihuman specular
  // (chara/demihuman/d1022/obj/equipment/e0001/texture/v01_d1022e0001_dwn_s.tex; ours resizes to
  // A8R8G8B8 2048x2048 mipCount 11, golden is DXT1 2048x2048 mipCount 12). Measured (2026-07-25,
  // throwaway harness script, mip0 RGBA): maxDelta 254/255, 2,247,453 / 16,777,216 bytes differ
  // (13.40%). That is noise-magnitude, not a tight bound — mirroring the adversarial NPOT-mask case
  // (measured 116, also structure-only) rather than the smooth one (measured 9, bounded) — so this
  // rule is STRUCTURE-ONLY: same dims, ours is A8R8G8B8, golden decodes as a recognized BC format,
  // decoded RGBA lengths match. It does not assert the pixels are correct (we cannot, without the
  // encoder); correctness of the resize itself is guarded byte-exactly elsewhere by the A8R8G8B8-source
  // case (src/upgrade/validate-tex.ts's unit tests, resizeBicubic's ImageSharp-golden fixtures, and
  // the byte-identical npot-mask-a8 corpus pack; a dedicated NPOT-with-mips A8R8G8B8 synthetic golden
  // is planned, design spec §6.2), which no rule here covers.
  //
  // PATH-SCOPED (via endsWith, robust to the prefixed member name the caller may pass — see
  // docs/backlog/2026-07-16-archive-diff-prefixed-gamepath.md) to KK_Sportcar's one diverging path, so
  // a different real pack reaching this branch (a different gamePath) is NOT silently covered and
  // shows up as a diff to inspect, and so an A8R8G8B8-source NPOT resize (byte-exact, no rule) is
  // never matched here either.
  {
    reason:
      "Load-seam Branch A BC-source NPOT resize (validateTexFileData, EndwalkerUpgrade.cs:2100-2129 " +
      "via Tex.MergePixelData, TEXTOOLS_BUGS.md #18): we emit A8R8G8B8 where TexTools re-encodes the " +
      "resized pixels to the source's original BC format (golden here is DXT1) -- no BC encoder here. " +
      "Measured mip0 maxDelta 254/255 (13.40% of bytes differ) on KK_Sportcar's " +
      "v01_d1022e0001_dwn_s.tex -- noise-magnitude, so pixels are accepted structure-only (same dims, " +
      "ours A8R8G8B8, golden a decodable BC format, equal decoded RGBA length). The A8R8G8B8-source " +
      "case stays byte-exact and is covered by no rule.",
    predicate: (gamePath) =>
      gamePath.endsWith(
        "chara/demihuman/d1022/obj/equipment/e0001/texture/v01_d1022e0001_dwn_s.tex",
      ),
    confirm: (ours, golden) => confirmBcResizedAsA8(ours, golden),
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

/** True iff `ours` is our A8R8G8B8 resize output and `golden` is TexTools' BC re-encode of the SAME
 *  resized image (the load-seam Branch A BC-source divergence, see the DIVERGENCE_RULES entry above).
 *  Cross-format: unlike isValidSameShapeA8Mask/withinDelta (both sides A8R8G8B8, same header/length),
 *  ours and golden here have DIFFERENT format, header, and length, so this parses+decodes both to
 *  RGBA and compares that instead of raw bytes.
 *    - `parseTex` both; a parse failure on either (majorly-broken data) is a genuine mismatch, not a
 *      confirmable divergence.
 *    - `ours` must be A8R8G8B8 -- the divergence is specifically "we emit A8R8G8B8"; anything else on
 *      the ours side is a real regression, not this rule's shape.
 *    - `golden` must be a format decodeToRgba supports decoding (`isCompressed`, matching
 *      decodedInputBytes' DXT1/DXT3/DXT5/BC4/BC5/BC7 dispatch) -- TexTools' whole point here is
 *      re-encoding to a BC format; an uncompressed golden is a different (byte-exact, unconfirmed)
 *      case.
 *    - `width`/`height` must be identical on both sides -- TexTools' resize target and ours must
 *      agree; only the format/compression differs, never the dims.
 *    - decode mip0 to RGBA on both; same dims already implies equal RGBA length, checked explicitly
 *      as a decoder-sanity guard rather than assumed.
 *    - `bound` omitted: structure-only (dims + format + both decode cleanly to equal-length RGBA) --
 *      for content where the BC round-trip error has no meaningful numeric bound (see the rule
 *      comment: measured max delta 254/255, noise-magnitude). `bound` given: every RGBA byte must
 *      also be within it, for content where a generous sanity ceiling is meaningful (mirroring
 *      NPOT_MASK_BC_BOUND above) -- unused today (KK_Sportcar's one diverging file is structure-only)
 *      but kept as a parameter so a future bounded case does not need a second near-duplicate helper.
 *  Exported for unit testing (test/helpers/upgrade-compare.test.ts) -- the shipped DIVERGENCE_RULES
 *  entry above always calls it unbounded, so the `bound` branch needs a direct test to be exercised
 *  at all. */
export function confirmBcResizedAsA8(
  ours: Uint8Array,
  golden: Uint8Array,
  bound?: number,
): boolean {
  let oursTex: ReturnType<typeof parseTex>;
  let goldenTex: ReturnType<typeof parseTex>;
  try {
    oursTex = parseTex(ours);
    goldenTex = parseTex(golden);
  } catch {
    return false;
  }
  if (oursTex.format !== A8R8G8B8) return false;
  if (!isCompressed(goldenTex.format)) return false;
  if (oursTex.width !== goldenTex.width || oursTex.height !== goldenTex.height)
    return false;
  let oursRgba: Uint8Array;
  let goldenRgba: Uint8Array;
  try {
    oursRgba = decodeToRgba(oursTex);
    goldenRgba = decodeToRgba(goldenTex);
  } catch {
    return false;
  }
  if (oursRgba.length !== goldenRgba.length) return false;
  if (bound === undefined) return true;
  for (let i = 0; i < oursRgba.length; i++) {
    if (Math.abs(oursRgba[i]! - goldenRgba[i]!) > bound) return false;
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
