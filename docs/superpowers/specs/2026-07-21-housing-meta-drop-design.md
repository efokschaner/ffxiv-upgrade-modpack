# Housing/`bgcommon` `.meta` drop — Design & handoff

**Date:** 2026-07-21
**Status:** Implemented 2026-07-21. §6's empirical check was run and confirmed the premise — all six
housing metas across both corpus packs deserialize to **zero** segments, so only the drop path is
reachable from the corpus. Two corrections found during implementation, applied in the shipped code:
§4's segment list must gate EST/EQDP/IMC on **non-empty**, not merely non-null
(`PmpExtensions.cs:436,446,456` use `Count > 0`); and §4 step 3 required **no new code** — an IMC
segment makes the predicate true, so control falls through to `parseMetaRoot`'s existing throw.
**Backlog item:** [`docs/backlog/2026-07-21-bgcommon-housing-meta-root-unsupported.md`](../../backlog/2026-07-21-bgcommon-housing-meta-root-unsupported.md)
(prioritized #1).
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
`if (path startsWith "bgcommon") drop`. Restructure `metadataRound.fixOne` to mirror the round-trip:

| TexTools step | Ported step | Citation |
|---|---|---|
| `ItemMetadata.Deserialize` | `deserializeMeta(bytes)` (exists) | `ItemMetadata.cs:869` ↔ `src/meta/deserialize.ts:22` |
| `MetadataToManipulations` — emit per present segment | compute "does this meta yield any manipulation?" from the `imc/eqp/gmp/est/eqdp` fields | `PmpExtensions.cs:417-467` |
| `FromImcEntry` needs `XivItemTypeToPenumbraObject[PrimaryType]` | IMC segment present **and** root has no Penumbra object type (housing) ⇒ **fail loud** (invalid input) | `PmpManipulation.cs:395`, `PmpExtensions.cs:216-223` |
| `ManipulationsToMetadata` materializes nothing for a manip-less root | **zero manipulations ⇒ drop the file** (remove it from `option.files`) | `PMP.cs:1271`, `WizardData.cs:467-479` |
| seed + apply + `Serialize` | `reconstructMeta` (existing path), only for metas that yield ≥1 manipulation | `src/meta/reconstruct.ts` |

Resulting `fixOne` control flow:

1. `deserializeMeta(bytes)`.
2. If the meta has **no** representable segment (no `imc`/`eqp`/`gmp`/`est`/`eqdp`) → **drop** the file
   (return a sentinel so the caller removes it from `option.files`; do not reach `parseMetaRoot`).
3. If it has an **IMC** segment but the root is unmapped (housing) → **throw** (invalid input; mirrors
   `FromImcEntry`).
4. Otherwise → `reconstructMeta` as today.

Housing metas (no segments) drop at step 2, before `parseMetaRoot` — so `parseMetaRoot`'s throw
(`root.ts:151`) survives as the fail-loud guard for a genuinely-unknown *chara-like* root that *does*
carry segments, which is still the right posture there.

### Notes for the implementer

- **Drop = remove from `option.files`.** `fixOne` currently maps `path → ModpackFile` into a fresh
  `Map` (`upgrade.ts:217-219`). To drop, skip the entry (don't `set` it). Keep the existing
  transform-order semantics.
- **`GetFirstRoot` vs `parseMetaRoot`.** TexTools' `ItemMetadata.Deserialize` resolves the housing root
  via `XivCache.GetFirstRoot` (`ItemMetadata.cs:883`) without throwing (the housing regex exists,
  `XivDependencyGraph.cs:257,263`). We deliberately *don't* need to port housing into `parseMetaRoot`,
  because we drop before needing the root. If a future need arises, mirror `GetFirstRoot`, not a second
  path check.
- **Keep `/upgrade` goldens byte-exact.** This changes *which files exist* in a furniture pack's output
  (housing metas removed) to match the golden; it must not perturb any chara meta's bytes.
- **Seam caveat:** the `/resave` findings note (backlog, `2026-07-13-resave-meta-reconstruction-seam.md`)
  observes `reconstructMeta` lives in our upgrade transform rather than the load seam. This drop is the
  same round; if the meta round is ever moved to the load seam, the drop moves with it.

## 5. Tests

- **Corpus goldens already pin it:** `raykie` must go green (its housing metas dropped, matching the
  0-meta golden) and `SM-Cherry Blossom Upscale` must stay a faithful `/upgrade` no-op. Re-bless is
  **not** needed if the fix is correct — these should match with an empty baseline.
- **Synthetic (optional, for the invalid-input guard):** author a pack with a housing `.meta` that
  carries an IMC segment; assert our port throws (matching TexTools' `KeyNotFoundException` abort). This
  pins step 3 and belongs in the `upgrade-error` corpus root iff ConsoleTools also errors on it —
  verify the oracle's behavior before classifying (it should throw, per §3.1).
- **A found divergence is a coverage gap:** this gap existed because no furniture pack was in the
  corpus. The corpus packs are the regression test; keep them.

## 6. One empirical check to run first (was blocked by tooling)

Confirm `raykie`'s furniture metas deserialize to **zero** segments — if any carried IMC, TexTools
would *crash* (not drop) and the pack would be an `upgrade-error` case, not a drop. `raykie`'s clean
golden already implies zero-segment, but verify directly. A scratch decoder was drafted at
`scripts/_tmp-inspect-meta.ts` (loads the pack, finds `.meta` members, `deserializeMeta`, prints
present segments). **Clean up that temp file** (and any `scripts/_tmp-*.txt`) — they are untracked
scaffolding left when the shell tool began erroring on every command mid-session.

## 7. Provenance summary (verify each against `reference/` before coding)

- Drop mechanism: `PmpExtensions.cs:417-467` (`MetadataToManipulations`), `PMP.cs:1271`
  (`ManipulationsToMetadata`), `WizardData.cs:467-479,685-691`.
- Housing has no IMC: `Variants/FileTypes/Imc.cs:74-85` (`UsesImc`), `XivDependencyRoot.cs:1093-1095`,
  `XivDependencyGraph.cs:970-983`.
- Housing has no Penumbra object type: `PmpExtensions.cs:216-223,33`, `PmpManipulation.cs:390-395`.
- Housing root is parseable (so `GetFirstRoot` doesn't throw): `XivDependencyGraph.cs:257,263,693-702`.
- Our code: `src/upgrade/upgrade.ts:205-219`, `src/meta/reconstruct.ts:16-22`, `src/meta/root.ts:151`,
  `src/meta/deserialize.ts:22`.
