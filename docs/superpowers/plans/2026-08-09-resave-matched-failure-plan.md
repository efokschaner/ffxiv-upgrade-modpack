# Plan — `/resave` matched-failure capability

Spec: [`../specs/2026-08-09-resave-matched-failure-design.md`](../specs/2026-08-09-resave-matched-failure-design.md)

Transient execution checklist. Delete before opening the PR (AGENTS.md, *Specs are durable; plans are
transient*).

## 1. `test/helpers/resave-compare.ts` (new)

- [ ] `ResaveMatchedFailureRule` interface: `reason`, `csharp`, `port`, `matchesOracle(trace)`,
      `ourRefusal`.
- [ ] `RESAVE_MATCHED_FAILURE_RULES` with the one entry — the `Combining` write refusal
      (`WizardData.cs · WizardGroupEntry.ToPmpGroup · 897-900`, ported at
      `src/container/pmp.ts · writePmp` group-assembly loop). `matchesOracle` requires BOTH the
      message text and the `WizardGroupEntry.<ToPmpGroup>` frame.
- [ ] `matchResaveFailure(trace)` — rule lookup for `corpus-resave.ts`.
- [ ] `declaredPortedRefusal(message)` — `ourRefusal` lookup for `corpus-golden.ts`.
- [ ] Header comment: what this registry is, why it is NOT a blanket "oracle errored ⇒ we may error",
      and the environmental/semantic split with Milktruck named.

## 2. `test/helpers/corpus-resave.ts`

- [ ] Move `loadModpack` + `writeModpack` AFTER `resaveGoldenCached`, into a closure.
- [ ] Export `assertMatchedResaveFailure(name, oracleMessage, rule, runResave)`, mirroring
      `assertMatchedUpgradeFailure`: exact-match `ourRefusal`, containment in the trace, loud fail on
      success or mismatch.
- [ ] Wire the `kind === "error"` branch: rule match → assert + return; no match → today's
      `console.error` + `ctx.skip`, textually unchanged.

## 3. `test/helpers/corpus-golden.ts`

- [ ] Wrap the `writeModpack` call; on throw, consult `declaredPortedRefusal`. Declared → log + pass.
      Otherwise re-throw.

## 4. Tests — `test/helpers/resave-compare.test.ts` (new)

- [ ] Combining trace (verbatim, from the cached marker) matches exactly one rule.
- [ ] **Milktruck CMP trace matches NO rule** — the negative guard §5 exists for.
- [ ] `declaredPortedRefusal` hits on the exact message, misses on anything else.
- [ ] `assertMatchedResaveFailure`: passes on matched refusal; fails on success; fails on a different
      thrown message; fails when the trace does not contain our refusal.

## 5. Corpus + docs

- [ ] `Copy-Item "C:\Users\user\Downloads\Parent Settings.pmp" test/corpus/real/` (copy, not move).
- [ ] Widen `real/`'s wording in `test/helpers/corpus-roots.ts` and AGENTS.md's glossary.
- [ ] Update `docs/backlog/2026-07-19-resave-oracle-error-skips-all-assertions.md` (branch split, new
      line numbers, still open, bonus deliberately not implemented).
- [ ] Update `docs/backlog/2026-08-09-real-v4-corpus-coverage.md` (its "not a `real/` candidate"
      verdict on this pack is superseded).
- [ ] Update `docs/BACKLOG.md`'s harness entry for the 2026-07-19 item.

## 6. Gates

- [ ] `npm run check`
- [ ] `npm run typecheck`
- [ ] `npm test` — expect the `upgrade` unit to spawn ConsoleTools once (no cached marker for this
      pack's `/upgrade`); the `/resave` marker is already cached.
- [ ] Remove `scratch-probe.ts`.
