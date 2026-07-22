// Builds test/corpus/synthetic/npot-mask-a8.ttmp2 and npot-mask-dxt5.ttmp2: the mask side's
// oracle for the NPOT Bicubic pre-step (design spec
// docs/superpowers/specs/2026-07-21-npot-texture-resize-design.md §3.3/§5.1). Both packs share one
// option carrying a colorset .mtrl (buildEwColorsetMaskMtrl) with a power-of-two 64x64 A8R8G8B8
// normal (so IndexMaps generation is trivial and never touches the resize path — the `<64` guard,
// Tex.cs:656-660, cannot fire) plus an NPOT 400x400 mask, so `upgradeMaskTex`'s NPOT branch
// (src/upgrade/texture.ts, EndwalkerUpgrade.cs:2082-2098) actually runs against a real ConsoleTools
// golden for the first time. RoundToPowerOfTwo(400) = 512 (IOUtil.cs:905-930; ties go to the
// floor, not that this is a tie).
//
// The two packs differ ONLY in the mask's compression format, so a divergence is attributable
// rather than merely observed:
//   - npot-mask-a8:   mask is A8R8G8B8. Tex.GetCompressionFormat (Tex.cs:718-747) maps this to
//     CompressionFormat.BGRA, so the MergePixelData round-trip we elide (see resizeToPow2ForMerge's
//     doc comment) is LOSSLESS for this format. This pack isolates the Bicubic resample alone.
//   - npot-mask-dxt5: mask is DXT5. MergePixelData re-encodes through nvtt here, which IS lossy —
//     the round-trip §3.3 establishes nothing else in the corpus has ever exercised — compounded
//     with our BCn decoder's own documented ±1 rounding divergence
//     (docs/backlog/2026-07-16-bcn-decoder-rounding-divergence.md).
// If -a8 is clean and -dxt5 is not, the round-trip (not the resampler) is the cause; if both
// diverge equally, the resampler is implicated instead. One combined pack could not distinguish
// the two. DXT5 block size for 400x400: (400/4)*(400/4)*16 = 160000 bytes, matching the real
// v01_m0242b0001_n_c.tex payload exactly (160080 with its 80-byte header).
//
// .ttmp2 rather than .pmp deliberately: Club Cyberia Motorbike (the index path's golden, §3.2)
// empirically proves the TTMP load path carries NPOT dimensions intact into the texture round,
// whereas whether PMP's unported FastValidateTexFile
// (docs/backlog/2026-07-13-pmp-load-time-tex-fixup.md) would normalize NPOT away at load time is an
// open question — keeping that unknown off the one pack that has to be trustworthy.
//
// The material path is a fictional chara/equipment/e9999 triple, chosen so
// resolveStolenIndexPath (src/upgrade/reference/index-path-resolver.ts) misses its table entirely
// (gate A of the index-path steal, EndwalkerUpgrade.cs:923-936) — no real base-game material lives
// at e9999, so the convention `_id.tex` path is kept and no index-path steal muddies the mask
// comparison this pack exists to make.

import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8, DXT5 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";
import { buildEwColorsetMaskMtrl } from "./synthetic-mtrl";
import { writeTtmp2Files } from "./ttmp2-builder";

const MTRL_PATH =
  "chara/equipment/e9999/material/v0001/mt_c9999e9999_top_a.mtrl";
const NORMAL_PATH = "chara/equipment/e9999/texture/c9999e9999_top_a_n.tex";
const MASK_PATH = "chara/equipment/e9999/texture/c9999e9999_top_a_m.tex";

/** Deterministic non-uniform byte pattern — a flat fill would make a resize difference invisible. */
function pattern(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + 3) & 0xff;
  return out;
}

// Power-of-two normal: never touches the resize path, so the pack's only NPOT exercise is the mask.
const NORMAL_W = 64;
const NORMAL_H = 64;
const normalTex = concatBytes([
  buildCanonicalTexHeader(A8R8G8B8, NORMAL_W, NORMAL_H, 1),
  pattern(NORMAL_W * NORMAL_H * 4),
]);

const MASK_W = 400;
const MASK_H = 400;
const maskTexA8 = concatBytes([
  buildCanonicalTexHeader(A8R8G8B8, MASK_W, MASK_H, 1),
  pattern(MASK_W * MASK_H * 4),
]);
// DXT5 block bytes: (400/4)*(400/4)*16 = 160000 — see header comment. Arbitrary non-uniform bytes
// decode to a non-trivial image; decodeToRgba places no validity constraint on block content.
// This is the ADVERSARIAL end of the range: after the 400->512 resample each 4x4 block has huge
// internal variance, which is the pathological worst case for BC endpoint fitting.
const maskTexDxt5 = concatBytes([
  buildCanonicalTexHeader(DXT5, MASK_W, MASK_H, 1),
  pattern((MASK_W / 4) * (MASK_H / 4) * 16),
]);

/** DXT5 blocks encoding a SMOOTH image — the realistic end of the range, standing in for what a
 *  real gear mask looks like. Hand-assembled rather than encoded because we have no BC encoder
 *  (that absence is the whole point of this pack; see the header).
 *
 *  DXT5 block layout: [alpha0, alpha1, 6 bytes of 16x 3-bit alpha indices, color0:u16 RGB565 LE,
 *  color1:u16 RGB565 LE, 4 bytes of 16x 2-bit colour indices]. Endpoints vary smoothly per block
 *  while the per-texel indices interpolate between them, so the decoded image is a smooth gradient
 *  with mild within-block variation — content BC can represent well, exactly as a real mask is. */
function smoothDxt5Blocks(width: number, height: number): Uint8Array {
  const bw = width / 4;
  const bh = height / 4;
  const out = new Uint8Array(bw * bh * 16);
  let o = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      // Alpha endpoints: a smooth diagonal ramp, a few levels apart so the 3-bit indices
      // interpolate a real (but gentle) gradient inside the block.
      const a0 = Math.min(255, Math.round((bx / bw) * 200) + 30);
      out[o++] = a0;
      out[o++] = Math.max(0, a0 - 8);
      for (let i = 0; i < 6; i++) out[o++] = 0x92; // repeating 3-bit indices (a gentle sweep)
      // Colour endpoints: RGB565, R ramping across x and G down y.
      const r5 = Math.round((bx / bw) * 31);
      const g6 = Math.round((by / bh) * 63);
      const c0 = (r5 << 11) | (g6 << 5) | 16;
      const c1 = (Math.max(0, r5 - 1) << 11) | (Math.max(0, g6 - 1) << 5) | 15;
      out[o++] = c0 & 0xff;
      out[o++] = (c0 >> 8) & 0xff;
      out[o++] = c1 & 0xff;
      out[o++] = (c1 >> 8) & 0xff;
      // 0x1b = 0b00011011; 2-bit indices are packed LSB-first, so each row decodes 3,2,1,0 —
      // a colour ramp across the block (direction is irrelevant, smoothness is the point).
      for (let i = 0; i < 4; i++) out[o++] = 0x1b;
    }
  }
  return out;
}

const maskTexDxt5Smooth = concatBytes([
  buildCanonicalTexHeader(DXT5, MASK_W, MASK_H, 1),
  smoothDxt5Blocks(MASK_W, MASK_H),
]);

const mtrl = buildEwColorsetMaskMtrl(NORMAL_PATH, MASK_PATH);

writeTtmp2Files("npot-mask-a8.ttmp2", "NPOT Mask (A8R8G8B8)", [
  { gamePath: MTRL_PATH, data: mtrl },
  { gamePath: NORMAL_PATH, data: normalTex },
  { gamePath: MASK_PATH, data: maskTexA8 },
]);

writeTtmp2Files("npot-mask-dxt5.ttmp2", "NPOT Mask (DXT5)", [
  { gamePath: MTRL_PATH, data: mtrl },
  { gamePath: NORMAL_PATH, data: normalTex },
  { gamePath: MASK_PATH, data: maskTexDxt5 },
]);

writeTtmp2Files("npot-mask-dxt5-smooth.ttmp2", "NPOT Mask (DXT5, smooth)", [
  { gamePath: MTRL_PATH, data: mtrl },
  { gamePath: NORMAL_PATH, data: normalTex },
  { gamePath: MASK_PATH, data: maskTexDxt5Smooth },
]);
