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
// `if (g == null || !g.HasData) { p.Groups.Remove(g); continue; }`) — a content-free group (every
// option HasData-false, WizardGroupEntry.HasData, WizardData.cs:621-627) is removed from the page
// before any prefix is generated. This IS ported (see `buildPages` below): left un-ported, a
// content-free group would still occupy a MakeGroupPrefix collision slot, shifting the `" (1)/"`
// suffix TexTools would assign to a later, real, data-carrying group of the same sanitized name —
// a member-name divergence. `ClearNulls`' innermost step, `if (o == null) g.Options.Remove(o)`
// (:1259-1262), is NOT ported: our `ModpackOption` model has no null-option representation, so that
// step can never apply to data built from it. `WizardOptionEntry.HasData`, the property this
// pruning actually consults (WizardData.cs:257-278), dispatches to a Standard or Imc-specific
// content check depending on the OWNING GROUP's type (`optionHasData`/`imcOptionHasData` below) —
// an Imc option can NEVER carry Files/Manipulations at all (PmpImcOptionJson, PMP.cs:1544-1551), so
// judging it by the Standard rule would treat every Imc group as content-free. See
// `imcOptionHasData`'s doc comment for the residual "Read mode" nuance this still doesn't chase down.
//
// A NOTE FOR TASK 8 (writePmp) — two things this module's own shape depends on that the writer must
// preserve:
//   - `optionPrefixes` returns NO ENTRY for an option whose group never made it into a surviving
//     page (e.g. the synthesized Default option when it's empty, or now also a content-free real
//     group). A consumer must treat "absent from the map" as "this option contributes no files / no
//     folder" — NOT as `""`, which is a real, valid prefix for a different case (a lone group on a
//     lone page, MakePagePrefix's WizardData.cs:1375-1378 branch).
//   - `WritePmp`'s own assembly loop throws BEFORE ever calling `MakeOptionPrefix` on a
//     file-carrying group/option with a blank name (`InvalidDataException`, WizardData.cs:1520-1523:
//     `if (string.IsNullOrWhiteSpace(o.Name) || string.IsNullOrWhiteSpace(g.Name))`). That means the
//     "Blank Group" / "Blank Option" substitutions inside `makeGroupPrefix` / `makeOptionPrefix`
//     below are UNREACHABLE on the real write path for any Standard-type group that carries files —
//     TexTools fails the whole write first. They are ported faithfully anyway (tests pin them:
//     `MakeGroupPrefix` / `MakeOptionPrefix` are correct ports of their own C# symbols regardless of
//     what calls them) because the guard lives in `WritePmp`'s caller loop, not in the prefix
//     builders themselves — WritePmp's loop only reaches line 1520 for `EGroupType.Standard` options
//     (`o.GroupType != EGroupType.Standard` continues past it first, WizardData.cs:1513-1516), so a
//     blank name on a non-Standard (Imc) group never hits this particular throw. `writePmp` MUST
//     reproduce the :1520-1523 throw itself when it starts calling into this module, or a
//     blank-named file-carrying Standard group would silently get a "Blank Group"/"Blank Option"
//     folder instead of failing loud like TexTools does.

import type {
  ModpackData,
  ModpackGroup,
  ModpackOption,
} from "../model/modpack";
import { folderSafeName } from "./pmp";

// Port of PMPOptionJson.IsEmptyOption (PMP.cs:1513-1517). Used ONLY to decide whether FromPmp
// synthesizes a Default page at all (WizardData.cs:1118).
function isEmptyDefaultOption(o: ModpackOption): boolean {
  return (
    o.files.length === 0 &&
    Object.keys(o.fileSwaps).length === 0 &&
    o.manipulations.length === 0
  );
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

// Port of WizardStandardOptionData.CheckHasData (WizardData.cs:77-80). Deliberately excludes
// FileSwaps, unlike IsEmptyOption above — a real asymmetry in the C# between "is the PMP option
// empty" (gates the Default page) and "does this Wizard option carry data" (gates page/group
// survival in ClearNulls).
function standardOptionHasData(o: ModpackOption): boolean {
  return o.files.length > 0 || o.manipulations.length > 0;
}

// Port of WizardImcOptionData.CheckHasData (WizardData.cs:189-196): an Imc-type option's own
// AttributeMask/IsDisableSubMod, NOT Files/Manipulations — an Imc option can never carry either
// (PmpImcOptionJson has no such fields at all, PMP.cs:1544-1551), so reusing the Standard check
// here would judge EVERY Imc option content-free and prune the whole group. Confirmed as a REAL
// regression, not a hypothetical: once `writePmp` started consulting this group-level pruning to
// decide group_NNN.json emission (Task 8's finding 2), an Imc group like
// `[DVNO] Desert Years.pmp`'s vanished from the write entirely. `o.raw` is consulted directly since
// `ModpackOption` does not model these two Imc-only fields as first-class fields (see
// `manifest-types.ts`'s `PmpOptionJson.IsDisableSubMod`/`AttributeMask`).
function imcOptionHasData(o: ModpackOption): boolean {
  const raw = isObj(o.raw) ? o.raw : {};
  return (
    (typeof raw.AttributeMask === "number" && raw.AttributeMask > 0) ||
    raw.IsDisableSubMod === true
  );
}

// Port of WizardOptionEntry.HasData's content-check branches (WizardData.cs:257-278): dispatches
// to the Standard or Imc CheckHasData depending on the OWNING GROUP's type.
//
// NOT ported: the "Read mode" shortcut at the top of the SAME property (WizardData.cs:262-266,
// `if (_Group.ModOption != null) return true;`) — for every WizardGroupEntry our port's actual
// call paths ever construct (`FromPMPGroup`/`FromWizardGroup`, both invoked from `WizardData.
// FromPmp`/`FromModpack` — i.e. every load ConsoleTools' `/resave` and `/upgrade` ever perform),
// `ModOption` is UNCONDITIONALLY set to the source document, so real TexTools' `HasData` is
// UNCONDITIONALLY true and the content-based checks below are NEVER actually consulted for a
// loaded pack. A fully faithful port would make group/option-level ClearNulls pruning a near-total
// no-op for any group that came from an existing document (only an entirely-EMPTY page — zero
// groups, from the off-by-one bug — would still prune). We do not go that far: it would undo
// already-corpus-exercised Standard-side pruning behaviour (`buildPages`'s existing folder-prefix
// use, and the option-prefix.test.ts "case 8" scenario) with no oracle evidence either way. This is
// therefore a residual, latent risk symmetric with the one we just fixed for Imc: a genuinely
// zero-AttributeMask, non-disable Imc option (or, on the Standard side, a genuinely zero-file,
// zero-manipulation option) inside an otherwise-real PMP group could in principle be pruned here
// where real TexTools' Read-mode shortcut would keep it. Revisit if the `/resave` oracle ever shows it.
function optionHasData(o: ModpackOption, isImc: boolean): boolean {
  return isImc ? imcOptionHasData(o) : standardOptionHasData(o);
}

// Port of WizardGroupEntry.HasData (WizardData.cs:621-627).
function groupHasData(g: ModpackGroup): boolean {
  const isImc = g.selectionType === "Imc";
  return g.options.some((o) => optionHasData(o, isImc));
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

  // WizardData.ClearNulls (WizardData.cs:1234-1244): drop any page with no groups carrying data.
  // Then, within each surviving page (WizardData.cs:1246-1263), drop any group that itself carries
  // no data — otherwise a content-free group would still occupy a MakeGroupPrefix collision slot
  // ahead of a later, real group with the same sanitized name (see the module header comment).
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
