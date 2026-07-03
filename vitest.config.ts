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
  },
});
