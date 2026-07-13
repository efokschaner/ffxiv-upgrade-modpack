# Backlog

Follow-up work deferred out of the change that surfaced it. See `AGENTS.md` → Conventions
("Deferred work lives in `BACKLOG.md`") for when to add here. Each item cites the audit
finding and/or C# source it traces to, so it can be picked up cold.

## Prioritized

`/upgrade`-pipeline work still to port — the rounds our pipeline currently stubs, roughly
highest-priority first. Reference: `src/upgrade/upgrade.ts`, `reference/.../Mods/EndwalkerUpgrade.cs`.

- **Partials round.** `partials` (`src/upgrade/upgrade.ts`) is a no-op stub for
  `UpdateUnclaimedHairTextures` / `UpdateEyeMask` / `UpdateSkinPaths` (roadmap round 6).
  Needs the bundled reference assets (eye textures, iris `(race,face)→path`, canonical
  hair/ear/tail sampler tables) — no corpus coverage exercises it yet.

## Unprioritized

- **`modelRound` propagates a model-normalizer throw and kills the whole pack; TexTools drops just
  the file.** `src/upgrade/upgrade.ts` (`modelRound`) calls `requireBytes` + `normalizeModel`
  unguarded, so a throw from `normalizeModel` (an unported/unparseable model structure) propagates
  out of `upgradeModpack` and fails the entire `/upgrade`. TexTools does not fail the pack here:
  every caller of `FixOldModel` on the `/upgrade` path wraps it in
  `try { … } catch (Exception ex) { Trace.WriteLine(ex); continue; }` — `WizardData.cs:716-727`
  (the one `ModpackUpgrader.cs:58 -> WizardData.FromModpack` actually takes), and the same shape at
  `TTMP.cs:741-754` and `:1380-1393` — and the `continue` skips the `data.Files.Add` a few lines
  below (`WizardData.cs:729-737`), so the file is silently DROPPED from the option rather than
  killing the pack. Pre-existing (true before the absent-file-tolerance change; unrelated to it —
  an absent file can never reach `modelRound` at all, since absent files are PMP-only and this
  round is gated off for PMP by `needsMdlFix`/`DoesModpackNeedFix`, `TTMP.cs:916`). **Deliberate,
  not an oversight:** fail-loud here is what exposes an unported model structure as a loud failure
  during development instead of silently shipping a pack with a missing model — matching TexTools'
  *outcome* (dropping the file) would require catching the normalizer's throw and removing the file
  from the option, the same shape as `materialRound`'s per-file try/catch. Revisit once model
  normalization coverage is broad enough that a throw here is more likely a real unported case than
  a bug worth surfacing loudly.

- **Audit the port for TexTools bugs we already reproduce, and register them.**
  `docs/TEXTOOLS_BUGS.md` is the register of upstream **bugs** (null derefs, dead guards,
  non-terminating loops, lying exit codes) that we deliberately reproduce for byte-parity, or
  deliberately don't reach, or fail loud on instead. It was seeded from the PMP absent-file
  investigation plus a grep for existing `QUIRK` / `NRE` comments, so it is **not** exhaustive —
  it captures what was in reach, not what is there. Sweep `src/` (and the `reference/` C# it cites)
  for the rest and add an entry per finding. Candidates to adjudicate on the way through, all of
  which are currently only noted in code comments: the EQP set-0 omission
  (`src/meta/reconstruct.ts:190`, `ItemMetadata.cs:522-528`); the `PlayableRaces` vs
  `PlayableRacesWithNPCs` race-order disagreement (`src/meta/playable-races.ts:1`, `Eqp.cs:48-92`);
  `MakePMPPathSafe`'s platform-dependent `Path.GetInvalidFileNameChars()`
  (`src/container/pmp.ts:151`, `PMP.cs:1316-1326`). Each needs the bug-vs-quirk call the register's
  header describes — a faithfully transcribed SE oddity is a quirk and stays a code comment; only a
  genuine defect gets an entry. Useful both as a correctness audit (a reproduced bug we *think* we
  reproduce may not actually match) and as the shortlist of patches we could offer upstream.

- **`writePmp` round-trips the source pack where TexTools *regenerates* it.** TexTools' PMP writer
  never round-trips: it rebuilds the whole pack from its fully-defaulted typed model. Ours re-emits
  the source manifest verbatim (`data.meta.raw` / `o.raw`) and reuses the source zip names
  (`pmpPath`). Two confirmed sub-symptoms of the one root cause:
  1. **Manifest content** — *empirically confirmed* (2026-07-12, see below). TexTools serializes its
     typed model, so every initialized field is written: a `meta.json` that Penumbra wrote without
     `Image` comes back **with** `"Image": ""`, and `default_mod.json` comes back as
     `{"Version": 0, "Files": …, "FileSwaps": …, "Manipulations": …}` — the source's `Name` /
     `Description` **dropped**, a `Version` **added** (`PMP.cs:830-869`; `WizardData.cs:1496` even
     forces `FileVersion`). Ours keeps the source document verbatim.
  2. **Zip member names** — anticipated, still unconfirmed directly. `ResolveDuplicates`
     (`PmpExtensions.cs:534`) **renames every payload entry** to `<optionPrefix><gamePath>` —
     `optionPrefix` being the lowercased, path-safe group name (plus option name when the group has
     more than one option; `WizardData.cs:1362-1458`) — and content-dedups shared files into
     `common/{idx}/<filename>` (`:537-551`). The source names are never retained: `UnpackPmpOption`
     (`PMP.cs:1071-1102`) uses the `Files` value only to locate the unzipped temp file and keys its
     dict by *game path*.
  3. **Functional breakage whenever the texture round fires — our upgraded PMPs are broken, not just
     mismatched.** `writeGeneratedTex` (`src/upgrade/texture.ts:122-139`) builds its replacement
     `ModpackFile` with no `pmpPath` field, while `optionToJson`'s raw branch (`src/container/pmp.ts`)
     re-emits the source option's `Files` map verbatim and `writePmp`'s payload loop
     (`src/container/pmp.ts:304-308`) writes each file at `f.pmpPath ?? f.gamePath`. Two distinct
     failures follow, both silent:
     - A **generated** file that didn't previously exist in the option (index map, gear mask —
       `existing < 0` in `writeGeneratedTex`) gets a new zip member at `gamePath`, but no `Files` key
       is added to name it (the raw `Files` map is untouched) — Penumbra has no way to find it, so the
       upgrade is a no-op from the mod's perspective.
     - An **in-place regenerated** file (HairMaps normal/mask — `existing >= 0`, the array slot is
       replaced wholesale) loses its `pmpPath`, so its new member is written at `gamePath` while the
       retained `Files` value for that same `gamePath` still names the *original* `on\…` zip path —
       which no longer has a member (the old `ModpackFile` object, and the entry that carried its
       `pmpPath`, is gone; `allFiles`/`writePmp` never revisit it). The result is a dangling `Files`
       entry pointing at nothing, and an orphan zip member no `Files` key names.

     Both are invisible to `diffUpgrade` (a model-level payload-multiset diff that runs *before* the
     write, so it never sees `writePmp`'s output) and to `diffArchives` on any pre-existing pack (the
     mismatch lands inside the same `meta.json`/`default_mod.json` divergence from sub-symptom (1) that
     is already sitting in that pack's ratchet baseline). **Pre-existing, not introduced by the
     absent-file branch** — `optionToJson` returned `o.raw`'s `Files` map verbatim before that work too
     — so this is documentation of a real defect, not a fix, in this change. A reader of this item
     should take away that our upgraded PMPs are functionally affected today whenever a texture-round
     target (index map, gear mask, or hair normal/mask) actually gets generated, not merely that the
     manifest bytes differ from what TexTools would write.

  **Why the corpus is green anyway.** Penumbra already lays packs out as `<group>/<option>/<gamePath>`,
  so "regenerated" and "verbatim" coincide for (2); and every real pack that exhibits (1) predates
  the ratchet, so its `meta.json` / `default_mod.json` mismatch is **already sitting in its baseline**
  (e.g. `test/corpus/.upgrade-baseline/dec0279….json`, `bd7130d….json`). A **newly added** pack gets
  no such grandfathering and must match fully — which is how this surfaced.

  **How it surfaced, and the repro.** The absent-file work (spec
  `docs/superpowers/specs/2026-07-12-pmp-absent-file-tolerance-design.md` §4.2) tried to add a
  synthetic pack that both carries an absent `Files` entry and genuinely upgrades, so ConsoleTools
  would actually *write* it. ConsoleTools did write it, and the repro target matched **byte-for-byte**
  (`group_001_absent.json` — TexTools drops the absent key, we drop it identically). The pack still
  could not land, blocked solely by (1): `default_mod.json#0:mismatch, meta.json#0:mismatch`. The
  builder is parked at `local-notes/build-synthetic-absent-file-upgraded.ts.parked` (gitignored) —
  it is a single-option group named `Absent` holding a hand-built EW 256-entry-colorset `.mtrl` at
  `chara/equipment/e9999/…` plus an absent `Files` entry. **Land it as
  `scripts/generate-synthetics/build-synthetic-absent-file-upgraded.ts` once this item is fixed** —
  it was the only thing blocking a clean 0-diff, so it should go green immediately, and it is the
  golden that pins both this fix and the absent-file drop on a real (non-noop) write.

  **Fixing it** means porting TexTools' regenerate-from-typed-model write: the `PMPMetaJson` /
  `PmpDefaultMod` Newtonsoft serialization shape for (1), and `ResolveDuplicates` + `MakeOptionPrefix`
  (with their dedup/`common/N` behaviour, incl. the zero-hash bug in `docs/TEXTOOLS_BUGS.md` §7) for
  (2). Nontrivial: it affects **every** genuinely-upgraded PMP, so expect ratchet baselines to move.
  Originally found while investigating whether ConsoleTools `/resave` could serve as a write-side
  round-trip oracle — it cannot, for exactly this reason.

- **PMP group with an unrecognized `Type` yields an empty group instead of failing loud.**
  `parsePmpGroup` (`src/container/manifest-types.ts`) defaults `Options` to `[]`, so a group whose
  `Type` is neither `Single`, `Multi` nor `Imc` (or is absent entirely) reads as a group with **no
  options** — its files silently vanish from the model, and `/upgrade` would emit a pack missing
  them. C# cannot produce that outcome: `PMPGroupJson.Options` is a virtual property that **throws**
  on the base class — `NotImplementedException($"Unimplemented PMP group type: {Type}")`
  (`PMP.cs:1407`) — and only the three known subtypes override it with a real `OptionData = new()`
  (`:1413` / `:1421` / `:1434`, selected by `JsonSubtypes` off `Type`, `:1383-1386`). So TexTools
  fails loudly where we quietly drop content, which inverts the port's fail-loud rule (a
  best-effort wrong output that the golden diff could miss, since an empty group also writes back
  empty). Pre-existing — the `?? []` predates the raw/parsed split and was carried through it
  unchanged, so this is not a regression.
  **To fix:** throw from `parsePmpGroup` when `Type` is not a known subtype, mirroring the C#
  message. **First check** what `JsonSubtypes` actually does with an unrecognized discriminator —
  it may throw at *deserialization* rather than reaching the base property, which would change the
  failure point (and whether `LoadPMP` can even load such a pack) — and scan the corpus for an
  unknown/absent `Type` before flipping it, or the ratchet will light up. Presumed latent (a pack
  that hit this would likely already show as missing files against its golden), but that scan has
  **not** been run — do it as step one rather than trusting this note.

- **ConsoleTools is not safe to run concurrently — the oracle needs a mutex.** `run()`
  (`test/helpers/oracle.ts:125-128`) shells out to `ConsoleTools.exe` with no cross-process
  serialization, and the runner schedules corpus units across Vitest's `forks` pool, so a **cold
  cache spawns several ConsoleTools at once**. Observed 2026-07-12: after rebuilding the three
  synthetic packs (new content-hash → cold `/upgrade` cache), all 6 affected units failed together
  with `Command failed: ConsoleTools.exe /upgrade …` (ConsoleTools returns `-1`, so `execFileSync`
  throws). The same binary on the **same input bytes succeeds every time when run alone**, and
  re-running the 6 units serially (`CORPUS_UNIT=<i> npm test`) passed all 6 and warmed the cache,
  after which the full suite was green — i.e. the inputs were never at fault, the concurrency was.
  Operator confirms he has hit ConsoleTools concurrency problems outside this project too, so treat
  it as a property of the tool (it likely assumes a single instance — shared config/lock/temp state),
  not of our harness. Today this is **masked**: the cache is content-addressed and warm, so a normal
  run spawns nothing; it only bites when several goldens go cold at once (new corpus mods, rebuilt
  synthetics, a cleared `.upgrade-cache/`) — precisely when a newcomer first populates the corpus, so
  it reads as a spurious hard failure. Fix: serialize **all** ConsoleTools invocations behind a
  cross-process mutex (the pool is multi-process, so an in-process lock is insufficient — needs e.g.
  a lockfile / named mutex around `run()` in `oracle.ts`, covering `/upgrade`, `/resave`, `/unwrap`,
  `/wrap`). Consider also a serial cache-warm entry point so a cold corpus can be populated in one
  pass. Harness robustness; no correctness impact on the port itself.

- **Expected-failure golden capability for the upgrade harness.** The golden harness models only
  two ConsoleTools `/upgrade` outcomes: a produced **pack** or a **noop** marker
  (`GoldenResult = { kind: "pack" } | { kind: "noop" }`, `test/helpers/upgrade-golden.ts:29-31`).
  It has **no way to represent (or cache) an input on which `/upgrade` is *expected to error***. When
  ConsoleTools returns `-1`, `run()`'s `execFileSync` throws (`test/helpers/oracle.ts:125-128`), the
  exception propagates out of `upgradeGoldenCached` uncaught, the test hard-fails, and nothing is
  cached — so every subsequent run re-spawns ConsoleTools and throws again. There is no "bless this as
  an expected failure" path (the ratchet baseline only covers known byte-diffs on a *produced* pack).
  If we ever want a corpus pack to assert "TexTools errors here and our port should error the same
  way," add: (1) a third `GoldenResult` kind (e.g. `{ kind: "error", … }`) capturing the failure, (2)
  a cached error-marker analogous to `<sha>.noop` so the outcome is content-addressed and not re-run,
  and (3) a bless path to record it. **Not needed today:** the only expected-failure case in flight is
  the `Mdl.cs:2822` vertex-buffer hard cap, which is covered by a synthetic unit test that drives the
  serializer directly (see `docs/superpowers/specs/2026-07-11-mdl-half-precision-fallback-design.md`
  §4.2-4.3) — the right vehicle regardless, since a ConsoleTools error can't be cached/blessed under
  the current harness anyway. Recorded so the capability is picked up deliberately if a real
  expected-failure corpus pack ever appears.

- **v1 metadata support.** `src/meta/deserialize.ts` now throws on any `.meta` with
  `version !== 2` rather than silently mis-upgrading it. An empirical probe
  (`local-notes/probe-v1-meta.ts`: downgrade a real pack's v2 equipment meta to v1 --
  `version=1`, EST/GMP stripped -- run it through ConsoleTools `/upgrade`, inspect the golden)
  confirmed ConsoleTools cleanly upgrades v1 -> v2 by **injecting base-game data** the v1 meta
  lacks, per C#'s `dataVersion==1` default-injection branches:
  - `DeserializeEstData` (`ItemMetadata.cs:823-826`) defaults a missing EST segment to
    `Est.GetExtraSkeletonEntries(root)` -- the est-table (`src/meta/reference/est-table.ts`)
    already supports computing this, so EST injection is portable today.
  - `DeserializeGmpData` (`ItemMetadata.cs:851-855`) defaults a missing GMP segment to
    `GetGimmickParameter(root, true)` -- this needs a **new per-item base-game GMP reference
    table + extraction**, which round 5 deliberately skipped (Task 6 extracted IMC/EST but not
    GMP). Without it, a v1 upgrade can't be reproduced faithfully.
  Extinct in the wild (0 v1 metas across 1431 real corpus `.meta`s), so deferred behind the
  fail-loud guard in `deserialize.ts` rather than ported. Re-run the probe script (still present,
  not wired into the harness) to re-verify against a fresh ConsoleTools build if this is ever
  picked up. `src/meta/serialize.ts` always writes version `2` on output regardless of input
  version (`ItemMetadata.Serialize`, `ItemMetadata.cs:509`), so this is purely a read-side gap.

- **NonSet (weapon/monster/demihuman) IMC reference table.** `src/meta/reference/imc-table.ts`
  (`scripts/extract-meta-reference.ts`) is now **exhaustive over base-game equipment/accessory** —
  it extracts every `(item, slot)` root in the framework's `item_sets.db` `roots` table (~1555
  items / ~7775 keys), so `reconstructMeta`'s IMC step (`src/meta/reconstruct.ts`) covers every
  base-game equipment/accessory item, not just corpus-referenced ones. What remains: `IMC_TABLE`
  is **Set-only**. NonSet items — weapon/monster/demihuman — use a different on-disk `.imc` shape
  (`Imc.cs` `ImcType.NonSet`, a 1-entry default + 1-entry subsets vs Set's 5-slot subsets), so they
  are never extracted, and weapon/monster `.meta`s take the pass-through branch (verified byte-exact
  on the corpus, ratchet-guarded). `parseMetaRoot` recognizes weapon/monster roots (Task 8b) only to
  produce a lookup key that misses `IMC_TABLE`. A general tool wanting NonSet IMC growth needs: (1) a
  NonSet `.imc` parser (the current `parseImcFile` handles only `ImcType.Set`), (2) its own NonSet
  extraction pass over the `weapon`/`monster`/`demihuman` `item_sets.db` roots, and (3) the NonSet
  column selection in `reconstructMeta`. Until then a NonSet meta that *would* grow its IMC silently
  passes through — no corpus pack exercises this, so the ratchet would flag it if a real one did.
  (Note: an equipment/accessory item genuinely absent from the exhaustive table — e.g. added to the
  game after the last `imc-table.ts` regen — now **fails loud** in `reconstructMeta`, signalling
  "regenerate the table", not a silent wrong output.)

- **EQDP reconstruction drops mod rows for non-playable races (latent).** `reconstructMeta`'s EQDP
  step (`src/meta/reconstruct.ts`, round 5) emits exactly the 18 `Eqp.PlayableRaces` in canonical
  order (mod value or 0). C#'s `DeserializeEqdpData` (`ItemMetadata.cs:773-788`) instead keeps
  *every* race the mod file carries and then backfills the missing playable races — so a mod EQDP
  row for a **non-playable** race would be preserved by C# but is silently dropped by our port.
  Unreachable today: game EQDP files are playable-race-scoped, so no real `.meta` carries a
  non-playable EQDP row (flagged in the round-5 final review as a latent fail-loud/fidelity
  asymmetry, unlike the EST/IMC out-of-range cases which were made to throw). Revisit only if a real
  pack ever exercises it; the honest fix is to keep the mod's extra rows (matching C#) rather than
  drop or throw.

- **M1/M2 — empty-sampler placeholder serialization (audit Theme D).** Reproduce, byte-for-byte,
  C#'s quirk where `XivMtrlToUncompressedMtrl` lowercases texture paths (`Mtrl.cs:560`) before its
  UPPERCASE `StartsWith(EmptySamplerPrefix)` exclusion checks, so placeholders are written as
  ordinary textures. `src/mtrl/serialize.ts` currently throws on any empty-sampler placeholder.
  Reproduction also requires matching C#'s placeholder path (`_empty_sampler_` + lowercased
  ESamplerId *name*, whereas `parse.ts` uses the numeric raw id). Needs an authored synthetic
  modpack with an orphan sampler to pin the golden bytes before implementing. Latent (0 unstable on
  the current corpus).
- **F6 — "real data in padding" throw (audit Theme A).** `src/sqpack/blocks.ts` `readBlock`
  omits C#'s `readBlockPadding` throw (`Dat.cs:2400-2405`) because that throw is gated on
  whole-`.dat` context (`lastInFile && i != blockCount - 1`) our single-file block reader does
  not carry. Documented as a code comment rather than ported, since a partial reproduction would
  risk over-throwing on legitimately-tolerated padding. Revisit if we ever thread archive-level
  read context (which file/block is last) into the block loop. Malformed-input-only + latent.

- **T2 — full `FixOldTexData` load-time round (only the drop-malformed subset is ported).** The
  texture round (round 4) surfaced that TexTools runs every `.tex` in an old pack (TTMP major < 2,
  or exactly 2.0) through `FixOldTexData` at **load** time (`TTMP.cs:1413-1460`, called from
  `MakeFileStorageInformationDictionary` `TTMP.cs:1367-1379`), gated by `DoesModpackNeedFix`
  (`TTMP.cs:916-930`). We ported **only the drop-on-decode-failure slice** (`src/upgrade/texfix.ts`
  `needsTexFix` + `texFixRound`, mirroring the `try { FixOldTexData } catch { continue }` that drops
  malformed placeholder textures — the fix for the 8 `hd_bunny_sluts` index regressions). The
  **remaining** `FixOldTexData` behaviour is unported: (1) `ValidateTexFileData`
  (`EndwalkerUpgrade.cs:2100`) — resize a NPOT texture that has >1 mip up to power-of-two (needs the
  **ImageSharp Bicubic resampler**, still deferred — same dependency as the texture round's resize
  gap), and fix up broken mip offsets; (2) the **unconditional recompress** of every kept `.tex` via
  `Tex.CompressTexFile` (`TTMP.cs:1436`). The recompress is invisible to our golden harness (it
  compares decompressed content, and recompression preserves it), so it is low-priority; the
  NPOT-resize *does* change decompressed content and would show as a golden diff if any old-pack
  corpus texture is NPOT-with-mips. This is a load-time round analogous to the model round's
  `FixOldModel`; scope it as its own spec→plan when the resampler lands or a corpus pack demands the
  resize. No corpus coverage forces it today (the ratchet will flag it if a real pack does).

- **T3 — ImageSharp Bicubic/NearestNeighbor resampler (texture-round resize skips + T2).** The
  texture round throws `TextureResizeUnsupported` (caught → skipped, baselined) whenever a
  generation source is non-power-of-two (`CreateIndexFromNormal` `:1098`, `UpgradeMaskTex` `:2088`)
  or a hair normal/mask pair differs in size (`ResizeImages`, `:1205`). C# resizes via ImageSharp
  (Bicubic, or NearestNeighbor for the pow2 pre-step). **Real corpus case:** `Misty_Hairstyle_Female.ttmp2`
  hits the hair size-mismatch branch twice (normal 4096² vs mask 1024², c0101/c0201 h0170) — currently
  baselined skips. **No NPOT source exists anywhere in the ~940-pack scan**, so the NPOT branch has zero
  real coverage (synthetic-only when built). Porting an ImageSharp-faithful Bicubic resampler is the
  shared dependency for these skips AND T2's `ValidateTexFileData` NPOT-resize; byte-parity against
  ImageSharp's float math may be machine-dependent (see texture-round spec §4.4) — likely needs a
  scoped per-pixel-threshold `DIVERGENCE_RULES` entry for resized outputs. Own spec→plan.

- **T4 — `index-path-overrides` table missing `chara/equipment/e0208` (and likely other) base-game
  entries.** `The_Final_Requiem_veil.ttmp2` overwrites base-game e0208 materials; the golden's index
  path uses the canonical override (`EndwalkerUpgrade.cs:923-936`) but `src/upgrade/reference/index-path-overrides.ts`
  has no e0208 c0101 entry, so we emit at the convention path (golden has `_met_id.tex` we don't →
  `#0:added`) and the two e0208 `.mtrl` mismatch. The index generation itself is byte-exact once pointed
  at the right path (triage-confirmed). Fix mechanically by re-running `scripts/extract-index-overrides.ts`
  against a game install to widen the table; the ratchet baselines the gap until then.

- **Vet page-load and upgrade-operation performance once a working webpage exists.** The
  library is consumed client-side, but there is no real page to profile yet. When one lands,
  measure the two things that matter to a user: (1) **initial page load** — JS parse/eval and
  time-to-interactive, and (2) the **upgrade operation itself** — wall-clock and peak memory of
  running `upgradeModpack` over representative packs. Profile the real app on real hardware
  (include a low-end/mobile-class device), find where the time and bytes actually go, and only
  then decide whether anything is worth optimizing. Keep the investigation unbiased — do not
  presume a culprit. One incidental data point already gathered (2026-07-11): the current lib
  build is `dist/index.js` 1,568 KB raw / 111 KB gzip, of which the two generated base-game
  reference tables (`src/meta/reference/imc-table.ts`, `est-table.ts`) are ~90% of the raw bytes
  but only ~62% of the gzip (they're highly repetitive, so gzip/brotli crush them). That suggests
  wire size is already small and any real cost is more likely eager parse/eval or the upgrade
  compute path — but treat that as a hypothesis to test, not a conclusion, and let the profiler
  point at whatever is actually hot. Housekeeping / perf; no correctness impact.

- **Audit temp-dir usage for leaks (`mkdtemp` cleanup).** Several helpers create OS temp working
  directories via `mkdtempSync(join(tmpdir(), …))` but never remove the *directory* (only inner
  files), so they accumulate across runs. The worst offenders run on **every `npm test`**:
  `test/helpers/oracle.ts:169` (`oracle-*`, a per-worker module singleton `ORACLE_TMP`, never rm'd)
  and `test/helpers/upgrade-golden.ts:49` (`upgrade-*`, `UPGRADE_TMP`, never rm'd) — these left the
  stale `oracle-*`/`upgrade-*` dirs found on 2026-07-10. Occasional offenders: `scripts/extract-index-overrides.ts:87`
  (`idxover-*`) and `scripts/extract-shader-params.ts:26` (`shparam-*`) (manual runs), and the test
  files `test/oracle-cache.test.ts` (`oc-*`) / `test/upgrade-harness.test.ts` (`ug-*`/`ub-*`).
  **Good examples to follow:** `test/sqpack/fixtures/regen.ts:64` and `test/tex/fixtures/bcn/regen.ts:431`
  both `rmSync(tmp, { recursive: true, force: true })` when done. Fix: give each `mkdtemp` site a
  guaranteed cleanup (try/finally, `afterAll`, or a `process.on("exit")` unlink for the singleton
  harness dirs), and consider a lint/grep guard so new `mkdtemp` calls without a paired removal are
  caught. Note `oracle.ts` already sweeps stale `.tmp` files in its *cache* dir (`:48-65`) — extend
  that discipline to the mkdtemp working dirs. Housekeeping; no correctness impact.
