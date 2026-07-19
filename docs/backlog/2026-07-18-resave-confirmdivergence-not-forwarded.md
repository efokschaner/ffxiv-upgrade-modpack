# `/resave`'s `diffArchives` call never forwards `confirmDivergence`

Filed: 2026-07-18 · Status: open · Surfaced closing out the FileSwap-preservation spec

`test/helpers/corpus-upgrade.ts` and `test/helpers/corpus-resave.ts` both call `diffArchives`, but
only the `/upgrade` harness passes its `confirmDivergence` argument through:

```typescript
// corpus-upgrade.ts
const archive = diffArchives(oursArchive, goldenBytes, target === "pmp", confirmDivergence, layoutEquivalent);

// corpus-resave.ts
const archive = diffArchives(oursArchive, goldenBytes, target === "pmp", undefined, layoutEquivalent);
```

The fourth argument — forwarded into `diffPayloadMembers`' (and, when `layoutEquivalent`,
`diffPayloadSemantic`'s) matched-pair content check — is `undefined` on the `/resave` call site.

**Consequence.** Any `DIVERGENCE_RULES` entry that would *confirm* a payload-member content mismatch
(e.g. the eye-mask diffuse's float64-vs-float32 pixel tolerance, or a future FileSwap-adjacent rule)
never fires from `/resave`'s structural comparison. The mismatch still gets through the suite green,
but only because it falls through to the gitignored `/resave` ratchet baseline
(`test/corpus/.resave-baseline/`) — which, per AGENTS.md, does **not** count as documenting a
divergence ("the baseline suppresses a diff, it does not confirm one"). So a divergence that is
properly *confirmed* under `/upgrade` is merely *suppressed* under `/resave` for the exact same pack
and the exact same bytes — an asymmetry between the two harnesses' rigor that is easy to miss because
both are green today.

**Why this is pre-existing, not caused by the FileSwap-preservation branch.** The gap in
`corpus-resave.ts` predates that work; it was only noticed while auditing both call sites for the new
`layoutEquivalent` parameter (`docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md`
§5.2), which both harnesses do wire up correctly and symmetrically. `confirmDivergence` is the one
argument that was already asymmetric before this branch touched either file.

**Why not fixed inline.** Forwarding `confirmDivergence` would let `DIVERGENCE_RULES` entries start
firing on `/resave` diffs that today land, unconfirmed, in per-pack `/resave` baselines. That will
shrink (and for some packs, possibly change the shape of) several packs' `.resave-baseline` entries —
a deliberate re-bless, not a side effect of an unrelated change. It needs its own pass: run the fix,
inspect what newly confirms vs. what still needs a baseline entry or a new `DIVERGENCE_RULES` rule,
then bless deliberately (`$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`).

**What to do about it:** pass `confirmDivergence` through in `corpus-resave.ts`'s `diffArchives` call,
same as `corpus-upgrade.ts` already does, then run the full suite and re-bless `/resave` baselines
that shrink as a result — reviewing each shrink to confirm it is exactly the divergence its
`DIVERGENCE_RULES` rule claims, not an accidental widening.

Reference: `test/helpers/corpus-resave.ts` (the `diffArchives` call) vs.
`test/helpers/corpus-upgrade.ts` (the same call, correctly wired).
