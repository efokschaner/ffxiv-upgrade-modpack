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
- **Metadata round** (roadmap round 5) — **EQDP slice landed** (`src/meta/reconstruct.ts`,
  `metadataRound` in `src/upgrade/upgrade.ts`): pure-EQDP `.meta` diffs (e.g. accessories) now
  byte-match the golden. **EST/EQP/GMP/IMC reconstruction still pass through unchanged**
  (`reconstructMeta` only touches `eqdp`) — remaining baselined `.meta` diffs are all
  equipment `met`/`top` slots (which carry EST) per
  `docs/superpowers/specs/2026-07-10-metadata-round-design.md` §5.
- **`parseMetaRoot` (`src/meta/root.ts`) doesn't recognize weapon/monster paths**
  (`chara/weapon/wNNNN/.../wNNNNbNNNN.meta`, `chara/monster/mNNNN/.../mNNNNbNNNN.meta`) —
  only equipment/accessory/hair/face are ported (Task 4, round 5). Discovered 2026-07-10 via
  two real corpus packs (`Persona 3 Evoker.ttmp2` w2021, `[Atelier Jaque] Balloon of Stars.ttmp2`
  m8045); both metas carry only an IMC segment (no EQDP), so `reconstructMeta` currently gates
  its `parseMetaRoot` validation on `eqdp` being present specifically to let these no-op rather
  than fail-loud. Once a later task ports IMC (needs the base-game variant table anyway, see the
  metadata-round design doc §3.3), `parseMetaRoot` will need a weapon/monster root shape too —
  widen it then, and drop the `if (eqdp)` gate in `reconstruct.ts` once every segment type is
  covered so an unrecognized root always fails loud again.

## Unprioritized

- **General (all-base-items) IMC reference table.** `src/meta/reference/imc-table.ts` (Task 8a,
  `scripts/extract-meta-reference.ts`) is **corpus-derived, not exhaustive** — only the 28
  equipment/accessory items referenced by a `.meta` gamePath in the current
  `test/corpus/{real,synthetic}` corpus are extracted (same precedent as
  `src/upgrade/reference/index-path-overrides.ts`, Task T4). A future mod referencing an item
  outside this set will have `IMC_TABLE` return `undefined` for its `(itemType, primaryId, slot)`
  key. If the shipped tool needs items beyond the corpus, widen the extractor to walk the game's
  full equipment/accessory id range (or a canonical item list) instead of scanning `.meta`
  gamePaths. Also out of scope: NonSet (weapon/monster/demihuman) `.imc` files — blocked on
  `parseMetaRoot` (`src/meta/root.ts`) not yet recognizing those roots (see the entry above).

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

- **MDL — Half-precision large-vertex-buffer fallback (model round `FixOldModel`).** The model
  normalizer throws `mdl: vertex buffer would overflow 8MB; Half-precision path unsupported`
  (`src/mdl/model/build-declarations.ts:62-66`) when a model's estimated vertex buffer reaches the
  8 MB `_MaxVertexBufferSize`. TexTools handles this by *not* doing the Half→Float precision upgrade
  for that model — it falls back to a Half-precision vertex declaration (`Mdl.cs:2513-2542`, consumed
  by the element-set construction `Mdl.cs:2614-2711`). We deliberately fail loud rather than emit a
  byte-incompatible declaration (the guard's own comment notes the corpus "never approaches" this).
  **Surfaced 2026-07-10:** `[V] [AM] Spring Florals.ttmp2` (Vermillion, 12 MB, in `XIVModOriginals`)
  is a real pack that trips it, so the "no corpus hits this" assumption no longer holds. Porting the
  Half-precision declaration path is its own scope; add Spring Florals (or a smaller repro) to the
  corpus once it lands so the ratchet locks it. Unrelated to the metadata round — found incidentally
  during the round-5 corpus scan.

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
