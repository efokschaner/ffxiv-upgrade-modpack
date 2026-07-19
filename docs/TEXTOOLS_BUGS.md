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
`backlog/2026-07-08-mtrl-empty-sampler-placeholders.md`.

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
the write-time drop. We do reproduce it, now that `ResolveDuplicates` is ported (see the "Us:"
paragraph below).

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

**Status:** **worked around** · **Where:** `PMP.cs:873-875` (see
`src/container/resolve-duplicates.ts`, `src/container/pmp.ts`)

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

**Us:** `resolveDuplicates` does **not** reproduce this bug, and does **not** fail loud on it either
— we deliberately preserve every FileSwap the source pack carries (`src/container/pmp.ts:437-445`,
`base.FileSwaps = o.fileSwaps`) rather than modelling TexTools' *read-side* placeholder mechanism
(`UnpackPmpOption`, `PMP.cs:1104-1137`, which needs a live game index we don't bundle) or reproducing
the write-side drop. This is the first divergence justified under AGENTS.md's user-benefit principle
rather than plain TexTools byte-parity: a FileSwap is a live redirection in Penumbra's runtime model
(`SubMod.AddContainerTo`, Penumbra repo `Mods/SubMods/SubMod.cs:23-32` — a separate repo from this
project's `reference/`), so reproducing the write-time drop would hand
the user a modpack quietly missing functionality. The resulting divergence (our `FileSwaps` populated
where the golden's is always `{}`) is confirmed against the oracle by a scoped carve-out in the golden
harness (`dropConfirmedAbsentKeys`, `test/helpers/upgrade-archive-diff.ts`), not by a ratchet
baseline — see `docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md` for the full
analysis, including why no bundled game index is needed and the `common/N` dedup-numbering side
effect (entry 8, above) this creates.

**The harm is observed, not theorised.** In-game verification 2026-07-19 (AGENTS.md's first
principle, requirement 3) against `torn bassment glow.pmp`: both packs load in Penumbra, and **a
material loads successfully from our output that FAILS to load from TexTools' output** — the swaps
that resolved its textures having been destroyed on write.

The mechanism, recorded so the observation is reproducible rather than testimony. The packed
material `chara/equipment/e0246/material/v0001/mt_c0101e0246_top_a.mtrl` references three textures,
**all three supplied by FileSwaps** (`..._top_n_afadde89.tex`, `..._top_m_0b26c9b8.tex`,
`..._top_id_f6bf57ea.tex`, swapped from the corresponding `e6120` textures). Those hash-suffixed
destination paths are TexTools' own item-swap feature minting unique names so the swapped item
cannot collide with real `e0246` gear — and checked against the 040000 index they are **absent from
the game**, while all three swap sources exist. So they are backed by nothing unless the swap
supplies them; there is no base-game fallback, because a suffixed name is not a base-game name.
Dropping the swaps leaves the material pointing at three addresses that resolve to nothing — a hard
load failure, not a degraded appearance. **TexTools' writer thus destroys exactly the data its own
item-swap feature depends on.** Verified against `/resave` rather than
`/upgrade`, because ConsoleTools no-ops on every swap-carrying pack available; `/resave` is the same
write path minus the transform (`Program.cs:191-221`) and this function sits in it, so the
destruction shown there is the destruction any writing `/upgrade` performs.

**Upstream fix:** either serialize `files`' original FileSwaps back into `opt.FileSwaps` in
`PopulatePmpStandardOption` (matching `opt.Files`/`opt.Manipulations`'s treatment), or — if dropping
them is intentional (e.g. because a swap's target may no longer resolve against the current game
version) — log or surface that loss to the user instead of doing it silently.

---

## 11. `ReadSqPackType3` over-allocates the model buffer by one header, appending 68 stray zero bytes

**Status:** reproduced · **Where:** `Dat.cs:801` (and `:699`) vs `Mdl.cs:2259` (see
`src/sqpack/type3.ts`, `decodeType3`)

`ReadSqPackType3` sizes its output buffer as `new byte[baseHeaderLength + decompressedSize]`
(`Dat.cs:801`, `baseHeaderLength = 68` at `:699`). But `decompressedSize` — the entry-header field at
offset 8 — is **already** the model's true decompressed size *including* the 68-byte runtime header.
The encoder proves it: `CompressMdlFile` writes `uncompressedSize = _MdlHeaderSize + vertexInfoBlock +
modelDataBlock + vertexDataSizes + indexDataSizes` (`Mdl.cs:2259`, `_MdlHeaderSize = 68`), i.e. exactly
`68 + content`, which is correct. The decoder then adds `baseHeaderLength` (68) a **second** time,
over-allocating by one header and leaving 68 trailing zero bytes that no offset or size in the header
points at. This is a defect in TexTools' own decoder, not transcribed SE/format weirdness — the encoder
and decoder simply disagree about whether `decompressedSize` counts the header.

The fault is confined to the decoded (unwrapped) representation and is **not externally visible**: the
padding is never stored in a compressed entry — `CompressMdlFile` slices its inputs by the header's
offsets/sizes, never reads past `content`, and recomputes `decompressedSize` back to `68 + content` —
so it is dropped on any re-compress and never appears in an emitted `.dat` or modpack. Its only
observable trace is that `ReadSqPackType3` returns 68 bytes more than the file's own declared size, and
that — because the zeros are regenerated on every decode — `decode(encode(x))` is non-idempotent for a
model that entered un-padded (a PMP stores each `.mdl` at its true `68 + content` size and gains the 68
zeros on first decode).

**Us:** `decodeType3` reproduces the over-allocation verbatim, because ConsoleTools `/unwrap` emits the
same 68 zeros and our decompressed-content byte-parity bar requires matching it. The corpus
self-round-trip check tolerates the resulting +68 growth on un-padded (PMP) models, asserting it is
*exactly* a run of 68 trailing zeros and nothing else (`test/helpers/corpus-sqpack.ts`,
`isTrailingZeroGrowth`). Our own `/upgrade` output is unaffected — nothing we write carries the padding.

**Upstream fix:** allocate `new byte[decompressedSize]` — the field already includes the header, so the
extra `baseHeaderLength` term is the whole bug. Purely a buffer-sizing correction: it removes the stray
zeros without altering any real model bytes.

---

## 12. `UpdateUnclaimedHairTextures` swallows every transform exception (bare catch)

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:1498-1501` (see
`src/upgrade/unclaimed-hair.ts`, the transform `try`/`catch` after the raw-copy step)

After copying a rescued hair/tail/ear texture pair to its canonical Dx11 destinations
(`:1478-1492`), the function calls `UpdateEndwalkerHairTextures` inside a bare
`catch (Exception ex) { Trace.WriteLine(ex); continue; }` (`:1495-1502`). That catch-all masks
not just the one condition we model explicitly (a resize/resample the C# would need — our
`TextureResizeUnsupported`) but **any** exception the transform can throw, including a genuinely
corrupt or malformed loose texture that fails to parse. Either way the failure is logged (or, in
our port, simply dropped) and the loop moves on, leaving the untransformed **raw** copies already
written in place — silently shipping a pixel-untransformed pair with the new Dawntrail paths.

**Us:** reproduced verbatim — a bare `catch { continue; }` around the transform, so any transform
failure (the modeled resize gap or an unmodeled corrupt-input failure) leaves the raw copies
already written above untouched, matching the C#'s "log and move on" outcome.

**Upstream fix:** catch only the specific expected condition (e.g. a resize-required signal), and
either log-and-skip explicitly for that case or let a genuinely unexpected exception (a corrupt
input) surface instead of silently swallowing it.

---

## 13. `UpdateEyeMask` passes a possibly-null `ResolveFile` result straight into `FromUncompressedTex`

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:2030-2032` (see `src/upgrade/eye-mask.ts`,
`updateEyeMask`)

`ResolveFile` returns null whenever the mask file's bytes cannot be resolved or decoded
(`EndwalkerUpgrade.cs:1761-1774` — an absent `RealPath`, or a decode failure caught and folded to
null). `UpdateEyeMask` takes that result and passes it directly into
`XivTex.FromUncompressedTex(data)` with no null check (`:2032`), which throws an
`ArgumentNullException` from `new MemoryStream(texData)` (`XivTex.cs:96`) — the same class of
unguarded-null-into-constructor defect as entry 1 (`GearMaskNew`), at a different call site with a
different exception type (`ArgumentNullException`, not NRE, since the null is passed as a
constructor argument rather than dereferenced directly).

**Us:** `updateEyeMask` throws when `resolveFile` returns null for the mask, citing this entry and
`XivTex.cs:96` at the throw site — fail-loud is faithful here, matching TexTools' own crash.

**Upstream fix:** null-check `ResolveFile`'s result before calling `FromUncompressedTex`, matching
the guard the sibling `GearMaskLegacy` branch (entry 1) already has.

---

## 14. `UpdateEyeMask` dereferences a `FirstOrDefault` that can return null for `TexturePath`

**Status:** reproduced · **Where:** `EndwalkerUpgrade.cs:2056-2059` (see `src/upgrade/eye-mask.ts`,
`updateEyeMask`)

`baseMaterial.Textures.FirstOrDefault(x => x.Sampler?.SamplerId == ... g_SamplerDiffuse)` can
legitimately return null when the iris material binds no diffuse sampler; the very next line
dereferences `mtrlTex.TexturePath` unconditionally (`:2059`), throwing a
`NullReferenceException`. Unlike entry 3 (an unguarded *scan predicate*), this is an unguarded
*result* dereference after a `FirstOrDefault` whose null case is the whole point of that LINQ
method — the same shape as entry 2's `normalTex.Dx11Path`, at a different call site.

**Us:** our eye-material lookup table (`EyeMaterialTable`, `src/upgrade/reference/eye-materials-types.ts`)
records that case as `diffusePath === undefined`, and `updateEyeMask` throws citing this entry
when it sees it — fail-loud in place of the NRE, since there is no cross-material fallback to
substitute.

**Upstream fix:** null-check `mtrlTex` before dereferencing `TexturePath`, and either skip the
material or surface a clearer error naming the missing sampler.

---

## 15. `RepathHairMashups`' sampler scan dereferences `x.Sampler.SamplerId` unguarded

**Status:** reproduced · **Where:** `ModpackUpgrader.cs:406-408` (and the sibling highlight-half scan
at `:294-295`) — see `src/upgrade/repath-hair-mashups.ts` / `src/upgrade/resolve-highlight.ts`,
`findSamplerUnguarded`

`RepathHairMashups` finds its normal/mask/diffuse textures with
`Textures.FirstOrDefault(x => x.Sampler.SamplerId == ...)` (`:406-408`), reading `x.Sampler.SamplerId`
with no null guard — the same defect class as entry 3, at a different call site. A texture that bound
no sampler NREs mid-scan. `ResolveHighlightOptionsAndMashupHair`'s highlight half does the identical
unguarded scan (`:294-295`), but there the enclosing `try/catch` (`:301-304`) folds the NRE into "skip
this .mtrl"; `RepathHairMashups` has **no** try/catch, so the NRE propagates and aborts the whole
`/upgrade`.

**Us:** both sites share `findSamplerUnguarded` (`resolve-highlight.ts`), which throws when it reaches
a null-sampler texture before a match — `Array.find` order decides the outcome, mirroring
`FirstOrDefault`. The highlight-half caller wraps it in a skip; `repathHairMashups` does not, so the
throw propagates, matching TexTools' uncaught NRE. Latent: real hair/`zear`/`tail` materials always
bind their samplers (no corpus/library mod reaches it).

**Upstream fix:** guard the scan (`x.Sampler?.SamplerId`) like entry 3's siblings, and — for
`RepathHairMashups` specifically — decide whether an unbound sampler should skip the material rather
than abort the run.
