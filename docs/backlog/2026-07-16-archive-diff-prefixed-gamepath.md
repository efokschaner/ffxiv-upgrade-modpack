# `diffArchives`' payload-member `confirmDivergence` call passes a prefixed name, not the bare gamePath

Filed: 2026-07-16 · Status: open · Priority: unprioritized (document/guard, not fix)

`diffPayloadMembers` (`test/helpers/upgrade-archive-diff.ts`), when comparing PMP zip payload
members whose bytes differ, calls `confirmDivergence(gs[i], oBytes, gBytes)` — but `gs[i]` there is
the **archive member name**, which for a PMP is `<optionPrefix><gamePath>`
(`src/container/option-prefix.ts`), not the bare `gamePath` that every other `confirmDivergence`
call site (`diffUpgrade`, per-file) passes. This is already called out in the function's own doc
comment (lines ~183-189): a path-scoped `DIVERGENCE_RULES` predicate consulted from this call site
must match a gamePath *suffix* of an arbitrary prefixed string — `.includes(...)`/`.endsWith(...)`
work, `.startsWith("chara/...")` does not, since the real prefix (e.g. `1 - Option Name/`) sits in
front of it.

**Why this is a latent footgun, not a live bug.** Today every `DIVERGENCE_RULES` predicate happens
to use `.endsWith`/`.includes`-shaped matching (or matches on file extension), so nothing currently
silently fails to fire. But nothing enforces that — a future rule authored the "obvious" way
(`path.startsWith("chara/human/...")`, mirroring how a bare-gamePath rule reads everywhere else)
would compile, pass review, and simply never confirm from this call site, silently promoting a
should-be-confirmed divergence to a hard mismatch here (while the *same* rule correctly fires from
`diffUpgrade`'s bare-gamePath comparison) — a confusing "it matches in one place but not the other"
symptom.

**Why not fix it here.** Recovering the true bare `gamePath` from a PMP archive member name at this
layer isn't feasible without re-deriving the option structure (which option prefix produced this
member) — `diffPayloadMembers` only has flat member-name sets, by design (see its doc comment on why
it deliberately doesn't share the PMP reader's resolution logic). Doing that properly means passing
the option/prefix mapping down from `diffArchives`' caller, which is more invasive than this item's
value justifies today.

**What to do about it:** either (a) leave it documented (as it already is, in
`upgrade-archive-diff.ts`) and rely on code review to catch a `.startsWith`-shaped rule meant for
this call site, or (b) add a lightweight runtime guard — e.g. have `DivergenceRule.confirm` (or a
wrapper used only at this call site) detect a predicate that would behave differently under a
prefixed vs. bare path and warn/throw in tests. No corpus pack or test currently depends on a rule
that would trip this, so there's nothing to prove a fix against yet.

Reference: `test/helpers/upgrade-archive-diff.ts` · `diffPayloadMembers` · confirmDivergence call
(~line 223); doc comment ~lines 183-189 already documents the constraint this item tracks.
