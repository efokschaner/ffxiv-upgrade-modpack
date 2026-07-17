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
// Measured max |ours-golden| on the synthetic eye-mask.pmp golden was 2 (see the rule below); +1
// margin for a tolerance that is a measurement, not a guess.
const EYE_DIFFUSE_TOLERANCE = 3;
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
  // Eye-mask round-6 diffuse (EndwalkerUpgrade.cs ConvertEyeMaskToDiffuse, :1910-2003): a multi-stage
  // ImageSharp float pipeline (Bicubic/NearestNeighbor resize, BoxBlur, SrcOver/SrcAtop composite)
  // ported faithfully at the algorithm/quantization level — including BoxBlur's per-pass 8-bit
  // Buffer2D<TPixel> inter-pass intermediate (src/tex/imagesharp/blur.ts requantizes to bytes
  // between its horizontal and vertical passes, matching Convolution2PassProcessor{TPixel}, rather
  // than an all-float "more precise" implementation that would itself be a divergence) — but in
  // float64 vs C#'s float32 Vector4 math throughout. With the quantization shape now matching,
  // the residual per-pixel delta is genuinely just that float-width difference, not a mismatched
  // blur algorithm. Measured against the synthetic eye-mask.pmp golden (test/corpus/synthetic,
  // built by scripts/generate-synthetics/build-synthetic-eye-mask.ts): header and length
  // byte-identical over all 349520 post-header bytes, max |ours-golden| = 2 (histogram: 318602
  // bytes @0, 30905 @1, 13 @2, 0 bytes > 2). EYE_DIFFUSE_TOLERANCE is that measured max plus a
  // 1-unit margin, not a loosely-picked bound. NOTE: this measurement predates the BoxBlur
  // inter-pass-requantization fix (test(tex): cover blur premultiply+vertical paths / fix(tex):
  // requantize BoxBlur inter-pass intermediate) — re-measure against a fresh synthetic golden
  // after that fix lands; the delta is expected to stay within tolerance and likely tighten, since
  // the blur no longer contributes an extra (non-float-width) source of error. Path-scoped to the
  // base-game eye diffuse destination (chara/common/texture/eye/..._base.tex) so it never loosens
  // the global `.tex` rule above.
  // `predicate` receives a bare gamePath from `diffUpgrade`'s per-gamePath payload diff, but a PMP
  // ARCHIVE MEMBER NAME (`<optionPrefix>chara/...`, see upgrade-archive-diff.ts's `diffPayloadMembers`
  // doc comment) from `diffArchives`' matched-pair content check — `.includes`/`.endsWith` match a
  // suffix in both shapes; `.startsWith` would silently never fire from the second call site.
  {
    reason:
      "Round-6 eye-mask diffuse (ConvertEyeMaskToDiffuse) — float64-vs-float32 ImageSharp pipeline " +
      "(BoxBlur's 8-bit inter-pass quantization now matches Convolution2PassProcessor, so the " +
      "residual is genuinely float-width-only); A8R8G8B8 header/dims/length identical, every " +
      "post-header pixel within " +
      `+/-${EYE_DIFFUSE_TOLERANCE} (measured max delta 2 on the synthetic eye-mask.pmp golden, ` +
      "pending re-measurement post-blur-fix — see comment above).",
    predicate: (gamePath) =>
      gamePath.includes("chara/common/texture/eye/") &&
      gamePath.endsWith("_base.tex"),
    confirm: (ours, golden) => {
      if (ours.length !== golden.length || ours.length < A8R8G8B8_HEADER_LEN)
        return false;
      for (let i = 0; i < A8R8G8B8_HEADER_LEN; i++)
        if (ours[i] !== golden[i]) return false;
      // Explicit format guard, mirroring the BC-rule check above: a +/-N per-byte tolerance is only
      // meaningful on uncompressed pixel bytes (bytes >= 80 as raw BGRA), so require A8R8G8B8 rather
      // than relying on the header-equality check above to imply it. Defense-in-depth — the eye
      // diffuse is always uncompressed A8R8G8B8 (encodeUncompressedTex, src/upgrade/eye-mask.ts) — not
      // a live fix.
      const format = new DataView(
        golden.buffer,
        golden.byteOffset,
        golden.byteLength,
      ).getUint32(A8R8G8B8_FORMAT_OFFSET, true);
      if (format !== A8R8G8B8) return false;
      for (let i = A8R8G8B8_HEADER_LEN; i < golden.length; i++)
        if (Math.abs(ours[i]! - golden[i]!) > EYE_DIFFUSE_TOLERANCE)
          return false;
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
