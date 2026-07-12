// Builds test/corpus/synthetic/f1-safename.pmp: a wizard PMP whose group Name has spaces + capitals,
// so TexTools' MakePMPPathSafe emits "group_001_weareable ears options.json" while the pre-fix TS
// safeName emits "group_001_Weareable_Ears_Options.json". Reproduces audit finding F1 (see the
// parity design spec §6). The .pmp is gitignored; regenerate locally with `npm run synthetics`.

import {
  DUMMY_PAYLOAD,
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

// One already-Dawntrail-safe dummy file at a gamePath /upgrade ignores, so ConsoleTools no-ops.
const dummyGamePath = "chara/dummy/f1_dummy.bin";
const dummyZipPath = "files/f1_dummy.bin";

writePmp("f1-safename.pmp", {
  meta: syntheticMeta("F1 SafeName Repro"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    // NOTE: authored with the CORRECT penumbra name (lowercase, spaces kept) so the pre-fix writer diverges.
    "group_001_weareable ears options.json": singleOptionGroup(
      "Weareable Ears Options",
      { [dummyGamePath]: dummyZipPath.replace(/\//g, "\\") },
    ),
  },
  files: { [dummyZipPath]: DUMMY_PAYLOAD },
});
