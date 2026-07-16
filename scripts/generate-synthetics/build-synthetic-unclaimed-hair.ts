// Builds test/corpus/synthetic/unclaimed-hair.pmp: a wizard PMP with one Single-select group, one
// option "On", carrying four LOOSE pre-Dawntrail textures and NO material — so /upgrade's material
// scan finds nothing to fix up and only the round-6 "unclaimed" texture partials
// (EndwalkerUpgrade.cs UpdateUnclaimedHairTextures, :1324-1519) fire, matching each loose file's
// gamePath against the generated hair-materials table by filename convention alone.
//
// Two real (race,id) pairs from src/upgrade/reference/hair-materials.ts:
//  - HAIR c0101 h0001 (hair.shpk): dest norm/mask are plain copies, no material rewrite (its
//    canonical mtrl carries no tailRewriteMtrlBase64).
//  - TAIL c0701 t0001 (hair.shpk, hideBackfaces=false): the same copy fires for its norm/mask, PLUS
//    the constant-swap rewrite emits mt_c0701t0001_a.mtrl from the table's tailRewriteMtrlBase64 —
//    exercising the tail-specific branch the hair pair does not reach.
//
// See docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md for the feature
// overview. The .pmp is gitignored; regenerate locally with `npm run synthetics` or
// `npx tsx scripts/generate-synthetics/build-synthetic-unclaimed-hair.ts`.

import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";
import {
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

/** A valid 8x8 A8R8G8B8 single-mip .tex, distinct per `seed` so normal != mask bytes. Equal pow2
 * dimensions keep the hair pixel transform inside the ported resampler (unequal dims are the
 * documented gap). */
function tex(seed: number): Uint8Array {
  const header = buildCanonicalTexHeader(A8R8G8B8, 8, 8, 1);
  const pixels = new Uint8Array(8 * 8 * 4).map((_, i) => (i * 7 + seed) & 0xff);
  return concatBytes([header, pixels]);
}

// gamePath -> [zipPath, tex bytes]. zipPath is backslashed as Penumbra writes it on disk; the
// pack-level `files` map (below) keys by the forward-slashed zip path instead.
const LOOSE_FILES: Record<string, [zipPath: string, bytes: Uint8Array]> = {
  "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex": [
    "files\\c0101h0001_hir_n.tex",
    tex(1),
  ],
  "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_s.tex": [
    "files\\c0101h0001_hir_s.tex",
    tex(2),
  ],
  "chara/human/c0701/obj/tail/t0001/texture/c0701t0001_etc_n.tex": [
    "files\\c0701t0001_etc_n.tex",
    tex(3),
  ],
  "chara/human/c0701/obj/tail/t0001/texture/c0701t0001_etc_s.tex": [
    "files\\c0701t0001_etc_s.tex",
    tex(4),
  ],
};

const groupFiles: Record<string, string> = {};
const packFiles: Record<string, Uint8Array> = {};
for (const [gamePath, [zipPath, bytes]] of Object.entries(LOOSE_FILES)) {
  groupFiles[gamePath] = zipPath;
  packFiles[zipPath.replace(/\\/g, "/")] = bytes;
}

writePmp("unclaimed-hair.pmp", {
  meta: syntheticMeta("Unclaimed Hair Rescue"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_loose hair textures.json": singleOptionGroup(
      "Loose Hair Textures",
      groupFiles,
    ),
  },
  files: packFiles,
});
