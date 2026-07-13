# PMP load-tolerance for genuinely-absent `Files` entries

**Date:** 2026-07-12
**Status:** Design — approved, pending implementation plan
**Roadmap:** hardens the PMP container reader/writer (`src/container/pmp.ts`, ported from
`Mods/FileTypes/PMP.cs`) and the upgrade rounds' read seam under the foundation roadmap
(`docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md` §8). Closes the last of
the three PMP load failures, after
`docs/superpowers/specs/2026-07-11-pmp-case-insensitive-file-resolution-design.md` (case-folding)
and `docs/superpowers/specs/2026-07-11-pmp-windows-path-normalization-design.md`
(trailing-dot/space stripping) — both of which fixed *resolution* bugs. This one is not a resolution
bug: the file genuinely is not in the archive.

## 1. Problem

Five real packs still fail loud with `pmp: missing file entry` (`BACKLOG.md`; re-derive with
`local-notes/scan-failed-loads.ts` + `local-notes/classify-fails.ts`). Their `Files` values name zip
paths absent from the archive under **any** Windows normalization — case-fold *and* trailing-dot/space
strip — i.e. the payload was never packed:

- Skelomae Custom Skeleton v3.3.0 (`.pmp`, ×2 — Skeleton + Devkit; `files/files/common/arachne/*.sklb`)
- `Hoodie Megapack 3 - 2.0.2.pmp` (`chara/equipment/e6033/model/c0201e6033_top.mdl` + a `designs/default` `.tex`)
- `[Nyameru]Cute Loop.pmp` (`chara/cuteloop2.pap`)
- `[Shy] Tactical Hoodie [DT].pmp` (`chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl`)

TexTools loads all five without complaint and `/upgrade`s each to a **noop** (verified against
ConsoleTools). We throw at load, so we cannot process them at all. Our loudness is wrong here: it is
loud about input TexTools reads happily.

## 2. What TexTools does (the spec)

Absent files are tolerated **structurally**, not by a single guard. Three mechanisms, all cited:

**Load keeps the entry, bytes or not.** `LoadPMP` (`PMP.cs:124`) performs no existence check.
`UnpackPmpOption` (`PMP.cs:1071-1102`) builds, for every `Files` entry, a `FileStorageInformation`
whose `RealPath = Path.Combine(unzipPath, file.Value)` — for an absent file, a path that simply does
not exist on disk. The option's `Files` dictionary is keyed by **game path** and still contains the
key. That containment is load-bearing (see below).

**Every read goes through `ResolveFile`, which returns null.** `EndwalkerUpgrade.ResolveFile`
(`:1758-1783`):

```csharp
if (files != null && files.ContainsKey(path))
{
    try
    {
        if (files[path].RealPath == null || !File.Exists(files[path].RealPath))
        {
            return null;
        }
        return await TransactionDataHandler.GetUncompressedFile(files[path]);
    } catch { return null; }
}
```

Each call site then decides for itself — and they do **not** agree. The table is the spec:

| Round | C# | Absent behaviour |
|---|---|---|
| material scan (`UpdateEndwalkerMaterials`) | `:495` `if (file == null) continue;` | **skip**, file untouched |
| model (`UpdateEndwalkerModel`) | `:252` `if (uncomp == null) return;` | **skip** |
| `IndexMaps` (`UpgradeRemainingTextures`) | `:1840` `ContainsKey` → `CreateIndexFromNormal` returns null data (`:1087`) → `:1843` `continue` | **skip** |
| `GearMaskLegacy` | `:1879` `ContainsKey` → `:1883` null-checked | **skip** |
| `GearMaskNew` | `:1867` `ContainsKey` → `:1870` passes null into `UpgradeMaskTex` → NRE | **throw** |
| `HairMaps` | `:1852` both keys `ContainsKey` → `UpdateEndwalkerHairTextures` `:1187` `throw new FileNotFoundException` | **throw** |

Two consequences worth stating explicitly:

- **The absent file must stay in the model.** The `IndexMaps` / `HairMaps` / `GearMask*` branches
  gate on `files.ContainsKey(path)`, which is **true** for an absent-on-disk file. In particular
  `HairMaps`' "one but not both" error (`:1858-1862`) counts an absent-on-disk normal as *present*.
  Dropping the entry at load would silently change which branch we take.
- **`GearMaskNew` throwing is a TexTools bug**, not a design choice — its sibling `GearMaskLegacy`
  null-checks the identical value three lines later. We reproduce it (`docs/TEXTOOLS_BUGS.md` §1).
  Both throw cases fail the entire `/upgrade` in TexTools too (`ModpackUpgrader.cs:137-141` wraps and
  rethrows), so fail-loud remains the faithful outcome.

**Write drops the file entirely.** `PopulatePmpStandardOption` (`PMP.cs:883-888`):

```csharp
if(!File.Exists(fi.Info.RealPath))
{
    // Sometimes poorly behaved penumbra folders don't actually have the files they claim they do.
    // Remove them in this case.
    continue;
}
```

The `continue` skips both `File.WriteAllBytes` (`:910`) and `opt.Files.Add` (`:914`) — so the written
pack has **neither the payload member nor the `Files` key**. The writer reaches that point safely
because `ResolveDuplicates` guards the missing file upstream (`PmpExtensions.cs:503-510`), assigning a
zero SHA1 rather than reading it (a bug in its own right — `docs/TEXTOOLS_BUGS.md` §7).

None of the five packs reaches the write path (all noop), so this rule is ported from the C# and
corroborated by a one-off `/resave` probe (§4), not observed in an `/upgrade` golden.

## 3. The fix

### 3.1 Model — an absent file has no bytes

`ModpackFile.data` becomes optional (`data?: Uint8Array`). An absent entry is a file with a
`gamePath`, a `pmpPath`, and no bytes — the exact analogue of a `FileStorageInformation` whose
`RealPath` points nowhere. We do **not** invent an empty buffer: empty bytes would decode-fail deep
inside a codec instead of skipping cleanly, which is the opposite of what C# does.

`data` has only four consumers today (`pmp.ts:276`, `texfix.ts:69`, `ttmp2.ts` `buildBlob`,
`upgrade.ts:66-72`), so the type change is what forces each one to state its behaviour.

### 3.2 Load — `readPmp` tolerates, and keeps the entry

`optionFromJson` (`src/container/pmp.ts:44-77`) stops throwing `pmp: missing file entry` when the
`windowsPathKey` lookup misses; it emits the `ModpackFile` with no `data`. The entry stays in
`option.files` — required by the `ContainsKey` semantics in §2. `windowsPathKey` is **exported** so
the harness can reuse the one definition (§4.1).

### 3.3 Read seam — port `ResolveFile`

`uncompressedBytes` (`src/upgrade/upgrade.ts:66-72`) becomes the port of `ResolveFile`: it returns
`null` when the file has no bytes. Each round then mirrors its C# call site from the §2 table exactly
— `materialRound` and `modelRound` skip; `upgradeRemainingTextures` skips for `IndexMaps` and
`GearMaskLegacy` and **throws** for `GearMaskNew` and `HairMaps`, each with the citation and, for
`GearMaskNew`, a comment naming the upstream bug.

`metadataRound` keeps throwing: PMP `.meta` files come from manipulations, never from a zip member,
so an absent `.meta` is unreachable — a fail-loud guard, not a ported behaviour. `texFixRound` is
gated to TTMP (`needsTexFix` returns false for PMP), which is where absent files cannot occur, and
its `storage !== SqPackCompressed` early-return already skips raw PMP files.

### 3.4 Write — port the drop

`writePmp` ports `PMP.cs:883-888`: an absent file contributes **no zip member and no `Files` key**.
Because our writer prefers the carried-through `raw` option JSON (`optionToJson`, `pmp.ts:195-216`),
this means pruning those keys out of a copy of `raw` — by `gamePath`, which is exactly the map's key,
so the pruning is precise.

`writeTtmp2` **throws** on an absent file. `/upgrade` never converts formats (the harness picks the
target from the input extension) and absent files are structurally PMP-only, so this path is
unreachable; TTMP's own importer skips such files (`TTMP.cs:1067`), but we have no golden for a
TTMP *write* of one, and a documented fail-loud guard beats a guess.

## 4. Testing

### 4.1 The manifest carve-out (comparison, not input manipulation)

On a noop, ConsoleTools writes nothing, so the harness compares our re-written archive against the
**input pack** (`corpus-upgrade.ts:34`) — which still contains the dangling `Files` key our writer now
drops. The inputs stay untouched; the *comparison* gains a narrowly-scoped confirmation, in the
spirit of `DivergenceRule.confirm` (`upgrade-compare.ts:10-14`: "*NOT a blanket tolerance: `confirm`
must be tight enough that any OTHER difference still fails*") and of `normalize()`
(`upgrade-archive-diff.ts:25-40`).

**The rule:** when a manifest member fails `deepEqual`, an option's `Files` key may be **missing from
ours** iff the golden's value for that key names a zip path that **does not resolve as a member of
the golden's own archive**, under the same `windowsPathKey` normalization the reader uses. Any other
difference — a key we dropped whose payload *is* present, a key whose value we changed, any other
field — still fails.

Two properties make it safe:

- **It cannot mask the earlier normalization fixes.** A merely case-mismatched or trailing-dotted key
  *does* resolve, so it is not covered. Reusing the exported `windowsPathKey` (rather than a second
  copy) is what guarantees the carve-out and the loader agree on "absent".
- **It is inert whenever TexTools actually wrote.** A real ConsoleTools golden has already dropped the
  key (`PMP.cs:883`), so both sides agree and the confirmation never runs. It can only fire when the
  reference is the input pack.

**Payload side:** `diffUpgrade` compares a per-`gamePath` payload multiset; an absent file has no
payload and so is not in the multiset on either side. That is the definition of the set, not a special
case — it holds in both branches (on a noop both models load it absent; on a real golden the output
does not contain it).

### 4.2 Goldens and tests

1. **Synthetic noop pack** — `scripts/generate-synthetics/build-synthetic-absent-file.ts`, same shape
   as `build-synthetic-trailing-dot.ts`: a `Files` value naming a zip path that is not in the archive,
   at a gamePath `/upgrade` ignores → ConsoleTools noops. Proves load-tolerance, the noop path and the
   §4.1 carve-out end to end from a clean clone.

2. **Synthetic non-noop pack** — an absent file **plus** a payload that genuinely upgrades, so
   ConsoleTools *writes* and we get a real golden for §3.4's drop. Candidate trigger: an EW 256-entry
   colorset `.mtrl` (`doesMtrlNeedDawntrailUpdate`, `EndwalkerUpgrade.cs:550`), authored like
   `test/mtrl/make-mtrl.ts`'s `buildMinimalMtrl` but with realistic texture paths.
   **Spike this first** (§4.3) — two things can sink it:
   - The pack's zip layout must already match TexTools' regenerated `<optionPrefix><gamePath>` scheme
     (`PmpExtensions.cs:534`; see `BACKLOG.md`), or we collide with an unrelated, pre-existing
     divergence in `writePmp`. A single-option group named `absent` gives prefix `absent/`.
   - C# may abandon the material via its own NRE (`docs/TEXTOOLS_BUGS.md` §2) if the normal texture
     does not resolve, which returns the pack to a noop and defeats the purpose.

   If the spike fails, this degrades to a **`writePmp` synthetic unit test** citing `PMP.cs:883` —
   acceptable per `AGENTS.md` ("fall back to a synthetic unit test … only when the case is too deep or
   edge-casey for a golden to reach it"), with the `/resave` probe as the empirical backstop.

3. **Real corpus packs** — add `[Shy] Tactical Hoodie [DT].pmp` (1.8 MB, missing an `.mtrl`) and
   `[Nyameru]Cute Loop.pmp` (missing a `.pap`) to `test/corpus/real/` (gitignored). Real ConsoleTools
   goldens for the real phenomenon; both are noops, so they exercise §4.1 directly.

4. **Unit tests**
   - `test/container/pmp-read.test.ts`: an absent `Files` entry loads as a file with no bytes rather
     than throwing; the entry is still present in `option.files` (the `ContainsKey` invariant).
   - `test/container/pmp-write.test.ts` (or the existing write suite): `writePmp` emits neither the
     zip member nor the `Files` key for an absent file, and leaves every other key untouched.
   - Read-seam tests, one per row of the §2 table: material/model/`IndexMaps`/`GearMaskLegacy` skip;
     `GearMaskNew`/`HairMaps` throw.
   - `test/helpers/upgrade-archive-diff.test.ts`: the carve-out confirms a genuinely-absent dropped
     key, and **rejects** a dropped key whose payload is present, a changed value, and any other
     field difference.

### 4.3 `/resave` probe (one-off, local)

`ConsoleTools /resave` (`Program.cs:191-221`) is `WizardData.FromModpack` → `WriteModpack` with no
upgrade and no change check, so it drives the same `PopulatePmpStandardOption` writer. Run it once on
`[Shy] Tactical Hoodie [DT].pmp` and inspect the output's group JSON to confirm the absent `Files`
key is gone — empirical corroboration of §3.4 without adopting `/resave` as a harness oracle (it
cannot be one: it renames every payload entry and re-serializes every JSON — see `BACKLOG.md`).
A `local-notes/` script, like `probe-v1-meta.ts`; not wired into the suite.

## 5. Divergences

None introduced, and no `DIVERGENCE_RULES` entry. The §4.1 manifest carve-out is not a divergence
from TexTools — it is a confirmation that our output matches what TexTools' *writer* would have
produced, in the one case where the harness has no TexTools-written reference to compare against
(a noop, where TexTools wrote nothing at all).

Two TexTools bugs are reproduced, both registered in `docs/TEXTOOLS_BUGS.md`: the `GearMaskNew` null
dereference (§1) and, by not porting `ResolveDuplicates`, the zero-hash dedup collision (§7, not
reached).

## 6. Out of scope

- **Porting `ResolveDuplicates` / `MakeOptionPrefix`** — i.e. regenerating payload zip names as
  `<optionPrefix><gamePath>` with `common/N` dedup, as TexTools' writer does. Our writer reuses source
  zip names and matches the goldens only because Penumbra's layout coincides. Recorded in
  `BACKLOG.md`; it is a pre-existing latent divergence, not one this change introduces (though §4.2's
  non-noop synthetic must be authored to conform to the scheme so it does not trip over it).
- **`/resave` as a harness oracle** (§4.3) — needs the above.
- **TTMP write of an absent file** (§3.4) — unreachable; fail-loud guard instead.
- **The remaining `pmp: missing file entry` sources** — none: after this change, a `Files` entry that
  resolves to nothing is tolerated, and the error is retired.
