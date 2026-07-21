# Audit temp-dir usage for leaks (`mkdtemp` cleanup)

Filed: 2026-07-10 · Status: open · Housekeeping; no correctness impact

Several helpers create OS temp working directories via `mkdtempSync(join(tmpdir(), …))` but never
remove the *directory* (only inner files), so they accumulate across runs.

**Worst offenders — these run on every `npm test`:**

- `ORACLE_TMP` in `test/helpers/oracle.ts` (`oracle-*`, a per-worker module singleton, never rm'd);
- `test/helpers/upgrade-golden.ts` (`upgrade-*`, `UPGRADE_TMP`, never rm'd).

These left the stale `oracle-*` / `upgrade-*` dirs found on 2026-07-10.

**Occasional offenders:** `scripts/probes/probe-idpath-rule.ts` (`idprobe-*`) and
`scripts/extract-shader-params.ts` (`shparam-*`) (manual runs), and the test files
`test/oracle-cache.test.ts` (`oc-*`) / `test/upgrade-harness.test.ts` (`ug-*` / `ub-*`).

**Good examples to follow:** `test/sqpack/fixtures/regen.ts` and `test/tex/fixtures/bcn/regen.ts`
both `rmSync(tmp, { recursive: true, force: true })` when done.

**Fix:** give each `mkdtemp` site a guaranteed cleanup (try/finally, `afterAll`, or a
`process.on("exit")` unlink for the singleton harness dirs), and consider a lint/grep guard so new
`mkdtemp` calls without a paired removal are caught. Note `sweepStaleTemps` in
`test/helpers/oracle.ts` already sweeps stale `.tmp` files in its *cache* dir — extend that
discipline to the mkdtemp working dirs.
