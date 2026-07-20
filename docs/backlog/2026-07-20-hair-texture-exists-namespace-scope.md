# `hair-texture-exists` is a namespace-scoped `FileExists` oracle, but is asked out-of-namespace questions

Filed: 2026-07-20 · Status: open · Surfaced by the 2026-07-20 reference-table completeness audit

`src/upgrade/reference/hair-texture-exists.ts` is the runtime `FileExists` oracle for
`RepathHairMashups` (`ModpackUpgrader.cs:379-482`), answering from the bundled
`hair-texture-index.ts` — 3,378 `(folderHash, fileHash)` pairs. It ports `HashGenerator.ComputeCRC`
(`HashGenerator.cs:154-205`) and `IndexFile.FileExists`' hash membership check
(`IndexFile.cs:516-621`) faithfully. **The hashing is not the problem; the domain is.**

The bundled set is *namespace-scoped*, and says so (`hair-texture-exists.ts:3-4`,
`scripts/extract-hair-texture-index.ts:6`): it covers only files under the hair / zear / tail
**texture** folders, enumerated as the full `IDRaceDictionary` race grid × `ID_MAX = 500`
(`scripts/extract-hair-texture-index.ts:56,68-83`). Within that namespace it is complete — the
extractor scans the whole 040000 index segment and keeps every file whose folder hash matches. Outside
it, every lookup returns a hard `false` regardless of what is really in the game index.

**The mismatch.** The enclosing loop only *visits* materials matching
`chara/human/c####/obj/{hair,zear,tail}/….mtrl` (`repath-hair-mashups.ts:17-21`), which is why the
namespace looked sufficient. But a material in that namespace can bind a **sampler path pointing
anywhere** — a mashup referencing `chara/common/…`, or a hair/ear/tail id above 500. Those are asked
of the oracle and answered `false` without justification.

**Why that is a silent divergence.** All three rewrite sites are shaped
`if (!exists(old)) { if (exists(candidate)) rewrite; }` — normal at `repath-hair-mashups.ts:52-62`,
mask at `:65-81`, diffuse at `:86-95`. A false negative on the *old* path is harmless (the rewrite is
still gated on the candidate). A false negative on the ***candidate*** silently suppresses a rename
TexTools would perform: no throw, no warning, and the material is re-serialized and written back
unconditionally at `:98` either way, so the output looks normal.

This is the same rule-violation shape as
[`index-path-overrides`](2026-07-10-index-path-overrides-e0208.md) — AGENTS.md's *"let the table **be**
the existence oracle: enumerate exactly the game files that exist, so a lookup **miss** means the file
is genuinely absent"* — but milder in effect (a skipped rename, not a wrong emitted path). Of the eight
bundled reference tables, these two are the only ones whose miss is not demonstrably faithful; the rest
either throw (`imc-table`, 15,695 roots) or enumerate their full domain (`est-table`, `hair-materials`
1,513, `eye-materials` 339).

**Options, in rough order of preference:**

1. **Widen the bundled index to the domain actually queried.** The candidate transforms are a closed
   set of suffix rewrites (`_n`→`_norm`, `_m`/`_s`→`_mask`/`_mult`, `_d`→`_base`, plus `--` stripping),
   so the set of paths that can ever be asked is derivable — enumerate it and bundle exactly those
   hashes rather than a folder-shaped slice.
2. **Fail loud on an out-of-namespace query** instead of answering `false`, per "fail loud, never
   silently diverge". Safe, but turns a currently-silent skip into a hard failure on real mods, so it
   needs corpus evidence on how often it fires before it can ship.
3. Keep the bound and **document the window precisely** at both the oracle and the call sites.

Whichever is chosen, the completeness claim in `hair-texture-exists.ts:38-39`
(*"out-of-namespace paths are a faithful miss"*) is currently stronger than the evidence supports and
must be restated.

**Test gap to close with the fix:** no corpus pack exercises an out-of-namespace sampler path today, so
nothing would have caught this. Prefer a **synthetic pack** (`scripts/generate-synthetics/`) carrying a
hair material whose normal sampler points at `chara/common/…` or a hair id > 500 — that runs it through
the `/upgrade` golden harness and AB-tests the real answer against TexTools, which is the only way to
learn what the game index actually says at those paths.
