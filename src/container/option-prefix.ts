// Port of WizardData's PMP-write prefix generators, the three prefix builders MakePagePrefix /
// MakeGroupPrefix / MakeOptionPrefix (WizardData.cs:1362-1458). Page construction (FromPmp,
// WizardData.cs:1118-1158) and pruning (ClearNulls, WizardData.cs:1234-1266) do NOT live here
// anymore: construction happens at load, in `readPmp` (src/container/pmp.ts), and pruning is its
// own module (src/container/clear-nulls.ts), called at both the load seam (FromPmp:1159) and the
// write seams (WritePmp:1462, WriteWizardPack:1334) — so every `ModpackPage` reaching this module's
// exported `optionPrefixes` has already had its nulls and empty groups/pages removed.
//
// This module ports one TexTools bug faithfully; see docs/TEXTOOLS_BUGS.md #6 for the full writeup:
// MakeGroupPrefix's non-incrementing collision loop (WizardData.cs:1406-1409), ported as written,
// but throwing rather than reproducing the hang if collision resolution would need more than one
// retry. (The FromPmp page-index off-by-one, docs/TEXTOOLS_BUGS.md #7, is likewise ported
// faithfully, but its citation now lives at the page-construction seam itself, `readPmp` in
// src/container/pmp.ts, since that is where the off-by-one indexing actually happens.)
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

import {
  allPages,
  type ModpackData,
  type ModpackGroup,
  type ModpackOption,
  type ModpackPage,
} from "../model/modpack";
import { folderSafeName } from "./pmp";

// Port of MakePagePrefix (WizardData.cs:1362-1382). `WizardPageEntry.FolderPath` (:967) is the C#'s
// memo; `ModpackPage` carries no equivalent field (see its doc comment, src/model/modpack.ts), so
// `pageFolderPaths` — local to this module's exported `optionPrefixes`, one per call — stands in for
// it instead.
function makePagePrefix(
  pages: ModpackPage[],
  page: ModpackPage,
  pageFolderPaths: Map<ModpackPage, string>,
): string {
  const existing = pageFolderPaths.get(page);
  if (existing !== undefined) return existing;

  let pagePrefix = "";
  if (pages.length > 1) {
    const pIdx = pages.indexOf(page) + 1;
    pagePrefix = `p${pIdx}/`;
  } else if (page.groups.length === 1) {
    // WizardData.cs:1375-1378 — a no-op branch: pagePrefix is already "" from initialization.
    // Reproduced for 1:1 traceability with the C#, not because it changes behaviour.
    pagePrefix = "";
  }

  pageFolderPaths.set(page, pagePrefix);
  return pagePrefix;
}

// Port of MakeGroupPrefix (WizardData.cs:1383-1413).
function makeGroupPrefix(
  pages: ModpackPage[],
  page: ModpackPage,
  group: ModpackGroup,
  groupFolderPaths: Map<ModpackGroup, string>,
  pageFolderPaths: Map<ModpackPage, string>,
): string {
  const existing = groupFolderPaths.get(group);
  if (existing !== undefined) return existing;

  // WizardData.cs:1390-1394 — IOUtil.MakePathSafe (folderSafeName) first, THEN substitute the
  // literal if the result is blank. "Blank Group" is NOT itself re-run through folderSafeName: it
  // is used verbatim, capitalized.
  let gName = folderSafeName(group.name);
  if (gName.trim() === "") gName = "Blank Group";

  const pagePrefix = makePagePrefix(pages, page, pageFolderPaths);
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
  // `g !== null` narrows rather than asserts: ClearNulls has already run on every page reaching this
  // module (see optionPrefixes' own top-of-function comment) -- but `page`'s declared type is the
  // general `ModpackPage`, so the compiler cannot see that here.
  if (
    page.groups.some(
      (g) => g !== null && groupFolderPaths.get(g) === groupPrefix,
    )
  ) {
    groupPrefix = `${pagePrefix}${gName} (${i})/`;
    if (
      page.groups.some(
        (g) => g !== null && groupFolderPaths.get(g) === groupPrefix,
      )
    ) {
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
 *  its lone option is empty, per `readPmp`'s `IsEmptyOption` check, src/container/pmp.ts) has no
 *  entry — TexTools never assigns it one either, since WritePmp's iteration
 *  (WizardData.cs:1506-1542) only visits `DataPages`. */
export function optionPrefixes(data: ModpackData): Map<ModpackOption, string> {
  // ClearNulls has already run (at load for PMP, FromPmp:1159; at write for both, WritePmp:1462 /
  // WriteWizardPack:1334), so no page reaching here holds a null. Narrow rather than assert that.
  const pages = allPages(data).map((p) => ({
    ...p,
    groups: p.groups.filter((g): g is ModpackGroup => g !== null),
  }));
  const groupFolderPaths = new Map<ModpackGroup, string>();
  const optionFolderPaths = new Map<ModpackOption, string>();
  // Local stand-in for `WizardPageEntry.FolderPath` (see makePagePrefix's doc comment) — scoped to
  // this one call, same lifetime as `groupFolderPaths`/`optionFolderPaths` above.
  const pageFolderPaths = new Map<ModpackPage, string>();

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
        pageFolderPaths,
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
        pageFolderPaths,
      );
      for (const option of group.options) {
        makeOptionPrefix(group, groupFolderPath, option, optionFolderPaths);
      }
    }
  }

  return optionFolderPaths;
}
