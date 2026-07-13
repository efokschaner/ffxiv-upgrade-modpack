# Make the ConsoleTools oracle async, so the cross-process lock can heartbeat

Filed: 2026-07-13 · Status: open (operator's call: keep the hand-rolled lock for now)

`withConsoleToolsLock` (`test/helpers/oracle.ts`) is a hand-rolled filesystem mutex: atomic `O_EXCL`
create, a random ownership token, and break-on-staleness after `LOCK_STALE_MS`. It has a documented
residual race — breaking a "stale" lock is a *guess* that the holder died, so a live holder that
overruns `staleMs` can have its lock taken, and its own release then races a successor's. Worst case
is two concurrent ConsoleTools, which fails loudly (exit -1) and a re-run clears; the cache is
content-addressed, so nothing wrong is persisted.

**The proper fix is a heartbeat**, as `proper-lockfile` does it: rewrite the lock's mtime every
`stale/2` ms so a live-but-slow holder is *never* judged stale (`onCompromised` when that fails). We
cannot use it — or any heartbeat — today: the critical section is `execFileSync`, which blocks the
event loop for the whole multi-minute ConsoleTools run, so no timer fires, and `proper-lockfile`
with `stale` cranked to ~20min degrades to exactly what we already have.

So: convert the oracle to async (`run`, `unwrapCached`, `upgradeGoldenCached`, `resaveGoldenCached`
and their sync corpus call sites — Vitest supports async `it`), then adopt `proper-lockfile`
(`lockSync`→`lock`, `mkdir` acquire, live heartbeat) and delete the hand-rolled lock.

Operator's call, 2026-07-13: keep the hand-rolled lock for now, do this properly later — it is the
better long-term shape. See the `withConsoleToolsLock` doc comment for the full reasoning.
