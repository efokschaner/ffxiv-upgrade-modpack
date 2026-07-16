# Round 6 partials — `UpdateUnclaimedHairTextures` (+ hair accessory)

Filed: 2026-07-15 · Status: open · Priority: prioritized

`partials` (`src/upgrade/upgrade.ts`) ports UpdateSkinPaths only. `UpdateUnclaimedHairTextures`
(EndwalkerUpgrade.cs:1324-1519) and `UpdateUnclaimedHairAccessory` (:1522+) remain unported: the
hair/tail/ear texture-only heuristics that detect a hair texture included WITHOUT its material and
copy it to SE's new pathing.

Needs a **bundled canonical material table** extracted from a live Dawntrail install — per
hair/tail/ear/accessory material (`HairRegexes`/`TailRegexes`/`EarRegexes`/`AccessoryRegexes`,
:1293-1321): its `g_SamplerNormal` / `g_SamplerMask` Dx11 sampler paths, shaderpack (must be Hair),
and material flags — plus a `FileExists` path-set for the `matPath` existence gate (:1430). Reuses
the already-ported `updateEndwalkerHairTextures` pixel path (`src/upgrade/texture.ts`) and the
`_SampleHair` constant material (:56) for the tail backface + shader-constant special-case (:1504).

Orchestration glue also lands here: the `unusedTextures`/`contained` filter (ModpackUpgrader.cs:150-172)
that feeds this and the eye pass. No corpus coverage today; will need real hair mods and/or a
synthetic pack.

Reference: `reference/.../Mods/EndwalkerUpgrade.cs`, `.../ModpackUpgrader.cs:162-182`.
