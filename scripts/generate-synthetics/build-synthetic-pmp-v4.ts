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
// port emits both once. See the OBSERVED OUTPUT block at the bottom of this file — this shape is
// CONFIRMED against the real oracle output, not predicted; read that block for the exact bytes.
// (An earlier revision of this pack gave both payload files the same content, which triggered an
// unrelated TexTools content-hash dedup pass (PmpExtensions.cs · ResolveDuplicates · 476-560) and
// collapsed the two regenerated paths into one shared file. Distinct GROUP_PAYLOAD/DEFAULT_PAYLOAD
// below avoid that path entirely, so the observed shape below isolates bug #23 alone.)
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
import { syntheticMetaV4, writePmpV4 } from "./pmp-builder";

// `.bin` at a gamePath the transforms ignore, matching build-synthetic-f1.ts's proven convention:
// ConsoleTools has nothing to upgrade and the asset-level corpus checks have nothing to decode.
const GROUP_GAME_PATH = "chara/dummy/v4_group.bin";
const GROUP_ZIP_PATH = "files/v4_group.bin";
const DEFAULT_GAME_PATH = "chara/dummy/v4_default.bin";
const DEFAULT_ZIP_PATH = "files/v4_default.bin";

// Distinct bytes per file — NOT pmp-builder.ts's shared `DUMMY_PAYLOAD`. That constant's contract
// (pmp-builder.ts:35-42) is "content is irrelevant"; here it is load-bearing. TexTools content-hashes
// (SHA1) every file it writes and collapses byte-identical files onto one shared path
// (PmpExtensions.cs · ResolveDuplicates · 537-544) — an unrelated dedup mechanism this pack must NOT
// trigger, or the golden conflates it with the bug #23 duplication this pack exists to isolate. With
// distinct bytes neither file's hash repeats, so ResolveDuplicates never takes the collapsing branch
// (:537) and each keeps its own regenerated prefix (:548), and the extra output member's content
// uniquely identifies it as the group file's payload rather than being equally explainable by either.
const GROUP_PAYLOAD = new Uint8Array([0xa1, 0xa2, 0xa3, 0xa4]);
const DEFAULT_PAYLOAD = new Uint8Array([0xb1, 0xb2, 0xb3, 0xb4]);

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
    [GROUP_ZIP_PATH]: GROUP_PAYLOAD,
    [DEFAULT_ZIP_PATH]: DEFAULT_PAYLOAD,
  },
});

// OBSERVED OUTPUT (2026-08-07, oracleKey/sha256 of the input pack:
// 0e82b2e7df7928818b472a35723137701720a28fa59f1bd3f12a944757b32d7a — cache file
// test/corpus/.resave-cache/<oracleKey>.bin):
//
// This is the SECOND observation of this pack. The first revision gave both payload files the same
// `DUMMY_PAYLOAD` bytes, which triggered TexTools' unrelated content-hash dedup pass
// (PmpExtensions.cs · ResolveDuplicates · 476-560) and collapsed the two regenerated paths into one
// shared file, producing a THREE-member golden that conflated two mechanisms (see git history for
// that observation and its analysis). With distinct GROUP_PAYLOAD/DEFAULT_PAYLOAD, ResolveDuplicates
// never takes its collapsing branch (:537) — each file keeps its own regenerated prefix (:548) — and
// the golden below is the isolated bug #23 signature alone, confirmed against the real oracle output,
// matching the four-member shape this file's header describes:
//
//   meta.json                                973 bytes  — the manifest
//   default/chara/dummy/v4_default.bin          4 bytes  — DefaultData's file, regenerated path, ONCE
//   files/v4_group.bin                          4 bytes  — the duplicate: group's file, verbatim at
//                                                            its own INPUT zip path (the ExtraFile)
//   v4 payload/chara/dummy/v4_group.bin         4 bytes  — the SAME group file, again, at its
//                                                            regenerated dedup path
//
// and, confirmed absent: `files/v4_default.bin` (the default file's own input path is never
// re-emitted verbatim, because the ExtraFiles scan gets DefaultData right).
//
// meta.json's two Files maps point at their own distinct regenerated paths (not a shared one):
//   Groups[0].Options[0].Files["chara/dummy/v4_group.bin"]  = "v4 payload\\chara\\dummy\\v4_group.bin"
//   DefaultData.Files["chara/dummy/v4_default.bin"]         = "default\\chara\\dummy\\v4_default.bin"
//
// So bug #23's signature is exactly the WizardData.cs · WritePmp · 1496-1507 / PMP.cs:234 asymmetry
// predicted: the GROUP option's file is written twice (once by the `saveExtraFiles`-gated verbatim
// `File.Copy` at :1504, once by the normal regenerated-path write every option's files go through
// regardless), because the v4 pull-back at PMP.cs:220 never populates the group_*.json list the
// ExtraFiles scan at :234 iterates, so the scan still wrongly treats the inline group's file as an
// "extra" file left over from a v3-shaped load. The DEFAULT option's file is written only once,
// because PMP.cs:267-276 scans `pmp.DefaultMod` correctly and :1504 never fires for it. The manifest
// itself is unaffected by the bug — both Files values point at their own regenerated (non-duplicate)
// path — confirming AGENTS.md's "manifest is not affected, only the member set" holds as originally
// stated, with no shared-file caveat needed once dedup is out of the picture.
//
// Our port's /resave still emits the OLD v3 shape entirely (default_mod.json + group_NNN_*.json, no
// meta.json Groups/DefaultData) — Tasks 6-8/11 haven't landed yet — so the corpus `resave` check for
// this pack fails with 8 regressions today; that failure is EXPECTED per this task's brief and is not
// blessed. The `upgrade` check passes as a matched failure (ConsoleTools /upgrade and our port both
// refuse a v4 .pmp input, per bug #23's `saveExtraFiles` gate not applying to /upgrade).
//
// TASKS 5 AND 10: build/confirm against the FOUR-member shape above.
