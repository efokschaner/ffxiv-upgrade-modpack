# 7. `FromPmp`'s page-index off-by-one merges page-0 groups onto the Default page

**Status:** reproduced · **Where:** `WizardData.cs:1137-1177` construction + `:1253-1263`
(`ClearNulls`' page-level pruning) — see `src/container/pmp.ts:325-333` (construction) and
`src/container/clear-nulls.ts` (pruning)

When `default_mod.json` is non-empty, `FromPmp` unshifts a synthesized "Default" page onto the
FRONT of `DataPages` before appending one page per real page index `0..pageMax`. The group-assignment
loop right after still indexes `DataPages[g.Page]` with each real group's *raw*, unadjusted page
number — so a group meant for page 0 lands on `DataPages[0]`, which is now the Default page, not the
page just created for it; the page created for page 0 is left with zero groups.

That would inflate `DataPages.Count` and switch on the `pN/` prefix for the whole pack — except
`ClearNulls` (WizardData.cs:1253-1263) runs immediately afterward (`:1178`, inside `FromPmp` itself,
and again — redundantly — at `:1481` inside `WritePmp`) and drops any page with zero
data-carrying groups. For the common case (a single real page, `pageMax === 0`), that prunes the
now-empty created page right back out, so `DataPages.Count` ends up **unchanged** (still 1) and NO
`pN/` prefix appears. The bug's only surviving, observable effect is that the misrouted group's
files merge directly onto the Default page's folder (e.g. both `default/…` and `everything/a/…`
sit at the top level with no page prefix) instead of the group getting a page — and, in the page
sense — of its own. A naive reading of the C# (assuming `ClearNulls` merely nulls fields and never
removes pages) would predict `DataPages.Count === 2` and a `p1/`/`p2/` split instead; that reading is
wrong — `ClearNulls`' page-removal step (`if (!p.HasData) { DataPages.Remove(p); continue; }`,
`WizardData.cs:1259-1263`) is unconditional, not GUI-only (that distinction belongs to
`ClearEmpties`, which additionally preserves one empty *option* per single-select group for the
import wizard UI — `ImportWizardWindow.xaml.cs:143` — and is not on the headless `/upgrade`/`/resave`
path).

**Us:** ported verbatim — page construction uses the same raw, unshifted index, and the same
page-level `HasData` pruning runs afterward. The single-real-page merge-onto-Default case (no `pN/`
prefix at all) is pinned by `test/container/option-prefix.test.ts` case 6; the multi-real-page case
described above — where the shift instead strands the LAST created page empty, `pN/` DOES turn on,
and the page-0 group's content still merges onto the Default page's folder while the page-1 group is
bumped into the slot meant for page 0 — is pinned separately by case 9.

**Upstream fix:** assign real groups to `DataPages[g.Page + (hasDefaultPage ? 1 : 0)]`.
