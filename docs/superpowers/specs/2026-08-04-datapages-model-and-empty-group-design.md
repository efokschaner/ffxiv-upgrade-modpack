# DataPages model, and the zero-option group both C# loaders drop

Status: designed, unimplemented · Filed 2026-08-04 · Supersedes
`docs/backlog/2026-07-20-empty-group-not-dropped.md`, which framed this as a two-line reader fix.

Every behavioural claim below was **measured** against ConsoleTools on 2026-08-03/04, not read off
the C#. The probe shapes are reproduced as corpus synthetics in §6 so the measurements stay live.

## 1. Why

Both wizard-model group constructors bail out on an option-less group and return `null`:

- `reference/.../Mods/WizardData.cs · WizardGroupEntry.FromWizardGroup · 749-753` (TTMP)
- `reference/.../Mods/WizardData.cs · WizardGroupEntry.FromPMPGroup · 851-855` (PMP)

`readTtmp2` and `readPmp` port neither, so an option-less group survives our read as a
`ModpackGroup` with `options: []`. That was the filed item. Tracing it produced three findings that
change what the work is.

### 1.1 The PMP half is already ported, under another name

`ClearNulls`' group prune is `if (g == null || !g.HasData)` (`:1249`). Per `option-prefix.ts`'s own
header analysis, `WizardOptionEntry.HasData` short-circuits `true` on every load path this port
reaches, so `WizardGroupEntry.HasData` reduces to `Options.Count > 0` and the condition reduces to
exactly `g == null`. `groupHasData` (`option-prefix.ts:105-107`) is `g.options.length > 0`. Our
filter **is** `ClearNulls`' prune, with "null" spelled "empty `options` array".

### 1.2 But `ClearNulls` crashes first, order-dependently

`ClearNulls` evaluates `p.HasData` (`:1240`) *before* the group loop that removes nulls, and
`WizardPageEntry.HasData` is `Groups.Any(x => x.HasData)` (`:969-975`) — a null dereference the
moment `Any` reaches a null element. `Any` short-circuits in order and every non-null group is
`HasData == true`, so:

> **The NRE fires iff an option-less group is the *first* group added to its page.** Any preceding
> data-carrying group shields it, and `:1249` then removes it cleanly.

Measured (ConsoleTools `/upgrade`, five hand-built PMPs, 2026-08-03):

| shape | result |
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

That frame is the lambda in `Groups.Any(x => x.HasData)`, i.e. `WizardData.cs:973`. Row 4 confirms
the mechanism twice over: a `Page: 0` group is shielded specifically because `FromPmp:1136` adds the
synthesized Default group first, and row 5 shows the shield is positional, not page-numbered.

`HandleUpgrade` catches it (`ConsoleTools/Program.cs:183-186`), `Trace.WriteLine(ex)`, `return -1`.
No output file.

So the PMP divergence is not "we keep a group they drop". It is: **where the empty group is
shielded we already match; where it is not, TexTools cannot upgrade the pack at all and we can.**

### 1.3 The TTMP half needs page identity fixed, not just the drop

`WriteWizardPack` (`:1332-1357`) calls `ClearNulls()`, skips `!page.HasData` pages, and numbers the
survivors with a **dense counter** — not the source `PageIndex`. Measured (ConsoleTools `/resave`,
four hand-built TTMP2s; `/resave` because a dummy-gamePath `/upgrade` no-ops and writes nothing):

| source | output |
| --- | --- |
| page 0 = empty group, page 1 = real group | **one** page, `PageIndex: 0`, holding the real group |
| single page, `PageIndex: 3` | `PageIndex: 0` |
| pages listed `[1, 0]` | `PageIndex 0 → Second`, `1 → First` — **array order, not sorted** |
| two pages both `PageIndex: 0` | **two** pages, `0 → Alpha`, `1 → Beta` |

`writeTtmp2` today emits `PageIndex: g.page` over `[...byPage.keys()].sort()`. Rows 2–4 are
divergences reachable with **no empty group involved**; row 1 shows the drop alone would not close
the item, since the survivor would still be emitted as `PageIndex: 1`.

### 1.4 The root cause is a blended model

`WizardData` carries only `DataPages` (`:1080`) — `List<WizardPageEntry>`, each holding
`List<WizardGroupEntry> Groups`. We carry a flat `groups: ModpackGroup[]` plus a `page: number`,
and that number means two different things:

- **PMP** — `PMPGroupJson.Page` is a genuine index; C# writes `data.DataPages[g.Page]` (`:1155`).
  Sparse values create real (later-pruned) pages, and the documented page off-by-one depends on the
  number being used as an index.
- **TTMP** — `ModPackPageJson.PageIndex` is **decorative at load**. `FromWizardTtmp:1180-1184`
  appends one page per `ModPackPages` element in array order; `FromWizardModpackPage` reads
  `jp.PageIndex` only to build a display name (`:980`). Page identity is positional, and the number
  is re-derived at write.

One field standing for both is the "mirror the C# data structure, not just its values" failure
(AGENTS.md) one level above the group. Every divergence in §1.3 follows from it. We also build
pages at **write** time (`option-prefix.ts`'s `buildPages`, whose header admits it blends `FromPmp`'s
page construction with `ClearNulls`) where C# builds them at **load** — the same seam-fidelity shape
as the two open `/resave` findings on `.mdl` v6 and `.meta` reconstruction.

## 2. Scope, and why it is one spec

Operator's call, 2026-08-04: fix it as fully as possible, as a **single spec in two ordered
phases**, so the two byte-moving causes stay separable in review and in history.

- **Phase 1 — structural, byte-neutral.** Model `DataPages`, move page construction to load,
  un-blend `ClearNulls`. No behaviour change: the corpus must not move, and any baseline that does
  is a bug in the move.
- **Phase 2 — behavioural.** The zero-option drop at both readers, the dense `PageIndex` renumber,
  the PMP divergence, and the fixtures and rules that confirm them.

Phase 1 keeps a transitional `sourcePageIndex` on `ModpackPage` so `writeTtmp2` can keep emitting
today's value; Phase 2 switches to the dense counter and deletes the field.

## 3. Model

- **New** `ModpackPage { groups: (ModpackGroup | null)[] }`, mirroring `WizardPageEntry`
  (`WizardData.cs:963-990`). The `null` is deliberate: `FromPmp:1136,1156` genuinely add nulls, and
  representing it is what lets §5's divergence be one legible line at the seam it belongs to rather
  than an absence nobody can see.
- `ModpackData.pages: ModpackPage[]` **replaces** `groups: ModpackGroup[]`. `WizardData` has no flat
  list; two views of the same groups would drift.
- `ModpackGroup.page: number` is **deleted** — it is the blended field. `WizardGroupEntry` carries
  no page at all; `readPmp` reads `g.Page` transiently from the parsed group JSON while assigning
  pages, exactly as `FromPmp:1155` does. Grep confirms only two readers today
  (`option-prefix.ts:135,144`, PMP-only; `ttmp2.ts:311,329`, TTMP-only), both rewritten here.

### 3.1 The Phase-1 hazard: flat iteration order

`allFiles(data)` walks `data.groups`; walking pages instead reorders PMP groups whenever they span
pages, because file order is not page order. That order feeds `buildBlob`'s offsets and
`resolveDuplicates`' `common/N` assignment, so it is byte-visible.

It should nonetheless be inert, because both write paths already use page order — `writePmp` via
`orderedGroups = pages.flatMap(p => p.groups)` (`pmp.ts:687`), and TTMP because `data.groups` order
already equals page order there. Phase 1's corpus run is the proof, and this is the specific thing
it is proving.

## 4. Load seam

`ClearNulls` moves to its own module, `src/container/clear-nulls.ts`, porting
`WizardData.ClearNulls` (`:1234-1266`) alone. That un-blends `option-prefix.ts`: page construction
goes to `readPmp`, pruning to the new module, and the three prefix builders stay where they are.

- **`readTtmp2`, wizard path** — one `ModpackPage` per `ModPackPages` element, in array order. Per
  group: `FromWizardGroup`'s zero-option `return null` (`:749-753`, which precedes the Single
  backstop at `:755-757`), then `FromWizardModpackPage`'s `if (g == null) continue` (`:986`). A
  skip-the-push at the reader is the honest transcription here because that is what the C# caller
  does.
- **`readTtmp2`, simple path** — mirrors `FromSimpleTtmp:1204-1231`: one hand-built page and group,
  added unconditionally, **no** `clearNulls` call. Its one-option group cannot trigger the early
  return, so the null it would otherwise leak is unreachable; noted in a comment, not guarded.
- **`readPmp`** — direct transcription of `FromPmp:1118-1159`: the Default page iff
  `!IsEmptyOption`; pages `0..pageMax`; the **unconditional** add at `:1156`, preserving the page
  off-by-one (`docs/TEXTOOLS_BUGS.md` #7) and letting nulls into `page.groups`; then `clearNulls`.
  `isEmptyDefaultOption`'s `o.raw` workaround (`option-prefix.ts:83-97`) simplifies away — it exists
  only because the check currently runs at write time against a `canImport`-filtered model, and at
  load we hold the raw `default_mod.json` directly, exactly as `pmp.DefaultMod.IsEmptyOption` does.
- **`readLegacyTtmp`** — builds its single page the same way.

`FromWizardTtmp` does **not** call `ClearNulls`; only `FromPmp` does. Reproduce that asymmetry.

## 5. The divergence

Operator's adjudication, 2026-08-03: **diverge — do not reproduce the NRE.** Against AGENTS.md's
three-part user-benefit bar:

1. **Registered defect** — yes. An unguarded null dereference on a list the same method is about to
   prune nulls from is a defect, not a transcribed quirk. Registered as `docs/TEXTOOLS_BUGS.md` #22,
   status `diverged`.
2. **Exercised over the corpus, every moved byte accounted for** — §6. No real pack reaches it; the
   synthetics do, and their bytes are accounted for by a paired real golden rather than by tolerance.
3. **Verified in the real game that our output is better** — inapplicable *by the measurement*, and
   this is the point rather than a waiver. TexTools produces **no file at all**. There is no output
   to compare against and no degraded mod to inspect: any correct pack is better than none. What
   requirement 3 exists to prevent — us confidently shipping something TexTools does differently and
   better — cannot arise where TexTools ships nothing.

Sited in `clear-nulls.ts`, where the C# crashes:

```ts
// DELIBERATE DIVERGENCE. WizardPageEntry.HasData is `Groups.Any(x => x.HasData)`
// (WizardData.cs:969-975) — a null deref the moment Any reaches a null group. Measured
// 2026-08-03: ConsoleTools /upgrade exits -1 with NO output whenever a zero-option group is
// FIRST on its page; a preceding data-carrying group shields it because Any short-circuits.
// We treat a null as "no data" so the pack upgrades instead. docs/TEXTOOLS_BUGS.md #22;
// confirmed by ORACLE_ERROR_DIVERGENCE_RULES, not suppressed by a baseline.
const pageHasData = (p: ModpackPage): boolean =>
  p.groups.some((g) => g !== null && groupHasData(g));
```

Note what is **not** diverged: the group-level prune (`:1249`) is already null-safe in the C# and is
ported verbatim, and the page off-by-one is reproduced untouched. The divergence is exactly one
predicate.

## 6. Write seam

C# runs `ClearNulls` at load **and** again at write; reproduce both calls rather than picking one.

- **`writeTtmp2`** — `clearNulls` per `WriteWizardPack:1334`, then skip `!pageHasData` pages and
  number survivors with the dense counter (`:1348-1357`). Today's `byPage` map, its
  `[...byPage.keys()].sort()`, and `PageIndex: g.page` are all gone by the end of Phase 2;
  iteration is over `data.pages` in order throughout. In Phase 1 the writer still bucketed by page
  and emitted the transitional `sourcePageIndex` (§2) to stay byte-neutral — Phase 2 is where that
  field is read for the last time and then deleted.
- **`writePmp`** — `clearNulls` at the `WritePmp:1462` seam; its `buildPages(data)` calls are
  removed, which also closes `docs/backlog/2026-07-13-buildpages-called-twice.md`.

## 7. Fixtures and confirmation

A new builder, `scripts/generate-synthetics/build-synthetic-empty-group.ts`, emits the probe shapes
so every measurement in §1 is re-run by the suite. TTMP page structure is a **writer** behaviour, so
those fixtures prove out through `/resave` — our writer oracle — because a dummy-gamePath `/upgrade`
no-ops and would compare our output against the unchanged input, showing nothing.

| fixture | root | oracle |
| --- | --- | --- |
| `empty-group-shielded.pmp`, `empty-group-default-shielded.pmp` | `synthetic` | ordinary `/upgrade` golden — proves the drop against real TexTools output |
| `empty-group-first.pmp`, `empty-group-page1.pmp` | `upgrade-error` | oracle NREs (exit -1, no output) |
| `empty-group-first-sibling.pmp`, `empty-group-page1-sibling.pmp` — identical but for the zero-option group's `group_NNN.json` | `synthetic` | ordinary golden — supplies the paired expected bytes |
| `empty-page0.ttmp2`, `sparse-pageindex.ttmp2`, `out-of-order-pages.ttmp2`, `duplicate-pageindex.ttmp2` | `synthetic` | `/resave` |

### 7.1 A reason-matched rule, not a per-pack baseline

`test/helpers/corpus-upgrade.ts:62` today treats "oracle errored but our upgrade SUCCEEDED" as a
hard failure. It gains a third outcome, gated on a new `ORACLE_ERROR_DIVERGENCE_RULES` list beside
`DIVERGENCE_RULES` in `test/helpers/upgrade-compare.ts`. Each rule carries its cited reason, a
predicate over the captured **oracle trace signature**, and a `confirm`.

Keying on the trace signature — here the `WizardPageEntry.<get_HasData>` NRE frame — is what makes
one rule cover every pack that trips this bug, today's synthetics and tomorrow's uploads alike, with
nothing blessed individually. Operator's requirement, 2026-08-03. A pack whose oracle error matches
no rule stays a hard failure, exactly as now.

`confirm` requires our output on the crashing pack to **byte-match the golden of its declared
sibling** — the same pack minus the zero-option group's json. That proves the divergence yields
precisely what TexTools would have produced had the crash-triggering group not been there, with
byte coverage from the real oracle and no hand-authored expectations.

The pairing is sound because removing the group's json and `ClearNulls` pruning its null converge on
the same surviving page set: `ClearNulls` also drops group-less pages, so the extra page a higher
`pageMax` would have created is pruned anyway. Rows 2 and 4 of §1.2 are the independent check —
they are the same shapes with the group *shielded*, where TexTools does produce output, and they go
through the ordinary golden path with no rule involved.

The pairing is declared by the builder, not derived at runtime by the harness; deriving it would
need zip-mutation machinery and an extra cached oracle spawn for no additional signal on inputs we
author ourselves.

## 8. Deletions

Both now-dead guards and their comments — `ttmp2.ts:184-190` and `pmp.ts:258-264`, whose
`options.length > 0` clauses exist solely because the early return was unported. Both unit tests
that pin the current behaviour are rewritten to assert the group is **absent** rather than
present-and-empty:

- `test/container/ttmp2-selected.test.ts` — "a zero-option Single group does not trip the backstop"
- `test/container/pmp-selected.test.ts` — "Single: a zero-option group does not trip the backstop"

Backlog: delete `docs/backlog/2026-07-20-empty-group-not-dropped.md` and
`docs/backlog/2026-07-13-buildpages-called-twice.md` with their index entries, after grepping `src/`,
`test/`, `scripts/` and `docs/` for inbound references — both are cited from code comments today.

One pre-existing citation error to correct while rewriting these files: `option-prefix.ts`'s header
says its two faithfully-ported bugs are `docs/TEXTOOLS_BUGS.md` **#1 and #6**. #6 (the
non-incrementing group-folder collision loop) is right; the `FromPmp` page-index off-by-one is **#7**,
not #1 — #1 is `UpgradeRemainingTextures`' null texture deref, unrelated. Found 2026-08-04 while
writing this spec.

`docs/backlog/2026-07-13-split-writepmp-module.md` is **not** closed by this work, but overlaps it:
its warning that a mechanical refactor there risks byte-parity regressions with no new test signal
applies to Phase 1 as well, and is why Phase 1 is separated and required to be byte-neutral.

## 9. Follow-ons

- `MetaRoot.slot` and `ModpackGroup.defaultSettings` are both recorded as write-only/unread fields
  awaiting a keep-or-drop decision. Deleting `ModpackGroup.page` here sets a precedent for both but
  does not decide them; they stay filed.
- Whether `readTtmp2` should preserve the source `PageIndex` anywhere for a direct model consumer is
  deliberately answered "no": `WizardGroupEntry` and `WizardPageEntry` carry no such field, nothing
  reads it, and the writer re-derives it.
