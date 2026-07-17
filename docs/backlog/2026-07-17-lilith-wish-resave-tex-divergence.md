# `[Inako] Lilith Wish.pmp` — `/resave` diverges on ~30 eye/face `.tex` payloads

Filed: 2026-07-17 · Status: **open, UNVERIFIED** (pack scoped out of `/resave`)

`[Inako] Lilith Wish.pmp` was added as the real-mod matched-failure fixture for the `/upgrade`
expected-failure capability (see
`docs/superpowers/specs/2026-07-17-resolve-highlight-preround-design.md`): ConsoleTools `/upgrade`
throws the `InvalidDataException` this branch's highlight pre-round reproduces, and our port throws
the same, so the `upgrade` check passes as a matched failure. That is the only thing this pack is
needed for.

The pack ALSO happens to exercise an **unrelated** pre-existing `/resave` writer gap on its eye/face
`.tex` payloads. This branch never touches tex writing, and the rest of the corpus passes `/resave`,
so the gap predates this change — it is only *visible* now because this pack was added. To avoid
gating the expected-failure test on an unrelated writer bug, the pack lives in the new
`test/corpus/upgrade-error/` root (`test/helpers/corpus-roots.ts`, `isUpgradeErrorPack`), which
`enumerateUnits` (`test/helpers/corpus-units.ts`) scopes to the `upgrade` check ONLY — no `assets`,
`golden`, or `resave` unit runs for it. `/resave` is therefore **UNVERIFIED** for this pack, not
passing and not failing.

## Characterization (2026-07-17, via a temporary `test/_tmp-characterize-lilith-resave.test.ts`,
run once locally then deleted — see the task-7b execution for exact commands)

Loaded the pack, wrote it back with our writer (`writeModpack(ours, "pmp", { store: true })`),
resaved it once via ConsoleTools `/resave` (`resaveGoldenCached`), and diffed our re-read archive
against the golden with `diffUpgrade` (payload multiset per gamePath, decompressed via
`decodeSqPackFile`):

- **52 matched, 72 mismatched** payload entries; **0** added/removed — every mismatch is a same-path
  `status: "mismatch"` (byte-length differs), not a missing/extra file.
- **30 unique gamePaths**, all eye/face textures:
  `chara/common/texture/eye/{eye01_mask,eye01_norm,eye02_base,eye03_base,eyelids_shadow}.tex` and,
  per face (`c0801f0001`..`c0801f0004`, `f0101`..`f0104`),
  `{etc_mask,etc_norm,fac_base,fac_mask,fac_norm}.tex` (not every suffix present on every face id).
- **Every single mismatch is `ours.length === golden.length + 80`** — e.g. `eye01_mask.tex`:
  ours=11096 vs golden=11016; `c0801f0001_fac_base.tex`: ours=2796400 vs golden=2796320. The delta is
  a constant **80 bytes**, identical across textures of wildly different total size (11 KB to 2.8 MB).

This is **not** the known ±1 BC-decode-class tolerance already covered by the `.tex` `DIVERGENCE_RULES`
rule (that rule is same-length, ±1-per-byte; this is a fixed-length excess on our side, same across
every affected file regardless of texture size). A constant 80-byte excess that doesn't scale with
texture size looks structural — most likely something in the `.tex` container header/mip-offset table
that our writer either double-writes or pads, or a mip level (or an intermediate encode buffer) TexTools
elides on write that we don't. Needs bisecting from the front of the payload (`.tex` header is a fixed
small size; diff the header + mip-offset-table bytes specifically, then decide if it is 80 extra header
bytes, one small phantom mip, or padding) — not yet done; only the aggregate length/uniform-delta shape
is confirmed so far.

## What to do

1. Reproduce locally: move the maintainer's local `[Inako] Lilith Wish.pmp` (gitignored, currently in
   `test/corpus/upgrade-error/`) to `test/corpus/real/` and drop it from `isUpgradeErrorPack`'s scoping
   (or just point a scratch script at it) to run it through `registerResaveCheck` directly.
2. Bisect the constant 80-byte delta: dump both `.tex` payloads' headers and mip-offset tables
   (`src/tex/...` — wherever the `.tex` container header is parsed/written) and diff them byte-for-byte
   on the smallest affected file (`eye01_mask.tex`, 11 KB) first.
3. Decide the bucket: a resize gap (T3, `docs/backlog/2026-07-10-imagesharp-resampler.md`), a load-time
   fixup gap (T2, `docs/backlog/2026-07-10-fixoldtexdata-load-round.md` / the PMP-load
   `docs/backlog/2026-07-13-pmp-load-time-tex-fixup.md`), or a genuine writer bug not yet tracked.
4. If it turns out to be one of the already-tracked tex items above, fold this pack in as its repro
   and close this item; otherwise file the writer bug directly.
5. Once fixed, move the pack back to `test/corpus/real/` (or drop the `upgrade-error` scoping) so
   `/resave` (and `assets`/`golden`) start covering it too — it is a real corpus mod, not a synthetic.

Cite: task 7b of `docs/superpowers/specs/2026-07-17-resolve-highlight-preround-design.md`
(the `/upgrade` expected-failure corpus addition).
