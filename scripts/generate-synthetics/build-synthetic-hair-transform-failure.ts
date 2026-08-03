// Builds test/corpus/synthetic/hair-transform-failure.pmp: the corpus' ONLY pack that makes
// EndwalkerUpgrade.cs:1498-1501's swallow fire, so it is the only live data behind the `"diagnostic"`
// DiffKind and its ratchet wiring (diagnostics-channel spec §7,
// docs/superpowers/specs/2026-08-01-upgrade-diagnostics-channel-design.md).
//
// Shape: a wizard PMP with one Single-select group, one option "On", carrying ONE loose pre-Dawntrail
// hair normal/specular pair and NO material — the same rescue path build-synthetic-unclaimed-hair.ts
// exercises (EndwalkerUpgrade.UpdateUnclaimedHairTextures, :1342-1519). The one difference is the
// NORMAL's DIMENSIONS, chosen so the hair pixel transform throws:
//
//   - The normal is 40x40. UpdateEndwalkerHairTextures NPOT-normalizes it first
//     (EndwalkerUpgrade.cs:1195-1198 -> Tex.ResizeXivTx), and RoundToPowerOfTwo(40) = 32
//     (IOUtil.cs:905-930; |40-32| = 8 < |64-40| = 24, so it floors). MergePixelData's size guard
//     (Tex.cs:656-660, `tex.Width < 64 || tex.Height < 64`, tested on the POST-resize dims) then
//     throws "Image is too small for DDS Compressor. (64x64 Minimum Size)".
//   - The pair is copied to its Dx11 destinations FIRST (:1478-1492), then transformed (:1495-1502).
//     The transform throws, `catch (Exception ex) { Trace.WriteLine(ex); continue; }` (:1498-1501)
//     swallows it, and the RAW pre-transform copies are what both TexTools and we leave behind.
//     So the upgraded bytes are identical on both sides and the ONLY difference is our
//     `HairTransformFailed` diagnostic (docs/TEXTOOLS_BUGS.md #12). VERIFIED against the real oracle,
//     2026-08-02: ConsoleTools /upgrade succeeds on this pack and its output matches ours
//     byte-for-byte at every gamePath. (Had it instead transformed successfully, the pack would have
//     been a finding about the oracle, not something to bless — see AGENTS.md.)
//
// The same guard at the ROUND-2 site is fatal rather than swallowed, and is pinned by
// test/corpus/upgrade-error/npot-tiny-mask.ttmp2 (build-synthetic-npot-guards.ts). This pack is its
// swallowed twin: same C# throw, reached through the hair try instead, so `ok: true` + a diagnostic
// rather than a refused pack — the site-dependence the diagnostics spec §6 item 2 describes.
//
// WHY NOT A TRUNCATED .tex, the other obvious way to force the throw (and the recipe used by the
// in-memory fixture at test/upgrade/unclaimed-hair.test.ts): it works against the oracle too
// (measured — ConsoleTools swallows a short mip identically), but a corpus pack also flows through
// the `assets` check family, whose `.tex` decode smoke (test/helpers/corpus-tex.ts) treats an
// undecodable texture as a hard failure. A 40x40 texture is perfectly well-formed and decodable; only
// the DDS compressor downstream refuses it. Keeping the corruption OUT of the file format means this
// pack needs no carve-out anywhere else in the harness.
//
// c0101 h0001 is a real Dawntrail hair: `fileExists` says its canonical material exists and
// src/upgrade/reference/hair-materials.ts carries it with shaderPackRaw "hair.shpk" and both Dx11
// sampler paths, so the rescue reaches the transform rather than one of the earlier `continue`s.
// Exactly ONE (race,id) group, so exactly ONE diagnostic — the assertion in
// EXPECTED_PACK_DIAGNOSTICS (test/helpers/corpus-upgrade.ts) is an EXACT match, not a subset.
//
// One further byte-level constraint: NO trailing NUL bytes in either texture's payload. PMP load runs
// every unzipped .tex through EndwalkerUpgrade.FastValidateTexFile (PMP.cs:86), whose second step
// truncates trailing null padding (:2149-2165) and which we have NOT ported
// (docs/backlog/2026-07-13-pmp-load-time-tex-fixup.md). A NUL-tailed payload would be a different
// length on TexTools' side than on ours — a byte divergence with nothing to do with what this pack is
// for. `pattern()` below never emits 0.
//
// The .pmp is gitignored; regenerate locally with `npm run synthetics` or
// `npx tsx scripts/generate-synthetics/build-synthetic-hair-transform-failure.ts`.

import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";
import {
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

/** RoundToPowerOfTwo(40) = 32, which trips Tex.cs:656-660's `< 64` guard. See the header comment. */
const NORMAL_DIM = 40;
/** Power-of-two and >= 64, so resizeToPow2ForMerge short-circuits and the MASK can never be the
 * thing that fails — the pack has exactly one cause of failure. */
const MASK_DIM = 64;

/** Deterministic, never-zero byte fill. Never-zero matters: see the FastValidateTexFile note in the
 * header comment. `seed` keeps the normal's and the mask's bytes distinct so a copy landing at the
 * wrong destination could not hide behind identical content. */
function pattern(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = ((i * 7 + seed) & 0xfe) | 1;
  return out;
}

/** A complete, well-formed single-mip A8R8G8B8 texture — nothing here is malformed. */
function tex(dim: number, seed: number): Uint8Array {
  return concatBytes([
    buildCanonicalTexHeader(A8R8G8B8, dim, dim, 1),
    pattern(dim * dim * 4, seed),
  ]);
}

const NORM_OLD =
  "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
const SPEC_OLD =
  "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_s.tex";

// gamePath -> [zipPath, bytes]. zipPath is backslashed as Penumbra writes it on disk; the pack-level
// `files` map keys by the forward-slashed zip path instead.
const LOOSE_FILES: Record<string, [zipPath: string, bytes: Uint8Array]> = {
  [NORM_OLD]: ["files\\c0101h0001_hir_n.tex", tex(NORMAL_DIM, 1)],
  [SPEC_OLD]: ["files\\c0101h0001_hir_s.tex", tex(MASK_DIM, 2)],
};

const groupFiles: Record<string, string> = {};
const packFiles: Record<string, Uint8Array> = {};
for (const [gamePath, [zipPath, bytes]] of Object.entries(LOOSE_FILES)) {
  groupFiles[gamePath] = zipPath;
  packFiles[zipPath.replace(/\\/g, "/")] = bytes;
}

writePmp("hair-transform-failure.pmp", {
  meta: syntheticMeta("Hair Transform Failure"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_loose hair textures.json": singleOptionGroup(
      "Loose Hair Textures",
      groupFiles,
    ),
  },
  files: packFiles,
});
