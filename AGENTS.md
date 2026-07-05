# Contributing & agent guide

Canonical workflow for humans and coding agents in this repo. Keep it short;
if a rule changes, change it here.

## Commands

- `npm run check` — format + lint + organize imports (Biome, applies safe fixes).
- `npm run lint` — lint only, no writes.
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — full suite via the custom parallel runner.
- `npm run test:coverage` — coverage report (v8) over the full suite incl.
  corpus; opt-in, **not** part of the required test gate. Writes `coverage/`.
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

**Coverage:** `npm run test:coverage` runs the same full suite (including the
corpus) under the v8 provider and writes a text + HTML + json-summary report to
`coverage/`. It is opt-in (the flag is off by default, so the normal gate pays
no overhead) and report-only — no thresholds. Use it to check that tests and the
corpus exercise the code, not as a pass/fail gate.

## Upgrade golden harness

`npm test` includes an end-to-end `upgrade` check per corpus pack: it runs our
`upgradeModpack` pipeline and diffs the result against a cached ConsoleTools
`/upgrade` golden (per `gamePath`, on decompressed content).

- **Goldens are cached** content-addressed under `test/corpus/.upgrade-cache/`
  (gitignored). First run spawns ConsoleTools per pack; later runs read the cache.
  A no-op upgrade caches a `<key>.noop` marker (ConsoleTools writes no file when
  nothing changes) and the pack is then compared against its own input.
- **Ratchet baseline** lives in `test/corpus/.upgrade-baseline/` (gitignored — it
  describes packs that only exist locally). A pack passes while its actual diff is
  a subset of its baseline; a regression (or a new pack that does not fully match)
  fails. Record/refresh baselines with the bless step:

      $env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE

  A newly added corpus mod has no baseline and is expected to fully match; if it
  does not, either it is a real bug, or the difference is an intended divergence.
- **Intended divergences from TexTools** are never ignored: add a rule to
  `DIVERGENCE_RULES` (`test/helpers/upgrade-compare.ts`) that *confirms* the
  divergence is exactly the one we meant (e.g. same tex shape, pixels within our
  documented encoder precision), with a cited reason. Files matched by no rule
  must be byte-identical to the golden.

## Conventions

- **Formatting is mechanical.** Biome owns it. Do not hand-format and do not
  re-introduce the old compact single-line style — run `npm run check`.
- **No per-file license headers.** Licensing lives in the top-level `LICENSE`
  (GPL-3.0) and `NOTICE` (third-party attributions). Do not add SPDX or
  copyright headers to individual source files. A file that ports third-party
  code may cite its upstream origin in a brief comment, but the license notice
  itself belongs in `NOTICE`.
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
