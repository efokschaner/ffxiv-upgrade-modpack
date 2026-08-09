# 23. `LoadPMP`'s ExtraFiles scan iterates the stale v3 `groups` list, duplicating a v4 pack's whole payload on save

> **Raised with upstream, informally (noted 2026-08-08).** The operator has mentioned this bug to the
> TexTools developers in Discord, drawing on the standalone write-up this entry has since absorbed
> (`docs/upstream/2026-08-06-textools-pmp-v4-extrafile-duplication.md`, deleted 2026-08-08 once it had
> served its purpose — its reproduction, observed output and suggested patch are the *Reproduction*
> and *Upstream fix* sections below). That was a conversation, not a tracked issue: no upstream
> ticket, acknowledgement or fix is recorded here, and the pinned oracle (`8e2a2603`, v3.1.1.4) still
> contains the defect. **This does not move any of the three evidence bars below** — in particular it
> is not bar 3, which is an in-game observation and nothing else.

**Status:** diverged — we deliberately do **not** reproduce this. Operator ruling, 2026-08-06
(*"it's a pretty gross bug"*). Reproducing it would hand the user a modpack roughly twice its
necessary size on the one path that reaches it (`/resave` — see *Reachability*). · **Where:** `PMP.cs · LoadPMP · 191-208` (builds the list) vs `· 217-225` (assigns
a different one) vs `· 234` (iterates the stale one) vs `· 279-280` (misclassifies). See
`src/container/pmp.ts` (`readPmp`'s `referencedKeys` block).

**What happens:** `:217-225` pulls Penumbra v4's inline data back into the v3 in-memory shape —
`pmp.Groups = meta.Groups`, `pmp.DefaultMod = meta.DefaultData` — but never touches the local
`groups` variable built from `group_*.json` at `:191-208`. The `allPmpFiles` scan at `:234` iterates
**`groups`**, not `pmp.Groups`. For a v4 pack that list is empty, so no inline group contributes a
single `Files` value; only `pmp.DefaultMod` does, via the separate (and correct) block at
`:267-276`.

**Consequence:** every payload member referenced solely by an inline group fails the
`!allPmpFiles.Contains(x)` test at `:279` and is recorded as an ExtraFile. `WizardData.WritePmp`
copies every ExtraFile into the output verbatim, at its **original** relative name
(`WizardData.cs:1496-1507`, `Path.Combine(tempFolder, file.Key)` — `file.Key` being the load-time
relative path stashed at `:1124-1126`), *and* the group loop (`:1602-1619` →
`PopulatePmpStandardOption`, `PMP.cs:1001-1003`) writes the same bytes again at their **regenerated
dedup** name. Two different names, so neither overwrites the other: a v4 → v4 `/resave` emits the
entire payload **twice**.

The same stale read has a second, opposite arm: for a *hybrid* pack (inline `meta.Groups` **and**
on-disk `group_*.json`), the discarded disk groups' `Files` values still count as referenced, so a
member only they name is wrongly kept *out* of ExtraFiles — and, its group having been discarded, is
then written by nothing at all and is lost.

**Reachability — and it is gated, so the symptom is not uniform.** Two independent gates:

1. **`/upgrade` cannot reach it at all.** `ModpackUpgrader.cs · UpgradeModpack · 218-241` either
   refuses a v4 input (`.pmp`/`.ttmp2` destination, `:232`) or raw-copies it (folder destination,
   `:237`) before `LoadPMP` ever ingests a v4 file for upgrade.
2. **`WizardData.ExtraFiles` is *only ever read* by the copy at `WizardData.cs:1496`, and that copy
   is gated on `saveExtraFiles`, which defaults `false`** (`WritePmp`, `:1479`; `WriteModpack`,
   `:1331`). Grepping the field confirms it has no other reader (`:1094` declares, `:1124-1126`
   populates, `:1496`/`:1498` consume). So:
   - **`saveExtraFiles == true` → the bug bites.** Only three call sites pass it:
     `ConsoleTools/Program.cs:211` (`/resave` — and note `:204`'s `WizardData.FromModpack(src)` takes
     the **default** `enforceCompatibility = false`, which is exactly why `/resave` ingests a v4 pack
     at all), `ModpackUpgrader.cs:246` and `FFXIV_TexTools/Helpers/ModpackUpgraderWrapper.cs:99` (both
     on the upgrade path, which gate 1 already keeps a v4 pack away from). **`/resave` is therefore
     the one live path**, and there the payload doubles.
   - **`saveExtraFiles == false` → the misclassification is inert.** The GUI exporters
     (`FileListExporter.xaml.cs:279`, `StandardModpackCreator.xaml.cs:424`,
     `ExportWizardWindow.xaml.cs:471`, all bare `WritePmp(path)`) and the import wizard's save
     (`ImportOnlyWindow.xaml.cs:251`, bare `WriteModpack(path)`) never read `ExtraFiles`, so a
     misclassified member is neither duplicated **nor dropped** — the group loop still writes it once,
     correctly, from `pmp.Groups`. Nothing observable happens on those paths.

   The hybrid arm follows the same gate: the member it loses would only ever have been preserved by
   the `saveExtraFiles == true` copy, so it too is a `/resave`-only loss.

**Reproduction** (measured 2026-08-06 against `8e2a2603`; this is the shape
`scripts/generate-synthetics/build-synthetic-pmp-v4.ts` builds). A minimal v4 `.pmp` — a zip of
exactly three members, `meta.json` plus `files/v4_group.bin` (`A1 A2 A3 A4`) and `files/v4_default.bin`
(`B1 B2 B3 B4`) — whose `meta.json` carries `FileVersion: 4`, one inline `Groups` entry with a single
option mapping `chara/dummy/v4_group.bin` → `files\v4_group.bin`, and a `DefaultData` mapping
`chara/dummy/v4_default.bin` → `files\v4_default.bin`. Run `ConsoleTools.exe /resave <in> <out>` and
list the members:

```
meta.json                                973 bytes
default/chara/dummy/v4_default.bin         4 bytes
files/v4_group.bin                         4 bytes   <-- duplicate
v4 payload/chara/dummy/v4_group.bin        4 bytes
```

The two `v4_group.bin` members are byte-identical, and nothing in the written `meta.json` points at
`files/v4_group.bin` — the option entry reads
`"chara/dummy/v4_group.bin": "v4 payload\\chara\\dummy\\v4_group.bin"` — so Penumbra never reads the
duplicate. **The asymmetry is the proof:** `files/v4_default.bin` is *absent* from the output,
because `DefaultData`'s file was classified correctly by the separate `pmp.DefaultMod` scan
(`:267-276`) and so was written once. Same pack, same save, two outcomes; the only difference is
which of the two scans saw the file.

Two details of the input are load-bearing, and a repro that omits either shows nothing. The two
payload files must have **different contents** — identical bytes are collapsed onto one shared path
by the content-hash pass in `PMPExtensions.ResolveDuplicates` (`PmpExtensions.cs:476`). And the
archive member names must **differ from the paths TexTools regenerates** (`<option folder>/<game
path>`), or the duplicate lands on the same name and overwrites invisibly.

**Impact.** A `/resave`d v4 pack carries a redundant copy of every inline-group payload file whose
archive path differs from the regenerated one — the normal case, since a pack is only laid out that
way if TexTools itself wrote it. For a typical pack, where the bulk of the payload sits in groups
rather than `DefaultData`, the output is roughly **twice** the necessary size. It does *not* compound
across repeated re-saves (the second pass regenerates the same paths and overwrites in place), and by
code trace the pack still installs and behaves correctly in Penumbra, the duplicated members being
unreferenced — size and confusion, not breakage. That last point is exactly what bar 3 below has to
confirm in-game rather than infer.

**Us:** `readPmp` fills `referencedKeys` from the groups it **actually loaded** — the one-variable
swap that constitutes the upstream fix. Two arms, both intended: an inline group's `Files` now count
as referenced (so its member is emitted once, not twice), and a hybrid pack's *discarded*
`group_*.json` values no longer do. The divergence is called out in full at the site
(`src/container/pmp.ts`, the boxed `INTENTIONAL DIVERGENCE` comment in `readPmp`).

**Evidence status (`AGENTS.md`'s three bars for a user-benefit divergence):**

| bar | state |
| --- | --- |
| 1. registered defect, adjudicated a genuine bug | **met** — this entry, operator ruling 2026-08-06 |
| 2. exercised over the corpus, every moved byte confirmed by a rule | **met** — `test/corpus/synthetic/pmp-v4-extrafiles.pmp` exercises the bug over the real oracle, and `test/helpers/pmp-v4-extrafile-divergence.ts` confirms the resulting golden-only payload member narrowly |
| 3. verified in the real game that our output is better | **outstanding** — manual, not yet performed, and not implied by anything above |

Shape-pinned meanwhile by `test/container/pmp-v4.test.ts` (both arms). See the note at the top of
this entry for how far this has been taken with the maintainers.

**Upstream fix:** iterate the list the pull-back actually populates —

```diff
- foreach (var g in groups)
+ foreach (var g in pmp.Groups)
```

— at `:234`. Equivalently, have `:220` assign the local `groups` list as well, so the two can no
longer disagree. **v3 is unaffected:** for a v3 pack `meta.Groups` is empty and `meta.DefaultData` is
null, so the pull-back at `:217` does not fire and `pmp.Groups` is still the list assigned at `:214`.

One consequence to be aware of, for the mixed input shape (on-disk `group_*.json` members *and* a
firing pull-back). That guard is wider than "has inline groups": a non-null `meta.DefaultData` fires
it on its own, and `:220` then assigns `meta.Groups ?? new List<PMPGroupJson>()` — so the on-disk
groups are dropped from `pmp.Groups` either way, whether replaced by an inline set or by an empty
list. For such a pack, those discarded groups' files are today counted as referenced by `:234` (which
is still reading the on-disk list) even though nothing downstream writes them; after the fix they are
no longer counted, so they become extra files. That is the accurate classification — nothing in the
written output points at them — but it is a behaviour change for that unusual input shape.
