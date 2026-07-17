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
