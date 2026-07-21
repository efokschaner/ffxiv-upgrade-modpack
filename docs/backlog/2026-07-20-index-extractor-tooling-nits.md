# Index-path resolver — deferred follow-ups (tooling nits + one test-coverage item)

Filed: 2026-07-20 · Status: open · Low priority (all deferred from the final whole-branch review of
`feat/faithful-index-path-resolution`; none block correctness). Traces to
`docs/superpowers/specs/2026-07-20-index-path-resolution-design.md`.

Three small items surfaced by review, deliberately not fixed in the shipping change:

1. **`scripts/lib/game-index.ts` extraction-tooling nits** (never-shipped code, functionally correct on
   current game data):
   - `entryBodyLength` returns the **total** on-disk entry length (header included), despite a name that
     reads as "body only". The caller uses it correctly as the total; rename to `entryTotalLength` to
     prevent a future double-add.
   - `(raw & ~0xf) * 8` (`:83`) uses 32-bit bitwise math with no guard; correct while a `.dat` stays below
     ~2^31 raw offset (today's `dat0` ≈ 12 GiB). Add an assertion if dats ever grow further.
   - `read()` peeks the first 4 bytes for `headerLength`, then re-reads them inside the full header slice —
     one redundant tiny positioned read.

2. **`RACES` grid is a third copy.** The 38-entry race grid in `scripts/extract-index-table.ts` duplicates
   the identical arrays in `scripts/extract-hair-texture-index.ts:16-55` and `extract-hair-materials.ts`.
   Hoist to `scripts/lib` the next time one of them is touched.

3. **Gate-B *suppression* direction is untested by a golden.** `material.ts:143`'s
   `stolen !== undefined && !idTexExists(idPath)` is exercised for gate B *holding* (the synthetic
   `index-fallback.pmp` golden) and `idTexExists` is unit-tested both ways in isolation, but no test
   exercises the combined *suppression* path (a convention `_id.tex` that exists in-game, so the steal is
   skipped). Low risk — and behaviourally hard to observe, since when the convention path exists it is
   usually the canonical path the steal would have produced anyway, so the output is identical either way,
   which is why no golden pins it. Close with a targeted unit test on `resolveStolenIndexPath` +
   `idTexExists` composition if the coverage gap is ever worth it.
