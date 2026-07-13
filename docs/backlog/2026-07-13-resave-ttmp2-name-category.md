# `writeTtmp2` round-trips `ModsJsons[].Name` / `Category` where TexTools RE-DERIVES them from the game path

Filed: 2026-07-13 · Status: open · Surfaced by the `/resave` write-side oracle

`Fantasia.ttmp2`, `chara/bibo/midlander_d.tex`: ours keeps the source's
`{"Name":"Body - c0201b0001_top","Category":"Body"}`; the golden writes
`{"Name":"Unknown","Category":"Unknown"}` — TexTools recomputes both from the game path and yields
`Unknown` for a path it cannot classify (`chara/bibo/…` is not a real game path).

10 packs (`ModsJsons/N/Name [mismatch]`), 5 packs (`…/Category [mismatch]`).
