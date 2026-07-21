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

Roughly highest-priority first (prioritization pass **2026-07-20b**, superseding 2026-07-20 and
2026-07-17). **2026-07-21 insertion:** the minion/mount/furniture corpus expansion added three
corpus-found items at the top (1 `bgcommon` housing-meta crash, 2 silent mount `_id.tex` gap, 3
furniture `.mdl` overrun), shifting the former 1–8 to 4–11; item 1's top slot is an operator directive.

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

1. [`bgcommon` housing/furniture `.meta` roots are unsupported — the whole upgrade throws](backlog/2026-07-21-bgcommon-housing-meta-root-unsupported.md)
   — `parseMetaRoot` throws `unrecognized root path` on `bgcommon/hou/{indoor,outdoor}/…/{i,o}####.meta`,
   and because `metadataRound` runs `reconstructMeta` on **every** `.meta`, that throw unwinds out of
   `upgradeModpack` — a furniture pack produces **no output at all**. TexTools parses `bgcommon` housing
   as a first-class root (`XivDependencyGraph.cs:257` `HousingExtractionRegex`) and never errors on
   these: `SM-Cherry Blossom Upscale` is a golden `.noop`, `raykie` a full 17.7 MB golden. So we crash
   where the oracle succeeds, on an entire content class (every furniture mod carrying a `.meta`).
   **Placed at #1 per operator directive (2026-07-21), which overrides the "silent above loud" ordering
   note below** — this is a *loud* crash, but its breadth (a whole content class the deployed page will
   receive) and confirmed divergence earn the top slot. Companion to item 3 (furniture `.mdl`); together
   they are "bgcommon housing/furniture support". Found by the minion/mount/furniture corpus expansion,
   2026-07-21.

2. [A mount/monster material's generated `_id` index texture is silently missing from our output](backlog/2026-07-21-monster-index-tex-generation-gap.md)
   — **the one new item in the worst rubric class: silent wrong output.** `Club Cyberia Motorbike`
   (mount, monster root `m0242`) upgrades with no error, but our output omits
   `v01_m0242b0001_n_c_id.tex` that TexTools generates in all 12 options — we emit no `_id` map for the
   material at all (no rename/dedup counterpart). Not covered by item 5 (`hair-texture-exists`, a *hair*
   namespace) — this is a *monster* root, and the gap is in round-4 index-map **generation**, not sampler
   path resolution. Ranked below the housing crash only because it is narrow (one known pack) and the
   root cause is not yet traced (symptom confirmed, cause TBD). Found 2026-07-21.

3. [Furniture `bgparts` `.mdl` overruns `modelDataSize` — codec throws on a subset](backlog/2026-07-21-furniture-bgparts-mdl-overrun.md)
   — `parseMdl`'s no-overrun gate throws on some furniture background-part models (`fun_b0_m0613.mdl`
   1601 > 641; `gar_b0_m0193.mdl` 1118 > 1022), while most furniture models round-trip fine — so a
   specific non-chara section-size bug (candidate: `furniturePartBoundingBoxCount`), not blanket bg
   unsupport. The `.mdl`-codec spec anticipated this fail-loud but no item tracked it; the corpus now
   reaches it (`Crystal-Striking-Goddess`, `raykie`). Companion to item 1. Found 2026-07-21.

4. [T3 — ImageSharp Bicubic resampler](backlog/2026-07-10-imagesharp-resampler.md) — **resolves the
   remaining `TextureResizeUnsupported` throws on NPOT sources** (a functional gap, not just a byte
   diff). The resampler is now wired into the hair round (`updateEndwalkerHairTextures`, closing the
   `Misty_Hairstyle_Female`/`Eliza` baselined resize skips); `createIndexFromNormal`/`upgradeMaskTex`
   NPOT-normalize and T2's NPOT resize still throw and remain open. Real cases exist. Ranks here
   rather than lower because in the hair path the throw is *swallowed* by the reproduced TexTools
   catch-all (`unclaimed-hair.ts:197`), making it a silent partial upgrade rather than a loud failure.

5. [`hair-texture-exists` is namespace-scoped but asked out-of-namespace questions](backlog/2026-07-20-hair-texture-exists-namespace-scope.md)
   — the last remaining silent-fallback table of this shape; its sibling (`index-path-overrides`)
   shipped a complete, item-seeded enumeration 2026-07-20
   (`docs/superpowers/specs/2026-07-20-index-path-resolution-design.md`,
   `scripts/extract-index-table.ts`) — the template this item should adopt. A hair material may bind a
   sampler path outside the bundled hair/zear/tail texture namespace (a `chara/common/…` mashup, or an
   id > 500); the oracle answers a hard `false`, silently suppressing a rename TexTools would perform.

6. **A diagnostics channel out of `upgradeModpack`.** *(No item file yet — needs a design decision
   first, so it is described here rather than filed.)* `unclaimed-hair.ts:197-204` faithfully
   reproduces TexTools' bare `catch { continue }` (`docs/TEXTOOLS_BUGS.md` #12), swallowing both the
   modeled `TextureResizeUnsupported` gap and genuine parse failures. Reproducing it is **correct** —
   but TexTools writes a `Trace` line and a webpage writes nothing, so the page would report success
   on a partial upgrade. This is the one place where faithfully matching TexTools' behaviour still
   leaves the *user* worse off, which makes a warnings channel a port-level requirement rather than
   UI polish. Note it is not a divergence: the transform behaviour stays identical, we only surface
   what was skipped.

7. **Round 7 — the site itself** (design §8.1 row 7, still unspecced; no UI spec exists among the
   33 in `docs/superpowers/specs/`). The long pole by effort, but the lowest-risk item here: the seam
   is already clean (`Uint8Array → Uint8Array`, `loadModpack`/`upgradeModpack`/`writeModpack`) and
   there are no correctness unknowns. Comprises: an app entry + `vite.config.ts` off `build.lib`
   (it currently emits no HTML page); a **Web Worker** (`upgradeModpack` is synchronous and
   CPU-bound, so it freezes the tab); **lazy-loading the reference tables** (~3.23 MB of `src/` is
   eagerly-evaluated generated tables, `imc-table.ts` alone 2.34 MB constructing a `Map` at module
   load); and surfacing the fail-loud guards as user-facing "this modpack isn't supported because…"
   messages. One hard constraint: `src/index.ts:80-84` rejects cross-format conversion, so the UI
   must **not** offer an output-format picker. Should start in parallel with 1-4, not after them.

8. **Widen the corpus.** Every gap on this list was found by the corpus; it is 70 packs on one
   machine, gitignored, with no CI. Code coverage is strong (92.98% lines / 84.6% branches — the 0%
   files are re-export barrels), so the residual risk is **data and inputs, not code paths**, which
   is exactly what more packs buy and coverage cannot. This is the only entry that finds the
   unknown-unknowns, and it is a standing activity rather than a task with a done state. See also
   design §8.4's thin-coverage note.

9. [Both C# loaders drop a zero-option group; our readers keep it](backlog/2026-07-20-empty-group-not-dropped.md)
   — **the highest-severity item that no corpus pack reaches.** Rubric class #1: a group TexTools
   drops from the wizard model entirely survives our TTMP read and gets re-emitted, so the user's
   upgraded pack carries a group the golden does not, with no diff to warn us (no baseline entry
   exists — it came from reading the C#, not from an oracle). Ranked here rather than lower on the
   **deploying-changes-the-probability-term** note above: a zero-option group is hand-authorable, and
   corpus silence is the only thing holding its probability down. Cheap to close and cheap to prove —
   a synthetic pack with an authored empty group gets a real ConsoleTools golden. Note the PMP half
   is already masked downstream by `groupHasData` (by the same predicate C# uses), so the genuinely
   open surface is the TTMP path. **Moved here from *Unprioritized → Other ported code*, 2026-07-20b.**

10. **The two remaining `writeTtmp2` manifest items** — [`Name`/`Category` re-derivation](backlog/2026-07-13-resave-ttmp2-name-category.md)
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

11. [PMP `structure` diffs are tex-payload shadows, not a `common/N` numbering bug](backlog/2026-07-21-common-n-tex-hash-shadows.md)
   — the ~42 non-orphan `structure` entries in `.upgrade-baseline`. ~22 are `diffPayloadMembers`
   (`upgrade-archive-diff.ts:335`) re-reporting a `.tex`/`.mdl` `payload` mismatch under the zip member
   name (19/19 verified as also `payload` entries); ~20 are `common/N` mismatches that look like a
   dedup **numbering** bug but aren't — our resized/decoded texture bytes fall into a different
   content-hash equality class in `ResolveDuplicates` (`PmpExtensions.cs:518,537-550`), shifting the
   `common/{idx}` assignment (100 % of those basenames are themselves payload-divergent `.tex`, across
   Marcellus / Romeo & Juliet / Constellation Crown). **Ranked last: cosmetic** (Penumbra keys on the
   redirect table, so a renumbering is runtime-equivalent) **and not independent work** — it is
   *derivative of #1*, carrying no fix of its own but a verification gate: it burns down as the `.tex`
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
- [`buildPages` is called twice per `writePmp`](backlog/2026-07-13-buildpages-called-twice.md) —
  wasted recomputation, not a correctness bug. Bundle with the split above.
- [PMP writer drops unreferenced source zip members TexTools retains](backlog/2026-07-17-pmp-writer-orphan-member-retention.md)
  — ConsoleTools leaves the original source members in the rewritten archive after re-pointing every
  `Files` entry; ours emits only referenced members, so each orphan is a `structure`/`added` diff.
  A slice of the "container-manifest structure" gap (design §8.3), baselined on real packs and the
  synthetics; `highlight.pmp`'s pure-orphan shape surfaced it explicitly. Not a regression. **Traced
  2026-07-21** (C# path is `WritePmp`, PMP.cs:830-868): this is only **~5** baselined `structure`
  entries (`added`/`removed` shaped). The other ~42 are a *different*, tex-payload-shadow phenomenon —
  now item 11 in the *Prioritized* list above.
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

- [`[Inako] Lilith Wish.pmp` — `/resave` diverges on ~30 eye/face `.tex` payloads](backlog/2026-07-17-lilith-wish-resave-tex-divergence.md)
  — every mismatch is `ours.length === golden.length + 80`, a constant excess regardless of texture
  size (not the known ±1 BC-decode tolerance). Pre-existing writer/codec gap, unrelated to this
  branch; the pack is scoped to the `upgrade` expected-failure check only (`upgrade-error` corpus
  root), so `/resave` is UNVERIFIED for it.
- [Deepen / re-evaluate the known ±1 BCn decoder divergence vs TexTools](backlog/2026-07-16-bcn-decoder-rounding-divergence.md)
  — the ±1 BCn value-rounding gap (our bc7enc_rdo port vs TexTools' FNA `DxtUtil`) is already
  documented (`decodeBc5`) and already absorbed by the `.tex` ±1 `DIVERGENCE_RULES` tolerance, so it
  does not fail the suite. New here: a measurement vs TexTools' actual decoder (9099/65536 bytes on
  `eye01_base`, all ±1) confirming it extends to **DXT1**, and the re-evaluation — the tex-codec spec
  §7 justified the bc7enc choice on "any spec-conformant decoder matches byte-for-byte," which this
  falsifies. Decide: keep accepting the tolerance, or eliminate it via a clean-room match of
  `DxtUtil`'s rounding (validated against its output, not transcribed — it is Ms-PL).
- [T2 — full `FixOldTexData` load-time round](backlog/2026-07-10-fixoldtexdata-load-round.md) — we
  ported only the drop-malformed slice. Unported: the NPOT resize (needs T3's resampler) and the
  mip-offset-table fixup, which `/resave` now empirically forces (same format, same length, differing
  header bytes). The offset half needs no resampler and can land independently.
- [PMP load-time `.tex` fixup (`FastValidateTexFile`)](backlog/2026-07-13-pmp-load-time-tex-fixup.md)
  — a *different* gap from T2 (PMP-load-gated, not TTMP): shares `FixUpBrokenMipOffsets` but also
  truncates trailing null padding. Blast radius is bigger than a byte diff — dedup keys on loaded
  content, so it changes `common/N` **member names**. Must land before member-name parity is complete.

### Metadata

- [v1 metadata support](backlog/2026-07-11-v1-metadata-support.md) — `deserialize.ts` throws on
  `version !== 2`. A probe confirmed ConsoleTools upgrades v1→v2 by injecting base-game data; EST
  injection is portable today, GMP needs a reference table round 5 never extracted. Extinct in the
  wild (0 of 1431 corpus metas).
- [EQDP reconstruction drops mod rows for non-playable races](backlog/2026-07-10-eqdp-non-playable-races.md)
  — C# keeps every race the mod carries and backfills; we emit exactly the 18 playable ones.
  Unreachable today (game EQDP files are playable-race-scoped).

### Other ported code

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
  overflow/redundant-read (never shipped, correct on current data), the third copy of the `RACES` grid
  across `extract-*` scripts, and the one uncovered test direction (gate-B *suppression*, behaviourally
  hard to observe). None block correctness.
