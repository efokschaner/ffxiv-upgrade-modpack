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
counterpart — so it is the same writer-gap root class but a slightly different mechanical shape.

**Scope — this item is small (traced 2026-07-21).** The C# repack path *was* traced: `WritePmp`
(`reference/.../Mods/FileTypes/PMP.cs:830-868`) prunes only stale `group_*.json` from the working
directory, then `ZipFile.CreateFromDirectory` zips the **whole tree** — and on `/upgrade` that
directory is the original unzip dir, so any source data file the transform did not overwrite survives
as an orphan. That mechanism produces **only `added`/`removed`-shaped** structure diffs (a member the
golden's zip has and ours doesn't), and it accounts for just the handful of such entries in the
baseline (e.g. the eye-mask synthetic's 3 `added`, one rename/case-fold pair) — **~5 across the
corpus**, not the ~47 the raw "structure kind" count suggests.

**What this item does *not* cover:** the *other* ~42 baselined `structure` entries are **not** this
root — they are shadows of the `.tex` payload divergences (~22 direct member-name re-reports and ~20
`common/N` content-hash-class shifts), filed separately as
`docs/backlog/2026-07-21-common-n-tex-hash-shadows.md`. So this orphan item is genuinely ~5 entries;
do not fold the other 42 into it.

## What to do

The C# repack path is traced (above). Decide between: reproduce "retain unreferenced source members
verbatim" in our PMP writer (`src/container/pmp.ts`) — the byte-parity default — or confirm it as an
accepted divergence with a rule (dropping dead weight is arguably a *better*, smaller pack, but that
clears the first-principle bar only with a `DIVERGENCE_RULES`-style confirmation, not a bare baseline
suppression). Either way it retires only the ~5 orphan/rename `structure` entries, **not** the other
~42 (those follow the `.tex` payload burndown — see the scope note). Scope any fix carefully so it
does not mask a *different* dropped-member bug: a blanket "drop unreferenced members" divergence rule
could hide a resolver bug that wrongly drops a member that *should* be referenced — a silent
wrong-output regression, which is why the verbatim-reproduce option is the safer of the two.
