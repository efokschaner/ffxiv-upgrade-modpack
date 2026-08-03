# Mutation testing as a latent-divergence detector

Filed 2026-08-01, out of the diagnostics-channel design
(`docs/superpowers/specs/2026-08-01-upgrade-diagnostics-channel-design.md` §2).

## The problem

Byte-parity on an input proves we are correct **on that input**. A control-flow difference between
our port and the C# that happens to be *absorbed* on every corpus input is invisible to the golden
harness — a **latent** divergence that becomes live the day a user uploads an input that
distinguishes it. Coverage cannot see it either: 92.98% lines / 84.6% branches says a line
*executed*, not that the decision at that line matched TexTools.

This was surfaced while designing the diagnostics channel, where a trace-based oracle was considered
and rejected for addressing only a keyhole of this class (that spec's §2 has the full reasoning).
The general problem was left open. This item is the open half.

## Why mutation testing specifically

A surviving mutant is *literally* the definition of the failure mode: a decision our code makes that
no input in the corpus distinguishes. Properties that fit this repo:

- **General over the whole port**, not scoped to a particular seam.
- **Needs no oracle.** Goldens are cached content-addressed under `test/corpus/.upgrade-cache/`, so a
  run is pure local compute — no ConsoleTools spawn, no game install.
- **Its output is a worklist of synthetics to author.** "No input distinguishes this branch" is
  exactly the input to `scripts/generate-synthetics/`, and the repo already has the
  author-a-pack → real-oracle → lock-the-result loop. It feeds existing machinery rather than adding
  a parallel one.
- **Report-only**, like `npm run test:coverage` — a periodic audit, never part of the `npm test`
  gate, consistent with the "keep the gate unbrittle" stance.

## Known costs, to size before committing

- **Slow**: N mutants × the suite, so it must be scoped per-directory (`src/upgrade/`, `src/mtrl/`,
  …) and run as an overnight job.
- **Runner integration is real work.** Stryker supports Vitest 4 (we are on 4.1.9), but tests run
  through a custom runner (`scripts/run-tests.ts`), not `vitest` directly.
- **Equivalent-mutant triage.** A mutated line that is unreachable by construction, or where TexTools
  behaves identically either way, survives without being a gap. This is the main ongoing cost and the
  main risk of the signal being ignored.

## What this item does NOT cover

The sibling failure mode: **C# behaviour never ported at all**. There is no branch to mutate and no
line to be uncovered, so mutation testing is blind to it by construction. That stays answered by the
citation-and-reading discipline plus corpus widening. A C#-side coverage harness was considered and rejected — we deliberately split
modules, and a large fraction of C# branches (every `files == null` half of
`EndwalkerUpgrade.cs`) is structurally unreachable on the modpack path, so the signal would arrive
buried in noise.
