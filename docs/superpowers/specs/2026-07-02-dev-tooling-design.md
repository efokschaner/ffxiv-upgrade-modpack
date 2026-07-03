# Developer Tooling: Formatter, Linter, Git Hooks — Design

**Date:** 2026-07-02
**Status:** Design approved (brainstorming complete) — ready for implementation planning

---

## 1. Goal

Add the standard automated-quality tooling this codebase is currently missing —
**autoformatting, static analysis (linting), and git hooks** — so that formatting
and a class of correctness issues are enforced mechanically rather than by
convention. This matters especially because the codebase is developed largely by
agents: mechanical enforcement keeps agent-authored diffs consistent and catches
mistakes (unused symbols, unreachable code, unsafe patterns) before they land.

### What already exists (and is kept)

- `tsc` in `strict` mode with `noUncheckedIndexedAccess` — strong type config.
- `npm run typecheck` (`tsc --noEmit`), `npm test` (custom parallel runner), `npm run test:watch`.
- Pinned-exact deps (`.npmrc save-exact`), a real test suite, and spec/plan discipline.

### Success criteria

- `npm run check` formats + lints the whole repo with one tool (Biome).
- The full existing test suite and `tsc --noEmit` remain green after the tooling is added and after the one-time reformat.
- A commit that violates formatting/lint rules is caught locally by a **pre-commit** hook.
- An **`AGENTS.md`** documents the agent workflow — including the **end-of-task ritual** (`npm run check` + `npm run typecheck` + `npm test` before a task is considered done) — and a **`CLAUDE.md`** imports it via Claude Code's `@AGENTS.md` syntax so both toolchains read one source of truth.
- New dev deps installed pinned-exact, ≥ 7-day min release age (operator supply-chain policy).
- `git blame` remains meaningful after the reformat (reformat commit is ignored via `.git-blame-ignore-revs`).

### Out of scope

- **GitHub Actions / CI** — explicitly deferred by operator; not set up in this work. With no CI and no pre-push hook, the test suite is enforced by the **end-of-task convention** documented in `AGENTS.md` (§6) plus human review — a deliberate, low-friction choice appropriate for a solo, agent-driven repo. A pre-push test hook or CI can be layered on later without reworking anything here.
- Any change to runtime behavior in `src/`. The only `src/` changes are whitespace/format from the one-time reformat and any trivial lint auto-fixes (e.g. removing an unused import); no logic changes.
- Rewriting the custom test runner or corpus infrastructure.

---

## 2. Decisions locked during brainstorming

- **Toolchain = Biome (all-in-one).** One Rust binary and one config file do both formatting (replacing Prettier) and linting (replacing ESLint + typescript-eslint). Chosen over ESLint+Prettier for simplicity and speed; the small loss in type-aware depth is acceptable for this project.
- **Optimize for standardization over minimizing reflow.** Use community-standard formatting defaults rather than tuning the formatter to preserve the existing deliberately-compact style. Consequence: the compact single-line `for`-blocks and packed imports/objects **will** be reflowed. This was accepted explicitly.
- **One-time reformat is unavoidable and accepted.** It lands as an isolated, format-only commit (see §5).

---

## 3. Component 1 — Biome (format + lint)

**Dependency:** `@biomejs/biome` (dev, pinned-exact, ≥ 7-day min age).

**Config:** `biome.json` at repo root.

- **Formatter:** enabled. Community-standard settings that match the existing code where it already agrees, so the *only* churn is line-reflow, not a quote/indent war:
  - `indentStyle: "space"`, `indentWidth: 2` — **decided**. This is a deliberate divergence from Biome's own default of tabs: chosen because the entire codebase is already 2-space, it matches Prettier and the dominant published-style-guide convention (so zero indent churn on top of the reflow), and it renders predictably in diffs and code review. (Biome defaults to tabs on an accessibility rationale; that path was considered and declined.)
  - `lineWidth: 80` — Biome/Prettier default; this is the setting that drives the reflow.
  - Quotes double, semicolons always, trailing commas `all` — all already true in the code, so no churn from these.
- **Linter:** Biome's **stable `recommended`** rule set only (which already covers the `suspicious`/`correctness`/`complexity` groups — unused vars, unreachable code, unsafe patterns, etc.). **Type-aware linting is deliberately deferred:** the marquee type-aware rule `noFloatingPromises` is `nursery` (experimental) and belongs to Biome's *types domain*, so enabling it turns on Biome's whole-project type-inference scanner on every lint. The payoff is low here (the codebase is mostly synchronous binary parsing; the only real async surface is the test runner) and the cost (experimental rule + slower lint) is real — revisit once it graduates from nursery. Any stable rule that fights an intentional pattern is disabled explicitly with an inline comment, not blanket-suppressed.
- **Import organizing:** Biome's import sorter (`organizeImports`) enabled — deterministic import order, good for agentic diffs.
- **Ignore:** `reference/` (vendored C#/third-party), `dist/`, `node_modules/`, `test/corpus/`, `.oracle-cache/`.

**Scripts added to `package.json`:**

- `format` → `biome format --write .`
- `lint` → `biome lint .`
- `check` → `biome check --write .` (format + lint + organize-imports, applying safe fixes)
- (existing `typecheck`, `test`, `test:watch`, `build` unchanged)

**The one-time reformat:** run `biome check --write .` across `src/`, `test/`, `scripts/`, config `*.ts`, and commit the result as a **single dedicated commit** titled to make its purpose obvious (e.g. `style: adopt Biome formatting (one-time reflow, no logic change)`). Its SHA is then recorded in `.git-blame-ignore-revs` (see §5). The commit contains formatting reflow plus any Biome *safe* auto-fixes (e.g. removing an unused import, sorting imports) — **no logic changes**. This is verified by reviewing the diff and confirming `tsc --noEmit` and `npm test` are green both before and after. (If a lint rule would require an unsafe/manual fix, that is deferred out of the reformat commit and handled separately, so the reformat stays mechanical.)

---

## 4. Component 2 — Git hooks (lefthook)

**Dependency:** `lefthook` (dev, pinned-exact, ≥ 7-day min age). Chosen over husky+lint-staged: single cross-platform Go binary (robust on this Windows host without depending on Git Bash shell scripts), one YAML file, parallel execution, and it subsumes lint-staged's staged-file filtering.

**Install:** a `prepare` npm script runs `lefthook install` so hooks are wired on `npm install`.

**`lefthook.yml`:**

- **pre-commit** (fast; must not be painful on every commit):
  - `biome check --write` on **staged** files only (`{staged_files}` glob filtered to `*.{ts,js,json}`), with `stage_fixed: true` so auto-fixed files are re-staged.
  - `tsc --noEmit` (whole-project typecheck; fast enough for pre-commit).
- **No pre-push hook.** The full test suite is *not* gated on push (operator preference). Instead it runs at the **end of every task** — more frequent than pushes, less frequent than commits — as a convention documented in `AGENTS.md` (§6). This keeps commit-time friction low while still running tests far more often than a per-push gate would.

Hooks are advisory-bypassable with `--no-verify` for genuine escape hatches; they are not a security control.

**Rationale:** the corpus tests are non-trivial in wall-clock (a parallel runner was purpose-built for them), so the full suite does not belong on every commit. Tying it to task completion — the natural unit of agent work — runs it at the right cadence without a hook that fires on every `git push`.

---

## 5. Component 3 — `.editorconfig` + blame hygiene

- **`.editorconfig`** at repo root: `charset = utf-8`, `end_of_line = lf`, `indent_style = space`, `indent_size = 2`, `insert_final_newline = true`, `trim_trailing_whitespace = true`. Aligns editors before Biome ever runs, and is the cross-tool source of truth for the whitespace basics Biome also enforces.
- **`.git-blame-ignore-revs`** at repo root containing the reformat commit's SHA (added in a follow-up tiny commit, since the SHA isn't known until the reformat commit exists). README gains a one-line note documenting the opt-in: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

---

## 6. Component 4 — Agent guidance (`AGENTS.md` + `CLAUDE.md`)

The repo is developed largely by agents, so the workflow above must be written
down where an agent will read it. Two files, one source of truth:

- **`AGENTS.md`** (repo root) — the canonical guidance. Kept short and imperative. Contents:
  - **Quality commands:** `npm run check` (format + lint + organize, auto-fixes), `npm run typecheck`, `npm test`, `npm run build`.
  - **End-of-task ritual (required):** before considering any task complete, run `npm run check`, `npm run typecheck`, and `npm test`, and confirm all are green. This is the primary test gate (no CI, no pre-push hook).
  - **Formatting is mechanical:** do not hand-format; Biome owns formatting. Don't fight it or re-introduce the old compact single-line style.
  - **Supply-chain rule:** new deps installed pinned-exact with ≥ 7-day min release age.
  - **Where design lives:** `docs/superpowers/specs` (designs) and `docs/superpowers/plans` (implementation plans) — read/extend these, spec-then-plan discipline.
  - **Reference material:** `reference/` is vendored third-party C# (xivModdingFramework / TexTools) for porting reference — never edit or lint it.
- **`CLAUDE.md`** (repo root) — a thin pointer that imports the shared file via Claude Code's import syntax: a single line `@AGENTS.md` (plus a one-line note that `AGENTS.md` is the source of truth). This keeps Claude Code and other AGENTS.md-aware tools reading the same content with no duplication.

Both files are outside `src/` and are ignored by Biome's linter (Markdown), though Biome *can* format Markdown if desired — left as an implementation detail, defaulting to not formatting docs to avoid churn.

---

## 7. Components and interfaces summary

**New files:**
- `biome.json` — formatter + linter + import-organizer config.
- `lefthook.yml` — pre-commit hook definitions.
- `.editorconfig` — editor whitespace baseline.
- `.git-blame-ignore-revs` — SHA of the reformat commit.
- `AGENTS.md` — canonical agent workflow guidance (§6).
- `CLAUDE.md` — thin `@AGENTS.md` import pointer (§6).

**Modified files:**
- `package.json` — add `@biomejs/biome`, `lefthook` devDeps; add `format`/`lint`/`check`/`prepare` scripts.
- `README.md` — short "Development" section: the `check` workflow, hooks, the end-of-task ritual, and the `blame.ignoreRevsFile` opt-in (links to `AGENTS.md`).
- All of `src/`, `test/`, `scripts/`, config `*.ts` — one-time formatting reflow (isolated commit).

**Unchanged:** `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` behavior; the test runner; all runtime logic.

---

## 8. Sequencing (for the plan)

The ordering matters so the reformat lands cleanly and blame stays intact:

1. Add `@biomejs/biome` + `biome.json` (no reformat yet); iterate config until `biome lint` output is sane and only expected rules fire.
2. Isolated commit A: `biome check --write .` — the one-time reflow. Verify `tsc`/`test` green, diff is format + safe-fix only.
3. Isolated commit B: add `.git-blame-ignore-revs` with commit A's SHA + README note.
4. Add `lefthook` + `lefthook.yml` + `prepare` script + `.editorconfig`; verify the pre-commit hook fires (a deliberately-misformatted staged file is blocked).
5. Add `AGENTS.md` + `CLAUDE.md` (`@AGENTS.md`); confirm the end-of-task ritual and commands documented there match the actual `package.json` scripts.

---

## 9. Non-goals / YAGNI

- No GitHub Actions / CI (deferred by operator).
- No ESLint, Prettier, or oxlint — Biome only.
- No formatter tuning to preserve the compact style (standardization chosen over reflow-minimization).
- No commit-message linting (commitlint) or changelog automation — not requested.
- No type-aware / nursery lint rules (`noFloatingPromises` et al.) — deferred until stable to keep lint fast and non-experimental (§3).
- No pre-commit and no pre-push test execution — tests run at end-of-task (§4, §6) to keep both commits and pushes low-friction.
