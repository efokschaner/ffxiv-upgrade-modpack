# PMP Windows path-normalization (trailing dots/spaces)

**Date:** 2026-07-11
**Status:** Design — approved, pending implementation plan
**Roadmap:** hardens the PMP container reader (`src/container/pmp.ts`, ported from
`Mods/FileTypes/PMP.cs`) under the foundation roadmap
(`docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md` §8). Directly extends
`docs/superpowers/specs/2026-07-11-pmp-case-insensitive-file-resolution-design.md` — that change
emulated *one* facet of the Windows filesystem TexTools relies on (case-folding); this adds the
second facet that appears in the real corpus (trailing-dot/space stripping).

## 1. Problem

`readPmp` still rejects `[Jaque] Romeo & Juliet [feb 2023] - DT update.pmp`, one of the six packs
the case-insensitive fix left throwing `pmp: missing file entry`. The backlog
(`BACKLOG.md`) classified all six as **genuinely-absent** `Files` entries. Re-investigation shows
that classification is **wrong for Romeo**: its ten "absent" entries are present in the archive
under a **trailing-dot-normalized** folder name.

Romeo's option folder is `Rainbow Tulip Corsage - Rose acc.` (note the trailing period). Penumbra
keeps that period in the lowercased `Files` **value**:

```
value:  optional\rainbow tulip corsage - rose acc.\chara\equipment\e6069\material\v0007\mt_c0101e6069_glv_b.mtrl
```

but the archive stores the physical entry with the period **stripped**:

```
entry:  optional/rainbow tulip corsage - rose acc/chara/equipment/e6069/material/v0007/mt_c0101e6069_glv_b.mtrl
```

Our case-insensitive lookup lowercases both but keeps the `.`, so the value's `rose acc.` segment
misses the entry's `rose acc` segment and we throw. The archived file is *right there*.

Empirically confirmed against the oracle: `ConsoleTools /upgrade` **succeeds on Romeo and produces
a full 63 MB upgraded pack** in which the option carries all ten formerly-"absent" files with real,
distinct bytes (mtrls 512–640 B, the `.mdl` 315 KB) — TexTools resolved them transparently. So this
is not load-tolerance for a missing file; it is a **resolution bug**: we fail loud on input TexTools
reads without complaint, the same wrong kind of loudness the case fix removed.

The other five packs (Skelomae ×2, Cute Loop, Hoodie Megapack 3, Tactical Hoodie) are genuinely
absent under any Windows normalization — verified — and all `/upgrade` to a noop. They stay out of
scope here (see §6).

## 2. What TexTools does (the spec)

Identical mechanism to the case fix. `LoadPMP` (`PMP.cs:124`) unzips the archive to a real NTFS temp
folder and does **no load-time existence check**; files are resolved later, at import, by reading
from disk with `Path.Combine(unzipPath, file.Value)` (`PMP.cs:1080`). The Windows filesystem
normalizes each path segment on both the unzip write and the combine/read, and that normalization
**strips trailing spaces and periods from every component** (Win32 path rules) in addition to being
case-insensitive. So:

- On unzip, the entry `…/rose acc/…` is written to disk as `rose acc` (already stripped).
- On read, `Path.Combine(unzip, "…\rose acc.\…")` resolves `rose acc.` → the on-disk `rose acc`.

That OS-provided normalization — case-fold **plus** trailing-dot/space strip — is exactly what we
must emulate against our in-memory archive index. We already do the case half; this adds the
trailing-dot/space half. There is no dedicated TexTools code for either: both are properties of the
NTFS `Path.Combine`/`File` reads at `PMP.cs:1080` that `LoadPMP` (`PMP.cs:124`) never guards. Romeo's
golden is the empirical proof that this is TexTools' real behaviour, not an invented rule.

## 3. The fix

In `src/container/pmp.ts`, generalize the key function from `toLowerCase()` to a single
`windowsPathKey(path)` helper and use it in the two places the case fix touched:

```ts
// Emulates the subset of Win32 path normalization TexTools' NTFS Path.Combine/File reads rely on
// (PMP.cs:1080), which LoadPMP never guards (PMP.cs:124): case-fold + strip trailing '.'/' ' from
// each path segment. readZip already normalizes '\' -> '/', so segments split on '/'.
function windowsPathKey(path: string): string {
  return path
    .toLowerCase()
    .split("/")
    .map((seg) => seg.replace(/[. ]+$/, "")) // TrimEnd('.', ' ') per segment
    .join("/");
}
```

- `readPmp` builds the archive index keyed by `windowsPathKey(entryName)` (was `entryName.toLowerCase()`).
- `optionFromJson` resolves each `Files` value via `index.get(windowsPathKey(zipPath))`.
- It still **throws `pmp: missing file entry`** when nothing matches — so the five genuinely-absent
  packs keep failing loud, unchanged (§6).
- Provenance comment cites `PMP.cs:1080` / `PMP.cs:124` and names the two normalization facets.

**Scope of the normalization: exactly case-fold + trailing-dot/space, nothing more.** These are the
only two facets any pack in the real corpus exercises. Other Win32 quirks (reserved device names,
alternate separators) are deliberately *not* emulated — no corpus evidence needs them, and a
truly-absent entry must keep throwing (YAGNI; fail loud beats speculative tolerance).

**`pmpPath` is unchanged** — it stays the manifest's verbatim (lowercased, dot-bearing) `Files`
value, exactly as the case fix left it. Only the *data lookup* is normalized; we do not rewrite
`pmpPath` to the archive's display name. The write-side consequences the case-fix spec documented
(payload zip-entry casing/naming differs from the original archive, but is invisible to the golden
harness because `diffUpgrade` compares payloads by gamePath and `diffArchives` compares only manifest
members) carry over verbatim — trailing dots/spaces on a payload entry name are equally invisible.

**No-collision invariant carries over.** Two archive entries whose keys collide under this
normalization (e.g. `rose acc` and `rose acc.`) cannot coexist in one folder on the NTFS temp dir
TexTools unzips to, so a pack that unzips cleanly cannot produce a collision — the same argument the
case fix makes. A pack that does *not* unzip cleanly is already outside TexTools' well-defined
behaviour; we keep last-write-wins in the index loop and note it.

## 4. Testing

Per the approved scoping: a precise unit test, a committed regenerable synthetic golden, and the
local real-corpus AB-test that Romeo uniquely provides.

1. **`test/container/pmp-read.test.ts` — trailing-dot/space resolution unit test.** A new `describe`
   block: a PMP whose `Files` value carries a trailing-dot folder segment (`Rose acc.`) while the
   physical zip entry is `Rose acc` loads and resolves to the correct bytes; a trailing-space variant
   likewise. The existing "throws when no archive entry matches under any casing" test already pins
   the preserved fail-loud path (its `files/missing.mtrl` is absent under this normalization too) —
   keep it.

2. **`scripts/generate-synthetics/build-synthetic-trailing-dot.mjs` — committed synthetic golden
   builder.** Mirrors `build-synthetic-case-mismatch.mjs`: emits a gitignored
   `test/corpus/synthetic/trailing-dot.pmp` containing an option whose `Files` value has a
   trailing-dot folder segment and whose archived payload entry is the stripped name, plus a dummy
   gamePath so ConsoleTools `/upgrade` no-ops (→ compared against input). Flows through the existing
   `/upgrade` golden harness, exercising load-through-normalization from a clean clone (Romeo is
   local-only). The `.pmp` is gitignored (regenerated by running the builder); the builder is
   committed.

3. **Real-corpus pack (local, gitignored): `[Jaque] Romeo & Juliet [feb 2023] - DT update.pmp`** →
   `test/corpus/real/`. The one Category-A pack that produces a **non-noop** golden (63 MB), so it is
   the strong end-to-end proof that our normalization *plus* the full upgrade transform matches
   TexTools. Bless its baseline as part of the change.
   - **Caveat, expected:** Romeo exercises the full mtrl/mdl/meta/texture pipeline and may surface
     pre-existing latent porting diffs unrelated to this fix. Those are captured by the ratchet
     baseline (the ratchet's job) and are *not* evidence against this change — the change's own claim
     is narrower: before it, Romeo throws `pmp: missing file entry` at load; after it, Romeo loads and
     the upgrade runs. The unit test proves the resolution precisely; the synthetic proves it through
     the harness; Romeo proves the real end-to-end path. If Romeo's blessed baseline is non-empty,
     note which diffs are pre-existing latent gaps vs. anything attributable to this fix (there should
     be none of the latter).

## 5. Divergences

None introduced. Like the case fix, this *removes* a divergence (an erroneous load-time throw) and
restores TexTools' behaviour. No `DIVERGENCE_RULES` entry is needed for the resolution itself. If
Romeo's baseline carries pre-existing latent diffs, each is governed by its own existing rule/backlog
item, not by this change.

## 6. Deferred — the five genuinely-absent packs (`BACKLOG.md`)

Distinct problem, unchanged by this work. Skelomae Custom Skeleton v3.3.0 (`.pmp`, ×2 — missing
`files/files/common/arachne/*.sklb`), `[Nyameru]Cute Loop.pmp` (missing `chara/cuteloop2.pap`),
`Hoodie Megapack 3 - 2.0.2.pmp` (missing `chara/equipment/e6033/model/c0201e6033_top.mdl` +
`designs/default/c0201e6033_top_m.tex`), and `[Shy] Tactical Hoodie [DT].pmp` (missing
`chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl`) reference paths absent from the
archive under **any** Windows normalization — verified. All five `/upgrade` to a **noop** (the absent
files are never read/needed). Matching that means TexTools' load-tolerance: load without throwing,
represent the absent entry without inventing bytes, defer any failure to first byte-demand, and
reproduce the noop. `BACKLOG.md` is rewritten to remove Romeo (fixed here) and narrow the item to
these five, citing `PMP.cs:124`/`:1080`. Re-derive the list with `local-notes/scan-failed-loads.ts`
+ `local-notes/classify-fails.ts` (extend the classifier to apply `windowsPathKey`-equivalent
normalization so it no longer mislabels normalization cases as absent).

## 7. Out of scope

- Load-tolerance for genuinely-absent entries (§6, → `BACKLOG.md`).
- Broader Win32 path normalization beyond case + trailing-dot/space (§3 — no corpus need).
- Any change to TTMP2 loading: TTMP2 resolves files by binary offset into the `.mpd` blob, not by
  zip-entry name, so this class of bug is structurally PMP-only.
- Rewriting `pmpPath` to the archive's stripped name (unnecessary — §3, invisible to the golden).
