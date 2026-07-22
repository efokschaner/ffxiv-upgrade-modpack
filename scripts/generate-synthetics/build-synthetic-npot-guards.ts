// Builds test/corpus/upgrade-error/npot-tiny-mask.ttmp2 and npot-dxt3-mask.ttmp2: expected-failure
// oracles for the two guards Tasks 1-2 ADDED to resizeToPow2ForMerge (src/upgrade/texture.ts),
// standing in for the two ways Tex.MergePixelData (Tex.cs:637-706) can abort the whole upgrade that
// our elided re-encode doesn't otherwise reproduce. Those guards are inferred from READING the C#,
// not observed in any corpus pack failing — these two packs are how that inference gets checked
// against the real oracle (design spec
// docs/superpowers/specs/2026-07-21-npot-texture-resize-design.md §3.3/§5.1, plan
// docs/superpowers/plans/2026-07-21-npot-texture-resize.md Task 4). Both packs are the SAME shape as
// npot-mask-a8/-dxt5 (build-synthetic-npot-mask.ts) — same fictional e9999 material/normal/mask
// gamePaths, same colorset .mtrl (buildEwColorsetMaskMtrl) so the mask path (upgradeMaskTex,
// EndwalkerUpgrade.cs:2082-2098) actually runs, same power-of-two 64x64 A8R8G8B8 normal so
// CreateIndexFromNormal's resize path (the OTHER resizeToPow2ForMerge caller) never touches the
// resize path at all — the only thing that can trigger a failure in either pack is the mask:
//
//   - npot-tiny-mask: mask is 40x40 A8R8G8B8. RoundToPowerOfTwo(40) = 32 (IOUtil.cs:905-930;
//     |40-32| = 8 < |64-40| = 24, so it floors rather than ceils), so ResizeXivTx's post-resize
//     dims are 32x32 and Tex.cs:656-660's `tex.Width < 64 || tex.Height < 64` guard fires before
//     MergePixelData ever reaches the TexImpNet compressor call ("the entire application" would
//     otherwise hard-crash with a memory error on a surface this small, per the C#'s own comment).
//     A8R8G8B8 is itself SUPPORTED by GetCompressionFormat (Tex.cs:739-741, -> CompressionFormat.
//     BGRA), so this pack isolates the size guard alone — nothing here can trip the format guard.
//   - npot-dxt3-mask: mask is 400x400 DXT3. DXT3 decodes cleanly through our decodeToRgba
//     (src/tex/decode.ts accepts it — it is a real BCn variant, just one MergePixelData's own
//     switch never learned), so this pack reaches resizeToPow2ForMerge's format check rather than
//     dying earlier in the decoder. GetCompressionFormat's switch (Tex.cs:718-747) lists only
//     {DXT1, DXT5, BC4, BC5, BC7, A8R8G8B8}; DXT3 falls through to its `default:` and throws
//     InvalidDataException("Format is currently unsupported: " + format.ToString()). 400x400 is
//     ALREADY NPOT at the RIGHT size for this guard regardless of where RoundToPowerOfTwo(400)
//     lands (512, matching npot-mask-a8/-dxt5) — the format check in resizeToPow2ForMerge runs
//     before the size check, so a 400x400 DXT3 mask cannot also demonstrate the `<64` guard; that
//     needs its own pack. DXT3 block bytes: (400/4)*(400/4)*16 = 160000 (same block layout as DXT5,
//     verified to decode cleanly).
//
// Two SEPARATE packs, not one: either guard firing aborts the WHOLE upgrade (both are plain
// `throw`s with no surrounding try/catch reaching this far — EndwalkerUpgrade.cs:1842 has none, and
// ModpackUpgrader.cs:133-141 rethrows wrapped rather than swallowing), so a single pack carrying
// both a too-small AND an unsupported-format mask could only ever demonstrate whichever guard the
// code reaches FIRST, never both.
//
// If ConsoleTools /upgrade SUCCEEDS on either pack instead of erroring, the corresponding guard in
// resizeToPow2ForMerge is WRONG — TexTools reaches this input by some path the trace missed, and we
// would be refusing a modpack TexTools upgrades fine. That is treated as a successful outcome of
// this pair of packs (it is exactly what they exist to check), not a bug in the packs themselves;
// see the plan's Task 4 step 3.
//
// .ttmp2 rather than .pmp for the same reason as npot-mask-a8/-dxt5: keeps PMP's unported
// FastValidateTexFile load-time fixup (docs/backlog/2026-07-13-pmp-load-time-tex-fixup.md) off the
// one axis (does the mask reach resizeToPow2ForMerge with its authored NPOT dims intact) these
// packs need to be trustworthy on.

import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8, DXT3 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";
import { buildEwColorsetMaskMtrl } from "./synthetic-mtrl";
import { writeTtmp2Files } from "./ttmp2-builder";

const MTRL_PATH =
  "chara/equipment/e9999/material/v0001/mt_c9999e9999_top_a.mtrl";
const NORMAL_PATH = "chara/equipment/e9999/texture/c9999e9999_top_a_n.tex";
const MASK_PATH = "chara/equipment/e9999/texture/c9999e9999_top_a_m.tex";

/** Deterministic non-uniform byte pattern — a flat fill would make a resize difference invisible,
 * and (for the DXT3 pack) a flat block encodes to a degenerate, unrepresentative block. */
function pattern(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + 3) & 0xff;
  return out;
}

// Power-of-two normal: never touches the resize path, so each pack's only NPOT exercise is the mask.
const NORMAL_W = 64;
const NORMAL_H = 64;
const normalTex = concatBytes([
  buildCanonicalTexHeader(A8R8G8B8, NORMAL_W, NORMAL_H, 1),
  pattern(NORMAL_W * NORMAL_H * 4),
]);

// RoundToPowerOfTwo(40) = 32 (|40-32| = 8 < |64-40| = 24) -> post-resize 32x32 trips Tex.cs:656-660.
const TINY_MASK_W = 40;
const TINY_MASK_H = 40;
const tinyMaskTex = concatBytes([
  buildCanonicalTexHeader(A8R8G8B8, TINY_MASK_W, TINY_MASK_H, 1),
  pattern(TINY_MASK_W * TINY_MASK_H * 4),
]);

// DXT3 block bytes: (400/4)*(400/4)*16 = 160000 — see header comment. Arbitrary non-uniform bytes
// decode to a non-trivial image; decodeToRgba places no validity constraint on block content, and
// the point of this pack is never reaching a re-encode at all.
const DXT3_MASK_W = 400;
const DXT3_MASK_H = 400;
const dxt3MaskTex = concatBytes([
  buildCanonicalTexHeader(DXT3, DXT3_MASK_W, DXT3_MASK_H, 1),
  pattern((DXT3_MASK_W / 4) * (DXT3_MASK_H / 4) * 16),
]);

const mtrl = buildEwColorsetMaskMtrl(NORMAL_PATH, MASK_PATH);

writeTtmp2Files(
  "npot-tiny-mask.ttmp2",
  "NPOT Guard: Tiny Mask (40x40 -> 32x32)",
  [
    { gamePath: MTRL_PATH, data: mtrl },
    { gamePath: NORMAL_PATH, data: normalTex },
    { gamePath: MASK_PATH, data: tinyMaskTex },
  ],
  "upgrade-error",
);

writeTtmp2Files(
  "npot-dxt3-mask.ttmp2",
  "NPOT Guard: Unsupported Format Mask (DXT3)",
  [
    { gamePath: MTRL_PATH, data: mtrl },
    { gamePath: NORMAL_PATH, data: normalTex },
    { gamePath: MASK_PATH, data: dxt3MaskTex },
  ],
  "upgrade-error",
);
