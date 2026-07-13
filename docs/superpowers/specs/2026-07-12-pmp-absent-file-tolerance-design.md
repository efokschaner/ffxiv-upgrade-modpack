# PMP load-tolerance for genuinely-absent `Files` entries

**Date:** 2026-07-12
**Status:** Implemented
**Roadmap:** hardens the PMP container reader/writer (`src/container/pmp.ts`, ported from
`Mods/FileTypes/PMP.cs`) and the upgrade rounds' read seam under the foundation roadmap
(`docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md` §8). Closes the last of
the three PMP load failures, after
`docs/superpowers/specs/2026-07-11-pmp-case-insensitive-file-resolution-design.md` (case-folding)
and `docs/superpowers/specs/2026-07-11-pmp-windows-path-normalization-design.md`
(trailing-dot/space stripping) — both of which fixed *resolution* bugs. This one is not a resolution
bug: the file genuinely is not in the archive.

## 1. Problem

Five real packs still fail loud with `pmp: missing file entry` (`BACKLOG.md`). Their `Files` values
name zip paths absent from the archive under **any** Windows normalization — case-fold *and*
trailing-dot/space strip — i.e. the payload was never packed:

- Skelomae Custom Skeleton v3.3.0 (`.pmp`, ×2 — Skeleton + Devkit; `files/files/common/arachne/*.sklb`)
- `Hoodie Megapack 3 - 2.0.2.pmp` (`chara/equipment/e6033/model/c0201e6033_top.mdl` + a `designs/default` `.tex`)
- `[Nyameru]Cute Loop.pmp` (`chara/cuteloop2.pap`)
- `[Shy] Tactical Hoodie [DT].pmp` (`chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl`)

TexTools loads all five without complaint and `/upgrade`s each to a **noop** (verified against
ConsoleTools). We throw at load, so we cannot process them at all. Our loudness is wrong here: it is
loud about input TexTools reads happily.

**Outcome, recorded for anyone re-checking this later:** after the fix below landed, re-scanning the
operator's full local library (1117 packs across three directories) with `scripts/scan-modpack-loads.ts`
finds **0** failures — was 47 before this change and the two resolution fixes that preceded it (see
`docs/superpowers/specs/2026-07-11-pmp-windows-path-normalization-design.md` §1). Re-check with:

    npx tsx scripts/scan-modpack-loads.ts <dir> [dir...]

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
| model (`FixOldModel` — the one we port) | `:192` `GetUncompressedFile` — **unguarded**, but every `/upgrade` caller wraps the call itself in `try/catch { continue }` (see below) | **throw** (unreachable — see below) |
| `IndexMaps` (`UpgradeRemainingTextures`) | `:1840` `ContainsKey` → `CreateIndexFromNormal` returns null data (`:1087`) → `:1843` `continue` | **skip** |
| `GearMaskLegacy` | `:1879` `ContainsKey` → `:1883` null-checked | **skip** |
| `GearMaskNew` | `:1867` `ContainsKey` → `:1870` passes null into `UpgradeMaskTex` → `ArgumentNullException` (`XivTex.cs:96`, not an NRE) | **throw** |
| `HairMaps` | `:1852` both keys `ContainsKey` → `UpdateEndwalkerHairTextures` `:1187` `throw new FileNotFoundException` | **throw** |

**On the model row.** `UpdateEndwalkerModel` (`:250`, the `FastMdlv6Upgrade` path) *does* null-guard via
`ResolveFile` (`:252-256`) — but that is **not the function we port**. Our `modelRound` calls
`normalizeModel`, which ports **`FixOldModel`** (`:190`), whose read at `:192` is unguarded; and
`modelRound` is gated by `needsMdlFix`, which mirrors `DoesModpackNeedFix` (`TTMP.cs:916-930`) and is
**false for PMP**. Since absent files are PMP-only, an absent file can never reach that round —
`requireBytes`'s no-bytes throw is dead code on the absent-file path specifically, which is the
only claim this spec needs. (That we do not port `UpdateEndwalkerModel` at all is a separate,
pre-existing gap.)

**Correction (this is not "TexTools has no skip here"):** TexTools *does* skip on this path — just
one level up the call stack from `FixOldModel`'s own unguarded read, not inside it. Every caller of
`FixOldModel` on the `/upgrade` path wraps the call in
`try { … } catch (Exception ex) { Trace.WriteLine(ex); continue; }`: `WizardData.cs:716-727` (the
one `ModpackUpgrader.cs:58 -> WizardData.FromModpack` actually takes), and the same shape at
`TTMP.cs:741-754` / `:1380-1393`. The `continue` skips the `data.Files.Add` a few lines below
(`WizardData.cs:729-737`), so a model `FixOldModel` cannot parse is **dropped from the option**, not
fatal to the whole pack. Our `modelRound` does not reproduce that outcome: a `normalizeModel` throw
propagates out of `upgradeModpack` unguarded, killing the whole pack. That is a real, **pre-existing**
divergence (true before this change, and unrelated to it — an absent file still can never reach this
round either way), kept deliberately fail-loud so an unported model structure surfaces loudly rather
than silently shipping a pack missing a model. See `BACKLOG.md`.

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
zero SHA1 rather than reading it (a bug in its own right — `docs/TEXTOOLS_BUGS.md` §8).

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
`option.files` — required by the `ContainsKey` semantics in §2. `windowsPathKey` is **not** exported:
§4.1 deliberately gives the harness its own, independent key function (`looseKey`) rather than
reusing this one — sharing it would let a regression in `windowsPathKey` agree with itself (see
§4.1's safety argument), so nothing outside this module should call it.

### 3.3 Read seam — port `ResolveFile`

The read seam splits in two, because not every round is a `ResolveFile` caller in C#:

- **`resolveFile(f)`** (`src/upgrade/upgrade.ts`) is the faithful port of `ResolveFile`
  (`EndwalkerUpgrade.cs:1761-1774`). It returns `null` in **both** of C#'s null cases: the file has no
  bytes (`:1765`), *and* the read throws (`:1771-1774` `catch { return null; }` — so an undecodable
  SqPack entry resolves to null, not an exception). The `tx` fallback (`:1777-1782`) has no analogue
  in our model. Used by every true `ResolveFile` seam: the material scan, `IndexMaps`,
  `GearMaskLegacy`, `GearMaskNew` and `HairMaps`.
- **`requireBytes(f)`** is a *direct* read: it throws when the file has no bytes and lets a decode
  error propagate unchanged. Used by the two rounds that are **not** `ResolveFile` callers —
  `modelRound` (ports `FixOldModel`, whose read at `:192` is unguarded) and `metadataRound` (no C#
  analogue). Keeping these off `resolveFile` is what stops us conflating *absent* with *undecodable*
  at seams where C# would have surfaced the real error.

Each round then mirrors its own C# call site from the §2 table: `materialRound` skips (and the skip
sits **above** the per-material `try`, as `:496-499` precedes `:501`); `modelRound` fails loud
(unreachable, per the note above); `upgradeRemainingTextures` skips for `IndexMaps` and
`GearMaskLegacy`, and **throws** for `GearMaskNew` and `HairMaps` — both of which resolve first and
then dereference the null in C#, so an undecodable entry throws there too. Each carries its citation
and, for `GearMaskNew`, a comment naming the upstream bug (`docs/TEXTOOLS_BUGS.md` §1).

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
the golden's own archive**, under `looseKey` — a normalization defined in the harness
(`upgrade-archive-diff.ts`) that is deliberately **not** the reader's `windowsPathKey`. Any other
difference — a key we dropped whose payload *is* present, a key whose value we changed, any other
field — still fails.

This is safe for one specific reason, and unsafe for a broader class the harness catches a different
way:

- **It fails closed against a regression in `windowsPathKey` specifically** — not against every failure
  upstream of it. A shared key function would make the carve-out agree with any bug introduced into
  `windowsPathKey` itself: a lost case-fold or trailing-dot strip would make the reader wrongly mark a
  resolvable file absent, the writer would drop it, and a confirmation built on the *same* broken
  function would recompute "absent" the same broken way and bless the drop. `looseKey` is independent
  code, and deliberately **looser** than any plausible resolution rule (it strips every `.`/` `, not
  just a trailing run per path segment), so it can only ever confirm *fewer* drops than the reader made
  under a `windowsPathKey` regression specifically: a merely case-mismatched or trailing-dotted key
  still resolves under it (so the two normalization fixes stay under test), and a genuinely
  never-packed payload matches nothing under any spelling (so the intended confirmations are
  unaffected).

- **It is NOT the thing that catches a member the writer silently dropped, for any other reason.**
  This rule only ever inspects `Files` map *keys*; it can't see a payload member vanish for a reason
  that never touches a `Files` key at all — e.g. a writer/reader bug that drops an **`ExtraFile`** —
  a non-manifest zip member no `Files`/`Image` field references at all (`PMP.cs:213-215`; a readme, a
  preview image). An earlier revision of this rule tried to patch that blind spot with an archive-wide
  "orphan-payload-member" guard (disable the confirmation entirely whenever the golden contains any
  unreferenced payload member) — but that guard was both a hack (it inferred a name-resolution failure
  indirectly, by absence of a reference, rather than checking the thing that actually matters) and
  wrong at the archive granularity: a pack with a *legitimate* extra (e.g. `[DVNO] DMBX Shoes 1.pmp`'s
  34 preview images) would disable the confirmation for the whole file even with zero actual drops.

  **What actually catches it:** `diffArchives` separately compares the *names* (and, for matched
  pairs, the bytes) of non-manifest ("payload") members between our archive and the golden — a plain
  multiset diff, bucketed by `looseKey` so a legitimate spelling difference (case, a stripped trailing
  dot) isn't flagged. If a payload member the golden has is absent from ours (or vice versa), under any
  name spelling, it is reported directly as a `structure` diff, per member. This comparison only runs
  when the caller passes `checkPayloadMembers: true` (`corpus-upgrade.ts` passes
  `target === "pmp" && golden.kind === "noop"` — PMP only: TTMP's single opaque `TTMPD.mpd` blob is not
  a PMP-shaped per-gamePath payload member at all): on a real ConsoleTools-written golden, TexTools
  regenerates every payload member's name (`<optionPrefix><gamePath>`, `PmpExtensions.cs:534`) where our
  writer reuses the source pack's own names — a real, separately tracked divergence
  (`BACKLOG.md`) this comparison must not light up.

  **What this does NOT cover:** an entry name TexTools' Ionic.Zip would decode differently than fflate
  does — a byte >= 0x80 with the zip's UTF-8 general-purpose-flag bit unset, where Ionic falls back to
  IBM437 and fflate falls back to latin1 — never reaches either comparison above. `readZip`
  (`src/zip/zip.ts`) scans the zip's Central Directory and **throws** on exactly that case before any
  entry is decoded, per AGENTS.md's "fail loud, never silently diverge": we do not implement IBM437
  (`BACKLOG.md`), so silently picking fflate's latin1 name would resolve a *different* file than
  TexTools does, with the mis-decoded member re-emitted as an ExtraFile under its wrong name — a
  balanced member count on both sides, invisible to the multiset diff above.
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

   **Outcome (2026-07-12): the oracle question was answered — YES — but the pack could not land.**
   Both anticipated hazards held: ConsoleTools genuinely *wrote* the pack (`Test-Path` → `True`; note
   `/upgrade` exits 0 either way — `docs/TEXTOOLS_BUGS.md` §9), and the authored zip layout matched
   TexTools' regenerated `absent/<gamePath>` names. **The golden's `group_001_absent.json` drops the
   absent `Files` key and keeps the surviving `.mtrl`'s — and our pipeline reproduces that member
   byte-for-byte.** That is a real, non-noop `/upgrade` confirmation of §3.4, strictly stronger than
   the `/resave` probe below.

   The pack is nonetheless **not committed**, blocked by a *third*, pre-existing divergence unrelated
   to absent files: `writePmp` re-emits the source `meta.json` / `default_mod.json` verbatim, where
   TexTools regenerates them from its typed model (adds `"Image": ""`; drops `Name`/`Description` and
   adds `Version`). The only diffs were `meta.json#0:mismatch, default_mod.json#0:mismatch` — the
   repro target itself matched. Every real corpus pack with that divergence already has it in its
   ratchet baseline; a *new* pack gets no grandfathering, so it cannot reach 0 diffs until that gap is
   fixed. Blessing a baseline was forbidden (it would enshrine a known divergence on a pack authored
   to prove a different one). The builder now lives at
   `scripts/generate-synthetics/build-synthetic-absent-file-upgraded.ts` (not registered in
   `build-all.ts` — see its header) and `BACKLOG.md` carries the item plus
   an instruction to land it once the writer regenerates manifests — it should go green immediately.

   So the write-side rule (§3.4) rests on: this spike's non-noop golden (strongest), the `/resave`
   probe (§4.3), and the `writePmp` unit tests — just not, yet, on a *committed* golden.

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
     field difference; separately, the payload-member name comparison catches a silently-lost
     unreferenced (`ExtraFile`) member on a no-op golden, stays inert when `checkPayloadMembers` is
     off (the non-noop branch), tolerates a `looseKey`-equivalent spelling difference, and does not
     flag legitimate extras present on both sides.

### 4.3 `/resave` probe (one-off, local; script since retired)

`ConsoleTools /resave` (`Program.cs:191-221`) is `WizardData.FromModpack` → `WriteModpack` with no
upgrade and no change check, so it drives the same `PopulatePmpStandardOption` writer. Ran it once on
`[Shy] Tactical Hoodie [DT].pmp` and inspected the output's group JSON to confirm the absent `Files`
key is gone — empirical corroboration of §3.4 without adopting `/resave` as a harness oracle (it
cannot be one: it renames every payload entry and re-serializes every JSON — see `BACKLOG.md`).
The one-off script that ran this (`probe-resave-absent.ts`) has since been deleted — its purpose was
served and the result is recorded permanently below; it is not needed to re-derive the finding.

**Empirical result (2026-07-12).** Ran the probe against
`[Shy] Tactical Hoodie [DT].pmp`. The pack's gamePath
`chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl` appears **twice**: once in
`default_mod.json`'s top-level `Files` (the genuinely-absent entry — its `pmpPath` names no zip
member) and again inside `group_001`'s `"Enable"` option (a present, real zip member). A first pass
of the probe that flattened `Files` by gamePath alone reported nothing dropped, because the present
copy in `group_001` papered over the absent one in `default_mod.json` under the same key — a probe
bug, not a writer bug. Fixed the probe to scope each key by `(json member, option name, gamePath)`
so the two same-gamePath entries can't collide, and re-ran:

```
Files keys: 23 in -> 22 out
DROPPED BY TEXTOOLS: [
  'default_mod.json::(top)#chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl'
]
```

Exactly the absent entry is dropped, nothing else — confirms `PMP.cs:883-888` and Task 1's writer.

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
