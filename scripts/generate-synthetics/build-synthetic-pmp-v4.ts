// Builds test/corpus/synthetic/pmp-v4-extrafiles.pmp — the corpus's ONLY Penumbra v4 INPUT pack,
// and the reproduction for TexTools bug #23 (docs/TEXTOOLS_BUGS.md; upstream report at
// docs/upstream/2026-08-06-textools-pmp-v4-extrafile-duplication.md).
//
// SHAPE, and why each part is the way it is:
//
//  - Two payload members, deliberately named NOTHING like the paths TexTools regenerates on write
//    (`<optionPrefix><gamePath>`). If the input's member names happened to equal the regenerated
//    ones, the duplication would collapse onto the same name and the bug would be invisible.
//  - One is referenced by an INLINE GROUP (`meta.Groups[0]`), which LoadPMP's ExtraFiles scan
//    MISSES (PMP.cs:234 iterates the group_*.json list the v4 pull-back at :220 never assigns).
//  - The other is referenced by `meta.DefaultData`, which the SAME scan gets right (:267-276).
//
// That contrast is the whole diagnostic value of this pack: after a ConsoleTools /resave, the
// inline-group member appears TWICE in the output archive (once verbatim at its input name as an
// "ExtraFile", once at its regenerated dedup path) while the DefaultData member appears ONCE. Our
// port emits both once. See the OBSERVED OUTPUT block at the bottom of this file.
//
// Under ConsoleTools /upgrade this pack is an EXPECTED ERROR — ModpackUpgrader.cs:226-232 refuses a
// v4 input bound for a .pmp/.ttmp2 destination — so its `upgrade` corpus check takes the
// matched-failure path (assertMatchedUpgradeFailure), which is also the only end-to-end proof that
// our own refusal gate (src/upgrade/upgrade.ts) reproduces that message. It still lives in the
// `synthetic` root, NOT `upgrade-error`: the `resave` check is the one that matters here, and
// `upgrade-error` packs are scoped to the upgrade check alone (test/helpers/corpus-units.ts).
//
// The .pmp is gitignored; regenerate locally with `npm run synthetics`.

import type { PmpGroupJsonRaw } from "../../src/container/manifest-types";
import { DUMMY_PAYLOAD, syntheticMetaV4, writePmpV4 } from "./pmp-builder";

// `.bin` at a gamePath the transforms ignore, matching build-synthetic-f1.ts's proven convention:
// ConsoleTools has nothing to upgrade and the asset-level corpus checks have nothing to decode.
const GROUP_GAME_PATH = "chara/dummy/v4_group.bin";
const GROUP_ZIP_PATH = "files/v4_group.bin";
const DEFAULT_GAME_PATH = "chara/dummy/v4_default.bin";
const DEFAULT_ZIP_PATH = "files/v4_default.bin";

// An inline group, in the same key order PMPGroupJson serializes (PMP.cs:1495-1518) — the base
// fields, then Identifier, then Options (Order = 99). `Identifier` is a pinned literal for the same
// byte-reproducibility reason as meta's (see syntheticMetaV4).
const inlineGroup: PmpGroupJsonRaw = {
  Version: 0,
  Name: "V4 Payload",
  Description: "",
  Image: "",
  Page: 0,
  Priority: 0,
  Type: "Single",
  DefaultSettings: 0,
  Identifier: "00000000-0000-4000-8000-00000000f002",
  Options: [
    {
      Name: "On",
      Description: "",
      Image: "",
      Files: { [GROUP_GAME_PATH]: GROUP_ZIP_PATH.replace(/\//g, "\\") },
    },
  ],
};

writePmpV4("pmp-v4-extrafiles.pmp", {
  meta: syntheticMetaV4("PMP v4 ExtraFiles Repro", [inlineGroup], {
    Version: 0,
    Files: { [DEFAULT_GAME_PATH]: DEFAULT_ZIP_PATH.replace(/\//g, "\\") },
  }),
  files: {
    [GROUP_ZIP_PATH]: DUMMY_PAYLOAD,
    [DEFAULT_ZIP_PATH]: DUMMY_PAYLOAD,
  },
});

// OBSERVED OUTPUT (2026-08-07, oracleKey/sha256 of the input pack:
// de2fef310054153712065412b5ca277a916b77eb42f53a3acd30e49cb49abdcc — cache file
// test/corpus/.resave-cache/<oracleKey>.bin):
//
// !! CONTRADICTS THE PREDICTED SHAPE ABOVE. Read this before trusting the "regenerated dedup path"
// !! names described earlier in this file's header comment — they do NOT appear in the real output.
//
// The real /resave golden has THREE members, not four:
//
//   meta.json                  948 bytes  — the manifest
//   common/1/v4_default.bin      4 bytes  — SHARED regenerated path for BOTH payload files
//   files/v4_group.bin           4 bytes  — the duplicate: group's file, verbatim at its input path
//
// meta.json's two Files maps both now point at the SAME regenerated path:
//   Groups[0].Options[0].Files["chara/dummy/v4_group.bin"]  = "common\\1\\v4_default.bin"
//   DefaultData.Files["chara/dummy/v4_default.bin"]         = "common\\1\\v4_default.bin"
//
// WHY: this is not bug #23 misbehaving differently than expected — it's a SEPARATE, genuine TexTools
// mechanism, PmpExtensions.cs · ResolveDuplicates · 476-560, that content-hashes (SHA1) every file
// being written and collapses byte-identical files onto one shared "common/<idx>/<name>" path
// (:537-544). Both of this pack's payload files use the same `DUMMY_PAYLOAD` bytes ([0,1,2,3]), so
// they hash identically and ResolveDuplicates merges their regenerated write targets into one file —
// independent of, and layered on top of, the ExtraFiles bug. The predicted "v4 payload/..." and
// "default/..." distinct paths assumed distinct content and were never going to appear with this
// pack's shared DUMMY_PAYLOAD; that assumption was wrong, not the bug's mechanism.
//
// The bug #23 diagnostic itself IS confirmed, cleanly, by the asymmetry that survives the collapse:
//   - `files/v4_group.bin` (the GROUP file's own INPUT zip path) is present in the output — the
//     verbatim ExtraFile re-emit that WizardData.cs:1502 performs for a member the ExtraFiles scan
//     (PMP.cs:234) wrongly still sees, because the v4 pull-back at :220 never populated the group_*
//     list it iterates.
//   - `files/v4_default.bin` (the DEFAULT file's own INPUT zip path) is ABSENT — DefaultData is
//     scanned correctly (:267-276), so WizardData.cs:1502 never fires for it; it only reaches the
//     output via the normal regenerated-path write, which the dedup pass then shares with the
//     group's regenerated entry.
//   - Manifest values are unaffected by the bug: both Files maps point at a real, present member
//     (the shared common/1/ path) on both sides — confirming AGENTS.md's "manifest is not affected,
//     only the member set" note holds, just via a redirected shared target rather than two separate
//     regenerated targets.
//
// Our port's /resave still emits the OLD v3 shape entirely (default_mod.json + group_NNN_*.json,
// no meta.json Groups/DefaultData) — Tasks 6-8/11 haven't landed yet — so the corpus `resave` check
// for this pack fails with 8 regressions today; that failure is EXPECTED per this task's brief and
// is not blessed. The `upgrade` check passes as a matched failure (ConsoleTools /upgrade and our
// port both refuse a v4 .pmp input, per bug #23's `saveExtraFiles` gate not applying to /upgrade).
//
// TASKS 5 AND 10: build/confirm against the THREE-member shape above (one shared common/ file, one
// files/v4_group.bin duplicate), not the four-member shape predicted in this file's header.
