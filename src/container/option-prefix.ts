// Port of WizardData's PMP-write prefix generators: the page construction inside
// WizardData.FromPmp (WizardData.cs:1118-1158), the page-pruning WizardData.ClearNulls performs
// immediately afterward (WizardData.cs:1234-1244 — invoked at :1159 inside FromPmp itself, and again
// redundantly at :1462 inside WritePmp before any prefix is generated), and the three prefix
// builders MakePagePrefix / MakeGroupPrefix / MakeOptionPrefix (WizardData.cs:1362-1458).
//
// `data.groups[0]` is our reader's synthesized "Default" group (readPmp, src/container/pmp.ts) — the
// TS analogue of FromPmp's `fakeGroup` (WizardData.cs:1121-1129). `data.groups.slice(1)` are the
// real PMP groups (`pmp.Groups` in the C#), each carrying its own `.page`.
//
// This module ports two TexTools bugs faithfully; see docs/TEXTOOLS_BUGS.md #1 and #6 for the
// full writeups:
//
//   1. FromPmp's page-index off-by-one (WizardData.cs:1152-1157): when a Default page is
//      synthesized, it is unshifted onto the FRONT of `DataPages` before the real per-page entries
//      are appended, but the group-assignment loop right after still indexes `DataPages[g.Page]`
//      with the group's *raw*, unadjusted page number. A group meant for page 0 therefore lands on
//      the Default page instead of the (now-empty) page created for it. `ClearNulls` then drops any
//      page with no groups carrying data — so the empty page never survives to influence
//      `DataPages.Count` on its own; the *observable* effect is that the misrouted group's content
//      merges onto the Default page's folder instead of getting a page of its own, and the overall
//      `pN/` prefix only turns on if enough *other*, correctly-routed pages still survive pruning.
//   2. MakeGroupPrefix's non-incrementing collision loop (WizardData.cs:1406-1409): ported as
//      written, but throws rather than reproducing the hang if collision resolution would need more
//      than one retry.
//
// `ClearNulls` also prunes at the GROUP level within each surviving page (WizardData.cs:1246-1263:
// `if (g == null || !g.HasData) { p.Groups.Remove(g); continue; }`), and `WizardGroupEntry.HasData`
// (WizardData.cs:621-627) is `Options.Any(x => x.HasData)`. BUT `WizardOptionEntry.HasData`
// (WizardData.cs:257-278) short-circuits on its FIRST line: `if (_Group.ModOption != null) { return
// true; } // "Read mode."`. `ModOption` is assigned in exactly two places in the whole file --
// `FromWizardGroup` (:649) and `FromPMPGroup` (:767) -- and never reset, and those are the ONLY group
// constructors `/upgrade` and `/resave` (i.e. every load of a pack this port cares about) ever reach.
// So on every path we port, `WizardOptionEntry.HasData` is UNCONDITIONALLY true, `WizardGroupEntry.
// HasData` reduces to `Options.Count > 0`, and `ClearNulls` NEVER prunes a group or option for
// lacking file/manipulation/fileSwap CONTENT -- only a page left with zero groups (the `FromPmp`
// off-by-one's stranded page, bug 1 above) is ever pruned. `groupHasData` below therefore checks
// `group.options.length > 0`, not any per-option content predicate -- a content-free group (e.g.
// every option's `Files` rejected by `canImport`, or an authored group with an empty `Files: {}`) is
// KEPT, gets its own `group_NNN.json` with `"Files": {}`, and DOES occupy a `MakeGroupPrefix`
// collision slot, exactly like TexTools does. `groupHasData` must therefore NOT be turned into a
// content check: that silently diverges from the golden. `ClearNulls`' innermost step,
// `if (o == null) g.Options.Remove(o)` (:1259-1262), is not ported: our `ModpackOption` model has no
// null-option representation, so that step can never apply to data built from it.
//
// Two contracts this module's callers depend on:
//   - `optionPrefixes` returns NO ENTRY for an option whose group never made it into a surviving
//     page (e.g. the synthesized Default option when it is empty). "Absent from the map" means "this
//     option contributes no files and no folder" — it is NOT `""`, which is a real, valid prefix for
//     a different case (a lone group on a lone page, MakePagePrefix's WizardData.cs:1375-1378 branch).
//   - The "Blank Group" / "Blank Option" substitutions inside `makeGroupPrefix` / `makeOptionPrefix`
//     are UNREACHABLE on the real write path: `WritePmp`'s assembly loop throws first on a blank name
//     (`InvalidDataException`, WizardData.cs:1520-1523), and `writePmp` reproduces that throw
//     (src/container/pmp.ts). They are ported faithfully anyway, because the guard lives in the
//     caller loop rather than in the prefix builders, and these functions are correct ports of their
//     own C# symbols regardless of what calls them. Note the loop only reaches :1520 for
//     `EGroupType.Standard` options (`:1513-1516` continues past the others first), so a blank name
//     on an Imc group never trips that throw.

import type {
  ModpackData,
  ModpackGroup,
  ModpackOption,
} from "../model/modpack";
import type { PmpOptionJsonRaw } from "./manifest-types";
import { folderSafeName } from "./pmp";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

// Port of PmpStandardOptionJson.IsEmptyOption (PMP.cs:1513-1517). Used ONLY to decide whether
// FromPmp synthesizes a Default page at all (WizardData.cs:1118), which reads `pmp.DefaultMod` --
// the RAW, deserialized default_mod.json document -- directly. CanImport filtering (PMP.cs:752-770)
// only ever runs later, inside UnpackPmpOption (PMP.cs:1075-1078), which this check precedes. So a
// default_mod.json whose Files are ALL canImport-rejected is non-empty to TexTools (raw Files.Count
// > 0) even though our reader's `o.files` (already canImport-filtered, see optionFromJson, pmp.ts)
// would look empty. When the option carries a raw PMP document (`o.raw`, the untouched
// default_mod.json set by readPmp), consult ITS Files/FileSwaps/Manipulations counts instead of the
// filtered model fields. A model-building (non-PMP) source has no such raw document and never went
// through canImport filtering to begin with -- there `o.files`/`o.fileSwaps`/`o.manipulations`
// already ARE the unfiltered set, so falling back to them is not a divergence, just the absence of a
// filtering step to correct for.
function isEmptyDefaultOption(o: ModpackOption): boolean {
  const raw = isObj(o.raw) ? (o.raw as PmpOptionJsonRaw) : undefined;
  if (raw !== undefined) {
    return (
      Object.keys(raw.Files ?? {}).length === 0 &&
      Object.keys(raw.FileSwaps ?? {}).length === 0 &&
      (raw.Manipulations ?? []).length === 0
    );
  }
  return (
    o.files.size === 0 &&
    Object.keys(o.fileSwaps).length === 0 &&
    o.manipulations.length === 0
  );
}

// Port of WizardGroupEntry.HasData (WizardData.cs:621-627), reduced to `Options.Count > 0` per the
// `WizardOptionEntry.HasData` Read-mode short-circuit documented in the module header comment above:
// on every load path this port reaches, EVERY option HasData is unconditionally true, so a group's
// HasData is exactly "does it have at least one option". Do not replace this with a per-option
// content check (files/manipulations/fileSwaps non-empty) -- that ports a branch that is dead code on
// our load paths and silently diverges from TexTools, which keeps a content-free group intact.
function groupHasData(g: ModpackGroup): boolean {
  return g.options.length > 0;
}

export interface Page {
  groups: ModpackGroup[];
  folderPath?: string;
}

// Port of WizardData.FromPmp's page construction (WizardData.cs:1118-1158) followed by
// WizardData.ClearNulls' page-level pruning (WizardData.cs:1234-1244). Exported so writePmp
// (pmp.ts) can drive the SAME DataPages/ClearNulls-order, pruned group set for two things this
// module doesn't itself need: (1) WritePmp's default-mod absorption search
// (WizardData.cs:1553-1578), which iterates DataPages in this exact order and must see the
// synthesized Default group (page 0, iff it survived) FIRST; (2) the group_NNN.json emission +
// its recomputed `Page` counter (WizardData.cs:1583-1600), which only writes a group that
// survived this same pruning and numbers pages by how many DataPages entries actually
// contributed a written group.
export function buildPages(data: ModpackData): Page[] {
  const [defaultGroup, ...realGroups] = data.groups;
  const pages: Page[] = [];

  // WizardData.cs:1118-1138 — the synthesized Default page, iff its lone option is non-empty.
  const defaultOption = defaultGroup?.options[0];
  if (defaultGroup && defaultOption && !isEmptyDefaultOption(defaultOption)) {
    pages.push({ groups: [defaultGroup] });
  }

  if (realGroups.length > 0) {
    // WizardData.cs:1142-1150 — one page per index 0..pageMax, appended after the Default page.
    const pageMax = Math.max(...realGroups.map((g) => g.page));
    for (let i = 0; i <= pageMax; i++) {
      pages.push({ groups: [] });
    }
    // WizardData.cs:1152-1157 — `data.DataPages[g.Page]`: a RAW index into `pages`, which already
    // has the (optional) Default page unshifted onto the front. This is the off-by-one bug: when a
    // Default page exists, index 0 is IT, not the page created above for g.page === 0. Ported
    // verbatim — no correction applied.
    for (const g of realGroups) {
      pages[g.page]!.groups.push(g);
    }
  }

  // WizardData.ClearNulls (WizardData.cs:1234-1244): drop any page with no groups. Then, within each
  // surviving page (WizardData.cs:1246-1263), drop any group with zero options -- per the module
  // header comment, HasData is unconditionally true on our load paths, so this reduces to a purely
  // STRUCTURAL prune (empty groups list), not a content-based one: a group with at least one option,
  // however contentless, survives and DOES occupy a MakeGroupPrefix collision slot, exactly as
  // TexTools' real (Read-mode) HasData would.
  return pages
    .filter((p) => p.groups.some(groupHasData))
    .map((p) => ({ groups: p.groups.filter(groupHasData) }));
}

// Port of MakePagePrefix (WizardData.cs:1362-1382).
function makePagePrefix(pages: Page[], page: Page): string {
  if (page.folderPath !== undefined) return page.folderPath;

  let pagePrefix = "";
  if (pages.length > 1) {
    const pIdx = pages.indexOf(page) + 1;
    pagePrefix = `p${pIdx}/`;
  } else if (page.groups.length === 1) {
    // WizardData.cs:1375-1378 — a no-op branch: pagePrefix is already "" from initialization.
    // Reproduced for 1:1 traceability with the C#, not because it changes behaviour.
    pagePrefix = "";
  }

  page.folderPath = pagePrefix;
  return pagePrefix;
}

// Port of MakeGroupPrefix (WizardData.cs:1383-1413).
function makeGroupPrefix(
  pages: Page[],
  page: Page,
  group: ModpackGroup,
  groupFolderPaths: Map<ModpackGroup, string>,
): string {
  const existing = groupFolderPaths.get(group);
  if (existing !== undefined) return existing;

  // WizardData.cs:1390-1394 — IOUtil.MakePathSafe (folderSafeName) first, THEN substitute the
  // literal if the result is blank. "Blank Group" is NOT itself re-run through folderSafeName: it
  // is used verbatim, capitalized.
  let gName = folderSafeName(group.name);
  if (gName.trim() === "") gName = "Blank Group";

  const pagePrefix = makePagePrefix(pages, page);
  let prefix = pagePrefix;
  if (page.groups.length > 0) {
    // WizardData.cs:1398-1401 — always true whenever this runs (group is a member of page.groups),
    // so this in practice always executes. Kept for 1:1 traceability with the C#.
    prefix = `${pagePrefix}${gName}/`;
  }

  let groupPrefix = prefix;
  const i = 1;
  // WizardData.cs:1406-1409 — `i` is never incremented in the C#, so a genuine collision beyond the
  // first retry would spin forever recomputing the same " (1)/" candidate. We port the loop
  // condition as written but throw instead of hanging if a second retry would be needed
  // (docs/TEXTOOLS_BUGS.md #6).
  if (page.groups.some((g) => groupFolderPaths.get(g) === groupPrefix)) {
    groupPrefix = `${pagePrefix}${gName} (${i})/`;
    if (page.groups.some((g) => groupFolderPaths.get(g) === groupPrefix)) {
      throw new Error(
        `option-prefix: MakeGroupPrefix's collision loop would not terminate for group ` +
          `"${group.name}" (WizardData.cs:1406-1409 never increments its retry counter — see ` +
          "docs/TEXTOOLS_BUGS.md #6)",
      );
    }
  }

  groupFolderPaths.set(group, groupPrefix);
  return groupPrefix;
}

// Port of the internal, 2-arg MakeOptionPrefix overload (WizardData.cs:1419-1458).
function makeOptionPrefix(
  group: ModpackGroup,
  groupFolderPath: string,
  option: ModpackOption,
  optionFolderPaths: Map<ModpackOption, string>,
): string {
  const existing = optionFolderPaths.get(option);
  if (existing !== undefined) return existing;

  // WizardData.cs:1432-1435 — same substitute-after-folderSafeName rule as the group name.
  let oName = folderSafeName(option.name);
  if (oName.trim() === "") oName = "Blank Option";

  let path: string;
  if (group.options.length > 1) {
    path = `${groupFolderPath}${oName}/`;
  } else {
    path = groupFolderPath;
  }

  // WizardData.cs:1448-1453 — this sibling loop DOES increment `i`, unlike MakeGroupPrefix's.
  let i = 1;
  while (group.options.some((o) => optionFolderPaths.get(o) === path)) {
    path = `${groupFolderPath}${oName} (${i})/`;
    i++;
  }

  optionFolderPaths.set(option, path);
  return path;
}

/** Maps every option reachable through the (pruned) page/group structure to its zip folder prefix
 *  — e.g. `""`, `"default/"`, `"options/black veil/"`, `"p2/outfit/juliet/"`. Prefixes end with `/`
 *  unless empty. An option whose group never made it into a surviving page (the Default option when
 *  its lone option is empty, per `isEmptyDefaultOption`) has no entry — TexTools never assigns it
 *  one either, since WritePmp's iteration (WizardData.cs:1506-1542) only visits `DataPages`. */
export function optionPrefixes(data: ModpackData): Map<ModpackOption, string> {
  const pages = buildPages(data);
  const groupFolderPaths = new Map<ModpackGroup, string>();
  const optionFolderPaths = new Map<ModpackOption, string>();

  // TWO passes, mirroring WritePmp's own two separate loops over DataPages — reproduced as two
  // loops here (not one page/group/option nesting pass) because they resolve MakeGroupPrefix
  // collisions in a DIFFERENT ORDER than a single pass would:
  //
  //   PASS 1 (WizardData.cs:1506-1542, "compose file storage information"): the per-OPTION loop
  //   `continue`s past any option whose GroupType != Standard BEFORE it ever reaches
  //   MakeOptionPrefix (:1513-1516/:1526) — and MakeOptionPrefix's 3-arg overload calls
  //   MakeGroupPrefix as a side effect (:1414-1418, `MakeGroupPrefix(page, group);`). So every
  //   Standard-type group across the WHOLE pack claims its MakeGroupPrefix slot (and its options'
  //   MakeOptionPrefix slots) here — an Imc-type group's FolderPath is untouched by this pass.
  //
  //   PASS 2 (WizardData.cs:1583-1600, the group_NNN.json emission loop): calls MakeGroupPrefix(p, g)
  //   directly for EVERY surviving group, Standard or Imc alike, with no type check — a no-op for a
  //   group PASS 1 already resolved (MakeGroupPrefix/MakePagePrefix both memoize via a
  //   present/absent FolderPath), but the FIRST resolution for an Imc-type group.
  //
  // Net effect: every Standard-type group claims its folder slot before any Imc-type group does, so
  // an Imc group that collides on name with a Standard group always loses the clean "<name>/" to it
  // and gets bumped to " (1)/" — never the reverse, regardless of which one appears first in the
  // page's group order. A single loop over page.groups (as this used to be) would let an Imc group
  // steal the clean slot when it happens to come first, changing a Standard group's payload member
  // names.
  for (const page of pages) {
    for (const group of page.groups) {
      if (group.selectionType === "Imc") continue; // WizardData.cs:1513-1516
      const groupFolderPath = makeGroupPrefix(
        pages,
        page,
        group,
        groupFolderPaths,
      );
      for (const option of group.options) {
        makeOptionPrefix(group, groupFolderPath, option, optionFolderPaths);
      }
    }
  }
  for (const page of pages) {
    for (const group of page.groups) {
      const groupFolderPath = makeGroupPrefix(
        pages,
        page,
        group,
        groupFolderPaths,
      );
      for (const option of group.options) {
        makeOptionPrefix(group, groupFolderPath, option, optionFolderPaths);
      }
    }
  }

  return optionFolderPaths;
}
