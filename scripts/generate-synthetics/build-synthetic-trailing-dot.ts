// Builds test/corpus/synthetic/trailing-dot.pmp: a PMP whose option Files VALUE keeps a trailing
// dot on a folder segment (Penumbra's lowercased form) while the archived payload entry stores the
// Windows-stripped name. Pre-fix, readPmp misses it and throws `pmp: missing file entry`; TexTools
// resolves it via an NTFS Path.Combine read (PMP.cs:1080) after a LoadPMP with no existence check
// (PMP.cs:124). The single gamePath is one /upgrade ignores, so ConsoleTools no-ops and the golden
// harness compares our output against the input. Reproduces the Windows path-normalization fix (see
// docs/superpowers/specs/2026-07-11-pmp-windows-path-normalization-design.md). The .pmp is gitignored;
// regenerate locally with `npm run synthetics`.

import {
  DUMMY_PAYLOAD,
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

// A gamePath /upgrade ignores, so ConsoleTools no-ops.
const dummyGamePath = "chara/dummy/trailing_dot_dummy.bin";
// Archived entry: the Windows-stripped folder name (no trailing dot), arbitrary display case.
const strippedZipPath =
  "Trailing Options/Rose acc/files/trailing_dot_dummy.bin";
// Files VALUE: Penumbra's lowercased form, retaining a trailing '.' on the folder segment + backslashes.
const filesValue = "trailing options\\rose acc.\\files\\trailing_dot_dummy.bin";

writePmp("trailing-dot.pmp", {
  meta: syntheticMeta("Trailing Dot Repro"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    // group filename = group_001_<safeName("Trailing Options")> = the lowercased penumbra name, so our
    // writer reproduces it (mirrors build-synthetic-case-mismatch.ts).
    "group_001_trailing options.json": singleOptionGroup("Trailing Options", {
      [dummyGamePath]: filesValue,
    }),
  },
  files: { [strippedZipPath]: DUMMY_PAYLOAD },
});
