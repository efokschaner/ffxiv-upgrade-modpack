# `writeTtmp2` round-trips `ModsJsons[].Name` / `Category` where TexTools RE-DERIVES them from the game path

Filed: 2026-07-13 · Status: open · Surfaced by the `/resave` write-side oracle

`Fantasia.ttmp2`, `chara/bibo/midlander_d.tex`: ours keeps the source's
`{"Name":"Body - c0201b0001_top","Category":"Body"}`; the golden writes
`{"Name":"Unknown","Category":"Unknown"}` — TexTools recomputes both from the game path and yields
`Unknown` for a path it cannot classify (`chara/bibo/…` is not a real game path).

10 packs (`ModsJsons/N/Name [mismatch]`), 5 packs (`…/Category [mismatch]`).

**2026-07-16 (Task 8, wiring the hair resampler):** the same root cause also reaches `/upgrade`
directly, not just `/resave` — `writeGeneratedTex`/`writeGeneratedMtrl` (`src/upgrade/texture.ts`)
build a brand-new `ModpackFile` with no `ttmp` field at all, so a REGENERATED entry loses `Name`/
`Category`/`DatFile` outright (empty string via `ttmp2.ts`'s `f.ttmp?.category ?? ""`) rather than
round-tripping the source's stale values. `Misty_Hairstyle_Female.ttmp2` newly exercises this: once
the hair-resize skip was wired up (`2026-07-10-imagesharp-resampler.md`), its two regenerated hair
option pairs (4 gamePaths — normal+mask `.tex`, `_n`/`_s` suffix) went from "left untouched by
`writeGeneratedTex`, so kept the source's `ttmp`" to "regenerated, so `ttmp` is dropped", surfacing
as 10 new `ModsJsons/N/{Category,DatFile,Name}` mismatches (all bare-`/upgrade`, not `/resave`) —
blessed into the ratchet baseline alongside the (small, expected) resize residual rather than fixed,
since re-deriving `Name`/`Category`/`DatFile` from the game path is exactly this item's scope, not
the resize task's.

**2026-07-19 (Task 4, the weapon IMC growth synthetic):** now exercised by a **synthetic** pack too,
not only by real corpus packs — `test/corpus/synthetic/imc-weapon.ttmp2`
(`scripts/generate-synthetics/build-synthetic-imc-weapon.ts`) reports
`ModsJsons/{0,1}/{Name,Category} [mismatch]`, blessed into its ratchet baseline. It is the first
synthetic `.ttmp2` to earn a real (non-noop) `/upgrade` golden. This pack shows the **inverse** of
the `Fantasia` case above: there the golden degraded to `Unknown` for an unclassifiable path, here it
*resolves* one — the builder writes `Name: "Dummy"` / `Category: "Unknown"` and the golden re-derives
`Name: "Makai Hand Mortar - Main Hand"` / `Category: "Machinist Arms"` from
`chara/weapon/w2021/obj/body/b0001/…`. So the fixture pins the success path of the re-derivation, and
is reproducible from a committed builder on a fresh clone (`npm run synthetics`) with no third-party
mod needed.
