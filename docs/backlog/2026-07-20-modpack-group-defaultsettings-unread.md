# `ModpackGroup.defaultSettings` is now write-only — nothing in `src/` reads it

Filed: 2026-07-20 · Status: open (write-only field, deliberately kept — decide its fate)
Surfaced by: review of the `fix/ttmp2-mpl-missing-fields` branch (Task 4, commit `5eddfd4`)

`ModpackGroup` (`src/model/modpack.ts:96`) declares `defaultSettings: number`. Every load path
assigns it — `readPmp` from the source group's `DefaultSettings` (`src/container/pmp.ts:271`),
`readTtmp2` and `readLegacyTtmp` to a literal `0` (`src/container/ttmp2.ts:136`, `:159`,
`src/container/ttmp-legacy.ts:91`) — but **no production code reads it back**.

The last consumer was the PMP writer. `groupSelection` (`src/container/pmp.ts`) used to
RECONSTRUCT each option's selection state from the group's raw `defaultSettings`, because the domain
model carried no per-option flag. Task 4 gave `ModpackOption` a real `selected` flag, derived at the
same seam the two C# loaders derive it (`FromPMPGroup`, `WizardData.cs:805-813` + the "none
selected" fixup `:857-860`; `FromWizardGroup`, `:755-757`), so `groupSelection` is now the direct
port of the `Selection` getter (`WizardData.cs:578-604`) and reads only `selected`. That is not a
regression but a fidelity gain — `ToPmpGroup` writes `pg.DefaultSettings = Selection`
(`WizardData.cs:949`) and never carries a source value through — and it left this field with no
reader. A grep for `defaultSettings` across `src/` finds assignments and type declarations only.

**The field was deliberately not removed**, and this item records that decision rather than leaving
it silent:

- It is a **faithful part of the ported data structure.** `ModpackGroup` mirrors `PMPGroupJson`,
  whose `DefaultSettings` is a real serialized member (`PMP.cs:1404`) that other TexTools call paths
  read. AGENTS.md's "mirror the C# data structure, not just its values" cuts toward keeping it.
- Unlike `MetaRoot.slot` (`docs/backlog/2026-07-19-metaroot-slot-unread.md`, the same shape of item)
  **the stored value is honest**, not a fabricated placeholder: on the PMP path it is the source
  document's own number, and on the TTMP paths `0` is what the format genuinely encodes (a TTMP
  group has no `DefaultSettings` field at all; selection lives in each option's `IsChecked`). So it
  is inert rather than a latent trap — a future consumer reading it gets a true value.

**What to decide.** Either:

1. **Remove `defaultSettings`** from `ModpackGroup` and its four assignment sites — smallest
   surface, and the model then expresses selection in exactly one place (`ModpackOption.selected`),
   which is also what the C# getter does; or
2. **Keep it** as the mirrored serialized member, on the argument that a future reader (a UI that
   wants to show the pack's authored default, a `/resave` seam fix) will want the source value that
   `selected` has already been normalized away from.

Note the two are not equivalent in information content: `selected` is *derived* from
`defaultSettings` on the PMP read path and loses the raw value (an out-of-range Single index is
backstopped to option 0; a Multi bitmask's bits past option count are dropped). If nothing ever
needs the pre-normalization value, option 1 is right.
