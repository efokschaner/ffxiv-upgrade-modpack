# `writeTtmp2` omits `.mpl` fields TexTools always writes

**Date:** 2026-07-20
**Status:** Design approved (brainstorming); ready for implementation plan.
**Closes:** `docs/backlog/2026-07-13-resave-ttmp2-missing-mpl-fields.md`
**Depends on:** `2026-07-08-modpack-serialization-parity-design.md`,
`2026-07-04-upgrade-golden-harness-design.md`, `2026-07-12-pmp-writer-regeneration-design.md`
(which introduced `computeSelection`, retired here).

---

## 1. Problem

`writeTtmp2` (`src/container/ttmp2.ts:205-283`) emits a `TTMPL.mpl` that is missing four things a
ConsoleTools-written one always carries. The `/resave` write-side oracle surfaced all four across 36
corpus packs, and `.upgrade-baseline` confirms they reach `/upgrade` too — this item plus its two
siblings account for ~5431 of 5811 baseline entries across 58 of 70 packs.

The root cause is a single serializer fact. TexTools writes the manifest with a bare
`JsonConvert.SerializeObject(_modPackJson)` — no settings object (`Mods/TTMPWriter.cs · TTMPWriter.Write · 324`).
Newtonsoft's default is `NullValueHandling.Include`, so **every null member is physically emitted as
`"Field": null`**, and `Mods/DataContainers/ModPackJson.cs` carries no `[JsonProperty]`,
`ShouldSerialize*`, `[JsonIgnore]` or `NullValueHandling` attribute anywhere to suppress one. Our
writer instead omits absent keys and our readers coalesce nulls to `""`, so we differ wherever C#
leaves a value null or default.

| Missing | C# provenance |
|---|---|
| `OptionList/N/IsChecked` | `ModOptionJson.IsChecked` (`ModPackJson.cs:189-198`), written from `ModOption.IsChecked` (`TTMPWriter.cs · AddOption · 148`) |
| `ModsJsons/N/ModPackEntry` | `ModsJson.ModPackEntry` (`ModPackJson.cs:262`) — never assigned in either `AddFile` initializer (`TTMPWriter.cs:168-177`, `:198-207`), so always `null` |
| `SimpleModsList` (wizard) / `ModPackPages` (simple) | The exclusive if/else in the `TTMPWriter` ctor (`:74-77`) initializes exactly one; the other stays `null` and is emitted as `null` |
| Option `Description` written as `""` where C# writes `null` | `ToModOption` (`WizardData.cs:414`) and `AddOption` (`TTMPWriter.cs:144`) copy verbatim, with no `?? ""` |

## 2. The `IsChecked` finding — it is a model field, not a writer trick

`IsChecked` cannot be derived at write time. The write is a straight copy
(`WizardData.cs · ToModOption · 418`, `TTMPWriter.cs · AddOption · 148`) of
`WizardOptionEntry.Selected` (`WizardData.cs:281-321`) — a plain `bool`, no initializer, so `false`.
The familiar "first option of a Single group is checked" rule is a **read-side** normalization
applied at each loader's tail, and the two loaders derive `Selected` differently:

- **TTMP** — `FromWizardGroup` (`WizardData.cs:668`): `wizOp.Selected = o.IsChecked;`, verbatim, **no
  clamping**. A Single group with several `IsChecked: true` keeps several selected.
- **PMP** — `FromPMPGroup` (`WizardData.cs:805-812`): `DefaultSettings` read as an **index** for
  Single (`DefaultSettings == (ulong)idx`) and as a **bitmask** for Multi (`1UL << idx`).
- **Both** then apply the same backstop *last*, after the empty-group return and after every option
  is in `group.Options` (`:755-757`, `:857-859`):
  `if (OptionType == Single && !Options.Any(x => x.Selected)) Options[0].Selected = true;`
  It is a *none-selected* backstop only — it never corrects a Single group with more than one.

The setter (`:281-321`) does IMC-only mutual exclusion and nothing for Single groups; on both load
paths the option is added to `Options` *after* the assignment, so `IndexOf(this) == -1` and that
logic early-returns. Single-group exclusivity is a WPF radio binding in the UI, never a model
invariant — so we must not invent one.

### 2.1 `computeSelection` retires

`src/container/pmp.ts:327-348` already ports `WizardGroupEntry.Selection` (`WizardData.cs:578-604`),
but feeds it by *simulating* the per-option derivation plus the backstop, because — as its own doc
comment states — "our domain model has no per-option `Selected` flag". Once the real flag exists
that simulation is redundant: the PMP writer reads the flags directly, exactly as `ToPmpGroup` does
(`:949`). This is expected to move **zero** PMP bytes, since the simulation is exact for
PMP-sourced groups by construction; any movement is a finding, not a re-bless.

## 3. Nullability — what is actually nullable

Verified end to end (`WizardMetaEntry` decls `WizardData.cs:1015-1020`; load `FromTtmp` `:1052-1069`;
write `WriteWizardPack` `:1332-1346`). The `= ""` initializers give no protection — load overwrites
them verbatim with whatever the source `.mpl` spelled.

| Field | Nullable through to serialization? |
|---|---|
| Top-level `Name`, `Author`, `Description`, `Url` | **Yes** — verbatim on both load and write |
| Top-level `Version` | **No** — forced non-null by `Version.TryParse` + `ver ??= new Version("1.0")` (`:1333-1335`), re-guarded in the `TTMPWriter` ctor (`:61`) |
| Option `Description` | **Yes** — verbatim (`WizardData.cs:663`, `:414`; `TTMPWriter.cs:144`) |
| Group/option `Name`, `ImagePath`, `GroupName`, `SelectionType`, per-file strings | Out of scope — never observed null, and widening them inflates the change past the item |

Note the asymmetry with PMP, which is *not* a bug to unify away: the PMP export path coalesces
(`ToPmpOption` `:543-544`, `pg.Name = (Name ?? "").Trim()` `:946`) and the PMP reader uses
`NullValueHandling.Ignore`, so a PMP-sourced description is never null. Only TTMP propagates nulls.

## 4. Design

### 4.1 Model (`src/model/modpack.ts`)

- Add `ModpackOption.selected: boolean` — mirrors `WizardOptionEntry.Selected`; default `false`.
- Widen `ModpackOption.description` to `string | null`.
- Widen `ModpackMeta.name` / `.author` / `.description` / `.url` to `string | null`. **`.version`
  stays `string`** (§3). `emptyMeta()` keeps its `""` values — they mirror the C# initializers.

`description` is consumed only by the two writers (`ttmp2.ts:233,263`, `pmp.ts:416,597,762`), so the
widening does not ripple. The PMP writer coalesces at its own seams, per §3.

### 4.2 Readers

- `readTtmp2` (`ttmp2.ts:71-162`) — stop coalescing the four meta strings and the option
  `Description`; set `selected` from `IsChecked` (absent → `false`, the C# field default).
- `readPmp` — set `selected` from `DefaultSettings`: index for Single, `1 << idx` bitmask otherwise.
- Both — apply the `Options[0]` backstop at the tail of the group build.

The backstop is **duplicated** at each seam rather than shared. It is three lines belonging to two
distinct C# symbols (`FromWizardGroup`, `FromPMPGroup`); a shared helper would blend them, against
AGENTS.md's "split, don't blend". Each copy cites its own site.

### 4.3 `writeTtmp2` (`ttmp2.ts:205-283`)

- `IsChecked: o.selected`.
- `ModPackEntry: null` on every mods json.
- Emit **both** `ModPackPages` and `SimpleModsList`, one of them `null` — symmetric, so simple packs
  gain `"ModPackPages": null` too (the item names only the wizard direction).
- `Description` verbatim, no `?? ""`; same for the four meta strings.
- Reorder the `ModOptionJson` literal to C# declaration order
  (`Name, Description, ImagePath, ModsJsons, GroupName, SelectionType, IsChecked`) — ours puts
  `ModsJsons` last. Manifests are compared semantically (`jsonPointerDiff`), so this is not enforced
  by the harness, but it is strictly closer to the golden bytes and free while editing the literal.

### 4.4 Version reformat (separable)

`WriteWizardPack` (`:1333-1335`) normalizes the pack version through `Version.TryParse`, so a source
spelling `"1"` is written `"1.0"`. `writeTtmp2` emits `data.meta.version` verbatim. This is a
**latent divergence not named by the backlog item** and no corpus pack currently exercises it; it is
in scope only because it lives in the same object literal and the same C# method as §3's null fix.
It is a discrete, droppable task in the plan.

`reformatPmpVersion` (`pmp.ts:321-325`) already implements the identical .NET semantic but is cited
to `WizardData.cs:1474-1475+:1494`, a *different* symbol. Lift it to a shared util cited to the .NET
`Version.TryParse`/`ToString()` contract itself, with each call site citing its own C# line — the
shared thing is the framework primitive, not one caller's logic.

## 5. Not in scope

- **Zero-option groups.** Both loaders `return null` for an empty group (`:749-753`, `:851-855`);
  our readers keep it. A real divergence two lines from code this change touches. **File as a
  backlog item.**
- **`SelectedSettings`.** Investigated and closed: `[JsonIgnore]` (`PMP.cs:1399-1400`), no
  `ShouldSerialize`, and the group writer passes only `Formatting.Indented` (`PMP.cs:856-862`). A
  ConsoleTools group json contains no such key, so our omitting it from `KNOWN_GROUP_KEYS` is
  correct. No action.
- The two sibling backlog items (`Name`/`Category` re-derivation, option file order) — they share
  the baseline entries but are independent fixes.

## 6. Testing

- **Primary target:** `test/corpus/synthetic/imc-weapon.ttmp2`
  (`scripts/generate-synthetics/build-synthetic-imc-weapon.ts`) already reproduces `IsChecked`,
  `ModsJsons/{0,1}/ModPackEntry` and `SimpleModsList` as `[added]` from a committed builder — a
  2-file pack to iterate against with no third-party mod. Closing this should empty its baseline.
- **Synthetic unit tests** for what no corpus pack reaches:
  1. backstop fires on a Single group with zero selected → `options[0].selected === true`;
  2. a TTMP Single group with several `IsChecked: true` survives **unclamped** (guards against
     inventing an invariant the C# does not have);
  3. a Multi group's bitmask round-trips per-bit;
  4. PMP `DefaultSettings` out of range for a Single group → backstop → recomputed to `0`;
  5. option `Description: null` round-trips as `null`, and `""` stays `""`.
- **Re-bless** the upgrade + resave baselines. Expect a large but *partial* drop: two sibling items
  still hold entries on the same packs. Every remaining entry on a touched pack must be attributable
  to a named sibling item.
- `computeSelection`'s retirement must move zero PMP bytes (§2.1).
