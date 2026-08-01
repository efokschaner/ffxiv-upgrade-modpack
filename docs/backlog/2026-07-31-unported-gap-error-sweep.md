# Sweep the rest of `src/` for catches that can absorb an `UnportedGapError`

Filed: 2026-07-31 · Status: open · Surfaced by the `feat/complete-file-exists-oracle` review's fix
round 2 (Task 3 review finding + coordinator audit)

`src/util/errors.ts`'s `UnportedGapError` distinguishes a gap in what THIS PORT reproduces from a
failure the C# oracle can itself produce. This branch introduced it and retagged exactly two throw
sites plus the one catch that sits above both: `src/upgrade/reference/file-exists.ts`'s
out-of-chara-category throw and `src/mtrl/serialize.ts:44`'s empty-sampler placeholder gap, both
reached through `src/upgrade/upgrade.ts`'s `materialRound` catch (`upgrade.ts:186`, mirroring
`EndwalkerUpgrade.cs:522-539`'s per-material NRE swallow). That catch now re-throws
`UnportedGapError` and swallows everything else.

That was a narrow, targeted fix — not a sweep. A coordinator audit enumerated every `catch` in
`src/` and every fail-loud "not yet ported" throw and crossed them; the results below are recorded
verbatim so a future sweep does not have to re-derive them.

## Being fixed in this round (for cross-reference)

- `src/upgrade/upgrade.ts:186` (`materialRound`) — absorbs `file-exists.ts`'s out-of-chara throw and
  `mtrl/serialize.ts:45`'s empty-sampler placeholder gap.

## Confirmed still-open instances

- **`src/upgrade/load-fixes.ts:121`** — `catch { return null }` on the TTMP load-time **mdl** fix.
  Absorbs `src/upgrade/model.ts`'s `normalizeModel` "structures not yet ported" throw and
  `src/mdl/model/serialize.ts:103`'s Shadow+Fog out-of-scope throw, dropping the model silently.
  This is already a known, documented symptom: `docs/BACKLOG.md`'s 2026-07-21b dated note records
  that the furniture `.mdl` overrun "no longer aborts the whole pack — the load-fix
  `catch { return null }` now swallows it, so the user gets a pack silently missing models."
  Cross-reference that note when this is picked up.
- **`src/upgrade/unclaimed-hair.ts:198`** — the bare catch-all reproducing `docs/TEXTOOLS_BUGS.md`
  #12. Absorbs `src/tex/encode.ts:27`'s "NPOT resize not yet ported" throw. Note the history:
  `docs/BACKLOG.md` prioritized item 2 (the diagnostics-channel item) records that this catch "used
  to swallow the modeled `TextureResizeUnsupported` gap too; that type no longer exists as of
  2026-07-22." So this repo previously HAD a typed port-gap error at exactly this seam and lost it —
  the strongest argument that `UnportedGapError` should be the permanent shape here rather than a
  one-off introduced for the file-exists/serialize pair.
- **`src/upgrade/load-fixes.ts:109`** — `catch { return null }` on the TTMP load-time **tex** fix.
  Lower confidence than the two above: its own comment says it deliberately drops on "a resize guard
  TexTools also aborts on", so some of what it swallows is a faithful match rather than a port gap.
  Needs case-by-case adjudication when picked up — do not assume it is a defect wholesale.

## Assessed and NOT instances (so a future sweep does not re-tread them)

- `src/upgrade/upgrade.ts:98` (`resolveFile`'s catch around `decodeSqPackFile`)
- `src/upgrade/resolve-highlight.ts:51` and `:60`
- `src/mdl/model/from-raw.ts:48`

Each of these mirrors a specific C# try/catch, and the throws that reach them are C#-reachable
failures (malformed input, the deliberately-mirrored null-sampler NRE) — not port gaps.

## Fail-loud guards not currently under any catch

These should still be retagged onto `UnportedGapError` by the eventual sweep, purely so that adding
a catch above them later cannot silently re-open a gap without anyone noticing:

- `src/meta/deserialize.ts:38` (v1 metadata)
- `src/meta/reconstruct.ts:39` (EQDP non-playable races)
- `src/container/pmp.ts:597` (`.meta`/`.rgsp` → `Manipulations`)
- `src/container/pmp-manipulation.ts:74,94` (manipulation field defaults)

## What a full sweep would involve

1. Case-by-case adjudication of `load-fixes.ts:109` — separate the genuinely-faithful drops from the
   ones that are actually swallowing an unported gap, and retag only the latter.
2. Retagging `load-fixes.ts:121` and `unclaimed-hair.ts:198`'s underlying throws
   (`model.ts`'s `normalizeModel`, `mdl/model/serialize.ts:103`, `tex/encode.ts:27`) onto
   `UnportedGapError`, then deciding whether their enclosing catches re-throw it (which changes their
   failure mode from "silently drop this file/material" to "abort the whole upgrade") or whether that
   decision waits on the diagnostics-channel item (`docs/BACKLOG.md` prioritized item 2) so a
   re-thrown gap can surface to the user without failing the entire upgrade outright.
3. Retagging the four not-currently-caught guards listed above, as pure future-proofing.
4. Re-running the full corpus after each retag — a caught throw changing from "swallowed" to
   "propagates" can change which packs pass/fail today's ratchet baselines, and any such change needs
   the same scrutiny as this branch's Task 3 gate-B fix (report the pack, not bless it).
