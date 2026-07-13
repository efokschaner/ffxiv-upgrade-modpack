# PMP case-insensitive Files resolution

**Date:** 2026-07-11
**Status:** Design — approved, pending implementation plan
**Roadmap:** hardens the PMP container reader (`src/container/pmp.ts`, ported from
`Mods/FileTypes/PMP.cs`) under the foundation roadmap
(`docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md` §8); adjacent to the
modpack-serialization / manifest parity work
(`docs/superpowers/specs/2026-07-08-modpack-serialization-parity-design.md`).

## 1. Problem

`readPmp` rejects real Penumbra packs that TexTools loads without complaint. A local scan
(`scan-failed-loads.ts`, a `local-notes/` script since retired — see
`docs/superpowers/specs/2026-07-12-pmp-absent-file-tolerance-design.md` §1 for the outcome and
`scripts/scan-modpack-loads.ts` for its successor) over 1116 packs found **47** that our `loadModpack`
pipeline throws on, every one with the same shape:

```
pmp: missing file entry <zipPath>      (src/container/pmp.ts:30)
```

`optionFromJson` maps each `Files` entry (gamePath → zip path) with a case-sensitive
`files.get(zipPath)` and throws when the key is absent. But Penumbra writes the `Files` JSON
**values lowercased** (`ear physics/off/chara/...`) while the archive stores the physical file
with its **option-folder display case** preserved (`Ear Physics/Off/chara/...`). Our exact-map
lookup misses and throws; the pack never loads.

Classifying all 47 (`classify-fails.ts`, also since retired):

- **41 packs** — pure **case-only** mismatches: every referenced `Files` value resolves against
  the archive under a case-insensitive lookup. These are the target of this change.
- **6 packs** — have **genuinely-absent** entries (a referenced path not in the archive under
  *any* casing; e.g. Skelomae's `default_mod` references `files/files/common/arachne/c0101as.sklb`
  which isn't packed). Out of scope here — deferred to `docs/BACKLOG.md` (see §6).

## 2. What TexTools does (the spec)

`LoadPMP` (`PMP.cs:124`) **unzips the archive to a real temp folder** (`ResolvePMPBasePath` →
`IOUtil.UnzipFiles`, `PMP.cs:132`) and does **no load-time existence check** — it parses the
manifests and only builds an `allPmpFiles` set for *logging unused files* (`PMP.cs:183-215`).
Files are resolved later, at import, by reading from disk:

```
var externalPath = Path.Combine(unzipPath, file.Value);   // PMP.cs:1080
```

On the Windows/NTFS filesystem the goldens are generated on, `Path.Combine`/`File` lookups are
**case-insensitive**, so the lowercased `file.Value` (`ear physics/off/...`) transparently
resolves to the display-case file on disk (`Ear Physics/Off/...`). That OS-provided
case-insensitivity is the entire mechanism we are missing: we do exact `Map` key lookups where
TexTools does case-insensitive filesystem reads.

This is a divergence where we **fail loud on input TexTools accepts** — the wrong kind of
loudness (AGENTS.md "reproduce TexTools behaviour faithfully" wins here; the crash is a port
bug, not a documented gap).

## 3. The fix

In `src/container/pmp.ts`:

- `readPmp` builds a **case-insensitive index** of the archive entries once —
  a `Map<string, Uint8Array>` keyed by `entryName.toLowerCase()` (entry names already have `\`
  normalized to `/` by `readZip`). A duplicate lowercased key cannot occur for a pack that
  unzips on NTFS (two entries differing only by case can't coexist in one folder), matching the
  filesystem TexTools relies on.
- `optionFromJson` resolves each `Files` value via `index.get(zipPath.toLowerCase())`.
- It still **throws `pmp: missing file entry`** when no entry matches under any casing, so the 6
  genuinely-absent packs keep failing loud (unchanged behaviour, §6).
- Provenance comment cites `PMP.cs:1080` (`Path.Combine(unzipPath, file.Value)` read from the
  unzipped folder on case-insensitive NTFS) and `PMP.cs:124` (`LoadPMP` performs no load-time
  existence check).

**`pmpPath` is unchanged — it stays the manifest's (lowercased) `Files` value.** Only the *data
lookup* becomes case-insensitive; we do not rewrite `pmpPath` to the archive's display-case name.
Consequences, all benign:

- `writePmp` re-emits `Files` JSON from the carried-through `raw` option/group objects (lowercased
  values, verbatim) and writes payload zip entries at `pmpPath` (the same lowercased values). Output
  is internally self-consistent and TexTools-loadable. The only difference from the *original*
  archive is payload zip-entry **casing** (lowercase vs the input's display case).
- That casing difference is invisible to the golden harness: `diffUpgrade` compares payloads **by
  gamePath** on decompressed content, and `diffArchives` (`test/helpers/upgrade-archive-diff.ts`)
  compares only **manifest members** (`meta.json`, `default_mod.json`, `group_*.json`, `*.mpl`) —
  never payload entry names. So a round-tripped case-only pack shows no structure/manifest/payload
  diff attributable to this change.

## 4. Testing

Two durable committed tests plus one local real-corpus pack — the change is a loader fix, so a
unit test reaches the cause directly, and a synthetic golden AB-tests the "TexTools tolerates it"
claim rather than resting on our reading of the C#.

1. **`test/container/pmp-read.test.ts` — case-insensitive resolution unit test.** A PMP whose
   `Files` value is lowercased while the physical zip entry preserves display case (e.g.
   `Ear Physics/Off/x.pap`) loads and resolves to the correct bytes. Fails at the cause. Also
   assert an entry absent under *every* casing still throws `pmp: missing file entry`, pinning the
   preserved fail-loud path.

2. **`scripts/generate-synthetics/build-synthetic-case-mismatch.ts` — committed synthetic golden
   builder.** Mirrors `build-synthetic-f1.ts`: emits a gitignored
   `test/corpus/synthetic/case-mismatch.pmp` containing an option whose `Files` value is lowercased
   and whose archived payload entry is display-case, plus a dummy gamePath so ConsoleTools
   `/upgrade` no-ops (→ compared against input). Flows through the existing `/upgrade` golden
   harness, AB-testing that ConsoleTools loads the case-mismatch and our post-fix pipeline matches.
   The `.pmp` is gitignored (regenerated by running the builder); the builder is committed.

3. **Real-corpus pack (local, gitignored): `Groove 001.pmp`** (0.5 MB, case-only) → `test/corpus/
   real/`. The representative real AB-test of the fix. It is animation-only, so ConsoleTools
   `/upgrade` no-ops and the harness compares our output against the input; with the fix it loads
   and should match its (empty) baseline cleanly. Bless the baseline as part of the change.

**Why no non-no-op pack is added.** All 41 fixable packs are **no-op** upgrades (verified by
running ConsoleTools `/upgrade` over the content-bearing case-only PMPs — Slime Skin, Hot Mess,
Sakura, Yet Another Body+ all produced no output): they are already Dawntrail-compatible or are
animation/sound (`.pap`/`.scd`/`.avfx`) that `/upgrade` ignores. There is therefore no non-no-op
pack among the newly-loadable set, and the existing local corpus (~55 packs, mostly non-no-op
TTMPs) already covers real upgrade-transform output. Adding an unrelated non-no-op TTMP was
considered and declined to keep the change scoped to the case-sensitivity bug.

## 5. Divergences

None introduced. This change *removes* a divergence (an erroneous load-time throw) and brings us
back to TexTools' behaviour. No `DIVERGENCE_RULES` entry is needed: the fixed packs are no-op
upgrades that must match their input byte-for-byte per gamePath.

## 6. Deferred — the 6 genuinely-absent packs (`docs/BACKLOG.md`)

The 6 packs referencing a `Files` value absent under any casing are a distinct problem: TexTools
tolerates them at **load** (`LoadPMP` does no existence check, `PMP.cs:124`) and would only
surface the gap at **read/import** time (`Path.Combine(unzipPath, file.Value)` → a nonexistent
path, `PMP.cs:1080`). Matching that would mean deferring our eager byte-read to first use and
representing an absent entry without inventing bytes. We keep failing loud for now and record an
unprioritized `docs/BACKLOG.md` item — citing `PMP.cs:124`/`:1080` and listing the 6 packs — so it can
be picked up cold if we later decide to reproduce TexTools' load-tolerance.

## 7. Out of scope

- Load-tolerance for genuinely-absent entries (§6, → `docs/BACKLOG.md`).
- Any change to TTMP2 loading: the case-sensitivity bug is structurally PMP-only (TTMP2 resolves
  files by binary offset into the `.mpd` blob, not by zip-entry name), and no TTMP appears in the 47.
- Rewriting `pmpPath` to display case / preserving original payload zip-entry casing on write
  (unnecessary — §3 shows it is invisible to the golden).
