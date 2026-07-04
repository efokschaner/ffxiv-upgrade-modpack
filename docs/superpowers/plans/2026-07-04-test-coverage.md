# Test Coverage Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `npm run test:coverage` that measures coverage of `src/**` and `test/**` across the full test suite (including the corpus work units), report-only.

**Architecture:** Use Vitest's built-in v8 coverage provider (Vitest already IS the engine). Coverage config lives in `vitest.config.ts`, disabled by default. The custom runner (`scripts/run-tests.ts`) parses a `--coverage` CLI flag (mimicking the Vitest CLI) and flips `coverage.enabled` in the config override it already passes to `createVitest`. Because the runner drives `standalone()` + `runTestSpecifications(specs, true)`, and Vitest's `runFiles` already calls `reportCoverage` internally, no extra lifecycle wiring is needed.

**Tech Stack:** Vitest 4.1.9, `@vitest/coverage-v8`, tsx, TypeScript, Biome.

## Global Constraints

- **Supply chain:** new deps pinned-exact (`.npmrc save-exact` is on), installed with a ≥ 7-day min release age. Today is 2026-07-04, so use `--before=2026-06-27`.
- **Provider must match core version exactly:** `@vitest/coverage-v8@4.1.9` (vitest is 4.1.9).
- **`reference/` is off-limits** — never edit/lint/format it.
- **Formatting is mechanical** — run `npm run check`; never hand-format.
- **End-of-task ritual (required, all green):** `npm run check`, then `npm run typecheck`, then `npm test`.
- **Default path must stay overhead-free:** plain `npm test` / `test:watch` must not enable coverage.

---

### Task 1: Coverage dependency, config, and gitignore

Installs the provider, adds the (default-off) coverage config block, and ignores the report output. After this task, coverage is *configured* but nothing turns it on yet — so the whole existing suite must still pass unchanged.

**Files:**
- Modify: `package.json` (devDependencies — added by npm)
- Modify: `vitest.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a `test.coverage` config block with `provider: "v8"`, `enabled: false`, that later tasks enable at runtime by passing `coverage: { enabled: true }` in the `createVitest` override.

- [ ] **Step 1: Install the coverage provider (pinned-exact, min release age)**

Run:
```powershell
npm install -D "@vitest/coverage-v8@4.1.9" --before=2026-06-27
```
Expected: `package.json` devDependencies gains `"@vitest/coverage-v8": "4.1.9"` (exact, no caret). If npm reports the version cannot satisfy `--before=2026-06-27`, stop and report — do not relax the date; ask the user.

- [ ] **Step 2: Verify the pin is exact**

Run:
```powershell
Select-String -Path package.json -Pattern 'coverage-v8'
```
Expected: a line showing `"@vitest/coverage-v8": "4.1.9"` (no `^`, no `~`).

- [ ] **Step 3: Add the coverage block to `vitest.config.ts`**

Replace the `test: { ... }` object so it reads exactly:
```ts
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    maxWorkers: MAX_WORKERS,
    coverage: {
      // Enabled at runtime by scripts/run-tests.ts when invoked with --coverage
      // (see `npm run test:coverage`). Off by default so plain `npm test` and
      // `test:watch` pay zero coverage overhead.
      enabled: false,
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      // Test helpers are part of the system under test, so include test/** too.
      // `all` surfaces files no test touched (as 0%) instead of hiding them.
      include: ["src/**", "test/**"],
      all: true,
      // No thresholds: report-only (there is no CI; the test gate stays unbrittle).
    },
  },
});
```

- [ ] **Step 4: Add `coverage/` to `.gitignore`**

Add under the `# Node` section (after the `dist/` line):
```
coverage/
```

- [ ] **Step 5: Verify config typechecks and formats clean**

Run:
```powershell
npm run check ; npm run typecheck
```
Expected: both exit 0. (`check` may reformat the edited config — that's fine.)

- [ ] **Step 6: Verify the default suite is unchanged (coverage still OFF)**

Run:
```powershell
npm test
```
Expected: full suite passes exactly as before. No `coverage/` directory is created (nothing enabled coverage). Confirm:
```powershell
Test-Path coverage
```
Expected: `False`.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json vitest.config.ts .gitignore
git commit -m "build(coverage): add @vitest/coverage-v8 and default-off config"
```

---

### Task 2: `--coverage` CLI flag in the custom runner + `test:coverage` script

Teaches `scripts/run-tests.ts` to honour `--coverage` (mimicking the Vitest CLI) and wires up the npm script. This is where coverage actually runs — across the full spec set, including every corpus unit.

**Files:**
- Modify: `scripts/run-tests.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: the `test.coverage` block from Task 1 (`enabled: false` by default).
- Produces: `npm run test:coverage`, which enables coverage by passing `coverage: { enabled: true }` in the `createVitest` CLI-options override.

- [ ] **Step 1: Add the `--coverage` flag and a doc note in `scripts/run-tests.ts`**

Extend the file header comment to state the CLI-mimic intent. Immediately after the existing top block comment (the one ending `...as a plumbing/debug aid.`), add:
```ts
//
// CLI compatibility: this runner aims to transparently mimic the Vitest CLI to
// the degree we actually need. Flags we support should behave as `vitest <flag>`
// does rather than inventing bespoke equivalents. Supported so far:
//   --coverage   enable coverage for this run (as `vitest --coverage`).
// (CORPUS_UNIT stays an env var: it is a plumbing/debug aid with no Vitest-CLI
// analogue.)
```

In `main()`, just after `const single = process.env.CORPUS_UNIT;`, add:
```ts
  const coverage = process.argv.includes("--coverage");
```

Change the `createVitest` CLI-options argument (currently `{ watch: false, reporters: ["default"] }`) to:
```ts
    {
      watch: false,
      reporters: ["default"],
      // --coverage flips this on; config default (vitest.config.ts) is false so the
      // normal path stays overhead-free. standalone()+runTestSpecifications already
      // drive the full coverage lifecycle: standalone() inits+cleans the provider,
      // and runFiles() calls reportCoverage() internally, so no extra call is needed.
      coverage: { enabled: coverage },
    },
```

- [ ] **Step 2: Add the `test:coverage` npm script**

In `package.json` `scripts`, add after the `test:watch` line:
```json
    "test:coverage": "tsx scripts/run-tests.ts --coverage",
```

- [ ] **Step 3: Format + typecheck**

Run:
```powershell
npm run check ; npm run typecheck
```
Expected: both exit 0.

- [ ] **Step 4: Run coverage and verify reports are actually produced (the empirical check)**

Run:
```powershell
npm run test:coverage
```
Expected:
- Suite passes (same green as `npm test`).
- A `text` coverage table prints to stdout with **non-zero** `% Stmts` for real `src/**` files (e.g. `src/sqpack/…`, `src/mtrl/…`) — proving the corpus workers' coverage was captured, not just the `*.test.ts` files.
- Report artifacts exist:
```powershell
Test-Path coverage/index.html ; Test-Path coverage/coverage-summary.json
```
Expected: both `True`.

If the text table shows all files at 0% or the files are missing: coverage did not collect from the forked workers. Do NOT paper over it with a manual `reportCoverage` call (the source shows `runFiles` already reports). Instead debug: confirm `provider: "v8"` resolved, confirm `include` globs match (paths are POSIX-style, repo-root-relative), and confirm the provider package installed. Report findings before proceeding.

- [ ] **Step 5: Verify the default path is still coverage-free**

Run:
```powershell
Remove-Item -Recurse -Force coverage ; npm test ; Test-Path coverage
```
Expected: suite green, final output `False` (plain `npm test` never enables coverage).

- [ ] **Step 6: Commit**

```powershell
git add scripts/run-tests.ts package.json
git commit -m "feat(coverage): --coverage flag + test:coverage script on custom runner"
```

---

### Task 3: Document the command in AGENTS.md

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: the `test:coverage` script from Task 2.
- Produces: nothing consumed downstream (docs only).

- [ ] **Step 1: Add the coverage command under the Commands list**

In `AGENTS.md`, in the `## Commands` bullet list, add after the `npm test` line:
```markdown
- `npm run test:coverage` — coverage report (v8) over the full suite incl.
  corpus; opt-in, **not** part of the required test gate. Writes `coverage/`.
```

- [ ] **Step 2: Verify formatting**

Run:
```powershell
npm run check
```
Expected: exit 0 (Biome may or may not touch Markdown; either way clean).

- [ ] **Step 3: Commit**

```powershell
git add AGENTS.md
git commit -m "docs(coverage): document npm run test:coverage in AGENTS.md"
```

---

### Task 4: Coverage gap assessment (analysis deliverable)

No code changes. Produce the written assessment the user asked for, grounded in the real numbers from Task 2.

**Files:**
- Read: `coverage/coverage-summary.json`, `coverage/index.html` (drill-down), and `src/**` for context.

**Interfaces:**
- Consumes: `coverage/` reports produced by `npm run test:coverage`.
- Produces: a prose assessment delivered in-session.

- [ ] **Step 1: Generate a fresh report**

Run:
```powershell
npm run test:coverage
```
Expected: green, `coverage/coverage-summary.json` present.

- [ ] **Step 2: Extract the per-file totals for a ranked view**

Run:
```powershell
$c = Get-Content coverage/coverage-summary.json -Raw | ConvertFrom-Json
$c.PSObject.Properties |
  Where-Object { $_.Name -like '*src*' } |
  ForEach-Object { [pscustomobject]@{ File = ($_.Name -replace '.*/src/','src/'); Stmts = $_.Value.statements.pct; Branch = $_.Value.branches.pct; Funcs = $_.Value.functions.pct } } |
  Sort-Object Stmts | Format-Table -AutoSize
```
Expected: a table of `src/**` files sorted worst-covered first.

- [ ] **Step 3: Write the assessment**

For the lowest-covered files and branches, open the corresponding `coverage/index.html` drill-down (or the source) and classify each concerning gap as one of:
- **Genuinely untested** — logic reachable but no test/corpus exercises it (→ add a test).
- **Not reachable from the current corpus** — needs a modpack variant we don't have (→ corpus-expansion note, not a missing unit test).

Prioritise most-concerning first. Explicitly check these known suspects against the numbers:
- `src/index.ts` — the cross-format guard in `writeModpack` (the `throw` branch).
- Error/`throw` paths across `src/sqpack/**`, `src/tex/**`, `src/mtrl/**`, `src/mdl/**`.
- Format variants: legacy ttmp vs ttmp2 vs pmp (`src/container/**`).
- Notable `test/helpers/**` helpers showing 0% (dead/unused test scaffolding).

Deliver as prose in-session. (Optional: if the findings are worth keeping, add a short `docs/` note and commit it — otherwise no commit.)

---

## Notes for the implementer

- **Windows/PowerShell:** commands above are PowerShell. `;` sequences commands; check each step's expected output rather than relying on a single exit code.
- **Do not** add coverage to the default `npm test`, and **do not** add thresholds — both are explicitly out of scope.
- **`coverage.include` paths** are repo-root-relative, POSIX-style globs even on Windows.
