# Developer Tooling (Biome, lefthook, AGENTS.md) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add autoformatting + linting (Biome), a pre-commit git hook (lefthook), an `.editorconfig`, and agent-facing workflow docs (`AGENTS.md` + `CLAUDE.md`) to a TypeScript codec library that currently has none of these.

**Architecture:** One all-in-one tool (Biome) owns both formatting and linting via a single `biome.json`. A one-time reformat lands as an isolated commit whose SHA is recorded in `.git-blame-ignore-revs` so `git blame` stays meaningful. lefthook wires a fast pre-commit hook (Biome + `tsc`); the full test suite is run at end-of-task by convention (documented in `AGENTS.md`), not on push. No CI in this work.

**Tech Stack:** TypeScript 5.4 (ESM, `strict` + `noUncheckedIndexedAccess`), Vite 6, Vitest 4, `@biomejs/biome` (v2), `lefthook`. Node ≥ 20.19.

**Design spec:** `docs/superpowers/specs/2026-07-02-dev-tooling-design.md`

## Global Constraints

Every task's requirements implicitly include these:

- **Commands run in PowerShell on Windows.** `npm`/`npx`/`git` are cross-shell; keep commit messages single-line (`-m "..."`) to avoid shell-quoting issues.
- **Supply-chain policy (operator hard rule):** install new deps with a **≥ 7-day min release age**. Use npm's as-of-date resolution: `--before=2026-06-25` (7 days before today, 2026-07-02). `.npmrc` has `save-exact=true`, so versions pin exactly automatically.
- **Do not touch `reference/`** — vendored third-party C# (gitignored), reference-only.
- **No runtime logic changes in `src/`.** The only `src/` changes allowed are Biome formatting + Biome *safe* auto-fixes (e.g. import sorting, removing an unused import). If a lint finding needs a manual/unsafe fix, resolve it as its own consideration — never alter parsing/encoding behavior.
- **Formatting settings (final):** `indentStyle: space`, `indentWidth: 2`, `lineWidth: 80`, `quoteStyle: double`, `semicolons: always`, `trailingCommas: all`.
- **Node floor stays** `>=20.19` (`package.json` `engines` unchanged).

---

### Task 1: Install and configure Biome (no reformat yet)

**Files:**
- Create: `biome.jsonc`
- Modify: `package.json` (add devDependency + `format`/`lint`/`check` scripts)

> **Implementation note (reconciled with shipped code):** the config file is `biome.jsonc`, not `biome.json` — Biome 2.5.1 rejects `//` comments in a file named `.json`, and we keep the inline rationale. Also, `linter.rules.recommended: true` is deprecated in 2.5.1 in favor of `preset: "recommended"` (used below), and the oracle-cache ignore uses the folder form `!**/.oracle-cache` (Biome ≥2.2 `useBiomeIgnoreFolder`). Other prose in this plan that says "biome.json" means this config file.

**Interfaces:**
- Produces: a working `biome.json` and `npm run check`/`lint`/`format` scripts that Task 2 (reformat) and Task 4 (hook) both invoke. The linter has `style.noNonNullAssertion` **off** (the codebase uses `arr[i]!` idiomatically with `noUncheckedIndexedAccess`).

- [ ] **Step 1: Install Biome pinned + min-age**

Run:
```
npm install -D @biomejs/biome --before=2026-06-25
```
Expected: `@biomejs/biome` added to `devDependencies` in `package.json` pinned to an exact version (no `^`), and present in `package-lock.json`.

- [ ] **Step 2: Record the installed version**

Run:
```
npx biome --version
```
Expected: prints a `2.x.y` version (e.g. `Version: 2.2.0`). Note this exact `X.Y.Z` — you will put it in `biome.json`'s `$schema` URL in Step 3.

- [ ] **Step 3: Create `biome.jsonc`**

Create `biome.jsonc` with exactly this content, replacing `X.Y.Z` in the `$schema` URL with the version from Step 2 (shipped: `2.5.1`):

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/X.Y.Z/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    // .gitignore already excludes reference/, node_modules/, dist/, test/corpus/.
    // Also skip the generated test oracle cache.
    "includes": ["**", "!**/.oracle-cache"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 80
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "recommended",
      "style": {
        // The codebase uses non-null assertions idiomatically alongside
        // tsconfig's noUncheckedIndexedAccess (e.g. `textures[i]!.path`).
        // Leaving this recommended rule on would flag hundreds of
        // intentional sites, so it is turned off deliberately.
        "noNonNullAssertion": "off"
      }
    }
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
```

- [ ] **Step 4: Add scripts to `package.json`**

In the `scripts` block of `package.json`, add these three entries (keep existing `build`/`test`/`test:watch`/`typecheck`):

```json
    "format": "biome format --write .",
    "lint": "biome lint .",
    "check": "biome check --write .",
```

- [ ] **Step 5: Verify the config loads and Biome sees the repo**

Run:
```
npx biome check .
```
Expected: Biome runs without a **configuration error** (if `$schema`/keys were wrong it would say so). It will report that many files "would be reformatted" and possibly some lint diagnostics, and **exit non-zero** — that is correct at this point (we have not reformatted yet). If instead you see `Configuration error` / `unknown key`, fix `biome.json` before continuing.

- [ ] **Step 6: Sanity-check the linter is not drowning in `noNonNullAssertion`**

Run:
```
npx biome lint .
```
Expected: **zero** `lint/style/noNonNullAssertion` diagnostics (proves the disable took effect). Other lint findings may appear; you will address them in Task 2. If you *do* see `noNonNullAssertion`, the rule path in `biome.json` is wrong — fix it.

- [ ] **Step 7: Commit (config only — no reformat)**

```
git add biome.jsonc package.json package-lock.json
git commit -m "build: add Biome (formatter + linter) config and scripts"
```

---

### Task 2: One-time reformat (isolated commit)

**Files:**
- Modify: all of `src/`, `test/`, `scripts/`, and root config `*.ts` (`vite.config.ts`, `vitest.config.ts`) — formatting + safe fixes only.

**Interfaces:**
- Consumes: `biome.json` and the `check` script from Task 1.
- Produces: a single reformat commit. Its full SHA is consumed by Task 3.

- [ ] **Step 1: Apply formatting + safe fixes across the repo**

Run:
```
npm run check
```
Expected: Biome rewrites files to the new format and applies safe fixes (import organizing, etc.). It prints a summary of fixed files. It may still report a few **unsafe** lint diagnostics it did not auto-apply.

- [ ] **Step 2: Resolve any residual lint findings**

Run:
```
npx biome lint .
```
Expected outcome: **no errors.**
- If a finding is a genuine, localized issue (e.g. a truly unused variable), fix it minimally without changing runtime behavior.
- If a finding reflects an intentional, pervasive pattern in this codebase (like `noNonNullAssertion` was), do **not** rewrite the code: turn that rule `"off"` in `biome.json`'s `linter.rules` with a short comment explaining why, re-run `npm run check`, and note it. Behavior in `src/` must not change.

- [ ] **Step 3: Verify types still pass**

Run:
```
npm run typecheck
```
Expected: PASS, no errors (formatting/import-sorting must not have broken types).

- [ ] **Step 4: Verify the full test suite still passes**

Run:
```
npm test
```
Expected: PASS — the same green suite as before the reformat. This is the proof the reformat is behavior-preserving.

- [ ] **Step 5: Review the diff is format/safe-fix only**

Run:
```
git diff --stat
```
Expected: whitespace/reflow across many files (plus any import reordering). Spot-check a couple of `src/` files with `git diff src/mtrl/parse.ts` to confirm no logic changed — only layout.

- [ ] **Step 6: Commit the reformat as one isolated commit**

```
git add -A
git commit -m "style: adopt Biome formatting (one-time reflow, no logic change)"
```

---

### Task 3: Blame hygiene (`.git-blame-ignore-revs`)

**Files:**
- Create: `.git-blame-ignore-revs`

**Interfaces:**
- Consumes: the reformat commit SHA from Task 2.

- [ ] **Step 1: Get the reformat commit's full SHA**

Run:
```
git log --grep="adopt Biome formatting" --format=%H -n 1
```
Expected: prints one 40-character SHA (the Task 2 commit). Copy it.

- [ ] **Step 2: Create `.git-blame-ignore-revs`**

Create `.git-blame-ignore-revs` with this content, replacing `<SHA>` with the SHA from Step 1:

```
# Reformat: one-time adoption of Biome formatting (no logic change).
# See docs/superpowers/specs/2026-07-02-dev-tooling-design.md
<SHA>
```

- [ ] **Step 3: Verify blame ignores the reformat**

Run (pick any reformatted source file):
```
git blame --ignore-revs-file .git-blame-ignore-revs -L 1,5 src/mtrl/parse.ts
```
Expected: the blamed commits for those lines are the *original* authoring commits, **not** the reformat commit.

- [ ] **Step 4: Commit**

```
git add .git-blame-ignore-revs
git commit -m "build: ignore the Biome reformat commit in git blame"
```

---

### Task 4: Git hooks (lefthook) + `.editorconfig`

**Files:**
- Create: `lefthook.yml`
- Create: `.editorconfig`
- Modify: `package.json` (add `lefthook` devDependency + `prepare` script)

**Interfaces:**
- Consumes: the `biome` binary and `biome.jsonc` from Task 1; `tsc` (already present).
- Produces: an active pre-commit hook that formats+lints staged files and runs `tsc --noEmit`.

> **Implementation note (reconciled with shipped code, commit 5530368; lefthook v2.1.9):** the Steps 6–7 verification below was corrected during execution and this is how it was actually done: (1) the throwaway **type-error** file must live under a tsconfig-`include`d dir (`test/`), NOT repo root — a root file is outside `include: ["src","test","scripts"]` so `tsc --noEmit` wouldn't see it and the "hook blocks" test would falsely pass; (2) verification used `npx lefthook run pre-commit` (no scratch commits polluting history) for the auto-format and block checks, with the real end-to-end `git commit` of the config (Step 8) serving as the genuine installed-hook test. The Steps 6–7 text below (root-path scratch files + scratch commits) is superseded by this note.

- [ ] **Step 1: Install lefthook pinned + min-age**

Run:
```
npm install -D lefthook --before=2026-06-25
```
Expected: `lefthook` added to `devDependencies` pinned exact.

- [ ] **Step 2: Add a `prepare` script so hooks install on `npm install`**

In `package.json` `scripts`, add:

```json
    "prepare": "lefthook install",
```

- [ ] **Step 3: Create `lefthook.yml`**

Create `lefthook.yml` with exactly:

```yaml
# Fast local gate. The full test suite is NOT run here — it runs at
# end-of-task (see AGENTS.md). Bypass in emergencies with `git commit --no-verify`.
pre-commit:
  parallel: true
  commands:
    format-lint:
      glob: "*.{ts,js,mjs,cjs,json,jsonc}"
      run: npx biome check --write --no-errors-on-unmatched {staged_files}
      stage_fixed: true
    typecheck:
      run: npx tsc --noEmit
```

- [ ] **Step 4: Create `.editorconfig`**

Create `.editorconfig` with exactly:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

- [ ] **Step 5: Install the git hooks**

Run:
```
npx lefthook install
```
Expected: `lefthook` reports it synced hooks; `.git/hooks/pre-commit` now exists and references lefthook.

- [ ] **Step 6: Verify the hook AUTO-FORMATS a staged file (fail→fixed)**

Create a deliberately misformatted throwaway file and stage it:
```
Set-Content -Path scratch-hooktest.ts -Value "export const   x=1"
git add scratch-hooktest.ts
```
Commit it:
```
git commit -m "test: hook autoformat check"
```
Expected: the commit succeeds and the committed file is reformatted to `export const x = 1;` (Biome ran via the hook and `stage_fixed` re-staged it). Verify:
```
git show HEAD:scratch-hooktest.ts
```
Expected output: `export const x = 1;`

Then remove the throwaway file:
```
git rm scratch-hooktest.ts
git commit -m "test: remove hook autoformat check"
```

- [ ] **Step 7: Verify the hook BLOCKS a type error (the real gate)**

Introduce a type error in a throwaway staged file:
```
Set-Content -Path scratch-typetest.ts -Value "export const n: number = ""str"";"
git add scratch-typetest.ts
git commit -m "test: hook should block this"
```
Expected: the commit is **rejected** — `tsc --noEmit` fails inside the hook and lefthook aborts the commit with a non-zero status. Clean up:
```
git restore --staged scratch-typetest.ts
Remove-Item scratch-typetest.ts
```

- [ ] **Step 8: Commit the hook config**

```
git add lefthook.yml .editorconfig package.json package-lock.json
git commit -m "build: add lefthook pre-commit (Biome + typecheck) and .editorconfig"
```
Note: this commit itself triggers the just-installed pre-commit hook — it should pass (these files are already formatted and types are clean).

---

### Task 5: Agent guidance (`AGENTS.md` + `CLAUDE.md`) + README

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Modify: `README.md` (add a "Development" section)

**Interfaces:**
- Consumes: the script names from Task 1 (`check`/`lint`/`typecheck`/`test`/`build`) and the workflow decisions (pre-commit hook, end-of-task test ritual).

- [ ] **Step 1: Create `AGENTS.md`**

Create `AGENTS.md` with exactly:

```markdown
# Contributing & agent guide

Canonical workflow for humans and coding agents in this repo. Keep it short;
if a rule changes, change it here.

## Commands

- `npm run check` — format + lint + organize imports (Biome, applies safe fixes).
- `npm run lint` — lint only, no writes.
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — full suite via the custom parallel runner.
- `npm run build` — production build (Vite).

## End-of-task ritual (required)

Before considering ANY task complete, run and confirm all green:

1. `npm run check`
2. `npm run typecheck`
3. `npm test`

This is the primary test gate — there is no CI and no pre-push hook. Tests run
at end-of-task (more often than pushes, less often than commits). A pre-commit
hook (lefthook) already runs Biome + typecheck on every commit; it does NOT run
the tests.

## Conventions

- **Formatting is mechanical.** Biome owns it. Do not hand-format and do not
  re-introduce the old compact single-line style — run `npm run check`.
- **Supply chain.** Install new deps pinned-exact (`.npmrc save-exact`) with a
  ≥ 7-day min release age (e.g. `npm install -D <pkg> --before=<date 7+ days ago>`).
- **`reference/` is off-limits.** It is vendored third-party C#
  (xivModdingFramework / TexTools) kept for porting reference. Never edit, lint,
  or format it (it is gitignored).
- **Design lives in `docs/superpowers/`.** Specs in `specs/`, implementation
  plans in `plans/`. Follow spec-then-plan discipline for non-trivial work.

## Blame hygiene

A one-time Biome reformat is recorded in `.git-blame-ignore-revs`. Opt in once so
`git blame` skips it:

    git config blame.ignoreRevsFile .git-blame-ignore-revs
```

- [ ] **Step 2: Create `CLAUDE.md`**

Create `CLAUDE.md` with exactly:

```markdown
See @AGENTS.md — the canonical contributor & agent guide for this repo.
Everything there applies to work done via Claude Code.
```

- [ ] **Step 3: Add a "Development" section to `README.md`**

Append this section to `README.md` (after the existing content):

```markdown

## Development

- **Format + lint:** `npm run check` (Biome owns formatting; don't hand-format).
- **Typecheck:** `npm run typecheck`
- **Test:** `npm test`
- **Build:** `npm run build`

A pre-commit hook (lefthook) runs Biome + typecheck on staged files. The full
test suite runs at end-of-task, not on push — see [`AGENTS.md`](./AGENTS.md).

After cloning, opt in to clean blame across the one-time formatting reflow:

    git config blame.ignoreRevsFile .git-blame-ignore-revs
```

- [ ] **Step 4: Verify the Claude import + docs are consistent**

- Confirm `CLAUDE.md` contains the literal token `@AGENTS.md` (Claude Code resolves it as a file import):
  ```
  Select-String -Path CLAUDE.md -Pattern "@AGENTS.md"
  ```
  Expected: one match.
- Confirm the commands named in `AGENTS.md` match `package.json` scripts (`check`, `lint`, `typecheck`, `test`, `build`) — they do if Task 1/Task 4 were followed.

- [ ] **Step 5: Verify these doc files pass the hook**

Stage and commit — the pre-commit hook runs (Markdown is not linted by Biome's default rules; `tsc` passes):
```
git add AGENTS.md CLAUDE.md README.md
git commit -m "docs: add AGENTS.md agent guide, CLAUDE.md pointer, README dev section"
```
Expected: commit succeeds.

---

## Self-Review notes

- **Spec coverage:** Biome format+lint (§3) → Task 1–2; isolated reformat + blame (§3, §5) → Task 2–3; lefthook pre-commit, no pre-push (§4) → Task 4; `.editorconfig` (§5) → Task 4; `AGENTS.md` + `CLAUDE.md` + end-of-task ritual (§1, §6) → Task 5; README dev section (§7) → Task 5; install discipline (§1) → Global Constraints + Task 1/4. CI is out of scope (§9) — no task, correct.
- **Type-aware lint deferred** (§3, §9): `biome.json` intentionally has no `nursery`/`noFloatingPromises` — correct per the locked decision.
- **Ordering guarantee:** reformat (Task 2) precedes lefthook install (Task 4), so the large reflow does not fight the hook; `.git-blame-ignore-revs` (Task 3) needs Task 2's SHA and comes after.
```
