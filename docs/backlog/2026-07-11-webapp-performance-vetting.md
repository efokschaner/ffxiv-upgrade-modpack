# Vet page-load and upgrade-operation performance once a working webpage exists

Filed: 2026-07-11 · Status: open · Housekeeping / perf; no correctness impact

The library is consumed client-side, but there is no real page to profile yet. When one lands,
measure the two things that matter to a user:

1. **initial page load** — JS parse/eval and time-to-interactive, and
2. the **upgrade operation itself** — wall-clock and peak memory of running `upgradeModpack` over
   representative packs.

Profile the real app on real hardware (include a low-end/mobile-class device), find where the time
and bytes actually go, and only then decide whether anything is worth optimizing. Keep the
investigation unbiased — do not presume a culprit.

One incidental data point already gathered (2026-07-11): the current lib build is `dist/index.js`
1,568 KB raw / 111 KB gzip, of which the two generated base-game reference tables
(`src/meta/reference/imc-table.ts`, `est-table.ts`) are ~90% of the raw bytes but only ~62% of the
gzip (they're highly repetitive, so gzip/brotli crush them). That suggests wire size is already
small and any real cost is more likely eager parse/eval or the upgrade compute path — but treat that
as a hypothesis to test, not a conclusion, and let the profiler point at whatever is actually hot.
