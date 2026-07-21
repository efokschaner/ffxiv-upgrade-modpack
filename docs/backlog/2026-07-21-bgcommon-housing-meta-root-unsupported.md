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

## What the fix has to establish (trace during implementation)

The open question is what TexTools' *metadata reconstruction* does with a housing `.meta` during
`/upgrade` — the `XivDependencyGraph` regex proves the root is *parseable*, but not what
`EndwalkerUpgrade`/`ItemMetadata` reconstruction does with it. Two shapes, decide by reading the C#:

1. **Faithful skip** — if TexTools' meta round only reconstructs `chara` metas and passes housing
   metas through untouched, the port should mirror that (a housing `.meta` is carried opaquely, not
   run through `reconstructMeta`). Cheapest; likely, given SM-Cherry is a full no-op.
2. **Housing meta reconstruction** — if TexTools *does* rebuild housing IMC/metadata from a base seed,
   this needs a housing-scoped base-data table (an `extract-*` script over `bgcommon` IMC), mirroring
   the `chara` metadata round (`docs/superpowers/specs/2026-07-10-metadata-round-design.md`).

Whichever it is, it is currently a **fail-loud gap**, which is the safe state — but it blocks every
furniture pack. Companion to the furniture `.mdl` gap
(`docs/backlog/2026-07-21-furniture-bgparts-mdl-overrun.md`); together they are "bgcommon
housing/furniture support".

## Test that would have caught it

A furniture corpus pack carrying a housing `.meta` — now present (`raykie`, `SM-Cherry Blossom
Upscale`, and any furniture mod). The fix should drive the `/upgrade` golden green on `raykie` and
keep `SM-Cherry Blossom Upscale` a faithful no-op.
