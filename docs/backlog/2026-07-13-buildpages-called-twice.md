# `buildPages` is called twice per `writePmp` invocation

Filed: 2026-07-13 · Status: open · Wasted work, not a correctness bug

`buildPages` (`src/container/option-prefix.ts`) is called once inside `optionPrefixes` (for the
prefix map) and again directly in `writePmp` (for the default-mod absorption search and group_NNN
emission order / Page renumbering).

Both calls are pure and deterministic over the same `data`, so this is only a wasted recomputation
(confirmed: `buildPages` has no side effects and both call sites pass the same `data` reference) —
but it doubles the `FromPmp` / `ClearNulls` page-construction work on every write.

**Fix:** have `writePmp` call `buildPages(data)` once and pass the result into `optionPrefixes`
(which would need a signature change to accept pre-built `pages` instead of re-deriving them), or
have `writePmp` derive prefixes directly from its own single `buildPages` call instead of going
through `optionPrefixes` at all.

Deferred alongside `2026-07-13-split-writepmp-module.md` (2026-07-13) — bundling a signature change
with the split makes more sense than two separate mechanical passes over the same code.
