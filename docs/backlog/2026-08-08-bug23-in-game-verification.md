# In-game verification of the bug #23 divergence (AGENTS.md evidence bar 3)

Filed: 2026-08-08 · Status: open · **Requires the operator — no agent can discharge this.**

`docs/TEXTOOLS_BUGS.md` **#23** is the repo's one deliberate divergence *from* TexTools' behaviour
rather than a faithful reproduction of it. AGENTS.md sets three evidence bars for that, and the third
has not been met:

> Someone has **verified in the real game** that our output is better than TexTools' — the mod works
> where TexTools' output is broken or degraded. This step is manual and cannot be skipped or
> inferred; an untested "improvement" is just an unverified divergence.

Bars 1 and 2 **are** met — the behaviour traces to a registered defect (#23), and the divergence is
confirmed corpus-side by `makeV4ExtraFileDuplicateConfirmation`
(`test/helpers/pmp-v4-extrafile-divergence.ts`), wired into the `/resave` check and exercised by the
purpose-built `test/corpus/synthetic/pmp-v4-extrafiles.pmp`. **Bar 3 is the sole outstanding one**, so
today the divergence ships on the operator's 2026-08-06 ruling, not on satisfied evidence.

## What the divergence is

`PMP.cs · LoadPMP · 191-208` builds its "extra files" set from the on-disk `groups` list, but the v4
pull-back at `:217-225` never assigns that local — it assigns `pmp.Groups` instead. So the
referenced-file scan at `:234` sees nothing for a v4 pack's inline groups, misclassifies every such
payload member as "extra", and `WizardData.WritePmp`'s `saveExtraFiles` path writes each one **twice**.
Our reader feeds the scan from the groups it actually loaded, so it emits each member once.

The reproduction and the suggested upstream patch live in the register entry itself
(`docs/TEXTOOLS_BUGS.md` #23).

## What to do

1. Produce both outputs for `test/corpus/synthetic/pmp-v4-extrafiles.pmp` — ours via `/resave`
   through this port, and ConsoleTools' via its own `/resave`.
2. Install **both** in Penumbra.
3. Confirm: both load; the in-game result is identical; ours is roughly **half the size**.
4. Record the outcome in **both** places that currently say bar 3 is outstanding —
   `test/helpers/pmp-v4-extrafile-divergence.ts` and `docs/TEXTOOLS_BUGS.md` #23 — and clear the
   **OPEN** note in `docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` §9.

## If it fails

A negative result is the useful one, and it is not merely a documentation change: if TexTools'
duplicated output behaves differently in-game than our de-duplicated output, then the duplication is
load-bearing somehow and **the divergence has to be withdrawn** — our reader would go back to
reproducing the bug faithfully, with the confirmation rule and the synthetic pack re-pointed at the
reproduction instead. Plan for that outcome rather than treating this as a formality.

## Why it is ranked where it is

Ranked first not by size — it is one manual test — but because it is the **only** thing in the repo
shipping on a ruling instead of on evidence, and the rule it is suspended against is one of the
project's three founding principles. Every day it stays open, more work is built on top of an
unverified divergence.
