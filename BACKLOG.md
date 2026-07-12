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
