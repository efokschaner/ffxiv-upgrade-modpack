# T4 — `index-path-overrides` is corpus-scoped, so it silently emits convention paths for unseen base-game materials

Filed: 2026-07-10 · Status: open (ratchet baselines the known cases) · **Fix is a redesign, not a re-run**
(revised 2026-07-20)

**Read the scope problem first — it is bigger than the `e0208` symptom this item was filed under.**
`src/upgrade/reference/index-path-overrides.ts` holds **11 entries** and makes no completeness claim.
It is the only one of the eight bundled reference tables that is *corpus-derived*, and the only one
whose miss is a **silent fallback**: `src/upgrade/material.ts:144-147` keeps the convention-derived
`idPath` from `:130-133` when the lookup misses — no throw, no warning. The call site admits it
(`material.ts:141-143`): *"The table only holds paths where the golden **actually diverged**, so this is
exact **for the corpus**."*

That violates AGENTS.md's rule for bundled data — *"bundle them for the **complete** set of inputs the
transform can encounter"*, *"let the table **be** the existence oracle, so a lookup **miss** means the
file is genuinely absent"*. Consequence for the static site (design §4, round 7): a user modpack that
overwrites a base-game material needing the refinement, but which our local corpus never referenced,
gets the wrong `_id.tex` path silently. The blast radius is unknown by construction — the ratchet can
only ever catch materials the corpus already contains.

A second, smaller approximation is stacked on the same call site (`material.ts:140-141`): C#'s
refinement *also* gates on the convention idPath not already existing in-game
(`EndwalkerUpgrade.cs:923-936`); we apply the table unconditionally per material path.

`The_Final_Requiem_veil.ttmp2` overwrites base-game e0208 materials; the golden's index path uses the
canonical override (`EndwalkerUpgrade.cs:923-936`) but `src/upgrade/reference/index-path-overrides.ts`
has no e0208 c0101 entry, so we emit at the convention path (golden has `_met_id.tex` we don't →
`#0:added`) and the two e0208 `.mtrl` mismatch.

The index generation itself is byte-exact once pointed at the right path (triage-confirmed).

**More cases confirmed 2026-07-17** (corpus additions; the "and likely other" this item predicted):
the same convention-vs-canonical id-path split shows up beyond equipment — a **common** path
(`tightandfirmmaxfilia.ttmp`: golden `chara/common/texture/id_16.tex`, ours
`…/hair/h0133/texture/--c0201h0133_acc_id.tex`, same bytes) and a **monster** path (`Camp Site.ttmp2`:
golden `…/m8373/…/v01_m8373b0001_id.tex`, ours `v01_unknown_id.tex`, same bytes), each with the
referencing `.mtrl` mismatching. The widened extraction needs to cover common/monster id overrides,
not just equipment.

**Fix (corrected 2026-07-20 — the previous instruction was wrong).** This item used to read *"re-run
`scripts/extract-index-overrides.ts` against a game install to widen the table."* **That would widen
nothing.** The extractor is corpus-driven by construction: it iterates
`readdirSync(\`${CORPUS}/inputs\`)` (`scripts/extract-index-overrides.ts:106`), upgrades each pack,
diffs against the cached golden, and records an entry only where our output diverged from the golden
*and only in the index-sampler path*. Its own header says so (`:9-11`): *"for every **corpus material**
whose ONLY divergence from the golden is the index-sampler path…"*. Re-running it over the same corpus
reproduces the same 11 entries; it can never see an input the corpus does not contain. (The script is
fail-loud about its own gaps — `process.exitCode = 1` at `:179-184` — but only for problems visible
*within* the corpus.)

The real fix is to **enumerate the domain from the game index instead of from the corpus**, the way
`scripts/extract-meta-reference.ts:299-306` does for the IMC table (a SQL walk of `item_sets.db`,
exhaustive over every root `Imc.UsesImc` accepts, with the corpus used only as a spot-check at
`:452-537`). Concretely: enumerate base-game materials, resolve each one's own index-sampler path, and
emit an entry wherever it differs from the naming convention — covering equipment **and** the
common/monster cases confirmed above. Then decide whether the table can become the existence oracle
outright (miss ⇒ convention is provably correct), or whether the C# "convention idPath doesn't already
exist in-game" gate at `material.ts:140-141` must also be ported to stay exact.

Sibling item, same rule and same silent-miss shape (milder effect):
[`hair-texture-exists` namespace scoping](2026-07-20-hair-texture-exists-namespace-scope.md).

**Test gap to close with the fix:** the ratchet cannot catch this class by design. Coverage has to come
from either widening the corpus with base-game-overwriting mods, or — better — an assertion that the
regenerated table is complete over the enumerated domain, so a future gap fails at extraction time
rather than at a user's upload.
