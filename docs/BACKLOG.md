# Backlog

Follow-up work deferred out of the change that surfaced it — a feature known to be unported,
hardening parked behind a decision, cleanup that outlives the current change. Use this instead of
leaving a silent TODO: a plan executes one spec, the backlog is the durable list of what's
postponed.

## How this works

**This file is the index**, split into a **prioritized** list (roughly ordered) and an
**unprioritized** bucket. Each entry is a one-paragraph summary — just enough to decide whether to
open the item.

**Each item lives in its own file** under `docs/backlog/`, named `YYYY-MM-DD-slug.md` — the date it
was *filed*, like a superpowers spec. Priority is deliberately **not** in the name, because it
changes. An item file cites the audit finding and/or C# source it traces to, so it can be picked up
cold by someone with no context.

- **To file an item:** write `docs/backlog/<today>-<slug>.md`, then link it from the right section
  below.
- **When an item ships:** delete its file and its index entry. The shipped code, tests, and git
  history are the record of what was done — a finished item left here is just bloat. **Before you
  delete it, grep for references to it** (`docs/backlog/<item>.md`) across `src/`, `test/`,
  `scripts/` and `docs/`: every fail-loud guard, gap comment and spec that cited the item has to be
  updated or removed in the same change, or you leave a dangling pointer to a file that no longer
  exists.
- **Cite an item from code only when the code is *waiting* on it** — a fail-loud guard, a
  documented gap, a known divergence ("unported; see `docs/backlog/<item>.md`"). That pointer dies
  with the item. Do **not** cite one as provenance for code that already works ("added as part of
  <item>"): that is what git history is for, and it leaves a dangling reference the day the item
  ships.

## Prioritized

Roughly highest-priority first. Mostly `/upgrade`-pipeline work still to port — the rounds our
pipeline stubs — plus any correctness defect that makes our *output* wrong. Reference:
`src/upgrade/upgrade.ts`, `reference/.../Mods/EndwalkerUpgrade.cs`.

1. [Partials round](backlog/2026-07-08-partials-round.md) — `partials` (`src/upgrade/upgrade.ts`) is
   a no-op stub for `UpdateUnclaimedHairTextures` / `UpdateEyeMask` / `UpdateSkinPaths` (roadmap
   round 6). Needs bundled reference assets (eye textures, iris `(race,face)→path`, canonical
   hair/ear/tail sampler tables); no corpus coverage exercises it yet.

## Unprioritized

### Corpus coverage

- [The asset-level corpus checks silently skip every PMP pack](backlog/2026-07-14-pmp-assets-never-codec-checked.md)
  — `sqpack`/`mtrl`/`tex`/`mdl`/`geometry` filter for `SqPackCompressed`, but a PMP stores its game
  files `RawUncompressed`, so they assert on **zero files** for every PMP and go green. The codec
  round-trips run on TTMP-sourced assets only. The fix is to make the shared decode storage-agnostic;
  kept separate from the perf work that found it because it is a coverage *expansion* that may
  surface real failures.

### PMP write path

- [Port `.meta`/`.rgsp` → `Manipulations` conversion](backlog/2026-07-13-pmp-write-meta-rgsp-manipulations.md)
  — `writePmp` throws where `PopulatePmpStandardOption` converts. Unreachable today (only a TTMP→PMP
  format conversion could reach it, and no upgrade flow performs one), so it is a fail-loud guard
  waiting on a product decision.
- [Port FileSwap handling](backlog/2026-07-13-pmp-write-fileswaps.md) — `resolveDuplicates` throws on
  a non-empty `fileSwaps` map. TexTools turns each swap into a placeholder whose zero-hash burns an
  `idx` and shifts `common/N` numbering, and deciding *which* swaps become placeholders needs the
  live game index we don't have. TexTools' own writer drops FileSwaps entirely, so "just drop them"
  is probably the right port — but that needs a synthetic pack to prove.
- [`WizardHelpers.WriteImage` re-encode is unported](backlog/2026-07-13-pmp-writer-image-reencode.md)
  — option/group/meta `Image` fields and their zip members are carried through verbatim rather than
  re-encoded to a 16-bit PNG under a new name. Deliberate: no image encoder in this repo. Real corpus
  packs diverge on this today.
- [Manipulation normalization fails loud on a missing field](backlog/2026-07-13-pmp-manipulation-field-defaults.md)
  — instead of emitting the C# type's own default for an omitted key. The honest fix needs each
  field's exact C# enum and its zero-value member name. No corpus manipulation omits a field.
- [Unrecognized PMP group `Type` yields an empty group](backlog/2026-07-12-pmp-unknown-group-type.md)
  — `parsePmpGroup` defaults `Options` to `[]`, silently dropping the group's files, where C# throws
  `Unimplemented PMP group type`. Inverts our fail-loud rule. Scan the corpus before flipping it.
- [Split `writePmp`](backlog/2026-07-13-split-writepmp-module.md) — it blends `PMP.WritePmp` and
  `WizardData.WritePmp` into one module, against "split, don't blend". Pure reorganization; needs its
  own careful pass because a mechanical refactor here risks byte-parity regressions with no new test
  signal.
- [`buildPages` is called twice per `writePmp`](backlog/2026-07-13-buildpages-called-twice.md) —
  wasted recomputation, not a correctness bug. Bundle with the split above.

### Findings from the `/resave` write-side oracle (2026-07-13)

The `/resave` harness (`test/helpers/corpus-resave.ts`) is the first thing in the suite to AB-test
our **writers** against TexTools (`/resave` = `WizardData.FromModpack` → `WriteModpack`,
`Program.cs:191-221` — the same load path `/upgrade` takes, minus the transform). It immediately
surfaced the items below; all are recorded in the per-pack ratchet baselines under
`test/corpus/.resave-baseline/`.

**Read this first — what these findings do NOT mean.** A `/resave` divergence is *not* automatically
a bug in our shipped `/upgrade` output. In the two biggest classes (`.mdl`, `.meta`) our `/upgrade`
output is **byte-identical to the `/upgrade` golden**; the divergence is that we apply a transform at
a *different seam* than TexTools does, which only a load-then-write oracle can see. Fixing them is
about **seam fidelity**, and any fix must keep the `/upgrade` goldens byte-exact.

- [Our load-fix seam bumps `.mdl` to v6; TexTools' does not](backlog/2026-07-13-resave-mdl-v6-bump-seam.md)
  — the v6 bump belongs to the *upgrade caller*, not the load fix. 483 `.mdl` diffs, all seam, none
  affecting our `/upgrade` bytes. The sharpest finding the oracle produced.
- [`.meta` reconstruction is a load/write behaviour in TexTools, but lives in our upgrade transform](backlog/2026-07-13-resave-meta-reconstruction-seam.md)
  — same shape: `reconstructMeta` is *correct* (byte-identical on `/upgrade`), only its seam is wrong.
- [`writeTtmp2` re-emits a simple pack as simple; TexTools always writes a wizard pack](backlog/2026-07-13-resave-ttmp2-simple-pack.md)
  — `WriteModpack` has no simple-pack writer at all. 13 packs. Decide deliberately whether to match.
- [`writeTtmp2` omits `.mpl` fields TexTools always writes](backlog/2026-07-13-resave-ttmp2-missing-mpl-fields.md)
  — `IsChecked`, `ModPackEntry: null`, an explicit `SimpleModsList: null`, and `Description: null`
  where we write `""`. 36 packs.
- [`writeTtmp2` round-trips `ModsJsons[].Name`/`Category`; TexTools re-derives them](backlog/2026-07-13-resave-ttmp2-name-category.md)
  — from the game path, yielding `Unknown` for a path it can't classify.
- [`writeTtmp2` emits an option's files in a different order](backlog/2026-07-13-resave-ttmp2-option-file-order.md)
  — 20 packs; confirm it is *only* order before fixing.

### Textures

- [T2 — full `FixOldTexData` load-time round](backlog/2026-07-10-fixoldtexdata-load-round.md) — we
  ported only the drop-malformed slice. Unported: the NPOT resize (needs T3's resampler) and the
  mip-offset-table fixup, which `/resave` now empirically forces (same format, same length, differing
  header bytes). The offset half needs no resampler and can land independently.
- [PMP load-time `.tex` fixup (`FastValidateTexFile`)](backlog/2026-07-13-pmp-load-time-tex-fixup.md)
  — a *different* gap from T2 (PMP-load-gated, not TTMP): shares `FixUpBrokenMipOffsets` but also
  truncates trailing null padding. Blast radius is bigger than a byte diff — dedup keys on loaded
  content, so it changes `common/N` **member names**. Must land before member-name parity is complete.
- [T3 — ImageSharp Bicubic/NearestNeighbor resampler](backlog/2026-07-10-imagesharp-resampler.md) —
  the shared dependency for the texture round's baselined resize skips (`Misty_Hairstyle_Female`) and
  T2's NPOT resize. Byte-parity against ImageSharp's float math may need a `DIVERGENCE_RULES` entry.
- [T4 — `index-path-overrides` missing `e0208` (and likely more)](backlog/2026-07-10-index-path-overrides-e0208.md)
  — we emit at the convention path instead of the canonical override. Fix is mechanical: re-run
  `scripts/extract-index-overrides.ts` against a game install.

### Metadata

- [v1 metadata support](backlog/2026-07-11-v1-metadata-support.md) — `deserialize.ts` throws on
  `version !== 2`. A probe confirmed ConsoleTools upgrades v1→v2 by injecting base-game data; EST
  injection is portable today, GMP needs a reference table round 5 never extracted. Extinct in the
  wild (0 of 1431 corpus metas).
- [NonSet (weapon/monster/demihuman) IMC reference table](backlog/2026-07-10-nonset-imc-reference-table.md)
  — `IMC_TABLE` is exhaustive over equipment/accessory but Set-only, so a NonSet meta that *would*
  grow its IMC silently passes through. Needs a NonSet `.imc` parser, its own extraction pass, and the
  NonSet column selection.
- [EQDP reconstruction drops mod rows for non-playable races](backlog/2026-07-10-eqdp-non-playable-races.md)
  — C# keeps every race the mod carries and backfills; we emit exactly the 18 playable ones.
  Unreachable today (game EQDP files are playable-race-scoped).

### Other ported code

- [`modelRound` propagates a normalizer throw and kills the whole pack](backlog/2026-07-12-model-round-throw-drops-pack.md)
  — TexTools catches and drops just the file. Deliberate for now: fail-loud is what exposes an
  unported model structure during development. Revisit when coverage is broad.
- [Port IBM437 (CP437) zip entry-name decoding](backlog/2026-07-12-cp437-zip-entry-names.md) —
  `readZip` throws on a non-UTF-8-flagged high-byte entry name rather than guessing; `Ionic.Zip`
  falls back to CP437, empirically confirmed via a hand-assembled zip run through ConsoleTools. No
  corpus pack trips it.
- [M1/M2 — empty-sampler placeholder serialization](backlog/2026-07-08-mtrl-empty-sampler-placeholders.md)
  — reproduce C#'s lowercase-then-compare-uppercase quirk that writes placeholders as ordinary
  textures. `serialize.ts` throws today. Needs a synthetic pack with an orphan sampler.
- [F6 — "real data in padding" throw](backlog/2026-07-08-sqpack-block-padding-throw.md) — omitted
  because C#'s throw is gated on whole-`.dat` context our single-file block reader doesn't carry.
  Malformed-input-only + latent.
- [Audit the port for TexTools bugs we already reproduce](backlog/2026-07-12-textools-bug-register-audit.md)
  — `docs/TEXTOOLS_BUGS.md` was seeded, not swept. Adjudicate the remaining candidates (EQP set-0
  omission, `PlayableRaces` race-order, `MakePMPPathSafe`'s platform-dependent invalid-char set)
  bug-vs-quirk and register the genuine defects.

### Harness & housekeeping

- [Make the ConsoleTools oracle async, so the lock can heartbeat](backlog/2026-07-13-consoletools-oracle-async-lock.md)
  — the hand-rolled mutex breaks "stale" locks on a guess. A heartbeat is the proper fix but needs
  the `execFileSync` critical section gone first. Operator's call (2026-07-13): keep the hand-rolled
  lock for now.
- [Expected-failure golden capability](backlog/2026-07-11-expected-failure-golden.md) — **the
  `/resave` half is done**; `/upgrade` still models only `pack | noop`, so a pack ConsoleTools errors
  on would hard-fail uncached every run. Deferred until one does.
- [Serial cache-warm entry point for the corpus](backlog/2026-07-12-corpus-cache-warm-entry-point.md)
  — a cold corpus still pays for each ConsoleTools spawn serially inside the parallel test run.
- [Nothing prunes baselines/goldens for packs that no longer exist](backlog/2026-07-14-orphaned-baseline-cache-entries.md)
  — they are keyed by `sha256(input pack)`, so re-keying a pack strands its old entries (4 baselines,
  13 cached goldens today). Cheap in disk, but it makes the file counts lie during a bless. The trap:
  the corpus is gitignored and often partial, so a naive "delete what no pack references" pruner would
  wipe every real pack's baseline on a fresh clone — and a missing baseline reads as "no known
  divergences", not as an error.
- [Audit temp-dir usage for leaks](backlog/2026-07-10-temp-dir-leaks.md) — several `mkdtempSync`
  sites never remove their directory; the two worst run on every `npm test`.
- [Vet page-load and upgrade-operation performance](backlog/2026-07-11-webapp-performance-vetting.md)
  — once a real webpage exists. Profile before presuming a culprit.
