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
- **The same test applies to prose, and it is stricter there.** A spec or a sibling item should name
  the **mechanism** ("answered by corpus widening", "closing it needs a BC encoder") rather than link
  the tracking item, unless the doc is genuinely *waiting* on that item. A "handled elsewhere, and by
  the way it's tracked" pointer tells the reader nothing the mechanism's name didn't, and it dies the
  day the item ships — while a **spec is durable and outlives the item by design**, so the dangling
  reference is guaranteed rather than merely possible. Never record an item's **rank** inside its own
  file: this index owns the ordering, for the same reason priority is not in the filename. (Both
  failures had already happened and were cleaned up 2026-08-03: a shipped spec and a sibling item
  both pointed at "prioritized item 2", and one item pointed at a diagnostics-channel entry that had
  been deleted on shipping.)

## Prioritized

Roughly highest-priority first (prioritization pass **2026-08-03**, superseding 2026-07-20b,
2026-07-20 and 2026-07-17). **This list is a total ordering.** Every entry is ranked and finishable;
an entry that cannot be ranked or cannot be completed has not been prioritized, and does not belong
here in that form.

**Pass log.** A shipped item's file is deleted per the convention above, so its dated entry here is
the only record left. **Rank movements are deliberately not logged** — this list's order is whatever
it says today, and rank arithmetic about items that no longer exist ages into noise within a week.

- **2026-07-21** — the minion/mount/furniture corpus expansion added three corpus-found items: the
  `bgcommon` housing-meta crash, the silent mount `_id.tex` gap, and the furniture `.mdl` overrun.
- **2026-07-21b** — the housing-meta crash **shipped**
  ([spec](superpowers/specs/2026-07-21-housing-meta-drop-design.md)). The furniture `.mdl` overrun's
  failure mode was found to have silently changed class in the process: it no longer aborts the whole
  pack — the load-fix `catch { return null }` now swallows it, so the user gets a pack silently
  missing models.
- **2026-07-21c** — the furniture `.mdl` overrun's *parse* half shipped, narrowing that item to its
  writer-side remainder and surfacing the unported `CalculateTangents` recompute. It also corrected
  the v6-bump-seam item (*Unprioritized → `/resave` findings*), which turns out to affect `/upgrade`
  output too, not only `/resave`.
- **2026-07-22** — the mount/monster `_id.tex` gap **shipped**
  ([spec](superpowers/specs/2026-07-21-npot-texture-resize-design.md)). Its root cause turned out to
  be the unported NPOT resize (T3), not the monster-specific material-round branch the item
  hypothesized, so the T3 item **narrowed to T2's load-time resize alone** rather than closing. One
  new item was filed from the same work
  ([`2026-07-22-bc-encoder-merge-pixel-data.md`](backlog/2026-07-22-bc-encoder-merge-pixel-data.md),
  *Unprioritized → Textures*): an accepted divergence, the only one in the repo carried by a ratchet
  rather than a `DIVERGENCE_RULES` confirmation.
- **2026-07-23** — the furniture `bgparts` `.mdl` item **shipped**: the boneless-part writer now
  emits `HasBonelessParts`, the `furniturePartBoundingBoxCount`, and the per-part culling boxes
  (`Mdl.cs:2978-2984/3314-3318/3751-3772`; see the model-normalizer spec's 2026-07-23 update). The 3
  corpus models it un-dropped now byte-match the golden except the MDL version at byte 0 — the known
  v6-bump-seam residual (baselined; see that item).
- **2026-07-24** — the unported `CalculateTangents` recompute **shipped**: the full
  binormal/handedness recompute branch (`ModelModifiers.cs:2140-2253`) + `GetWeldedMeshData`
  (`:1935-2100`) are ported; `gar_b0_m0112.mdl` now byte-matches the `/resave` golden except the v6
  version byte (its own item). See `docs/superpowers/specs/2026-07-24-tangent-recompute-design.md`.
- **2026-07-25** — the T3 ImageSharp Bicubic resampler item (by then narrowed to T2's load-time
  `ValidateTexFileData` resize) **shipped in full**
  ([spec](superpowers/specs/2026-07-25-validate-tex-load-seam-design.md)). `validateTexFileData`
  (`src/upgrade/validate-tex.ts`) now ports both branches of TexTools' `ValidateTexFileData`
  load-seam fixup: the NPOT resize (reproducing a genuine width-for-both-dims bug,
  `docs/TEXTOOLS_BUGS.md` #20) and the broken mip-offset-table repair (reproducing the
  `FixUpBrokenMipOffsets` struct-copy `MipCount` quirk, `docs/TEXTOOLS_BUGS.md` #21) — the latter
  alone shrank or removed diffs across 30+ real corpus packs. On a BC-compressed NPOT source the
  resize is a confirmed divergence (we emit A8R8G8B8 where TexTools re-encodes to the source's
  original BC format; no BC encoder), reached for real by `KK_Sportcar_Final_Hotfix_V1.1.1.ttmp2`.
  That same work **falsifies** the 2026-07-25 survey conclusion on the BC-encoder item below ("keep
  unprioritized — leverage not urgency, ~0 probability of a corpus pack reaching the gap"): a real
  pack now reaches the identical `MergePixelData` BC-reencode gap via this load seam, so "zero corpus
  packs reach it" no longer holds, even though the item stays unprioritized (see the Textures section
  below for the corrected item).
- **2026-07-31** — the `hair-texture-exists` namespace-scope item **shipped** (see
  `docs/superpowers/specs/2026-07-31-game-file-exists-oracle-design.md`). The oracle is now complete
  over `chara/` (a generated `chara-index.ts`, 333,072 entries across 82,369 folders, replacing the
  3,378-entry namespace-scoped table), so a miss provably means the file is absent rather than merely
  out-of-namespace. The index-path steal's gate B (`idTexExists` over `ID_TEX_PACKED`) was retired
  onto the same shared `fileExists` oracle. The hair/eye material tables' existence gates were split
  from their content lookups and now **fail loud** (`UnportedGapError`) on a table gap instead of
  silently skipping.
- **2026-08-02** — the diagnostics-channel item **shipped** (see
  `docs/superpowers/specs/2026-08-01-upgrade-diagnostics-channel-design.md`). `upgradeModpack` now
  returns `{ ok, data, diagnostics }`; a port gap stays fatal (`ok: false`, never a diagnostic beside
  a returned pack), and `unclaimed-hair.ts:213`'s catch now re-throws `UnportedGapError` before
  emitting its diagnostic, satisfying the precondition
  `docs/backlog/2026-07-31-unported-gap-error-sweep.md` was waiting on. Corpus measurement found
  **zero** diagnostics across all ~105 local packs — the sole emitting site (the swallowed
  `MergePixelData` failure inside `updateEndwalkerHairTextures`) is reached by no local pack and is
  pinned only by synthetic tests.

- **2026-08-03** — a **re-ranking pass**, the first since 2026-07-20b; everything above it is a
  shipped-item record rather than a re-derivation, and two defects had accumulated behind that.
  **(a)** The site (Round 7) had reached the top of the list by erosion rather than by decision — it
  was authored fifth in the 2026-07-20 pass and carried upward as the items above it shipped, until
  its own closing line told the reader to start it "in parallel with" itself. That placement
  contradicted the rubric stated below, which "ranks a large, well-understood build (the UI) below
  small, unbounded correctness holes", because the empty-group item beneath it is rubric class 1. The
  empty-group item now leads and the site follows it; the deploying-changes-the-probability-term note
  is what settles the order, since launching the site is precisely what converts the empty-group
  trigger from latent to live. The "start in parallel" hedge went with it — the site's independence
  from its neighbours is a scheduling fact, not a rank. **(b)** The corpus item described itself as
  "a standing activity rather than a task with a done state"; an entry that can never complete cannot
  be ranked, which makes the list something other than a prioritization. Per operator: corpus
  widening is **bounded product-vetting work with specific goals**. Stale figures were refreshed in
  the same pass (pack counts; the coverage percentages are now date-stamped as a 2026-07-20
  measurement rather than asserted as current; the spec count). The pass also swept
  rank-by-reference out of the rest of the repo — see the prose bullet under *How this works*.
- **2026-08-04** — the empty-group item **shipped**, in full, as a page-model restructure rather than
  the two-line reader fix originally filed (see
  `docs/superpowers/specs/2026-08-04-datapages-model-and-empty-group-design.md`). `ModpackData.pages`
  replaces the flat `groups` list, page construction moved to load, both readers drop a zero-option
  group, and `writeTtmp2`'s `PageIndex` is now a dense renumber — which turned out to shrink real
  `.ttmp2` baseline diffs across many packs (cause unestablished) and closed the `buildPages`-called-
  twice item as a side effect (`writePmp` no longer calls it at all). The one adjudicated divergence —
  we upgrade a zero-option-group pack that crashes ConsoleTools outright — is `docs/TEXTOOLS_BUGS.md`
  #22. **Round 7 (the site) now leads the list**, the only item that had been ranked above it.

**The ranking objective.** The product is a static webpage that upgrades a modpack as robustly as
TexTools does — the port's functional completeness and the site are the *same* goal, not competing
ones, so this is one list rather than "port work" and "product work". Items are ordered by
**probability × severity that a user gets a wrong or failed modpack**, which sorts the failure modes:

1. **Silent wrong output** — worst. The user ships a broken mod and never learns. Our "fail loud,
   never silently diverge" rule exists for this, and every violation of it outranks everything below.
2. **Hard crash or refusal** — bad, but honest.
3. **Doesn't exist yet** — blocking, but carries no correctness *unknowns*.
4. **Cosmetic divergence from the golden** — real ("byte-parity is the definition of correct"), but
   lowest user impact.

Note this deliberately ranks a *silent* gap above a *loud* one even when the loud one is bigger, and
ranks a large, well-understood build (the UI) below small, unbounded correctness holes. Reference:
`src/upgrade/upgrade.ts`, `reference/.../Mods/EndwalkerUpgrade.cs`.

**Deploying changes the probability term** (new in the 2026-07-20b pass). Most "latent — no corpus
pack reaches it" items were triaged against 70 packs on one machine. A public webpage accepts
arbitrary uploads, so corpus silence stops being decent evidence of rarity and becomes merely
*absence of evidence*. When re-ranking, give a latent item a probability bump if its trigger is
something a mod author could plausibly author by hand (an empty group, a hand-edited manifest, a
non-UTF-8 zip name) rather than something only a specific game-data shape produces. Severity is
unchanged by deployment; only probability moves.

1. [**TexTools re-pin Part B — port the one upstream commit that still owes a port**](backlog/2026-08-08-textools-repin-part-b.md)
   — the other half of the v3.1.1.4 re-pin, whose exit condition was deliberately *not* a zero
   baseline. Smaller than the name suggests: of the 11 ledger rows in the re-pin spec §10, only **row 1
   (`1993bf6`)** still owes a port — rows 6/8/9/10/11 shipped in the PMP v4 detour, row 2 shipped in
   Part A, and rows 3/4/5/7 are `no port impact` with recorded rationales. One commit, three hunks, all
   in `Tex.cs`: delete `assertTexHeaderWritable` (upstream's `ToBytes` lost **all four** checks, not
   just the `LoDMips` ordering guard #19 is named for, and is now a pure serializer), change
   `buildCanonicalTexHeader`'s LoD2 to `mipCount > 2 ? 2 : mipCount - 1`, and add the ascending clamp
   to `fixUpBrokenMipOffsets` — inverting the tests that currently pin the throw, retiring the three
   `*pre-fix*` markers, and updating register #19's status. `docs/TEXTOOLS_BUGS.md` #19's "What Part B
   owes" is the authoritative statement of the work. **This one moves corpus bytes** via
   `encodeUncompressedTex`, which is exactly why Part A recorded the opening total (166 packs / 5809
   diffs, `roundtrip` 0) — re-bless deliberately and attribute what moved. Ranked first because it is
   the only work in the repo that is purely execution: the analysis is complete, the C# read and cited,
   the register entry written, and the reference measurement already in place. Operator call,
   2026-08-08.

2. [**In-game verification of the bug #23 divergence (AGENTS.md evidence bar 3)**](backlog/2026-08-08-bug23-in-game-verification.md)
   — **operator-only; no agent can discharge it.** `docs/TEXTOOLS_BUGS.md` #23 is the repo's one
   deliberate divergence *from* TexTools rather than a faithful reproduction, and AGENTS.md's third
   evidence bar — someone verified in the real game that our output is better — has **not** been met.
   Bars 1 and 2 are (registered defect; confirmed corpus-side by `makeV4ExtraFileDuplicateConfirmation`
   over the purpose-built `test/corpus/synthetic/pmp-v4-extrafiles.pmp`), so this is the sole gap, and
   the divergence currently ships on the 2026-08-06 operator ruling instead of on evidence. The work is
   one manual test: `/resave` that pack through both our port and ConsoleTools, install both in
   Penumbra, confirm both load, the in-game result is identical, and ours is roughly half the size.
   **Plan for a negative result** — if the duplication turns out to be load-bearing in-game, the
   divergence has to be withdrawn and our reader goes back to reproducing the bug, with the
   confirmation rule and the synthetic re-pointed at the reproduction. Ranked first not by size but
   because it is the only thing in the repo shipping on a ruling rather than on evidence, against one
   of the project's three founding principles — and everything built on top of it inherits that.
   Operator call, 2026-08-08.

3. [**TTMP load fix does not handle `.rgsp`; it passes through unchanged**](backlog/2026-07-21-ttmp-load-rgsp-passthrough.md)
   — a **rubric class 1 candidate** (silent wrong output) whose size is genuinely unknown. TexTools
   diverts a `.rgsp` into `data.Manipulations` at load and re-materializes it on write from the game's
   *clean default* parameter plus those manipulations (`PMP.cs · ManipulationsToMetadata · 1335,1347`);
   we pass the file through verbatim. The two agree only if `RgspToManipulations` emits a manipulation
   for **every** field of the struct — any field it misses is silently reset to the game default by
   TexTools while we preserve the pack's value, i.e. a modpack that behaves differently and a user who
   never finds out. **Nobody has read that C# yet**, which is what makes this unbounded rather than
   merely open. Filed 2026-07-21 behind "no corpus pack carrying `.rgsp` has been found"; that blocker
   is **gone** — `Milktruck Bust Scaling Tweaks v1.0.0.ttmp2` is 12 `.rgsp` entries and nothing else,
   and it had no `/resave` golden for its entire life only because v3.1.0.2 could not resave it (the
   patch-7.5 `human.cmp` breakage). The v3.1.1.4 re-pin produced one, and our bytes match it — which
   bounds the risk but does not discharge it: one pack, one game version, against an implementation
   that is structurally different rather than equivalent. First step is cheap and settles the whole
   item: read `RgspToManipulations` (`PmpExtensions.cs`) and establish struct coverage. Total coverage
   makes this a behaviour-preserving refactor pinnable against Milktruck's golden; anything less is a
   live divergence waiting on the right input. Ranked above the site per this list's own note that
   small, unbounded correctness holes outrank a large, well-understood build — the same reasoning that
   placed the empty-group item there in the 2026-08-03 pass. Operator call, 2026-08-07.

4. [**Re-measure the ±1 BCn decoder divergence, and decide whether to reconverge on `DxtUtil`**](backlog/2026-07-16-bcn-decoder-rounding-divergence.md)
   — upstream **rewrote** `DxtUtil.cs` in `371f74b` (found while verdicting it for the v3.1.1.4
   re-pin), and that moved both of this item's load-bearing premises. (a) The file is now **GPL-3.0**,
   not FNA's Ms-PL, so the clean-room constraint is lifted and a **direct port is legally available**
   — DXT1/3/5 and BC4 are a fresh in-house implementation (`DxtUtil.cs:154,166,203,241`), while BC5/BC7
   still delegate to `JeremyAnsel.BcnSharp` (`:44`, `:52`), confirming only the `DxtUtil` formats were
   ever drift candidates. (b) More importantly, **our measurement is now stale**: the ±1 figures in the
   item (9099/65536 on `eye01_base`) were taken against the old FNA decoder that no longer exists at
   our pin, so the current divergence is *unmeasured*. Ranked here — above the site — because of what
   that implies rather than the port effort: we carry a `DIVERGENCE_RULES` ±1 tolerance over **every**
   generated A8R8G8B8 `.tex`, and if the rewrite happens to round the way we do, that tolerance is now
   unnecessary and is silently absorbing any future ±1 regression across the whole texture path. A
   tolerance resting on a false premise is a class-1 risk (silent wrong output), not a cosmetic one.
   The deciding step is cheap and needs no new code: re-run the existing two-texture repro against the
   v3.1.1.4 oracle and see which of three worlds we are in — gap closed (retire the tolerance), gap
   unchanged (port it, now directly), or gap changed shape (re-characterize). Do that before writing
   any decoder code. Operator call, 2026-08-07.

5. [**Reconsider line numbers in TexTools citations**](backlog/2026-08-08-citation-line-numbers-maintenance.md)
   — `file · symbol · lines` costs ~1,374 line-number citations across 173 files, all of which have to
   be re-pointed at every re-pin. Not a correctness item; a recurring tax with a bad failure mode. A
   stale line number points *confidently at unrelated code* rather than at nothing (live example: three
   sites still cite `Tex.cs:138` for a guard `1993bf6` deleted, and `Tex.cs:138` is now a real line with
   unrelated content), it cannot be checked mechanically the way a file, symbol or quoted fragment can,
   and re-pointing it is dangerous — the v3.1.1.4 sweep took two fix rounds and produced a
   wrong-but-confident rewrite in *each* automated pass. Sketch: keep `file · symbol`, replace line
   numbers with a quoted code fragment where sub-symbol precision genuinely matters, then add a checker
   that verifies file + symbol + fragment. Changes a rule AGENTS.md states, so the decision is recorded
   there too. Ranked above the site because it is cheap and the tax compounds with every re-pin, below
   the two items above it because nothing is actually wrong today. Operator call, 2026-08-08.

6. **Round 7 — the site itself** (design §8.1 row 7, still unspecced; no UI spec exists among the
   41 in `docs/superpowers/specs/`). The long pole by effort, but the lowest-risk item here: the seam
   is already clean (`Uint8Array → Uint8Array`, `loadModpack`/`upgradeModpack`/`writeModpack`) and
   there are no correctness unknowns. Comprises: an app entry + `vite.config.ts` off `build.lib`
   (it currently emits no HTML page); a **Web Worker** (`upgradeModpack` is synchronous and
   CPU-bound, so it freezes the tab); **lazy-loading the reference tables** (~3.23 MB of `src/` is
   eagerly-evaluated generated tables, `imc-table.ts` alone 2.34 MB constructing a `Map` at module
   load); and surfacing the fail-loud guards and the `diagnostics` channel (shipped 2026-08-02) as
   user-facing "this modpack isn't supported because…" / "these files were skipped" messages. One
   hard constraint: cross-format conversion is not supported, so the UI must **not** offer an
   output-format picker. Read the enforcement carefully, though — `writeModpack`'s guard
   (`src/index.ts:87-98`) is a **per-file** storage scan, not a format check, so a pack carrying zero
   files crosses formats without tripping it (`docs/backlog/2026-08-08-writemodpack-per-file-format-guard.md`,
   filed 2026-08-08). The UI constraint is unaffected — there is still no picker to offer — but the
   site must not treat that throw as its only line of defence. Nothing blocks *starting* it, and its one real dependency (a
   diagnostics channel, so the page cannot report success on a partial upgrade) cleared 2026-08-02 —
   so its position here is the rubric's doing, not a dependency's: items 3-4 above it are class-1
   correctness unknowns and this is class 3, while items 1-2 are ranked on completed analysis and an
   unmet evidence bar respectively, and item 5 on cheapness rather than on the rubric.

7. **Widen the corpus to vet the product.** Bounded product-vetting work with specific goals, not
   maintenance: the corpus is how every gap on this list was found, and widening it is how we
   establish that the shipped page handles what real users will actually upload. It is **85 real
   packs** (121 total, incl. 29 synthetic and 7 expected-failure — the empty-group-and-DataPages work
   (2026-08-04) added 8 synthetic + 2 upgrade-error) on one machine, gitignored, with no
   CI. Code coverage was strong at the last measurement (92.98% lines / 84.6% branches as of
   2026-07-20 — the 0% files are re-export barrels), so the residual risk is **data and inputs, not
   code paths**, which is exactly what more packs buy and coverage cannot; this is the only entry
   that finds the unknown-unknowns. ⚠️ **Acceptance criteria are unrecorded** — the operator has
   specific goals for this (stated 2026-08-03) that are not yet written down here, and until they are
   this entry cannot be checked off. Write them in before picking the item up. See also design §8.4's
   thin-coverage note.

8. **The two remaining `writeTtmp2` manifest items** — [`Name`/`Category` re-derivation](backlog/2026-07-13-resave-ttmp2-name-category.md)
   and [option file order](backlog/2026-07-13-resave-ttmp2-option-file-order.md). They share the same
   entries — every `ModsJsons/N/*` entry in `.upgrade-baseline` is one or the other (a re-derived
   `Name`/`Category`, or a `FullPath`/`DatFile` shifted by ordering) — **2490 of the 3002 entries
   (83%), across 42 packs**, by count still by far the largest divergence from the golden. Ranked
   here rather than higher because the impact is cosmetic (re-derived display strings, file
   ordering). **They were previously filed under *Unprioritized → `/resave` findings***, behind that
   section's caveat that a `/resave` divergence is not automatically an `/upgrade` bug — true in
   general, but the `.upgrade-baseline` data shows these specifically *do* reach `/upgrade`. Moved
   here 2026-07-20; the remaining `/resave` findings stay where they are. Their third sibling, the
   missing `.mpl` fields (`IsChecked`, `ModPackEntry`, the null `SimpleModsList`/`ModPackPages`
   sibling, verbatim-null descriptions), **shipped 2026-07-20** and removed 2809 of the then-5811
   entries; see `docs/superpowers/specs/2026-07-20-ttmp2-mpl-manifest-fidelity-design.md`.

9. [PMP `structure` diffs are tex-payload shadows, not a `common/N` numbering bug](backlog/2026-07-21-common-n-tex-hash-shadows.md)
   — the ~42 non-orphan `structure` entries in `.upgrade-baseline`. ~22 are `diffPayloadMembers`
   (`upgrade-archive-diff.ts:335`) re-reporting a `.tex`/`.mdl` `payload` mismatch under the zip member
   name (19/19 verified as also `payload` entries); ~20 are `common/N` mismatches that look like a
   dedup **numbering** bug but aren't — our resized/decoded texture bytes fall into a different
   content-hash equality class in `ResolveDuplicates` (`PmpExtensions.cs:518,537-550`), shifting the
   `common/{idx}` assignment (100 % of those basenames are themselves payload-divergent `.tex`, across
   Marcellus / Romeo & Juliet / Constellation Crown). **Ranked last: cosmetic** (Penumbra keys on the
   redirect table, so a renumbering is runtime-equivalent) **and not independent work** — it is
   *derivative of the `.tex` payload work*, carrying no fix of its own but a verification gate: it
   burns down as the `.tex`
   payload bulk (design §8.3) does, and only a `common/N` entry that *survives* byte-matching textures
   is a genuine numbering-input divergence that would then earn its own investigation against
   `resolve-duplicates.ts`. Filed 2026-07-21 from the trace that also re-scoped the orphan item below.

## Unprioritized

### PMP write path

- [Port `.meta`/`.rgsp` → `Manipulations` conversion](backlog/2026-07-13-pmp-write-meta-rgsp-manipulations.md)
  — `writePmp` throws where `PopulatePmpStandardOption` converts. Unreachable today (only a TTMP→PMP
  format conversion could reach it, and no upgrade flow performs one), so it is a fail-loud guard
  waiting on a product decision.
- [`WizardHelpers.WriteImage` re-encode is unported](backlog/2026-07-13-pmp-writer-image-reencode.md)
  — option/group/meta `Image` fields and their zip members are carried through verbatim rather than
  re-encoded to a 16-bit PNG under a new name. Deliberate: no image encoder in this repo. Real corpus
  packs diverge on this today.
- [Manipulation normalization fails loud on a missing field](backlog/2026-07-13-pmp-manipulation-field-defaults.md)
  — instead of emitting the C# type's own default for an omitted key. The honest fix needs each
  field's exact C# enum and its zero-value member name. No corpus manipulation omits a field.
- [Split `writePmp`](backlog/2026-07-13-split-writepmp-module.md) — it blends `PMP.WritePmp` and
  `WizardData.WritePmp` into one module, against "split, don't blend". Pure reorganization; needs its
  own careful pass because a mechanical refactor here risks byte-parity regressions with no new test
  signal.
- [PMP writer drops unreferenced source zip members TexTools retains](backlog/2026-07-17-pmp-writer-orphan-member-retention.md)
  — ConsoleTools leaves the original source members in the rewritten archive after re-pointing every
  `Files` entry; ours emits only referenced members, so each orphan is a `structure`/`added` diff.
  A slice of the "container-manifest structure" gap (design §8.3), baselined on real packs and the
  synthetics; `highlight.pmp`'s pure-orphan shape surfaced it explicitly. Not a regression. **Traced
  2026-07-21** (C# path is `WritePmp`, PMP.cs:830-868): this is only **~5** baselined `structure`
  entries (`added`/`removed` shaped). The other ~42 are a *different*, tex-payload-shadow phenomenon —
  the tex-payload-shadow item in the *Prioritized* list above.
- [Writer always emits `FileSwaps: {}`; Penumbra omits the key when empty](backlog/2026-07-18-empty-vs-omitted-fileswaps-key.md)
  — `pmp.ts:446` unconditionally serializes `FileSwaps`, but Penumbra's own writer (`SubMod.cs`,
  separate repo) omits the key when the map is empty, same as `Files`. Only visible against a raw
  Penumbra export (a `/upgrade` no-op or an otherwise-untouched `/resave` option) since TexTools'
  own writer currently emits `{}` unconditionally too (its matching `ShouldSerialize*` overrides are
  commented out, `PMP.cs:1519-1524`). Surfaced as `Flower Child - by Solona.pmp`'s
  `default_mod.json#/FileSwaps` baseline entry — unrelated to FileSwap preservation itself, which the
  carve-out only confirms in the opposite (populated-vs-empty) direction.

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
- **Two `writeTtmp2` manifest items moved to the Prioritized list** (2026-07-20): `Name`/`Category`
  re-derivation and option file order. They were filed here on the reasoning at the top of this
  section — that a `/resave` divergence need not be an `/upgrade` bug — but they are 2490 of the 3002
  `.upgrade-baseline` entries, so for these two that caveat does not hold. (A third, the missing
  `.mpl` fields, moved with them and has since shipped.)
- [`/resave`'s `diffArchives` call never forwards `confirmDivergence`](backlog/2026-07-18-resave-confirmdivergence-not-forwarded.md)
  — unlike `corpus-upgrade.ts`, so a `DIVERGENCE_RULES` entry that would *confirm* a payload-member
  mismatch under `/upgrade` is merely baseline-suppressed under `/resave` instead — not documented,
  per AGENTS.md. Pre-existing, surfaced while auditing both call sites for FileSwap preservation's
  `layoutEquivalent` parameter. Fixing it will shrink several packs' `/resave` baselines, so it needs
  its own deliberate re-bless.

### Textures

- [`MergePixelData`'s BC re-encode is unported, and the NPOT mask path diverges because of it](backlog/2026-07-22-bc-encoder-merge-pixel-data.md)
  — an **accepted, operator-adjudicated divergence** (2026-07-22), not a silent gap: `resizeToPow2ForMerge`
  elides the nvtt re-encode `Tex.ResizeXivTx` performs (`Tex.cs:637-706`), which is exact for a lossless
  source (`A8R8G8B8` → `BGRA`, measured byte-identical) and exact on the index path (quantization absorbs
  it), but reaches the output bytes on the mask path. Bracketed by three synthetic packs: smooth content
  max delta **9**, adversarial content max delta **116**. **Stays unprioritized on rank (2026-07-25
  survey: leverage-not-urgency, large standalone effort), but its "zero corpus packs reach it" basis is
  now corrected** — the `ValidateTexFileData` load-seam port (see the 2026-07-25 dated pass note above)
  reaches the identical `MergePixelData` BC-reencode gap for real, via
  `KK_Sportcar_Final_Hotfix_V1.1.1.ttmp2` (see the item file's Reachability section). Uniquely on this
  list it has **no**
  `DIVERGENCE_RULES` entry — a tolerance was considered and rejected because, unlike the global `.tex` ±1
  rule, there is no provable bound to pin one to. Closing it means a BC encoder matching TexImpNet/nvtt.
- [`[Inako] Lilith Wish.pmp` — `/resave` diverges on ~30 eye/face `.tex` payloads](backlog/2026-07-17-lilith-wish-resave-tex-divergence.md)
  — every mismatch is `ours.length === golden.length + 80`, a constant excess regardless of texture
  size (not the known ±1 BC-decode tolerance). Pre-existing writer/codec gap, unrelated to this
  branch; the pack is scoped to the `upgrade` expected-failure check only (`upgrade-error` corpus
  root), so `/resave` is UNVERIFIED for it.
- [T2 — full `FixOldTexData` load-time round](backlog/2026-07-10-fixoldtexdata-load-round.md) — we
  ported only the drop-malformed slice. Unported: the NPOT resize (needs T3's resampler) and the
  mip-offset-table fixup, which `/resave` now empirically forces (same format, same length, differing
  header bytes). The offset half needs no resampler and can land independently.
- [PMP load-time `.tex` fixup (`FastValidateTexFile`)](backlog/2026-07-13-pmp-load-time-tex-fixup.md)
  — a *different* gap from T2 (PMP-load-gated, not TTMP): shares `FixUpBrokenMipOffsets` (now ported,
  ready to wire) but also truncates trailing null padding, which remains unported. Blast radius is
  bigger than a byte diff — dedup keys on loaded content, so it changes `common/N` **member names**.
  Must land before member-name parity is complete.
- [Synthetic `/upgrade` goldens for the `ValidateTexFileData` load-seam port](backlog/2026-07-25-validate-tex-load-seam-synthetics.md)
  — the load-seam resize (Branch A) and mip-offset fixup (Branch B) shipped 2026-07-25 with unit +
  real-corpus coverage but no dedicated synthetic pack golden through the real oracle. Needs
  `ttmp2-builder.ts` changes (an old-`TTMPVersion` param, a Type-4 tex payload writer) to build.

### Metadata

- [v1 metadata support](backlog/2026-07-11-v1-metadata-support.md) — `deserialize.ts` throws on
  `version !== 2`. A probe confirmed ConsoleTools upgrades v1→v2 by injecting base-game data; EST
  injection is portable today, GMP needs a reference table round 5 never extracted. Extinct in the
  wild (0 of 1431 corpus metas).
- [EQDP reconstruction drops mod rows for non-playable races](backlog/2026-07-10-eqdp-non-playable-races.md)
  — C# keeps every race the mod carries and backfills; we emit exactly the 18 playable ones.
  Unreachable today (game EQDP files are playable-race-scoped).

### Other ported code

- [`writeModpack`'s cross-format guard is per-FILE, not per-format](backlog/2026-08-08-writemodpack-per-file-format-guard.md)
  — it infers the format from each file's `storage` and never reads `data.sourceFormat`, so a model
  carrying **no files** crosses formats silently. Measured 2026-08-08: a PMP whose only group is a
  Penumbra `Combining` group with empty containers wrote a 605-byte `.ttmp2`. The wrong-output hole
  that exposed it is closed loudly at the seam (`src/container/ttmp2.ts`, `UnportedGapError`); this
  is the underlying guard, whose fix has to audit every hand-built `ModpackData` fixture.
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
- [`MetaRoot.slot` is no longer read by any production code](backlog/2026-07-19-metaroot-slot-unread.md)
  — re-keying `IMC_TABLE` on the `.meta` root path removed the field's last consumer, so only tests
  read it now. Kept deliberately (it mirrors `XivDependencyRootInfo.Slot`), but the weapon/monster
  value is a **fabricated placeholder** (`"body"`) where the C# leaves `Slot` unset — inert only
  while nothing reads it. Decide: drop the field, or type it `string | null` and return null there.
- [`ModpackGroup.defaultSettings` is now write-only](backlog/2026-07-20-modpack-group-defaultsettings-unread.md)
  — giving `ModpackOption` a real `selected` flag turned `groupSelection` into the direct port of the
  `Selection` getter (`WizardData.cs:578-604`), removing the field's last consumer; every load path
  still assigns it and nothing in `src/` reads it. Same shape as the `MetaRoot.slot` item above, but
  **milder**: the stored value is honest rather than a fabricated placeholder, so it is inert, not a
  trap. Decide: drop it, or keep it as the mirrored `PMPGroupJson.DefaultSettings` member.
- [Audit the port for TexTools bugs we already reproduce](backlog/2026-07-12-textools-bug-register-audit.md)
  — `docs/TEXTOOLS_BUGS.md` was seeded, not swept. Adjudicate the remaining candidates (EQP set-0
  omission, `PlayableRaces` race-order, `MakePMPPathSafe`'s platform-dependent invalid-char set)
  bug-vs-quirk and register the genuine defects.
- [`vNormalize` doesn't reproduce SharpDX's zero-tolerance normalize behaviour](backlog/2026-07-24-vnormalize-zero-tolerance.md)
  — the tangent recompute's `vNormalize` guards only exactly-zero length, where SharpDX
  `Vector3.Normalize` / TexTools' `.Normalized()` (`ModelModifiers.cs:2225-2226`) leave the vector
  unchanged below a ~1e-6 zero-tolerance. Latent (degenerate-geometry-only; no corpus model's
  recompute reaches it) and deferred because the extension's source isn't vendored in `reference/`.
- [Sweep the rest of `src/` for catches that can absorb an `UnportedGapError`](backlog/2026-07-31-unported-gap-error-sweep.md)
  — `feat/complete-file-exists-oracle`'s fix round 2 introduced `UnportedGapError` (the signal that
  THIS PORT hasn't reproduced something, as distinct from a C#-reachable failure) and retagged
  exactly the `file-exists.ts` out-of-chara throw and `mtrl/serialize.ts`'s empty-sampler placeholder
  gap, both reached through `materialRound`'s catch. A full audit found three more catches that can
  still silently absorb a port gap (`load-fixes.ts:121` mdl load fix, `unclaimed-hair.ts:211`'s
  bare catch-all which used to have a typed gap here and lost it, `load-fixes.ts:109` tex load fix —
  lower confidence, needs case-by-case adjudication) plus four uncaught fail-loud guards that should
  be retagged as future-proofing. Recorded verbatim rather than fixed; each retag can change which
  corpus packs pass today's ratchet baselines and needs the same scrutiny as a byte-moving fix.

### Harness & housekeeping

- [`readLegacyTtmp` silently returns an empty pack when fed a non-legacy (zip) archive](backlog/2026-07-17-harness-legacy-ttmp-reread-format.md)
  — the harness re-read seam that exposed this (a legacy `.ttmp` written as ttmp2, re-read under the
  `.ttmp` name → empty → whole-pack phantom `added`) is **fixed**; both harnesses now re-read under the
  written `target`. What remains is the fail-loud half: `readLegacyTtmp` should throw on a zip (the
  `PK` magic) instead of yielding empty, so a future miswire is loud rather than a silent phantom diff.
- [`/resave` asserts nothing when its oracle errors](backlog/2026-07-19-resave-oracle-error-skips-all-assertions.md)
  — it skips (loudly, and correctly — the one such error is environmental, TexTools reading the
  installed game's `human.cmp`) *before* running the checks that need no golden: the
  write→re-read→compare round-trip and `pmpSelfConsistency`. Matters because
  `Milktruck Bust Scaling Tweaks v1.0.0.ttmp2` is both a `/upgrade` no-op and a `/resave` oracle
  error, so nothing in either harness compares its written output to anything. Fixable entirely
  inside `/resave`, with no crosstalk between the harnesses. Do **not** close it by asserting a
  matched failure — the item explains why that is wrong here.
- [Make the ConsoleTools oracle async, so the lock can heartbeat](backlog/2026-07-13-consoletools-oracle-async-lock.md)
  — the hand-rolled mutex breaks "stale" locks on a guess. A heartbeat is the proper fix but needs
  the `execFileSync` critical section gone first. Operator's call (2026-07-13): keep the hand-rolled
  lock for now.
- [Expected-failure golden capability](backlog/2026-07-11-expected-failure-golden.md) — **done** (both
  halves: `/resave` 2026-07-13, `/upgrade` 2026-07-17 via Trace-channel capture). Kept, not deleted:
  it is the cited design-rationale doc for the expected-failure design (referenced by the `/resave`
  and `/upgrade` harness code and other specs).
- [Serial cache-warm entry point for the corpus](backlog/2026-07-12-corpus-cache-warm-entry-point.md)
  — a cold corpus still pays for each ConsoleTools spawn serially inside the parallel test run.
- [Nothing prunes baselines/goldens for packs that no longer exist](backlog/2026-07-14-orphaned-baseline-cache-entries.md)
  — they are keyed by `sha256(input pack)`, so re-keying a pack strands its old entries (4 baselines,
  13 cached goldens today). Cheap in disk, but it makes the file counts lie during a bless. The trap:
  the corpus is gitignored and often partial, so a naive "delete what no pack references" pruner would
  wipe every real pack's baseline on a fresh clone — and a missing baseline reads as "no known
  divergences", not as an error.
- [Mutation testing as a latent-divergence detector](backlog/2026-08-01-mutation-testing-latent-divergence.md)
  — the general instrument for "control flow differs but bytes match": a decision our port makes that
  no corpus input distinguishes. A surviving mutant is literally that failure mode, and unlike a
  golden diff it needs no oracle (goldens are cached), while its output is a worklist of synthetics to
  author — feeding the existing `scripts/generate-synthetics/` loop. Report-only, per-directory,
  never in the `npm test` gate. Filed 2026-08-01 from the diagnostics-channel design, which rejected a
  narrower trace-based oracle for addressing only a keyhole of this class. Costs to size first:
  runtime, Stryker-vs-custom-runner integration, and equivalent-mutant triage.
- [Audit temp-dir usage for leaks](backlog/2026-07-10-temp-dir-leaks.md) — several `mkdtempSync`
  sites never remove their directory; the two worst run on every `npm test`.
- [Vet page-load and upgrade-operation performance](backlog/2026-07-11-webapp-performance-vetting.md)
  — once a real webpage exists. Profile before presuming a culprit.
- [`diffArchives`' payload-member `confirmDivergence` call passes a prefixed name, not the bare
  gamePath](backlog/2026-07-16-archive-diff-prefixed-gamepath.md) — a future path-scoped
  `DIVERGENCE_RULES` predicate written as `.startsWith("chara/...")` would silently never fire from
  this call site. Document/guard, not fix — recovering the true gamePath at that layer isn't
  feasible without threading the option structure through.
- [`diffPayloadSemantic` part 2 has narrower coverage than a casual read suggests](backlog/2026-07-18-semantic-payload-part2-coverage.md)
  — the FileSwap relaxed-comparison mode's name-only pass filters `common/`-prefixed names out
  entirely (a one-sided orphan inside `common/` is invisible) and never byte-compares a payload
  member no `Files` value names (an `Image`, an `ExtraFiles` entry). Only affects the 2 corpus packs
  on the relaxed path today; doc comment now states both gaps precisely, behaviour unchanged.
- [Index-path resolver — deferred follow-ups](backlog/2026-07-20-index-extractor-tooling-nits.md) —
  three low-priority nits from the index-path resolver work: `game-index.ts` extraction-tooling naming/
  overflow/redundant-read (never shipped, correct on current data), a duplicated `RACES` grid across
  `extract-*` scripts (down to two copies since `feat/complete-file-exists-oracle` deleted the third,
  2026-07-31), and the one uncovered test direction (gate-B *suppression*, behaviourally hard to
  observe). None block correctness.
