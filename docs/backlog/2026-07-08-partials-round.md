# Partials round (roadmap round 6)

Filed: 2026-07-08 · Status: open · Priority: prioritized

`partials` (`src/upgrade/upgrade.ts`) is a no-op stub for `UpdateUnclaimedHairTextures` /
`UpdateEyeMask` / `UpdateSkinPaths`.

Needs the bundled reference assets (eye textures, iris `(race,face)→path`, canonical hair/ear/tail
sampler tables) — no corpus coverage exercises it yet.

Reference: `reference/.../Mods/EndwalkerUpgrade.cs`.
