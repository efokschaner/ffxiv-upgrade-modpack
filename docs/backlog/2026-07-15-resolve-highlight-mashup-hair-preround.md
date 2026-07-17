# Port the `RepathHairMashups` half of the pre-round

Filed: 2026-07-15 · Narrowed: 2026-07-17 · Status: open · Priority: prioritized

The `ResolveHighlightOptionsAndMashupHair` pre-round (`ModpackUpgrader.cs:83,267-482`) has two halves.
The **highlight-resolution half** (cross-option normal/mask pointer stapling + the fail-loud throws)
**shipped 2026-07-17** — `src/upgrade/resolve-highlight.ts`, wired first in `upgradeModpack`, spec
`docs/superpowers/specs/2026-07-17-resolve-highlight-preround-design.md`. This item now tracks only
the still-deferred **`RepathHairMashups`** half.

## What remains (`ModpackUpgrader.cs:379-482`)

Reached only when the pre-round finds Hair-shader materials but no split options AND no option holds
any of their normal/mask textures (`badOptions.Count == 0 && containers.Count == 0` — a material-only
"mashup" hair). `resolve-highlight.ts` throws a fail-loud there today (citing this item).

`RepathHairMashups` runs over hair/`zear`/`tail` `.mtrl`: for each sampler's Dx11 path, when the old
path does **not** exist in the live game index (`rtx.FileExists`), it repaths the suffix
(`_n→_norm`, `_m→_mask`/`_mult`, `_s→_mask`/`_mult`, `_d→_base`, stripping `--`) and rewrites the
material. **This needs the live Dawntrail game index** (a `FileExists` path-set) — the same
bundled-DT-reference-path dependency the eye partials still await
(`docs/superpowers/specs/2026-07-16-unclaimed-hair-partials-design.md` resolved the analogous hair
case with a bundled canonical-material table).

## Why still deferred

It cannot be byte-verified without the live index the golden was produced against, and no corpus or
local-library mod reaches this branch (0 of 1131 scanned — see the shipped spec §1.1), so it is
latent and the fail-loud throw is safe. Port it behind the shared DT-path-set the eye partials need.

Reference: `reference/.../Mods/ModpackUpgrader.cs:379-482`.
