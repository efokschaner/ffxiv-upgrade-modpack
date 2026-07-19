// Builds test/corpus/synthetic/default-only.pmp: a PMP with NO groups at all — only a populated
// default_mod.json. Penumbra writes this shape whenever a mod has no user-selectable options; no
// real corpus pack had it until `torn bassment glow.pmp` arrived, which is why the harness gap
// below went unnoticed.
//
// What it pins. On load, WizardData.FromPmp synthesizes a group named "Default" holding one option
// named "Default" (WizardData.cs:1118-1138, the `fakeGroup`). On write, MakeGroupPrefix folder-safes
// that name and appends a slash (WizardData.cs:1390-1400), so every payload member comes back out
// under a `default/` prefix that the raw Penumbra input never had:
//
//   in:  chara/equipment/e0246/model/c0201e0246_top.mdl
//   out: default/chara/equipment/e0246/model/c0201e0246_top.mdl
//
// Verified against the write-side oracle: ConsoleTools /resave on `torn bassment glow.pmp` emits
// exactly that `default/` prefix, byte-identical to ours.
//
// Why it belongs in the corpus. /upgrade NO-OPs on this pack (its gamePaths need no transform), so
// the harness compares our output against the UNTOUCHED INPUT — whose layout TexTools' writer never
// produced. That made every member report as added+removed purely from the correct prefix, which in
// turn paired nothing and skipped the member-level content comparison entirely. registerUpgradeCheck
// now re-keys the payload comparison to the redirect table on the no-op branch for exactly this
// reason; this pack is the fresh-clone-reproducible regression test for it.
//
// The .pmp is gitignored; regenerate with `npm run synthetics`.

import type { PmpOptionJsonRaw } from "../../src/container/manifest-types";
import { syntheticMeta, writePmp } from "./pmp-builder";

// Two already-Dawntrail-safe dummy files at gamePaths /upgrade ignores, so ConsoleTools no-ops (the
// branch this pack exists to exercise) and no asset codec claims them. `.bin` deliberately, NOT
// .mdl/.tex: the repro turns on the pack having NO GROUPS, not on the payload's type, and a real
// extension would route a dummy payload into the mdl/tex corpus round-trip checks.
//
// Payload bytes are DISTINCT per file, deliberately — not the shared `DUMMY_PAYLOAD` the other
// builders use. Identical content makes ResolveDuplicates (PmpExtensions.cs:528-551) collapse both
// members into `common/1/`, which erases the `default/` prefix this fixture exists to pin: the pack
// then reproduces the dedup path instead of the option-folder path, and passes for the wrong reason.
//
// Penumbra writes a Files VALUE as the backslashed zip path (PMP.cs:1107-1109), and lays payload out
// at the bare gamePath with no option folder — exactly the layout TexTools' writer will NOT
// reproduce, which is the point of the fixture.
const FILES: Record<string, Uint8Array> = {
  "chara/dummy/default_only_a.bin": new Uint8Array([0, 1, 2, 3]),
  "chara/dummy/default_only_b.bin": new Uint8Array([4, 5, 6, 7]),
};

const defaultMod: PmpOptionJsonRaw = {
  Name: "",
  Description: "",
  Files: Object.fromEntries(
    Object.keys(FILES).map((p) => [p, p.replace(/\//g, "\\")]),
  ),
  FileSwaps: {},
  Manipulations: [],
};

writePmp("default-only.pmp", {
  meta: syntheticMeta("Default-Only Repro"),
  defaultMod,
  groups: {},
  files: FILES,
});
