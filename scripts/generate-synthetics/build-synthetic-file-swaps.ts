// Builds test/corpus/synthetic/file-swaps.pmp: the pack that makes TexTools' FileSwap placeholder
// idx-burn OBSERVABLE, so our deliberate divergence from it is measured rather than reasoned about.
// See docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md.
//
// WHY THE SHAPE IS WHAT IT IS -- two groups, not one:
//
// UnpackPmpOption (PMP.cs:1104-1137) appends each option's FileSwap placeholders AFTER that same
// option's own Files. So in a ONE-option pack every real file is visited before any placeholder, the
// zero-hash collision happens last, and the idx it burns lands after every duplicate has already
// been numbered -- shifting nothing and proving nothing. (`torn bassment glow.pmp`, the only real
// corpus pack with swaps, is exactly this degenerate case: 6 swaps, no duplicate content, no
// observable effect.)
//
// Splitting across two groups fixes the ordering. FileIdentifier.IdentifierListFromDictionaries
// walks option-by-option building the dictionary ResolveDuplicates then dedupes
// (PmpExtensions.cs:594-611), so:
//
//   TexTools:  [swaps option: placeholder(src1), placeholder(src2)]  -> collide on ZERO_HASH, burn idx 1
//              [dupes option: dupA, dupB]                            -> duplicate promoted to common/2
//   Ours:      [swaps option: nothing -- swaps are preserved, never placeholders]
//              [dupes option: dupA, dupB]                            -> duplicate promoted to common/1
//
// The golden's common index set therefore has a GAP at 1 (the burned idx's own name is never
// emitted -- every zero-hash entry is dropped from the returned map), and ours is gapless. That gap
// is the signature the semantic-comparison mode keys on.
//
// The swap SOURCES must be real base-game paths or TexTools skips them outright (`offset <= 0`,
// PMP.cs:1118-1122) and no placeholder is created at all -- the pack would then prove nothing. The
// two below were verified present in the 040000 index via scripts/lib/game-index.ts.
//
// Both gamePaths under chara/dummy/ are ones /upgrade ignores, so ConsoleTools no-ops there and the
// UPGRADE golden falls back to comparing against the input pack. The check that matters for this
// pack is /resave, which is load-then-write and therefore ALWAYS produces a TexTools-written
// archive -- including its own common/N numbering.
//
// The .pmp is gitignored; regenerate locally with `npm run synthetics`.

import {
  DUMMY_PAYLOAD,
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

// Group 1 -- carries the FileSwaps. Also carries one ordinary file so the group is not content-free
// (a content-free group is KEPT by ClearNulls, but a file here keeps the pack closer to a real one).
const swapHolderGamePath = "chara/dummy/file_swaps_holder.bin";
const swapHolderZipPath = "Swaps/On/files/file_swaps_holder.bin";

// Real base-game paths (verified in the 040000 index) -> TexTools resolves them and creates a
// placeholder for each. TWO of them, so the zero-hash class reaches the 2-member threshold that
// burns an idx. The keys are the gamePaths being overridden; the values are the base-game files
// served instead, backslashed as Penumbra writes them (PMP.cs:1107-1109).
const fileSwaps = {
  "chara/dummy/file_swap_dest_1.tex":
    "chara\\equipment\\e6120\\texture\\v01_c0101e6120_top_n.tex",
  "chara/dummy/file_swap_dest_2.tex":
    "chara\\equipment\\e6120\\texture\\v01_c0101e6120_top_m.tex",
};

// Group 2 -- the duplicate pair whose common/N number the burned idx shifts. Two DISTINCT gamePaths
// and two DISTINCT zip members carrying IDENTICAL bytes, which is what ResolveDuplicates dedupes on
// (content hash, PmpExtensions.cs:528-551) -- not on path.
const dupeAGamePath = "chara/dummy/file_swaps_dupe_a.bin";
const dupeAZipPath = "Dupes/On/files/file_swaps_dupe_a.bin";
const dupeBGamePath = "chara/dummy/file_swaps_dupe_b.bin";
const dupeBZipPath = "Dupes/On/files/file_swaps_dupe_b.bin";

const backslashed = (p: string) => p.toLowerCase().replace(/\//g, "\\");

writePmp("file-swaps.pmp", {
  meta: syntheticMeta("File Swaps Repro"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_swaps.json": singleOptionGroup(
      "Swaps",
      { [swapHolderGamePath]: backslashed(swapHolderZipPath) },
      fileSwaps,
    ),
    "group_002_dupes.json": singleOptionGroup("Dupes", {
      [dupeAGamePath]: backslashed(dupeAZipPath),
      [dupeBGamePath]: backslashed(dupeBZipPath),
    }),
  },
  files: {
    [swapHolderZipPath]: DUMMY_PAYLOAD,
    // Identical CONTENT under two different member names -> the pack's one real duplicate.
    [dupeAZipPath]: new Uint8Array([9, 8, 7, 6, 5]),
    [dupeBZipPath]: new Uint8Array([9, 8, 7, 6, 5]),
  },
});
