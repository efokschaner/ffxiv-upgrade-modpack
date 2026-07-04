import { defineConfig } from "vitest/config";

// Worker cap: bounds peak memory when big corpus packs (200–457 MB) load in parallel.
// Override per run with VITEST_MAX_WORKERS. `forks` isolates per-worker memory better than threads.
const MAX_WORKERS = Number(process.env.VITEST_MAX_WORKERS) || 8;

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
