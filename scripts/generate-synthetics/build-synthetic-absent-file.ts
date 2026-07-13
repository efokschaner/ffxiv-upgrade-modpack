// Builds test/corpus/synthetic/absent-file.pmp: a PMP whose option Files map names a zip path the
// archive genuinely does not contain — not a resolution bug (no casing or trailing-dot form of it
// is packed either), the payload was simply never included. TexTools tolerates this: LoadPMP does
// no existence check (PMP.cs:124), UnpackPmpOption builds a FileStorageInformation whose RealPath
// does not exist (PMP.cs:1071-1102), every read seam null-guards it (ResolveFile,
// EndwalkerUpgrade.cs:1758), and the writer drops it (PMP.cs:883-888). Pre-fix, readPmp threw
// `pmp: missing file entry`.
//
// Both gamePaths are ones /upgrade ignores, so ConsoleTools no-ops and the golden harness compares
// our output against the input — which still lists the dangling key, so this pack also exercises the
// manifest carve-out in test/helpers/upgrade-archive-diff.ts. See
// docs/superpowers/specs/2026-07-12-pmp-absent-file-tolerance-design.md.
// The .pmp is gitignored; regenerate locally with `npm run synthetics`.

import {
  DUMMY_PAYLOAD,
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

// A gamePath /upgrade ignores, whose payload IS packed — so the pack is not degenerate and the
// surviving Files key proves the drop is scoped to the absent one.
const presentGamePath = "chara/dummy/absent_file_present.bin";
const presentZipPath = "Absent Options/On/files/absent_file_present.bin";

// A gamePath /upgrade ignores, whose payload is NOT packed. No entry of any casing exists.
const absentGamePath = "chara/dummy/absent_file_missing.bin";
const absentFilesValue = "absent options\\on\\files\\absent_file_missing.bin";

writePmp("absent-file.pmp", {
  meta: syntheticMeta("Absent File Repro"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_absent options.json": singleOptionGroup("Absent Options", {
      [presentGamePath]: presentZipPath.toLowerCase().replace(/\//g, "\\"),
      [absentGamePath]: absentFilesValue,
    }),
  },
  files: { [presentZipPath]: DUMMY_PAYLOAD },
});
