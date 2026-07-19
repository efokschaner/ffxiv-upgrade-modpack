# `diffPayloadSemantic` part 2 has narrower coverage than a casual read suggests

Filed: 2026-07-18 · Status: open · Priority: unprioritized (documentation/coverage gap, not a known
live bug) · Surfaced during the final-review pass on
`docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md`

`diffPayloadSemantic` (`test/helpers/upgrade-archive-diff.ts`) is the relaxed-mode payload comparison
used only for a pack whose input carries FileSwaps (`packHasFileSwaps`, gated per the design spec's
§5.2 — 2 of the corpus today: the real `torn bassment glow.pmp` and the synthetic `file-swaps.pmp`).
Part 1 compares the Penumbra redirect table (`gamePath -> content`, via `resolveRedirects`, which
walks each option's `Files` map); part 2 compares payload member *names* outside the `common/N`
dedup namespace, to catch a misnamed or dropped ordinary member that part 1's `Files`-keyed view
can't see.

Auditing that part 2 doc comment against the code (this branch) found two real coverage gaps, not
just imprecise wording — now corrected in the comment, but the underlying behaviour is unchanged:

1. **A one-sided orphan member INSIDE `common/` is invisible.** `outsideNames` filters every
   `common/`-prefixed name out of part 2's comparison, on *both* `ours` and `golden` — not just out
   of the exact-name check. So a `common/N/...` member present on only one side (a writer bug that
   drops or adds a deduped member, unrelated to any legitimate `common/N` renumbering) is checked by
   nothing in relaxed mode, unless it also happens to be named by some option's `Files` value (in
   which case part 1 would at least catch a content mismatch for the *matched* pair — a one-sided
   presence difference still isn't structurally flagged). The strict-mode sibling,
   `diffPayloadMembers`, would report exactly this as a structural add/remove.

2. **Part 2 is name-only.** A payload member matched by name in part 2 is never byte-compared —
   that's deliberate, since part 1's redirect-table walk already content-checks every member a
   `Files` value points at. But part 1 only ever looks at `Files`; a payload member named by
   something else — an option's `Image` field, an `ExtraFiles` entry, any future non-`Files`
   reference — has its bytes checked by *neither* part when relaxed mode is active, even though
   `diffPayloadMembers` (strict mode) would content-compare a matched pair like that directly.

**Why this wasn't caught by anything so far:** both gaps only matter on the 2 packs that take the
relaxed path, and neither of those two currently exercises a `common/`-orphan or a non-`Files` payload
member content mismatch — so nothing in the golden harness or synthetic corpus currently depends on
either hole.

## What to do

Two independent strengthenings, either or both:

- **Byte-compare matched pairs in part 2**, the same way `diffPayloadMembers` already does for its
  own matched pairs — closes gap 2 without touching part 1's redirect-table walk.
- **Reconsider the blanket `common/` filter in part 2** — e.g. still bucket-compare `common/`-prefixed
  names for *count* (not exact identity, since renumbering must stay free), so a one-sided orphan
  inside the namespace is at least flagged as a count mismatch instead of vanishing entirely. Needs
  care: the whole point of `common/N` tolerance is that legitimate renumbering shifts names, so a
  naive "the two sets of `common/` names must be equal" reintroduces the very mismatch the mode
  exists to suppress.

Deliberately not fixed in the pass that filed this item — AGENTS.md's project instructions call out
that a late behaviour change to the project's only oracle (`diffArchives`/`diffPayloadSemantic`) is
not worth the regression risk without a test that specifically needs it. If either gap is ever hit by
a real or synthetic pack, that pack's failure is the natural forcing function to build the fix against.

Reference: `test/helpers/upgrade-archive-diff.ts` · `diffPayloadSemantic` (part 2, the `outsideNames`
bucketed comparison) · doc comment now describes both narrowings in detail.
