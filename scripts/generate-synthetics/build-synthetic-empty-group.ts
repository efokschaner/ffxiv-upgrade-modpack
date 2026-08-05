// Builds the ten probe packs for the zero-option group behaviour measured in
// docs/superpowers/specs/2026-08-04-datapages-model-and-empty-group-design.md §1.2/§1.3 and pinned
// as docs/TEXTOOLS_BUGS.md #22. The behaviour itself already shipped (Tasks 5 and 7); this builder
// turns the operator's hand-run measurements into corpus packs so the real ConsoleTools oracle keeps
// re-running them.
//
// ---------------------------------------------------------------------------------------------
// PMP HALF — What the oracle does, measured (ConsoleTools /upgrade, 2026-08-03/04)
// ---------------------------------------------------------------------------------------------
// `WizardData.FromPmp` (WizardData.cs:1118-1157) adds a zero-option PMP group's
// `WizardGroupEntry.FromPMPGroup` result — `null` (:851-855) — to its page UNCONDITIONALLY, both for
// the synthesized "Default" group (:1136, only when `pmp.DefaultMod` is non-empty) and for every
// real group (:1156). `ClearNulls` (:1234-1266, run at load per :1159) then reads
// `WizardPageEntry.HasData` — `Groups.Any(x => x.HasData)` (:969-975) — BEFORE the loop that removes
// nulls, and `Any` dereferences the first element that isn't already `true`. Every real group's
// `HasData` IS `true` (`WizardGroupEntry.HasData`, :621-627, and `WizardOptionEntry.HasData`, which
// returns `true` on its first line whenever `ModOption != null`, :257-278 — both group constructors
// always set it), so a data-carrying group PRECEDING the null on the same page shields it and
// `Any` short-circuits before ever touching the null; a null reached FIRST throws immediately:
//
//   System.NullReferenceException: Object reference not set to an instance of an object.
//      at xivModdingFramework.Mods.WizardPageEntry.<>c.<get_HasData>b__4_0(WizardGroupEntry x)
//
// `HandleUpgrade` (ConsoleTools/Program.cs:183-186) catches it, `Trace.WriteLine`s it, returns -1 —
// no output file, no message on stdout.
//
// A second wrinkle makes "shielded" ambiguous with "page-numbered": docs/TEXTOOLS_BUGS.md #7 — when
// `pmp.DefaultMod` is non-empty, the synthesized Default page is pushed to `DataPages` BEFORE the
// per-group pages loop (:1144-1150) allocates `pageMax + 1` MORE pages after it, but a group's OWN
// `Page` value is used to index `DataPages` UNADJUSTED (`data.DataPages[g.Page]`, :1155) — so a
// custom group declaring `Page: 0` lands on the SAME page as the Default group (shielded by it, one
// slot early), while `Page: 1` lands on the page `Page: 0` "should" have gotten (a fresh, otherwise
// empty page — NOT shielded). Four of the five hand-built shapes from the measurement table below
// are reproduced as packs (the fifth — an empty `default_mod` with a single `Options: []` group — is
// the degenerate case both `empty-group-first.pmp` and `empty-group-shielded.pmp` already generalize,
// varying only which of two same-page groups comes first):
//
// | fixture                          | shape                                              | result |
// | --------------------------------- | --------------------------------------------------- | ------ |
// | `empty-group-shielded.pmp`        | empty `default_mod`; real group then empty, Page 0  | no-op  |
// | `empty-group-first.pmp`           | empty `default_mod`; empty group then real, Page 0  | NRE    |
// | `empty-group-default-shielded.pmp`| non-empty `default_mod`; empty group alone, Page 0   | no-op  |
// | `empty-group-page1.pmp`           | non-empty `default_mod`; empty group alone, Page 1   | NRE    |
//
// The two NRE-ing packs' declared siblings, `empty-group-first-sibling.pmp` and
// `empty-group-page1-sibling.pmp`, are BYTE-IDENTICAL to their partner except the crashing group's
// own `group_NNN_*.json` zip member is absent entirely (same meta/default_mod/other-group content) —
// see this file's `writePmp` calls below and spec §7.1's `ORACLE_ERROR_DIVERGENCE_RULES` (wired in
// Task 9), whose `confirm` requires our upgrade of the crashing pack to byte-match the sibling's
// ordinary golden. The pairing is sound because dropping the group's json and `ClearNulls` pruning
// its null converge on the same surviving DataPages: `ClearNulls` also drops a page left with no
// groups, which is exactly what a higher `pageMax` would otherwise have created.
//
// ---------------------------------------------------------------------------------------------
// TTMP HALF — What the oracle does, measured (ConsoleTools /resave, 2026-08-03/04)
// ---------------------------------------------------------------------------------------------
// The TTMP wizard path never NREs: `WizardPageEntry.FromWizardModpackPage` (WizardData.cs:977-990)
// discards a zero-option group's `null` at the ADD site (`if (g == null) continue;`, :986), so no
// null ever reaches `ClearNulls`. But `ModPackPageJson.PageIndex` is DECORATIVE at load —
// `WizardData.FromWizardTtmp` (:1180-1184) appends one `DataPages` entry per `ModPackPages` array
// element in ARRAY order, and `FromWizardModpackPage` reads `jp.PageIndex` only to build a display
// name (:980) — so page IDENTITY is positional, and `WriteWizardPack` (:1332-1357) renumbers
// survivors with a DENSE COUNTER over `DataPages` in that same array order, never sorting and never
// consulting the declared value:
//
// | fixture                     | source (ModPackPages array, in order)                  | output |
// | ---------------------------- | ------------------------------------------------------- | ------ |
// | `empty-page0.ttmp2`          | [PageIndex 0: empty group; PageIndex 1: real group]     | ONE page, `PageIndex: 0`, the real group |
// | `sparse-pageindex.ttmp2`     | [PageIndex 3: real group]                                | `PageIndex: 0` |
// | `out-of-order-pages.ttmp2`   | [PageIndex 1: "Second"; PageIndex 0: "First"]            | `PageIndex 0` -> "Second", `PageIndex 1` -> "First" (ARRAY order, not sorted by the declared value) |
// | `duplicate-pageindex.ttmp2`  | [PageIndex 0: "Alpha"; PageIndex 0: "Beta"]              | TWO pages, `0` -> "Alpha", `1` -> "Beta" (duplicates are not collapsed) |
//
// A dummy gamePath makes /upgrade no-op on every one of these (nothing to compare page structure
// against), so all four prove out through /resave instead — see pmp-builder.ts's `SyntheticRoot`
// doc comment and ttmp2-builder.ts's `writeTtmp2MultiPage`.
//
// The .pmp/.ttmp2 files are gitignored; regenerate with `npm run synthetics`.

import type { PmpOptionJsonRaw } from "../../src/container/manifest-types";
import {
  DUMMY_PAYLOAD,
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
  zeroOptionGroup,
} from "./pmp-builder";
import { writeTtmp2MultiPage } from "./ttmp2-builder";

const REAL_GAME_PATH = "chara/dummy/empty_group_real.bin";
const REAL_ZIP_PATH = "files/empty_group_real.bin";
const DEFAULT_GAME_PATH = "chara/dummy/empty_group_default.bin";
const DEFAULT_ZIP_PATH = "files/empty_group_default.bin";

/** A "Default" option (default_mod.json) carrying one file, so `PmpDefaultMod.IsEmptyOption`
 * (PMP.cs:1513-1517) is `false` and `FromPmp` synthesizes the Default page (:1118-1138) — the
 * shield `empty-group-default-shielded.pmp`/`empty-group-page1.pmp` need. Same shape/key order as
 * `EMPTY_DEFAULT_MOD`, just a non-empty `Files`. */
const NON_EMPTY_DEFAULT_MOD: PmpOptionJsonRaw = {
  Name: "",
  Description: "",
  Files: { [DEFAULT_GAME_PATH]: DEFAULT_ZIP_PATH.replace(/\//g, "\\") },
  FileSwaps: {},
  Manipulations: [],
};

const realGroup = () =>
  singleOptionGroup("Real", {
    [REAL_GAME_PATH]: REAL_ZIP_PATH.replace(/\//g, "\\"),
  });

// --- empty-group-shielded.pmp: real group then empty, same page -> no-op (shielded). ---
const shieldedMeta = syntheticMeta("Empty Group Shielded Repro");
writePmp("empty-group-shielded.pmp", {
  meta: shieldedMeta,
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_real.json": realGroup(),
    "group_002_empty.json": zeroOptionGroup("Empty"),
  },
  files: { [REAL_ZIP_PATH]: DUMMY_PAYLOAD },
});

// --- empty-group-first.pmp: empty group then real, same page -> NRE (not shielded). ---
// Its sibling below is byte-identical minus "group_001_empty.json".
const firstMeta = syntheticMeta("Empty Group First Repro");
writePmp(
  "empty-group-first.pmp",
  {
    meta: firstMeta,
    defaultMod: EMPTY_DEFAULT_MOD,
    groups: {
      "group_001_empty.json": zeroOptionGroup("Empty"),
      "group_002_real.json": realGroup(),
    },
    files: { [REAL_ZIP_PATH]: DUMMY_PAYLOAD },
  },
  "upgrade-error",
);
writePmp("empty-group-first-sibling.pmp", {
  meta: firstMeta,
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_002_real.json": realGroup(),
  },
  files: { [REAL_ZIP_PATH]: DUMMY_PAYLOAD },
});

// --- empty-group-default-shielded.pmp: non-empty default_mod; empty group alone, Page 0 -> no-op
// (shielded by the synthesized Default group landing on the same page, docs/TEXTOOLS_BUGS.md #7). ---
writePmp("empty-group-default-shielded.pmp", {
  meta: syntheticMeta("Empty Group Default Shielded Repro"),
  defaultMod: NON_EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_empty.json": zeroOptionGroup("Empty", 0),
  },
  files: { [DEFAULT_ZIP_PATH]: DUMMY_PAYLOAD },
});

// --- empty-group-page1.pmp: non-empty default_mod; empty group alone, Page 1 -> NRE (the shield is
// positional, not page-numbered: Page 1 lands on a fresh page the Default group never touches). ---
// Its sibling below is byte-identical minus "group_001_empty.json" (and so carries no custom group
// at all — just the non-empty default_mod).
const page1Meta = syntheticMeta("Empty Group Page1 Repro");
writePmp(
  "empty-group-page1.pmp",
  {
    meta: page1Meta,
    defaultMod: NON_EMPTY_DEFAULT_MOD,
    groups: {
      "group_001_empty.json": zeroOptionGroup("Empty", 1),
    },
    files: { [DEFAULT_ZIP_PATH]: DUMMY_PAYLOAD },
  },
  "upgrade-error",
);
writePmp("empty-group-page1-sibling.pmp", {
  meta: page1Meta,
  defaultMod: NON_EMPTY_DEFAULT_MOD,
  groups: {},
  files: { [DEFAULT_ZIP_PATH]: DUMMY_PAYLOAD },
});

// --- empty-page0.ttmp2: page 0 = empty group, page 1 = real group -> one surviving page, renumbered
// to PageIndex 0, holding only the real group. ---
writeTtmp2MultiPage("empty-page0.ttmp2", "Empty Page0 Repro", [
  { pageIndex: 0, groups: [{ name: "Empty", optionless: true }] },
  { pageIndex: 1, groups: [{ name: "Real" }] },
]);

// --- sparse-pageindex.ttmp2: a single page declaring PageIndex 3 -> renumbered to PageIndex 0. ---
writeTtmp2MultiPage("sparse-pageindex.ttmp2", "Sparse PageIndex Repro", [
  { pageIndex: 3, groups: [{ name: "Real" }] },
]);

// --- out-of-order-pages.ttmp2: array lists PageIndex 1 before PageIndex 0 -> output follows ARRAY
// order, not the declared value: PageIndex 0 gets "Second" (array position 0), PageIndex 1 gets
// "First" (array position 1). Group names spell out which declared PageIndex each one WAS, so the
// renumbering (or lack of it) is legible from the output alone. ---
writeTtmp2MultiPage("out-of-order-pages.ttmp2", "Out Of Order Pages Repro", [
  { pageIndex: 1, groups: [{ name: "Second" }] },
  { pageIndex: 0, groups: [{ name: "First" }] },
]);

// --- duplicate-pageindex.ttmp2: two pages both declaring PageIndex 0 -> NOT collapsed into one;
// output keeps two pages, in array order ("Alpha" then "Beta"). ---
writeTtmp2MultiPage("duplicate-pageindex.ttmp2", "Duplicate PageIndex Repro", [
  { pageIndex: 0, groups: [{ name: "Alpha" }] },
  { pageIndex: 0, groups: [{ name: "Beta" }] },
]);
