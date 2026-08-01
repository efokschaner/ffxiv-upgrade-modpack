/**
 * Signals that OUR PORT has not (yet) reproduced some C# behaviour or data — a gap in the port
 * itself, as distinct from a failure the C# oracle can also produce (a malformed input, a
 * deliberately-mirrored NRE, ...). A qualifying source is a bundled-table (or bundled-category) miss
 * that the game index itself says should have hit — i.e. the port's own data or logic is
 * incomplete, not the input or the C#'s own behaviour. Sources are not enumerated here because the
 * list grows as more call sites are audited (see `docs/backlog/2026-07-31-unported-gap-error-sweep.md`
 * for the running tally); find the current set with
 * `git grep -n "new UnportedGapError"` or `git grep -n "UnportedGapError"`.
 *
 * Any `catch` written to mirror a SPECIFIC C#-reachable failure (a per-material try/catch mirroring
 * an NRE the C# itself can throw, a decode-failure skip, ...) must re-throw this rather than
 * absorb it: swallowing a port-gap signal into a "leave this file/material untouched" path would
 * silently hide a divergence that has nothing to do with the C# behaviour the catch exists to
 * reproduce. Only failures the C# can itself produce may be swallowed by such a catch.
 *
 * Lives in `src/util/` (not `src/upgrade/` or `src/mtrl/`) because both layers throw it and both
 * already depend on `src/util/` for shared, layer-neutral primitives (see `util/base64.ts`,
 * `util/binary.ts`) — putting it under either layer would make the other import "up" across a
 * boundary this codebase otherwise keeps one-directional (mtrl/tex/mdl are lower-level than
 * upgrade, which orchestrates them).
 */
export class UnportedGapError extends Error {}
