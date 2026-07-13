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
// The group/option-level pruning ClearNulls also performs (removing a group none of whose options
// carry data) is NOT ported: it only matters for a group whose every option is entirely
// content-free, which none of writePmp's real inputs produce.

import type {
  ModpackData,
  ModpackGroup,
  ModpackOption,
} from "../model/modpack";
import { safeName } from "./pmp";

// Port of PMPOptionJson.IsEmptyOption (PMP.cs:1513-1517). Used ONLY to decide whether FromPmp
// synthesizes a Default page at all (WizardData.cs:1118).
function isEmptyDefaultOption(o: ModpackOption): boolean {
  return (
    o.files.length === 0 &&
    Object.keys(o.fileSwaps).length === 0 &&
    o.manipulations.length === 0
  );
}

// Port of WizardStandardOptionData.CheckHasData (WizardData.cs:77-80). Deliberately excludes
// FileSwaps, unlike IsEmptyOption above — a real asymmetry in the C# between "is the PMP option
// empty" (gates the Default page) and "does this Wizard option carry data" (gates page/group
// survival in ClearNulls).
function optionHasData(o: ModpackOption): boolean {
  return o.files.length > 0 || o.manipulations.length > 0;
}

// Port of WizardGroupEntry.HasData (WizardData.cs:621-627).
function groupHasData(g: ModpackGroup): boolean {
  return g.options.some(optionHasData);
}

interface Page {
  groups: ModpackGroup[];
  folderPath?: string;
}

// Port of WizardData.FromPmp's page construction (WizardData.cs:1118-1158) followed by
// WizardData.ClearNulls' page-level pruning (WizardData.cs:1234-1244).
function buildPages(data: ModpackData): Page[] {
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

  // WizardData.ClearNulls (WizardData.cs:1234-1244): drop any page with no groups carrying data.
  return pages.filter((p) => p.groups.some(groupHasData));
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

  // WizardData.cs:1390-1394 — safeName() first, THEN substitute the literal if the result is
  // blank. "Blank Group" is NOT itself re-run through safeName: it is used verbatim, capitalized.
  let gName = safeName(group.name);
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

  // WizardData.cs:1432-1435 — same substitute-after-safeName rule as the group name.
  let oName = safeName(option.name);
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

  // WizardData.cs:1506-1542 — the same page/group/option nesting order WritePmp iterates in.
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
