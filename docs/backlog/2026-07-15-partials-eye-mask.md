# Round 6 partials — `UpdateEyeMask`

Filed: 2026-07-15 · Status: open · Priority: prioritized

`partials` (`src/upgrade/upgrade.ts`) ports UpdateSkinPaths only. `UpdateEyeMask`
(EndwalkerUpgrade.cs:2007-2079) remains unported: converts an Endwalker iris mask
(`--c{race}f{face}_iri_s.tex`, EyeMaskPathRegex :2005) to a Dawntrail diffuse.

Needs a **bundled iris table** extracted from a live Dawntrail install — the iris material
`chara/human/c{race}/obj/face/f{face}/material/mt_c{race}f{face}_iri_a.mtrl` (:2044) and its
`g_SamplerDiffuse` texture path (:2058-2059), i.e. a `(race, face) → diffuse path` map — plus the
`FileExists` gate (:2049). Also needs the pixel helpers `ConvertEyeMaskToDiffuse` (:1910),
`TextureHelpers.SwizzleRB` (:2066), and the DDS conversion round (:2069-2073) — confirm which are
already ported under `src/tex/`. Float-math parity may require a `DIVERGENCE_RULES` entry.

No corpus coverage today; will need real eye mods and/or a synthetic pack.

Reference: `reference/.../Mods/EndwalkerUpgrade.cs:1910-2079`, `.../ModpackUpgrader.cs:174-177`.
