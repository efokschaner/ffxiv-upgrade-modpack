# Test coverage integration — design

Date: 2026-07-04
Status: approved (brainstorm)

## Goal

Give the repo an on-demand way to measure test coverage of `src/**` and
`test/**`, so we can judge whether the tests and the corpus of real-world
modpacks exercise the code sufficiently, and find concerning gaps before the
next development step.

Report-only. No build-failing thresholds (there is no CI, and the normal test
gate must stay fast and unbrittle).

## Context that shapes the design

- `npm test` runs `tsx scripts/run-tests.ts`, a **custom runner that drives
  Vitest programmatically** (`createVitest` / `standalone()` /
  `runTestSpecifications`). It is not a bespoke engine — Vitest 4 (4.1.9) is
  already the engine, so coverage should use a Vitest coverage provider rather
  than a third-party tool.
- The bulk of real code exercise comes from the **corpus work units**: 33 real
  modpacks × check-families (sqpack/golden/mtrl/tex/mdl/pmp), enumerated in
  `test/helpers/corpus-units.ts` and dispatched as fileless virtual specs
  (`\0virtual:corpus-unit:<i>`) across forked workers. A naive
  `vitest run --coverage` would only see the `*.test.ts` files and **miss the
  corpus entirely**, wildly undercounting. Coverage therefore must run through
  the custom runner so it sees the full spec set.
- Coverage is collected from the **forked workers**, where the virtual corpus
  modules import and exercise `src/**`. The runner (`scripts/run-tests.ts`) and
  the corpus plugin (`scripts/corpus-units-plugin.ts`) execute in the **main
  process**, so their code is never registered as covered.

## Decisions

- **Provider: v8** (`@vitest/coverage-v8`). Native V8 coverage, low overhead, no
  source instrumentation — the right fit given big corpus packs (200–457 MB) and
  the existing 8-worker memory cap. Vitest 4 remaps V8 data to source with
  usable branch coverage.
- **Report-only.** No thresholds.
- **Opt-in via a CLI switch**, not always-on: the default `npm test` and
  `test:watch` pay zero coverage overhead.

## Design

### 1. Dependency

Add `@vitest/coverage-v8` as a dev dependency:

- Version-matched to the installed `vitest` (4.1.9). Vitest requires the
  coverage provider to match the core version exactly.
- Pinned-exact (`.npmrc save-exact`), installed with a ≥ 7-day min release age
  (`npm install -D @vitest/coverage-v8@4.1.9 --before=<date ≥7 days ago>`).

### 2. Coverage config (`vitest.config.ts`)

Add a `test.coverage` block:

- `provider: "v8"`
- `enabled: false` — default off; the runner turns it on when asked (§3).
- `reporter: ["text", "html", "json-summary"]` — text summary to stdout for a
  quick read, HTML to `coverage/` for drill-down, `json-summary` for a stable
  machine-readable total used by the gap assessment.
- `include: ["src/**", "test/**"]` — test helpers are part of the system under
  test; an unexercised helper is itself a signal.
- `all: true` — files never touched by any test still appear (as 0%), so gaps
  cannot hide by being absent from the report.
- `reportsDirectory: "coverage"`.
- No `thresholds`.

`reference/**` is out of scope simply by not being included (it is also
gitignored and off-limits). `scripts/**` is intentionally not included: it runs
in the main process and would show a misleading 0% under `all: true`.

### 3. Wire coverage into the custom runner

`scripts/run-tests.ts` gains minimal, Vitest-CLI-compatible argv parsing:

- Parse `--coverage` from `process.argv`. When present, set
  `coverage: { enabled: true }` in the **config override object already passed
  to `createVitest`** (second arg). This is the first CLI flag the runner
  honours; it establishes the convention.
- Document the intent in the file's header doc comment: this runner aims to
  **transparently mimic the Vitest CLI to the degree necessary** — flags we need
  should behave as `vitest <flag>` does, rather than inventing bespoke
  env-var equivalents. (`CORPUS_UNIT` remains an env var: it is a
  plumbing/debug aid with no Vitest-CLI analogue.)

New npm script:

```json
"test:coverage": "tsx scripts/run-tests.ts --coverage"
```

Same entry point as `npm test`, so coverage sees the identical full spec set
(normal specs + all corpus units). Single source of truth for spec routing; no
divergent second entry point.

**Lifecycle risk to validate empirically (implementation task):** the runner
drives `standalone()` + manual `runTestSpecifications` rather than
`vitest.start()`. Coverage init/clean/collect is lifecycle-bound, and the
end-of-run `reportCoverage()` may not fire automatically on this path. The
implementation must verify whether an explicit `await vitest.reportCoverage(true)`
(before `close()`) is required to emit reports, and if so add it — guarded so it
only runs when coverage is enabled, leaving the default path byte-for-byte
unchanged. Verification = run `npm run test:coverage` and confirm a populated
`coverage/` report and non-zero `src/**` numbers actually appear.

### 4. Artifacts / gitignore

- Add `coverage/` to `.gitignore`.

### 5. Docs

- One line in `AGENTS.md`: `npm run test:coverage` generates a coverage report;
  it is opt-in and **not** part of the required test gate.

### 6. Gap assessment (deliverable)

After the tooling runs green, generate coverage and produce a written
assessment of concerning gaps in `src/**` (and notable `test/**` helper gaps):

- Prioritised, most-concerning first.
- Distinguish **genuinely untested** logic from logic **not reachable from the
  current corpus** (the latter is a corpus-expansion signal, not a missing-test
  signal).
- Call out obvious suspects up front to verify against the numbers: error/throw
  paths, format variants, and the cross-format guard in
  `writeModpack` (`src/index.ts`).

Delivered as prose in the session (optionally a short `docs/` note if it proves
worth keeping); no code changes are implied by the assessment itself beyond
recommendations.

## Out of scope

- Coverage thresholds / gating.
- Wiring coverage into `npm test` by default.
- Any CI.
- Measuring the runner/plugin main-process code.
```
