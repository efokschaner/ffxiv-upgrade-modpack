/**
 * Signals that OUR PORT has not (yet) reproduced some C# behaviour or data — a gap in the port
 * itself, as distinct from a failure the C# oracle can also produce (a malformed input, a
 * deliberately-mirrored NRE, ...). Two current sources: `src/upgrade/reference/file-exists.ts`'s
 * "category not bundled" gate, and `src/mtrl/serialize.ts`'s empty-sampler placeholder gap
 * (docs/backlog/2026-07-08-mtrl-empty-sampler-placeholders.md).
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
