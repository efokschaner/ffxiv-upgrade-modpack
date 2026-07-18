# PMP writer: TexTools retains unreferenced source zip members; we drop them

Filed: 2026-07-17 · Status: open · Priority: unprioritized · Surfaced by the `highlight.pmp` synthetic
(spec `docs/superpowers/specs/2026-07-17-resolve-highlight-preround-design.md` Part C.2)

When ConsoleTools re-writes a `.pmp`, its output **retains the original source zip members** even
after the upgrade has re-pointed every `Files` entry at regenerated/deduped member names — the
now-unreferenced originals are left in the archive as dead weight. Our writer builds a fresh archive
containing only referenced members, so it **omits** them. Result: a `kind:"structure"` "added" diff
(present in golden, absent from ours) for each orphaned member.

This is the "container-manifest structure" gap the roadmap already tracks at the burndown level
(design spec `2026-06-30-…-design.md` §8.3). It is baselined across the corpus — real packs
(`Holographic Options/…mtrl`, `models/bibo+/…mdl`, `dance*.pap`) and the `synthetic-f1` /
`highlight.pmp` synthetics all carry it. It is **not** a regression in this branch (which does not
touch the PMP writer) and **not** a payload/content difference — the referenced members are
byte-exact; only these orphan entries differ.

## Nuance vs. the other structure diffs

Most baselined structure diffs are **rename/case-fold pairs** (a matched `added`+`removed` at
different casings). `highlight.pmp`'s is **pure orphan-retention** — `added` with no `removed`
counterpart — so it is the same writer-gap root class but a slightly different mechanical shape. The
exact C# repack path that leaves the orphans in was not traced (likely `PMP.WritePmp` adding new
members onto the loaded `ZipFile` without pruning; confirm against `reference/.../Mods/FileTypes/PMP.cs`).

## What to do

Trace the C# repack path, then decide: reproduce "retain unreferenced source members verbatim" in our
PMP writer (`src/container/pmp.ts`), or confirm it as an accepted divergence with a `DIVERGENCE_RULES`
rule. Either way it retires a chunk of the corpus-wide structure-diff baseline. Scoped carefully so a
fix does not mask a *different* orphan-member bug elsewhere.
