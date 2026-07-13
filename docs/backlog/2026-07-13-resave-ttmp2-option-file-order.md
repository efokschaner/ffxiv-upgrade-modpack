# `writeTtmp2` emits an option's files in a different ORDER than TexTools

Filed: 2026-07-13 · Status: open · Surfaced by the `/resave` write-side oracle

`#/ModsJsons/N/FullPath [mismatch]` on 20 packs is (at least largely) an ordering difference, not a
content one: `Tight&Firm-YorhaCollection-2B.ttmp2` option "Large" — our `ModsJsons[0]` is
`chara/equipment/e0649/e0649_top.meta`, the golden's is
`chara/equipment/e0649/material/v0001/mt_c0101e0649_top_a.mtrl`. Both lists have 13 entries.

Worth confirming it is *only* order before fixing.
