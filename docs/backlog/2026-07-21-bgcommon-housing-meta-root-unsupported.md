# `bgcommon` housing/furniture `.meta` roots are unsupported — the whole upgrade throws

**Filed:** 2026-07-21, from the minion/mount/furniture corpus expansion (added 15 packs to
`test/corpus/real/`).

**Severity:** hard crash of the *entire* `upgradeModpack` call, on a content class TexTools handles
cleanly — i.e. we fail where the oracle succeeds. Highest-ranked new item (operator directive,
2026-07-21).

## Symptom

`parseMetaRoot` (`src/meta/root.ts:151`) recognizes only the seven `chara/…` root shapes
(equipment, accessory, hair, face, demihuman, weapon, monster) and `throw`s
`meta: unrecognized root path …` on anything else. Furniture/housing mods carry housing metadata at
`bgcommon/hou/{indoor,outdoor}/general/####/{i,o}####.meta`. The metadata round
(`src/upgrade/upgrade.ts:205-219`, `metadataRound` → `fixOne`) calls `reconstructMeta` on **every**
`.meta` file (`IS_META.test(path)`), so a single housing `.meta` throws out of
`reconstructMeta → parseMetaRoot`, unwinding all the way through `upgradeModpack`
(`upgrade.ts:214 → 218 → 343`). The pack does not partially upgrade — it produces **no output at all**.

Observed errors (bless run 2026-07-21):

```
meta: unrecognized root path bgcommon/hou/indoor/general/0613/i0613.meta   (raykie Gym Equipment Posing Props)
meta: unrecognized root path bgcommon/hou/outdoor/general/0112/o0112.meta  (SM-Cherry Blossom Upscale)
```

## Why this is a real divergence, not a faithful throw

TexTools parses `bgcommon` housing as a **first-class root type**, not an error:
`XivDependencyGraph.cs:257` `HousingExtractionRegex = ^bgcommon\/hou\/([a-z]+)\/([a-z]+)\/([0-9]+)\/?.*$`
and `HousingExtractionRegex2` (`:263`), dispatched at `ExtractRootInfo` (`XivDependencyGraph.cs:693-702`,
"Might be a housing item."). Empirically, ConsoleTools `/upgrade` never chokes on these metas:

- `SM-Cherry Blossom Upscale.ttmp2` → golden cached as **`.noop`** (TexTools leaves it unchanged).
- `raykie Gym Equipment Posing Props V1_0_2.ttmp2` → **17.7 MB real golden** (TexTools fully transforms it).

Both carry housing metas; both upgrade in TexTools without error. We crash on both. So the throw is a
gap, not a reproduced behaviour.

## RESOLVED 2026-07-21 — fixed by the manipulation-less drop, at the load seam

**Shipped.** `makeTtmpLoadFix` (`src/upgrade/load-fixes.ts`) now drops any `.meta` that yields zero
Penumbra manipulations — determined by the shared predicate `yieldsManipulations`
(`src/meta/manipulations.ts`), ported from `PMPExtensions.MetadataToManipulations`
(`PmpExtensions.cs:417-467`) plus `PMP.ManipulationsToMetadata`'s by-root materialization
(`PMP.cs:1258-1295`). The drop lives at the **load** seam, not in `metadataRound`
(`src/upgrade/upgrade.ts`) — an earlier attempt put it in the transform, but a corpus run showed that
seam wrong (it broke `SM-Cherry Blossom Upscale.ttmp2`'s `/upgrade` no-op, because the transform-level
drop is visible to our `ModpackUpgrader.AnyChanges` equivalent where TexTools' load-time diversion
into `data.Manipulations` never is). See
[`docs/superpowers/specs/2026-07-21-housing-meta-drop-design.md`](../superpowers/specs/2026-07-21-housing-meta-drop-design.md)
§4's "Finding from implementation" for the full account. No housing support was added to
`parseMetaRoot` and no housing base-data table was needed. Regression cover:
`test/upgrade/meta-drop.test.ts` plus the `raykie` / `SM-Cherry Blossom Upscale` corpus goldens. The
companion furniture `.mdl` gap (`2026-07-21-furniture-bgparts-mdl-overrun.md`) remains open.

**Traced 2026-07-21; full design + handoff in
[`docs/superpowers/specs/2026-07-21-housing-meta-drop-design.md`](../superpowers/specs/2026-07-21-housing-meta-drop-design.md).**
TexTools **drops** housing metas — `raykie`'s golden has **zero** `.meta` references; `/resave` records
them as `removed`. The mechanism: every `/upgrade` round-trips each `.meta` through the Penumbra
manipulation model, and a meta that yields **zero manipulations is never re-materialized**. A housing
meta yields zero because it has no representable segment — housing does not use IMC
(`Imc.UsesImc`, `Variants/FileTypes/Imc.cs:74-85`, returns `false` for indoor/outdoor) and carries no
chara segments. So the fix needs **no** housing base-data table: `makeTtmpLoadFix` (the load seam, not
`metadataRound`) drops a meta with no representable segment (mirroring `ManipulationsToMetadata`
materializing nothing), and `metadataRound` keeps running `reconstructMeta` only for metas that survive
the drop with ≥1 manipulation. The housing-IMC crash corner is
**invalid-input** rejection (housing IMC can't exist in-game), **not** a bug — do not register it in
`TEXTOOLS_BUGS.md`. Companion to the furniture `.mdl` gap
(`docs/backlog/2026-07-21-furniture-bgparts-mdl-overrun.md`); together they are "bgcommon
housing/furniture support".

## Test that would have caught it

A furniture corpus pack carrying a housing `.meta` — now present (`raykie`, `SM-Cherry Blossom
Upscale`, and any furniture mod). **Actual outcome:** `SM-Cherry Blossom Upscale` is fully green (0
diffs / 0 regressions — a faithful `/upgrade` no-op). `raykie` has a newly recorded baseline for 97
diffs; its `.meta` behaviour is correct (housing metas dropped, matching the golden's zero `.meta`
references) — the remaining diffs are all owned by the separate, already-filed furniture `bgparts`
`.mdl` gap (`2026-07-21-furniture-bgparts-mdl-overrun.md`), not by this item.
