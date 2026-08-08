# 22. `ClearNulls` reads `WizardPageEntry.HasData` over a list it is about to remove nulls from

**Status:** diverged · **Where:** `WizardData.ClearNulls` (`WizardData.cs:1253-1285`) reading
`WizardPageEntry.HasData` (`:980-986`), over nulls admitted by `WizardData.FromPmp` (`:1155`, `:1175`)
from `WizardGroupEntry.FromPMPGroup`'s empty-group early return (`:857-861`). See
`src/container/clear-nulls.ts` and
`docs/superpowers/specs/2026-08-04-datapages-model-and-empty-group-design.md`.

`FromPMPGroup` returns `null` for a group with no options, and `FromPmp` adds the result to
`page.Groups` **unconditionally** at both its call sites — the synthesized Default group (`:1155`)
and the real ones (`:1175`). So a zero-option PMP group puts a literal `null` into a
`List<WizardGroupEntry>`. `FromPmp` then calls `ClearNulls()` (`:1178`) to prune exactly that:

```csharp
foreach (var p in pages)
{
    p.FolderPath = null;
    if (!p.HasData)          // :1259 — evaluated BEFORE the null-removing loop below
    {
        DataPages.Remove(p);
        continue;
    }

    var groups = p.Groups.ToList();
    foreach (var g in groups)
    {
        if (g == null || !g.HasData) { p.Groups.Remove(g); continue; }   // :1268 — null-SAFE
```

The group-level check at `:1268` is correctly null-guarded. The page-level check one statement
earlier is not:

```csharp
public bool HasData { get { return Groups.Any(x => x.HasData); } }   // :980-986
```

`Any` dereferences `x` to read the instance property, so it throws `NullReferenceException` the
moment it reaches a null element. The method crashes on the list it exists to clean.

It is **order-dependent**, because `Any` short-circuits on the first `true`. Every non-null group on
the paths a modpack load reaches is `HasData == true` (`WizardGroupEntry.HasData` is
`Options.Any(x => x.HasData)`, `:627-633`, and `WizardOptionEntry.HasData` returns `true` on its
first line whenever `ModOption != null`, `:259-280` — which both group constructors always set). So
any data-carrying group *preceding* the null shields it, and the NRE fires **iff the zero-option
group is the first group added to its page**.

Measured, ConsoleTools `/upgrade`, five hand-built PMPs, 2026-08-03:

| pack shape | result |
| --- | --- |
| empty `default_mod`; sole group `Options: []` | **NRE**, exit -1, no output |
| real group **then** empty group, same page | exit 0, clean no-op |
| empty group **then** real group, same page | **NRE**, exit -1, no output |
| non-empty `default_mod`; empty group on Page 0 | exit 0, clean no-op |
| non-empty `default_mod`; empty group alone on Page 1 | **NRE**, exit -1, no output |

```
System.NullReferenceException: Object reference not set to an instance of an object.
   at xivModdingFramework.Mods.WizardPageEntry.<>c.<get_HasData>b__4_0(WizardGroupEntry x)
```

Row 4 is the mechanism confirming itself twice: a `Page: 0` group is shielded only because
`FromPmp:1155` puts the synthesized Default group in front of it, and row 5 shows the shield is
positional rather than page-numbered — the same empty group one page over still crashes.
`HandleUpgrade` catches the exception (`ConsoleTools/Program.cs:183-186`), `Trace.WriteLine`s it and
returns -1, so the user gets **no output file at all** and no message on stdout.

The TTMP wizard path is unaffected: `WizardPageEntry.FromWizardModpackPage` discards the null at the
call site (`if (g == null) continue;`, `:997`), so no null ever enters `page.Groups` there.

**Us:** we deliberately do **not** reproduce it. `pageHasData` in `src/container/clear-nulls.ts` is
null-safe (`p.groups.some((g) => g !== null && groupHasData(g))`), so the pack upgrades instead of
failing. This is the rare case where AGENTS.md's user-benefit bar is satisfied without an in-game
comparison, because there is nothing to compare against: TexTools emits no file, so any correct pack
is strictly better than none, and the risk that rule guards against — shipping something TexTools
does differently and better — cannot arise. Everything around the divergence stays faithful: the
group-level prune at `:1268` is ported verbatim, and the `FromPmp` page off-by-one (entry 7) is
reproduced untouched. Confirmed by an `ORACLE_ERROR_DIVERGENCE_RULES` entry keyed on the trace
signature above, not by a ratchet baseline — its `confirm` (`confirmOracleErrorDivergence`,
`test/helpers/corpus-upgrade.ts`) checks both that our output byte-matches the CONTENT of a sibling
pack's `/upgrade` golden (identical but for the zero-option group) AND that our output's STRUCTURE
(manifest members, payload member names) matches our own pipeline's write of that same sibling —
the content check alone is a payload multiset keyed by gamePath and cannot see a stray
`group_NNN.json` or a shifted `pN/` prefix, either of which moves zero gamePath bytes.

**Upstream fix:** null-guard the page predicate the same way the group loop already is —
`Groups.Any(x => x != null && x.HasData)` — or, better, have `FromPmp` skip the add when
`FromPMPGroup` returns null, as `FromWizardModpackPage:997` already does, so `ClearNulls` never has
a null to survive in the first place.
