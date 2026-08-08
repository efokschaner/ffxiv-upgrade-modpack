// Builds the two synthetic PMPs whose defining property is a manifest member that ISN'T THERE.
// Both are legal Penumbra packs; neither shape existed anywhere in the corpus before this file.
//
//   test/corpus/synthetic/pmp-meta-only.pmp     — meta.json and NOTHING else. Zero options.
//   test/corpus/synthetic/pmp-no-default-mod.pmp — meta.json + one group_NNN.json, no default_mod.json.
//
// WHY THEY ARE LEGAL. `PMP.cs · LoadPMP · 181-189` reads default_mod.json only
// `if (File.Exists(defModPath))` — a plain existence check, NOT gated on `meta.FileVersion` — so an
// absent default_mod.json simply leaves `defaultOption` null. The group scan that follows
// (`PMP.cs · LoadPMP · 191-208`) iterates `Directory.GetFiles(path)` and finds however many
// `group_*.json` there are, including none. A pack carrying only a meta.json therefore loads
// successfully with no default option and no groups. Our reader ports both reads faithfully
// (src/container/pmp.ts:212-254), so it agrees; that agreement is what these packs pin against the
// oracle rather than against our own expectations.
//
// WHY THE FIRST PACK EXISTS (primary). It is the regression pack for a HARNESS bug found in PR #45
// review: `optionEntries` (test/helpers/archive-redirects.ts) used to throw on any archive with a
// meta.json and no option container, which is exactly this shape. `packHasFileSwaps` runs on EVERY
// PMP /resave input (test/helpers/corpus-resave.ts), so a legal empty pack in the corpus turned the
// suite red for a reason that had nothing to do with the port. The guard now discriminates on
// "payload members no option container explains"; this pack is the end-to-end proof, and the
// unit-level proof that the ORIGINAL fail-open still throws lives in
// test/helpers/archive-redirects.test.ts. It carries NO payload members at all — that emptiness is
// the whole fixture, so do not add one.
//
// WHY THE SECOND PACK EXISTS (secondary — cheap cover, not a repro). Nothing is known to be broken
// about it: it works today. It exists only because the `File.Exists` guard above is the single line
// that makes an absent default_mod.json legal, and no corpus pack exercised it while carrying actual
// content. One payload member routed through a group option is enough to notice if that read ever
// regresses to unconditional.
//
// Both are v3 (`FileVersion: 3`) deliberately. `writePmpV4` is the only v4 emitter in the repo and
// v4 brings the `ModpackUpgrader.cs:226-232` refusal with it, which would make `/upgrade` an
// expected-failure test and drown the shapes these packs are about. The reader treats the absent
// default_mod.json identically at both versions (it is one `File.Exists`), so v3 loses no coverage.
//
// The .pmp files are gitignored; regenerate with `npm run synthetics`.

import type { PmpGroupJsonRaw } from "../../src/container/manifest-types";
import { encodeJson, syntheticMeta, writePmpMembers } from "./pmp-builder";

// ---------------------------------------------------------------------------------------------
// pmp-meta-only.pmp — the legal, genuinely optionless pack.
// ---------------------------------------------------------------------------------------------

writePmpMembers("pmp-meta-only.pmp", {
  "meta.json": encodeJson(syntheticMeta("PMP Meta-Only")),
});

// ---------------------------------------------------------------------------------------------
// pmp-no-default-mod.pmp — a group, but no default_mod.json.
// ---------------------------------------------------------------------------------------------

// `.bin` at a gamePath the transforms ignore, matching build-synthetic-f1.ts's proven convention:
// ConsoleTools /upgrade has nothing to transform (so it no-ops and the harness compares against the
// input) and no asset-level codec check claims the payload. Bytes are arbitrary but distinct from
// every other fixture's, so a stray content-hash collapse (PmpExtensions.cs · ResolveDuplicates ·
// 476-560) can never conflate this member with another pack's.
const GAME_PATH = "chara/dummy/no_default_mod.bin";
const ZIP_PATH = "files/no_default_mod.bin";
const PAYLOAD = new Uint8Array([0xc1, 0xc2, 0xc3, 0xc4]);

// Written in the key order `singleOptionGroup` (pmp-builder.ts) uses — this builder assembles its
// own member map, but the group document itself should spell out identically to every other v3
// fixture's. Penumbra writes a Files VALUE as the backslashed zip path (PMP.cs:1107-1109).
const group: PmpGroupJsonRaw = {
  Version: 0,
  Name: "No Default Mod",
  Description: "",
  Image: "",
  Page: 0,
  Priority: 0,
  Type: "Single",
  DefaultSettings: 0,
  Options: [
    {
      Name: "On",
      Description: "",
      Image: "",
      Files: { [GAME_PATH]: ZIP_PATH.replace(/\//g, "\\") },
      FileSwaps: {},
      Manipulations: [],
    },
  ],
};

// Member ORDER is load-bearing (it decides the zip bytes, and the golden cache keys on
// sha256(input pack)): meta, then the group, then payload — the same relative order `writePmp`
// emits, minus the default_mod.json this pack is defined by not having.
writePmpMembers("pmp-no-default-mod.pmp", {
  "meta.json": encodeJson(syntheticMeta("PMP No Default Mod")),
  "group_001_no_default_mod.json": encodeJson(group),
  [ZIP_PATH]: PAYLOAD,
});
