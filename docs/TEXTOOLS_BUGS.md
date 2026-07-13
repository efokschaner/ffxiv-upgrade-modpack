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
`XivTex.FromUncompressedTex(null)` (`:2084`) and throws an NRE, which `ModpackUpgrader` catches and
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

**Status:** **not reached** — we don't port prefix generation · **Where:** `WizardData.cs:1406-1409`

The loop that de-collides duplicate group folder names never increments its counter `i`, so two
groups whose names sanitize to the same folder would spin forever. Unreachable in our port: we
re-emit the source manifest and reuse the source zip member names rather than regenerating
`<optionPrefix><gamePath>` (see `BACKLOG.md` — that non-port is itself a latent divergence).

**Upstream fix:** increment the counter.

---

## 7. Missing files all share the zero hash, perturbing dedup paths

**Status:** **not reached** · **Where:** `PmpExtensions.cs:509-514` + `:537-551`

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

**Us:** not reached — we don't port `ResolveDuplicates`.

**Upstream fix:** exclude missing files from the dedup set instead of hashing them to a shared
sentinel.

---

## 8. `/upgrade` reports success and a destination path it never wrote

**Status:** **worked around** · **Where:** `ConsoleTools/Program.cs:181,188` + `ModpackUpgrader.cs:216`

When the upgrade produces no changes, `rewriteOnNoChanges` is `false`, so **no output file is
written** — but the CLI still prints `"Upgraded Modpack saved to: {dest}"` and returns exit code
`0`. A caller that trusts either signal gets a path to a nonexistent file.

**Us:** the golden harness treats "exit 0 but no file on disk" as the no-op outcome and caches a
`<sha256>.noop` marker (`test/helpers/upgrade-golden.ts`); the pack is then compared against its own
input.

**Upstream fix:** only print the success line when a file was actually written, and/or report the
no-op distinctly.
