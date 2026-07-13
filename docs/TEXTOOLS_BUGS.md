# TexTools bug register

Bugs and mistakes in **TexTools / xivModdingFramework / ConsoleTools** that this port meets and
must decide what to do about.

We do **not** fix them here. `AGENTS.md` is explicit: TexTools is the spec, byte-parity with its
`/upgrade` output is the definition of correct, and a "fix" is a divergence from the golden. So the
port reproduces the buggy behaviour faithfully and records the bug here — this file is the register
of every place we knowingly did that, and the shortlist we could take upstream as patches or issues
if we ever choose to.

**Add an entry when** you port (or deliberately decline to port) behaviour that is a defect rather
than a design choice: a null dereference, an unreachable guard, a comparison that can never match, a
loop that cannot terminate, an exit code that lies. Ordinary SE/format weirdness that TexTools
merely *transcribes* — an odd race order, a hard-coded set-0 rule — is a **quirk**, not a bug; leave
those in the code comments where they are, unless the transcription itself is wrong.

**Each entry states:** what is wrong, the C# citation, what it does to us, what we do about it, and
what an upstream fix would look like.

> **Status legend** — `reproduced`: our port deliberately mirrors the bug. `not reached`: the buggy
> code is in a path we don't port, recorded so nobody "discovers" it later. `gap`: we do **not**
> reproduce it yet and fail loud instead (a known parity hole). `worked around`: we neither reproduce
> nor fail loud — the harness absorbs the symptom by other means (see the entry for how) rather than
> our port mirroring the buggy behaviour itself.

---

## 1. `UpgradeRemainingTextures` dereferences a null texture in the `GearMaskNew` branch

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:1865-1889` (see `src/upgrade/texture.ts`, the GearMaskNew branch)

The `GearMaskNew` branch resolves the old mask and passes it straight into `UpgradeMaskTex`
*before* checking it for null:

```csharp
var data = await ResolveFile(upgrade.Files["mask_old"], files, null);
data = await UpgradeMaskTex(data);          // :1870 — NRE when data == null
if (data != null) { await WriteFile(...); } // :1871 — the check comes too late
```

The sibling `GearMaskLegacy` branch immediately below (`:1882-1887`) checks null *first* and skips
cleanly. The asymmetry is plainly unintended: `ResolveFile` returns null whenever the file's
`RealPath` is missing on disk (`:1765`) — which happens for real, in the wild, whenever a PMP's
`Files` map names a payload the archive never contained. `UpgradeMaskTex` then calls
`XivTex.FromUncompressedTex(null)` (`:2084`), which throws an `ArgumentNullException` — not an
NRE — from `new MemoryStream(texData)` (`XivTex.cs:96`), which `ModpackUpgrader` catches and
rethrows as a wrapped failure (`ModpackUpgrader.cs:137-141`), killing the whole `/upgrade`.

**Us:** an absent file must therefore make our `GearMaskNew` path throw, while `GearMaskLegacy`
skips. Fail-loud is faithful here — TexTools fails the pack too.

**Upstream fix:** move the null check above the call, matching `GearMaskLegacy`.

---

## 2. `UpdateEndwalkerMaterial` dereferences an unresolvable Normal texture

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:912-921` (see `src/upgrade/material.ts:135`)

`normalTex.Dx11Path` is dereferenced unconditionally, so a colorset material with no resolvable
Normal texture throws an NRE. The per-material `try/catch` in `UpdateEndwalkerMaterials`
(`:522-539`) swallows it, so the file is left **byte-untouched** — `WriteFile` (`:1069`) is never
reached.

**Us:** `upgradeMaterial` throws on that shape and `materialRound` catches it, leaving the file
untouched. Reproducing the *outcome* (untouched bytes) is what byte-parity requires; "fixing" it
would rewrite a material TexTools leaves alone.

**Upstream fix:** null-check the sampler and skip (or stub) the material explicitly, rather than
relying on an exception to abandon it.

---

## 3. Unguarded sampler scan in the spec/diffuse lookup

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:1028-1029` (see `src/upgrade/material.ts:211`)

The spec/diffuse scan reads `x.Sampler.SamplerId` with no null guard, unlike the mask lookups above
it (`:975` / `:1011`), which guard with `x.Sampler != null`. A texture that bound no sampler NREs
mid-scan, and the per-material `try/catch` abandons the material byte-untouched.

**Us:** we scan without `?.` and throw before a match if a null-sampler texture is reached first —
`Array.find` order matters, so the *position* of the null-sampler texture decides the outcome, and
we mirror that.

**Upstream fix:** guard the scan like its siblings do.

---

## 4. Empty-sampler exclusion checks can never match (case mismatch)

**Status:** **gap** — we fail loud instead · **Where:** `Mtrl.cs:560` vs `:577` / `:593` / `:627` / `:719`

`XivMtrlToUncompressedMtrl` lowercases every texture path (`:560`) *before* comparing it against the
`_EMPTY_SAMPLER_` prefix constant (`Mtrl.cs:70`), which is **uppercase**. The comparison can never
succeed, so every exclusion check that was meant to drop empty-sampler placeholders is dead code and
C# **writes the placeholders into the output material**.

**Us:** `src/mtrl/serialize.ts` throws rather than emitting placeholders — a deliberate parity hole,
because pinning the exact bytes TexTools emits here needs a synthetic modpack that exercises it. See
`BACKLOG.md`.

**Upstream fix:** compare case-insensitively (or lowercase the constant). Note this would *change*
TexTools' output bytes, so it is a behavioural fix, not a cosmetic one.

---

## 5. `TTModel.GetMaterialIndex` folds "not found" to index 0

**Status:** reproduced · **Where:** `TTModel.cs:1419-1430` (see `src/mdl/model/tt-model.ts:224`)

Returns `index > 0 ? index : 0` — note `> 0`, not `>= 0`. A material that `IndexOf` fails to find
(`-1`) is silently mapped to material 0 rather than reported. (Index 0 itself round-trips correctly
by luck: it maps to 0 either way.)

**Us:** preserved verbatim.

**Upstream fix:** `>= 0`, with an explicit error (or an explicit documented default) for `-1`.

---

## 6. Group-folder collision loop cannot terminate

**Status:** **gap** — we throw rather than hang · **Where:** `WizardData.cs:1406-1409` (see
`src/container/option-prefix.ts`, `makeGroupPrefix`)

The loop that de-collides duplicate group folder names never increments its counter `i`, so two
groups whose names sanitize to the same folder AND whose first retry (`" (1)/"`) also collides
would spin forever recomputing the same candidate. (The sibling loop in `MakeOptionPrefix`,
`:1448-1453`, increments correctly — see below.)

**Us:** ported the loop condition as written (a single retry at `" (1)/"` succeeds silently, matching
the C#), but if resolving the collision would need a second retry we throw, citing this entry,
instead of hanging. `optionPrefixes` is unit-tested (`test/container/option-prefix.test.ts`) and
called by `writePmp` (`src/container/pmp.ts`) to regenerate every zip path from the model.

**Upstream fix:** increment the counter.

---

## 7. `FromPmp`'s page-index off-by-one merges page-0 groups onto the Default page

**Status:** reproduced · **Where:** `WizardData.cs:1118-1158` construction + `:1234-1244`
(`ClearNulls`' page-level pruning) — see `src/container/option-prefix.ts`, `buildPages`

When `default_mod.json` is non-empty, `FromPmp` unshifts a synthesized "Default" page onto the
FRONT of `DataPages` before appending one page per real page index `0..pageMax`. The group-assignment
loop right after still indexes `DataPages[g.Page]` with each real group's *raw*, unadjusted page
number — so a group meant for page 0 lands on `DataPages[0]`, which is now the Default page, not the
page just created for it; the page created for page 0 is left with zero groups.

That would inflate `DataPages.Count` and switch on the `pN/` prefix for the whole pack — except
`ClearNulls` (WizardData.cs:1234-1244) runs immediately afterward (`:1159`, inside `FromPmp` itself,
and again — redundantly — at `:1462` inside `WritePmp`) and drops any page with zero
data-carrying groups. For the common case (a single real page, `pageMax === 0`), that prunes the
now-empty created page right back out, so `DataPages.Count` ends up **unchanged** (still 1) and NO
`pN/` prefix appears. The bug's only surviving, observable effect is that the misrouted group's
files merge directly onto the Default page's folder (e.g. both `default/…` and `everything/a/…`
sit at the top level with no page prefix) instead of the group getting a page — and, in the page
sense — of its own. A naive reading of the C# (assuming `ClearNulls` merely nulls fields and never
removes pages) would predict `DataPages.Count === 2` and a `p1/`/`p2/` split instead; that reading is
wrong — `ClearNulls`' page-removal step (`if (!p.HasData) { DataPages.Remove(p); continue; }`,
`WizardData.cs:1240-1244`) is unconditional, not GUI-only (that distinction belongs to
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

---

## 8. Missing files all share the zero hash, perturbing dedup paths

**Status:** reproduced · **Where:** `PmpExtensions.cs:509-514` + `:537-551` (see
`src/container/resolve-duplicates.ts`)

`ResolveDuplicates` guards a file whose `RealPath` doesn't exist by assigning it a **default
(all-zero) `SHA1HashKey`** instead of hashing it. Two or more absent files therefore collide as
"duplicates": on the second (and any later) absent file, the dedup loop sees the zero hash already in
`seenFiles`, relocates the *first* absent file's path into `common/{idx}/…`, and increments the shared
`idx` counter (`:537-543`) — all of this happens in `ResolveDuplicates`, entirely before
`PopulatePmpStandardOption`'s write-time `!File.Exists` guard (`PMP.cs:883-888`) ever runs.

That write-time guard drops the absent files' own `Files` entries and payload bytes, but it does
**not** undo the `idx` increment their collision already consumed — `idx` is a local counter in a
different function, already spent by the time the drop happens. So with two absent files, the very
next **genuine** duplicate (two really-identical present files) is relocated into `common/2/…` instead
of `common/1/…` — an observable member-name difference between our output and TexTools' that survives
the write-time drop and would need reproducing if we ever port `ResolveDuplicates` (see `BACKLOG.md`).

**Us:** `resolveDuplicates` inserts the same all-zero sentinel hash for a byte-less
`ModpackFile` (`data === undefined`) and lets it dedupe against every other absent file, burning
`idx` values exactly as the C# does; a later genuine duplicate's `common/N` numbering shifts to
match. Pinned by `test/container/resolve-duplicates.test.ts` case 6. Absent files are still excluded
from the function's returned map — that is `PopulatePmpStandardOption`'s separate `!File.Exists`
guard (`PMP.cs:883-888`), which does not undo the `idx` this bug already spent.

**Upstream fix:** exclude missing files from the dedup set instead of hashing them to a shared
sentinel.

---

## 9. `/upgrade` reports success and a destination path it never wrote

**Status:** **worked around** · **Where:** `ConsoleTools/Program.cs:181,188` + `ModpackUpgrader.cs:216`

When the upgrade produces no changes, `rewriteOnNoChanges` is `false`, so **no output file is
written** — but the CLI still prints `"Upgraded Modpack saved to: {dest}"` and returns exit code
`0`. A caller that trusts either signal gets a path to a nonexistent file.

**Us:** the golden harness treats "exit 0 but no file on disk" as the no-op outcome and caches a
`<sha256>.noop` marker (`test/helpers/upgrade-golden.ts`); the pack is then compared against its own
input.

**Upstream fix:** only print the success line when a file was actually written, and/or report the
no-op distinctly.

---

## 10. `PopulatePmpStandardOption` silently destroys a pack's FileSwaps on write

**Status:** **gap** — we fail loud instead · **Where:** `PMP.cs:873-875` (see
`src/container/resolve-duplicates.ts`)

`PopulatePmpStandardOption` initializes `opt.FileSwaps = new()` (`:874`) alongside `opt.Files` and
`opt.Manipulations`, but unlike those two, nothing ever adds to it afterward — the function's body
(`:876-928`) only populates `opt.Files` (from `files`) and `opt.Manipulations` (from the metadata/
rgsp conversion and `otherManipulations`). This is the **only** writer of `PmpStandardOptionJson`
(`WizardData.WritePmp` → `PopulatePmpStandardOption` is the sole call site that builds an option's
JSON for the zip), so any option that came in with file swaps — a Penumbra mod that swaps one game
file for another instead of shipping a custom replacement — has that data unconditionally discarded
by TexTools' own writer. A round-trip through TexTools (`/resave`, or `/upgrade` when it needs to
rewrite the pack at all) silently drops a mod author's file swaps from the emitted pack, with no
warning and no error. That is a data-loss defect, not a transcribed SE oddity: nothing about game
data or a legacy format forces it, it's a writer that starts populating a field and then never
finishes the job for one of its three members.

**Us:** `resolveDuplicates` throws when an option carries a non-empty `FileSwaps` map, rather than
attempting to reproduce (or silently drop) file swaps. We can't reproduce TexTools' *read-side*
placeholder mechanism faithfully either (`UnpackPmpOption`, `PMP.cs:1104-1137`, needs a live game
index we don't have — see the throw site and `BACKLOG.md` for the full analysis), so failing loud is
the only option that doesn't risk shipping a silently-wrong pack. No corpus PMP currently carries any
FileSwaps (checked empirically, all 13 real corpus packs have `fileSwaps=0`), so this is latent.

**Upstream fix:** either serialize `files`' original FileSwaps back into `opt.FileSwaps` in
`PopulatePmpStandardOption` (matching `opt.Files`/`opt.Manipulations`'s treatment), or — if dropping
them is intentional (e.g. because a swap's target may no longer resolve against the current game
version) — log or surface that loss to the user instead of doing it silently.
