// Port of WizardData.ClearNulls (reference/.../Mods/WizardData.cs · WizardData.ClearNulls ·
// 1234-1266) and the two HasData predicates it reads: WizardGroupEntry.HasData (· 621-627) and
// WizardPageEntry.HasData (· 969-975).
//
// WizardGroupEntry.HasData is `Options.Any(x => x.HasData)` (:621-627), so it depends in turn on
// WizardOptionEntry.HasData (:257-278), which short-circuits on its FIRST line:
// `if (_Group.ModOption != null) { return true; } // "Read mode."`. `ModOption` is assigned in
// exactly two places in the whole file — `WizardGroupEntry.FromWizardGroup` (:649) and
// `WizardGroupEntry.FromPMPGroup` (:767) — and never reset, and those are the ONLY group
// constructors `/upgrade` and `/resave` (i.e. every load of a pack this port cares about) ever
// reach. So on every path we port, `WizardOptionEntry.HasData` is UNCONDITIONALLY true,
// `WizardGroupEntry.HasData` reduces to `Options.Count > 0`, and `ClearNulls` NEVER prunes a group
// for lacking file/manipulation/fileSwap CONTENT — only a page left with zero groups, or a group
// left with zero options, is ever pruned. `groupHasData` below therefore checks
// `group.options.length > 0`, not any per-option content predicate — a content-free group (e.g.
// every option's `Files` rejected by `canImport`, or an authored group with an empty `Files: {}`)
// is KEPT and DOES occupy a `MakeGroupPrefix` collision slot, exactly like TexTools does.
// `groupHasData` must therefore NOT be turned into a content check: that silently diverges from
// the golden.

import type { ModpackGroup, ModpackPage } from "../model/modpack";

// Port of WizardGroupEntry.HasData (WizardData.cs:627-633), reduced to `Options.Count > 0` per the
// `WizardOptionEntry.HasData` Read-mode short-circuit documented above.
export function groupHasData(g: ModpackGroup): boolean {
  return g.options.length > 0;
}

// DELIBERATE DIVERGENCE — docs/TEXTOOLS_BUGS.md #22.
// The C# is `Groups.Any(x => x.HasData)` (WizardData.cs:984), which dereferences a null group and
// throws. Measured 2026-08-03: ConsoleTools /upgrade exits -1 with NO output file whenever a
// zero-option group is FIRST on its page; any preceding data-carrying group shields it, because
// Any short-circuits. We treat a null as "no data" so the pack upgrades instead of failing.
// Confirmed by ORACLE_ERROR_DIVERGENCE_RULES (test/helpers/upgrade-compare.ts), not suppressed by
// a ratchet baseline. See docs/superpowers/specs/2026-08-04-datapages-model-and-empty-group-design.md §5.
export function pageHasData(p: ModpackPage): boolean {
  return p.groups.some((g) => g !== null && groupHasData(g));
}

export function clearNulls(pages: ModpackPage[]): void {
  // `DataPages.ToList()` (:1236) — iterate a SNAPSHOT while removing from the live list.
  for (const p of [...pages]) {
    // :1239 — `p.FolderPath = null`. Not ported: `ModpackPage` carries no `folderPath` field at all
    // (see its doc comment, src/model/modpack.ts) — `optionPrefixes` owns that memo locally and
    // never reads it back through this module, so there is nothing here to null.
    if (!pageHasData(p)) {
      pages.splice(pages.indexOf(p), 1); // :1242
      continue;
    }
    // :1246-1253 — same snapshot-then-remove shape, at the group level. This check IS null-guarded
    // in the C#; only the page-level one above is not.
    for (const g of [...p.groups]) {
      if (g === null || !groupHasData(g)) {
        p.groups.splice(p.groups.indexOf(g), 1);
      }
      // :1254 — g.FolderPath = null. Our group folder paths live in optionPrefixes' local Maps
      // (rebuilt per call), so there is no stored field to null here.
    }
    // :1256-1263 — `if (o == null) g.Options.Remove(o)` is NOT ported: ModpackOption has no null
    // representation, so the step can never apply to data built from our model.
  }
}
