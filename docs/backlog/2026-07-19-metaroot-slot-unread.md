# `MetaRoot.slot` is no longer read by any production code

Filed: 2026-07-19 · Status: open (dead field, deliberately kept — decide its fate)
Surfaced by: review of the IMC reference table unification branch
(`docs/superpowers/specs/2026-07-19-imc-reference-table-unification-design.md`)

`parseMetaRoot` (`src/meta/root.ts`) returns a `MetaRoot` carrying a `slot: string` field. Before the
IMC table was re-keyed, `reconstructMeta` composed its `IMC_TABLE` lookup key from
`itemType`/`primaryId`/`slot`. That key is gone: the table is now keyed on the lowercased `.meta`
root path itself (spec §3.2), so `src/meta/reconstruct.ts` — `parseMetaRoot`'s **only** consumer in
`src/` — never touches `.slot`. Nothing else in `src/` reads it either. The only remaining readers
are tests (`src/meta/root.test.ts`), which assert the value `parseMetaRoot` computes.

**The field was deliberately not removed** as part of that branch, and this item records the decision
rather than leaving it silent. Two reasons to keep it for now:

- It is a **faithful part of the ported data structure.** `MetaRoot` mirrors
  `XivDependencyRootInfo` (`XivDependencyGraph.cs`, `_slotRegex` / `ExtractRootInfo` ·
  `XivDependencyGraph.cs:679-689`), whose `Slot` is a real member that other TexTools call paths
  read. AGENTS.md's "mirror the C# data structure, not just its values" cuts toward keeping the
  member; deleting it would make the next thing that needs a slot re-derive it ad hoc.
- The **weapon/monster placeholder is a live trap.** For those roots `_slotRegex` never matches and
  the real `XivDependencyRootInfo.Slot` is left unset, but our parser fills `slot` from the
  SecondaryType (`"body"`) instead. That is documented in place (`src/meta/root.ts`, the
  weapon/monster comment) and is currently harmless *precisely because nothing reads it*. The moment
  a future consumer does, it will silently read `"body"` where TexTools reads null.

**What to decide.** Either:

1. **Remove `slot`** from `MetaRoot`, along with the weapon/monster placeholder and its test
   assertions — the smallest surface, and the trap goes with it; or
2. **Keep it and make the placeholder honest** — type it `slot: string | null` and return `null` for
   weapon/monster, matching `ExtractRootInfo`'s actual behaviour, so a future consumer that reads it
   gets the C#'s value rather than a fabricated one.

Option 2 is the more faithful port and the safer of the two if any planned round needs a slot; option
1 is right if none does. Either way, do not leave a fabricated value on a field nobody reads — that
is exactly the shape of latent divergence that the IMC item this branch closed turned out to be.
