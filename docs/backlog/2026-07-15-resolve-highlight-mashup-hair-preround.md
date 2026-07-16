# Investigate & port the `ResolveHighlightOptionsAndMashupHair` pre-round

Filed: 2026-07-15 · Status: open · Priority: prioritized · Surfaced while porting round 6 partials
(spec `docs/superpowers/specs/2026-07-15-partials-skin-paths-design.md` §8)

`ModpackUpgrader.UpgradeModpack` runs `ResolveHighlightOptionsAndMashupHair(data)` at
`ModpackUpgrader.cs:83` — **before** round 1 (material/model), run **unconditionally** (it is *not*
gated by `includePartials`). Our `upgradeModpack` (`src/upgrade/upgrade.ts`) has **no pre-round**:
it goes straight into the material/metadata pass (the load-time FixOldTexData/FixOldModel fixes now
run at the read seam inside `loadModpack`, not here). So this transform is entirely unported, and any
pack it would have mutated diverges from the `/upgrade` golden.

## What it does (`ModpackUpgrader.cs:267-482`)

- Scans every option's `.mtrl`, keeps the **Hair**-shaderpack ones, and collects each material's
  `(g_SamplerNormal Dx11 path, g_SamplerMask Dx11 path)` pair.
- Builds, across all options: `containers` (which options hold each of those texture paths) and
  `badOptions` (options that hold *one* of a pair but not the other — a highlight/visibility split).
- For each bad option's missing texture: if exactly **one** container holds it, staple a pointer to
  that copy into the option; if the count is not 1, **throw** `InvalidDataException` ("Highlight/
  Visibility options are unresolveable…"). *(This half needs no game index — it is pure cross-option
  pointer stapling, like `UpdateSkinPaths`.)*
- If there are **no** bad options but material-only hair mashups exist, call `RepathHairMashups`
  (`ModpackUpgrader.cs:379-482`): for hair/zear/tail `.mtrl`, read each sampler's Dx11 path and, when
  the old path does not exist in the live game index (`rtx.FileExists`), repath the suffix
  (`_n→_norm`, `_m→_mask`/`_mult`, `_s→_mask`/`_mult`, `_d→_base`, stripping `--`) and rewrite the
  material. **This half needs the live Dawntrail game index** (a `FileExists` path-set), like the
  hair/eye partials.

## Why it is deferred, not done in the skin-paths slice

Out of scope for the partials round: it is a distinct pre-round, and its `RepathHairMashups` half
shares the "bundled DT reference path-set" dependency with the eye partials
(`…-eye-mask.md`) — the same kind of dependency the now-shipped hair partials resolved with a bundled
canonical-material table (see `docs/superpowers/specs/2026-07-16-unclaimed-hair-partials-design.md`).
The highlight-resolution half (stapling + the fail-loud throw) *is* portable today with no new assets.

## First steps

1. **Confirm reachability** against the corpus: does any pack carry Hair-shader materials with split
   normal/mask options, or material-only hair mashups? If none, this is latent and the throw-path
   matters most.
2. Port the highlight-resolution half (no game index) + reproduce the `InvalidDataException`
   fail-loud. Prove with a synthetic pack or unit test.
3. Split `RepathHairMashups` out behind the shared DT-path-set dependency (co-file with the hair
   partial) — it cannot be byte-verified without the live index the golden was produced against.

Reference: `reference/.../Mods/ModpackUpgrader.cs:83,267-482`.
