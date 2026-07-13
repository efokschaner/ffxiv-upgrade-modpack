# Serial cache-warm entry point for the corpus

Filed: 2026-07-12 · Status: open · Harness convenience; no correctness impact on the port

A cold corpus (new corpus mods, rebuilt synthetics, a cleared `.upgrade-cache/`) still spawns
ConsoleTools once per uncached entry across Vitest's parallel `forks` pool. `withConsoleToolsLock`
(`test/helpers/oracle.ts`) now serializes those spawns so they succeed instead of failing together,
but a full cold-corpus run still pays for each spawn's wait-in-queue serially.

A dedicated entry point that warms the cache in one pass up front (outside the parallel test run)
would let a newcomer populate a cold corpus faster.
