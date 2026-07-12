// Builds test/corpus/synthetic/case-mismatch.pmp: a PMP whose option Files VALUE is lowercased
// (as Penumbra writes it) while the archived payload entry preserves the option-folder DISPLAY
// case. Pre-fix, readPmp's exact-case lookup throws `pmp: missing file entry`; TexTools loads it
// via a case-insensitive NTFS read (PMP.cs:1080). The single gamePath is one /upgrade ignores, so
// ConsoleTools no-ops and the golden harness compares our output against the input. Reproduces the
// case-sensitivity fix (see docs/superpowers/specs/2026-07-11-pmp-case-insensitive-file-resolution-design.md).
// The .pmp is gitignored; regenerate locally with `npm run synthetics`.

import {
  DUMMY_PAYLOAD,
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

// A gamePath /upgrade ignores, so ConsoleTools no-ops.
const dummyGamePath = "chara/dummy/case_dummy.bin";
// Zip entry keeps DISPLAY case; the Files VALUE is lowercased + backslashed (Penumbra's form).
const displayZipPath = "Case Options/On/files/case_dummy.bin";
const filesValue = displayZipPath.toLowerCase().replace(/\//g, "\\");

writePmp("case-mismatch.pmp", {
  meta: syntheticMeta("Case Mismatch Repro"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    // group filename = group_001_<safeName("Case Options")> = the lowercased penumbra name, so our
    // writer reproduces it (mirrors build-synthetic-f1.ts).
    "group_001_case options.json": singleOptionGroup("Case Options", {
      [dummyGamePath]: filesValue,
    }),
  },
  files: { [displayZipPath]: DUMMY_PAYLOAD },
});
