# Housing/`bgcommon` `.meta` drop — Design & handoff

**Date:** 2026-07-21
**Status:** Implemented 2026-07-21. §6's empirical check was run and confirmed the premise — all six
housing metas across both corpus packs deserialize to **zero** segments, so only the drop path is
reachable from the corpus. Three corrections found during implementation, applied in the shipped code:

1. §4's segment list must gate **EST and IMC** on non-empty, not merely non-null
   (`PmpExtensions.cs:436,456` use `Count > 0`) — but **not** EQDP. `DeserializeEqdpData`
   unconditionally backfills all 18 `Eqp.PlayableRaces` after parsing (`ItemMetadata.cs:779-788`), so
   `PmpExtensions.cs:446`'s `Count > 0` can never be false for a present segment there; the shipped
   `yieldsManipulations` (`src/meta/manipulations.ts`) mirrors that *effective* gate with a bare
   non-null check for EQDP instead of porting the literal `Count > 0` text.
2. §4 step 3 required **no new code** — an IMC segment makes the predicate true, so control falls
   through to `parseMetaRoot`'s existing throw.
3. **The drop moved seams.** §4 as originally written put the drop inside `metadataRound.fixOne` (the
   upgrade transform). A corpus run showed that was the wrong seam — it broke a genuine `/upgrade`
   no-op pack — so the drop was relocated to the **load** fix (`makeTtmpLoadFix`,
   `src/upgrade/load-fixes.ts`), with the segment-presence predicate extracted to
   `yieldsManipulations` (`src/meta/manipulations.ts`). See §4's "Finding from implementation" for the
   full rationale; `metadataRound` was reverted to its pre-drop shape and still owns reconstruction
   only.

**Backlog item:** shipped. The item that tracked this
(`docs/backlog/2026-07-21-bgcommon-housing-meta-root-unsupported.md`, formerly prioritized #1) was
deleted from `docs/BACKLOG.md` per this repo's shipped-item convention (`docs/BACKLOG.md`'s "When an
item ships" rule) — this spec is now the durable record. Its companion,
[`docs/backlog/2026-07-21-furniture-bgparts-mdl-overrun.md`](../../backlog/2026-07-21-furniture-bgparts-mdl-overrun.md),
remains open (re-ranked to a top silent-wrong-output item once this fix let furniture packs reach the
model round — see that file).
**Builds on:** the metadata round design
([`2026-07-10-metadata-round-design.md`](2026-07-10-metadata-round-design.md)) — read its §1 first;
this design extends the same round.
**Goal:** stop `upgradeModpack` throwing on furniture/housing packs, by reproducing — faithfully and
auditably — the fact that TexTools **drops** housing `.meta` files rather than reconstructing them.

---

## 1. The problem

`parseMetaRoot` (`src/meta/root.ts:151`) recognizes only the seven `chara/…` root shapes and throws
`meta: unrecognized root path …` on `bgcommon/hou/{indoor,outdoor}/general/####/{i,o}####.meta`.
`metadataRound` (`src/upgrade/upgrade.ts:205-219`) runs `reconstructMeta` on **every** `.meta`
(`IS_META.test(path)`), and `reconstructMeta` (`src/meta/reconstruct.ts:16`) calls `parseMetaRoot`
first thing (`:22`). So a single housing `.meta` throws, unwinds through `upgradeModpack`
(`upgrade.ts:214 → 218 → 343`), and the furniture pack produces **no output at all**.

Surfaced by the 2026-07-21 minion/mount/furniture corpus expansion:
`raykie Gym Equipment Posing Props V1_0_2.ttmp2` and `SM-Cherry Blossom Upscale.ttmp2` both throw.

## 2. What TexTools actually does (confirmed)

TexTools **drops housing metas**. Evidence:

- `raykie`'s cached `/upgrade` golden (`test/corpus/.upgrade-cache/2f16…bbc51.bin`) contains **zero**
  `.meta` references, though the input carries four `bgcommon/…/i####.meta`.
- The `/resave` ratchet records those same metas as `removed` (ours-only) — TexTools' load→write drops
  them even with no upgrade transform.
- `SM-Cherry Blossom Upscale` is a `/upgrade` **no-op** (golden `.noop`), yet carries a housing meta —
  i.e. TexTools loads it without error and changes nothing.

This is **not** a "housing is an error" behavior — it is a consequence of the metadata round-trip.

## 3. Why it drops (root-cause mechanism)

Every `/upgrade` round-trips each `.meta` through the Penumbra **manipulation** model
(metadata-round spec §1):

- **Read** (TTMP, `WizardData.cs:685-691`; PMP, `PMP.cs:894`):
  `ItemMetadata.Deserialize` (`ItemMetadata.cs:869-921`) → `PMPExtensions.MetadataToManipulations`
  (`PmpExtensions.cs:417-467`). Emits one manipulation per **present** segment: `Gmp`, `Eqp`, `Est`,
  `Eqdp`, `Imc`.
- **Write** (`WizardData.cs:467-479` → `PMP.ManipulationsToMetadata`, `PMP.cs:1271`): groups
  manipulations by root, seeds `ItemMetadata.GetMetadata(path, forceOriginal=true)`, applies deltas,
  `Serialize`. **A root with no manipulations is never materialized → its `.meta` is absent from the
  output.**

A housing meta yields **zero** manipulations, so it is dropped. Two independent reasons no segment is
representable:

1. **IMC:** housing does not use IMC. `Imc.UsesImc` (`Variants/FileTypes/Imc.cs:74-85`) returns `true`
   only for equipment/weapon/monster/demihuman/accessory — `false` for `indoor`/`outdoor`.
   Corroborated by `XivDependencyGraph.cs:970-983` (furniture roots validated by an **asset folder**,
   not an `.imc`) and `GetRawImcFilePath` returning `""` when `!UsesImc` (`XivDependencyRoot.cs:1093-1095`).
   So a well-formed furniture `.meta` has no IMC segment.
2. **Eqp/Gmp/Est/Eqdp:** these are chara-only concepts; a housing meta does not carry them.

### The invalid-input corner (NOT a bug — do not register in TEXTOOLS_BUGS.md)

`FromImcEntry` (`PmpManipulation.cs:390-395`) sets `ObjectType = XivItemTypeToPenumbraObject[root.PrimaryType]`
with a **direct indexer**, and `XivItemTypeToPenumbraObject` (`PmpExtensions.cs:216-223`) has **no**
`indoor`/`outdoor` entry (even though `PMPObjectType.Housing` exists, `:33`). So a housing meta that
*did* carry an IMC segment would throw `KeyNotFoundException` — and the read path has **no** try/catch
around the conversion (`WizardData.cs:685-691`; the only try/catches there are the `.tex`/`.mdl`
branches). That would abort the whole `/upgrade`. But per §3.1 housing IMC is **invalid game data**, so
this is TexTools rejecting bad input, not a defect. (Operator confirmed this framing, 2026-07-21.)

## 4. The faithful design — mirror the round-trip, don't special-case the path

The drop must fall out of a ported rule with **auditable parallels at each step**, not a hardcoded
`if (path startsWith "bgcommon") drop`.

| TexTools step | Ported step | Citation |
|---|---|---|
| `ItemMetadata.Deserialize` | `deserializeMeta(bytes)` (exists) | `ItemMetadata.cs:869` ↔ `src/meta/deserialize.ts:22` |
| `MetadataToManipulations` — emit per present segment | `yieldsManipulations(meta)` — computed from the `imc/eqp/gmp/est/eqdp` fields | `PmpExtensions.cs:417-467` ↔ `src/meta/manipulations.ts` |
| `FromImcEntry` needs `XivItemTypeToPenumbraObject[PrimaryType]` | IMC segment present **and** root has no Penumbra object type (housing) ⇒ **fail loud** (invalid input) — reached via `parseMetaRoot`'s existing throw once a manipulation-bearing meta reaches `metadataRound` | `PmpManipulation.cs:395`, `PmpExtensions.cs:216-223` |
| `ManipulationsToMetadata` materializes nothing for a manip-less root | **zero manipulations ⇒ drop the file at load** — the load fix returns `null`, so the reader never adds the entry to `option.files` in the first place | `PMP.cs:1271`, `WizardData.cs:685-691` ↔ `src/upgrade/load-fixes.ts` |
| seed + apply + `Serialize` | `reconstructMeta`, unchanged, only for metas that yield ≥1 manipulation | `src/meta/reconstruct.ts` |

Shipped control flow:

1. `makeTtmpLoadFix` (the TTMP per-file load fix, the `.meta` half of `WizardData.cs:685-691`) runs on
   every `.meta` **before** the reader's last-write-wins collapse: `deserializeMeta(bytes)`, then
   `yieldsManipulations(meta)`.
2. If **false** (no representable segment) → the fix returns `null` and the reader drops the entry,
   mirroring `FromWizardGroup` diverting a manipulation-less meta into `data.Manipulations` and never
   reaching `data.Files` at all. Housing metas (no segments) drop here, **before** `parseMetaRoot` is
   ever called.
3. If **true** → the fix returns the file unchanged; it survives into `option.files` and reaches
   `metadataRound` → `reconstructMeta` → `parseMetaRoot` as before. A meta with an IMC segment but an
   unmapped (housing) root hits `parseMetaRoot`'s existing throw (`root.ts:151`) there — mirroring
   `FromImcEntry`'s `KeyNotFoundException` — with **no new guard needed**, since an IMC segment alone
   makes the predicate true and lets control fall through to the existing throw.
4. `metadataRound` → `reconstructMeta` runs unchanged on every surviving `.meta`.

`parseMetaRoot`'s throw (`root.ts:151`) survives as the fail-loud guard for a genuinely-unknown
*chara-like* root that *does* carry segments, which is still the right posture there.

**Scope of that guard (verified against the C#, 2026-07-21).** It only fires for a
segment-**bearing** meta — a segment-**less** meta at an unrecognized root has no equivalent guard and
is silently dropped by step 2 above, same as housing. `MetadataToManipulations` reads `m.Root.Info`
unconditionally at `PmpExtensions.cs:420`, *before* any segment check, and `ItemMetadata.Deserialize`
builds `new ItemMetadata(await XivCache.GetFirstRoot(path))` with no null guard
(`ItemMetadata.cs:883-884`; `GetFirstRoot`, `XivCache.cs:1764-1772`, returns `null` when no root
regex matches). So for a `.meta` at a path matching **none** of TexTools' root regexes — not just
housing, whose regex exists and matches (`XivDependencyGraph.cs:257,263`) — TexTools NREs at load,
unconditionally, regardless of whether the meta carries any segments at all. Our
`yieldsManipulations` never looks at the path, only the segment fields, so a segment-less meta at such
a path is silently dropped and the upgrade continues where TexTools would have crashed the whole
`/upgrade`. This only bites a genuinely malformed/unrecognized path (hand-edited or corrupt input, not
anything a real game asset produces) — housing is unaffected because its regex matches — so it is
noted as a residual gap this design does not close, not a fix owed here.

### Finding from implementation: the drop belongs at the load seam, not the transform

This design was first shipped **inside `metadataRound.fixOne`** — dropping the entry out of
`option.files` at the point `upgrade.ts`'s transform maps over it, matching the letter of an earlier
draft of the table above. A corpus run then falsified that seam: it broke
`SM-Cherry Blossom Upscale.ttmp2`, a genuine `/upgrade` **no-op** pack, turning a faithful "nothing
changed" into a reported change.

The reason is `ModpackUpgrader.AnyChanges` (`ModpackUpgrader.cs:25-49`). Its per-option file-set
baseline (`originals[o]`) is snapshotted from the **load** result (`WizardData.FromModpack`,
`ModpackUpgrader.cs:58`), *before* any transform runs, and the write is gated on that comparison
(`UpgradeModpack`, `ModpackUpgrader.cs:212-219`: `WriteModpack` only runs `if (data.AnyChanges ||
rewriteOnNoChanges)`). In TexTools, a manipulation-less `.meta` was **never part of that baseline** —
`FromWizardGroup` (`WizardData.cs:685-691`) diverts it into `data.Manipulations` at **load** time, so
it never touches `data.Files` to begin with. A drop performed inside our **transform**, by contrast,
removes a file that *was* present in our load-time snapshot — so our `AnyChanges`-equivalent sees a
file-set change TexTools' own baseline never could, on a pack where TexTools makes none.

The fix: move the drop to the **load** seam, `makeTtmpLoadFix` (`src/upgrade/load-fixes.ts`), with the
segment-presence predicate extracted to `yieldsManipulations` (`src/meta/manipulations.ts`) so both
the load fix and any future PMP-side equivalent share one ported rule. `metadataRound`
(`src/upgrade/upgrade.ts`) was reverted to its pre-drop shape — it still runs `reconstructMeta` on
every `.meta` it sees, but the load fix now guarantees a manipulation-less `.meta` never reaches it.
Reconstruction living in the transform rather than the load/write seam is a **separate, pre-existing**
seam question this change does not resolve, still tracked by
[`docs/backlog/2026-07-13-resave-meta-reconstruction-seam.md`](../../backlog/2026-07-13-resave-meta-reconstruction-seam.md)
— `metadataRound` was deliberately reverted rather than folding reconstruction into the load fix too.

Corpus result after the move: `SM-Cherry Blossom Upscale.ttmp2` is 9 matched, 0 diffs / 0 regressions
(the no-op is faithful again; no baseline needed). `raykie Gym Equipment Posing Props V1_0_2.ttmp2` is
22 matched with a newly recorded baseline for 97 diffs — **not** all owned by the `bgparts` `.mdl` gap
as an earlier draft of this doc claimed. The real split, counted from the baseline JSON:

| Count | Shape | Owner |
|---|---|---|
| 9 | `.mdl` `added` | `bgcommon/hou/**/bgparts/*.mdl` gap (`docs/backlog/2026-07-21-furniture-bgparts-mdl-overrun.md`) |
| 9 | manifest `added` | same gap — the index shift the missing models leave in their options' manifests |
| 50 | manifest `mismatch` | `Name`/`Category` re-derivation & option file order (`docs/backlog/2026-07-13-resave-ttmp2-name-category.md` and its file-order sibling) |
| 29 | `.tex` `mismatch` | the texture float-precision bulk (roadmap design §8, `docs/backlog/2026-07-10-imagesharp-resampler.md`) |

Only 18 of the 97 (the `.mdl` gap's slice) trace to this change's companion item; the other 79 are
pre-existing, unrelated gaps the corpus expansion happened to surface at the same time.

**The decisive evidence for this change itself: the blessed `raykie` baseline contains zero `.meta`
entries, and so does every other baseline in `test/corpus/.upgrade-baseline/`.** Our meta file-set
matches the golden's on every corpus pack — none of the 97 diffs, nor any diff on any other corpus
pack, is a `.meta` entry. That is the strongest available confirmation that the drop implemented here
is correct.

### Notes for the implementer

- **Drop = the load fix returns `null`.** `makeTtmpLoadFix` (`src/upgrade/load-fixes.ts`) runs on each
  file **before** the reader's last-write-wins collapse into the option's `files` map; returning `null`
  for a `.meta` means the entry is never added at all, mirroring `FromWizardGroup`'s implicit skip
  (`WizardData.cs:685-691`) for a manipulation-less file that never reaches `data.Files`. (An earlier
  version of this fix dropped from `option.files` inside `metadataRound.fixOne` instead — see "Finding
  from implementation" above for why that seam was wrong.)
- **`GetFirstRoot` vs `parseMetaRoot`.** TexTools' `ItemMetadata.Deserialize` resolves the housing root
  via `XivCache.GetFirstRoot` (`ItemMetadata.cs:883`) without throwing (the housing regex exists,
  `XivDependencyGraph.cs:257,263`). We deliberately *don't* need to port housing into `parseMetaRoot`,
  because we drop before needing the root. If a future need arises, mirror `GetFirstRoot`, not a second
  path check.
- **Keep `/upgrade` goldens byte-exact.** This changes *which files exist* in a furniture pack's output
  (housing metas removed) to match the golden; it must not perturb any chara meta's bytes.
- **Seam caveat (corrected from the original draft).** The drop lives at the **load** seam
  (`makeTtmpLoadFix`), independent of where `.meta` **reconstruction** happens. An earlier draft of
  this note said "if the meta round is ever moved to the load seam, the drop moves with it" — that has
  the causality backwards: implementation showed the drop had to move to the load seam *without*
  reconstruction following it (see "Finding from implementation" above). Reconstruction
  (`reconstructMeta`) stays in `metadataRound`/the transform, tracked separately by
  [`docs/backlog/2026-07-13-resave-meta-reconstruction-seam.md`](../../backlog/2026-07-13-resave-meta-reconstruction-seam.md).

## 5. Tests

- **Corpus goldens already pin it:** `raykie` must go green (its housing metas dropped, matching the
  0-meta golden) and `SM-Cherry Blossom Upscale` must stay a faithful `/upgrade` no-op. Re-bless is
  **not** needed if the fix is correct — these should match with an empty baseline. (Shipped result:
  confirmed — see §4's "Finding from implementation" for the exact corpus outcome.)
- **Shipped unit coverage:** `test/upgrade/meta-drop.test.ts` pins `makeTtmpLoadFix`'s drop/keep
  behaviour per segment (including the present-but-empty EST/IMC vs EQDP asymmetry from the Status
  line above) and `metadataRound`'s continued throw on a manipulation-bearing unknown root.
- **Synthetic (optional, for the invalid-input guard):** author a pack with a housing `.meta` that
  carries an IMC segment; assert our port throws (matching TexTools' `KeyNotFoundException` abort). This
  pins step 3 and belongs in the `upgrade-error` corpus root iff ConsoleTools also errors on it —
  verify the oracle's behavior before classifying (it should throw, per §3.1).
- **A found divergence is a coverage gap:** this gap existed because no furniture pack was in the
  corpus. The corpus packs are the regression test; keep them.

## 6. Empirical check performed: do `raykie`'s furniture metas actually carry zero segments?

The question mattered because the answer decides which branch of the design applies: if any of
`raykie`'s furniture metas carried an IMC segment, TexTools would *crash* (not drop) and the pack
would belong in the `upgrade-error` corpus root, not on the drop path. `raykie`'s clean golden already
implied zero-segment, but the premise was verified directly rather than assumed, using a scratch
decoder (loads the pack, finds `.meta` members, runs `deserializeMeta`, prints present segments).

**Result:** confirmed. All six housing metas across both corpus packs (`raykie`,
`SM-Cherry Blossom Upscale`) deserialize to zero segments, so only the drop path (step 2 in §4) is
reachable from the corpus; the invalid-input throw (step 3) remains unexercised by any real pack. The
scratch decoder was scaffolding only and has since been removed from the tree.

## 7. Provenance summary (verify each against `reference/` before coding)

- Drop mechanism: `PmpExtensions.cs:417-467` (`MetadataToManipulations`), `PMP.cs:1271`
  (`ManipulationsToMetadata`), `WizardData.cs:467-479,685-691`.
- Housing has no IMC: `Variants/FileTypes/Imc.cs:74-85` (`UsesImc`), `XivDependencyRoot.cs:1093-1095`,
  `XivDependencyGraph.cs:970-983`.
- Housing has no Penumbra object type: `PmpExtensions.cs:216-223,33`, `PmpManipulation.cs:390-395`.
- Housing root is parseable (so `GetFirstRoot` doesn't throw): `XivDependencyGraph.cs:257,263,693-702`.
- Our code (as shipped): `src/upgrade/load-fixes.ts` (the drop, in `makeTtmpLoadFix`),
  `src/meta/manipulations.ts` (`yieldsManipulations`, the shared predicate), `src/upgrade/upgrade.ts`
  (`metadataRound`, reverted to pre-drop shape — reconstruction only), `src/meta/reconstruct.ts:16-22`,
  `src/meta/root.ts:151`, `src/meta/deserialize.ts:22`.
