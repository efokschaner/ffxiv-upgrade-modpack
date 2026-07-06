# Model Round — Pivot & Sequencing Plan (SUPERSEDES the byte-patch plan)

> This plan previously contained a task-by-task port of the *byte-patch*
> `FastMdlv6Upgrade`. That approach is **superseded** — see the correction in
> `docs/superpowers/specs/2026-07-06-model-round-design.md` §0 and the source map in
> `docs/superpowers/specs/2026-07-06-model-normalizer-research.md`. The model round is
> re-scoped as a two-phase normalizer port; each phase gets its own spec→plan when we
> start it. This doc now records the pivot, the sequencing, and how to use the
> reference branch.

**Goal:** Reproduce, byte-for-byte, ConsoleTools `/upgrade`'s normalized `.mdl`
(full `FixOldModel` re-serialize: LoD0-only collapse + v6 + vertex re-encode with
Half→Float), driving the corpus `.mdl` ratchet 453 → 0.

## Why the pivot (short)

The byte-patch premise was wrong: `/upgrade` normalizes every model at read time via
`FixOldModel` (`GetXivMdl → TTModel.FromRaw → MakeUncompressedMdlFile`), not the
size-preserving `FastMdlv6Upgrade`. Corpus proved it (453 → 452, one match). It is a
genuine vertex-geometry re-encode. Full evidence + decision: spec §0.

## Sequencing — two sub-projects (each: brainstorm → spec → plan → PR)

1. **Sub-project A — MDL geometry codec** (fresh branch off `main`, FIRST).
   Vertex-declaration parse + geometry decode/encode (port `MdlVertexReader` +
   `WriteVertex`; Half↔Float; byte quantizers; block0/block1 streams; per-mesh/part
   offsets). Gate = a corpus geometry decode→encode round-trip byte-exact check. De-risks
   the precision-sensitive core before the rebuild.
2. **Sub-project B — model normalizer** (fresh branch off `main`, after A).
   TTModel-equivalent (LoD0 weld/sort/dedupe) + `MakeUncompressedMdlFile` serializer +
   LoD-collapse + v6 + the TTMP-major-<2 gate + wiring into `upgrade.ts`. Ratchet gate:
   `.mdl` 453 → 0. Folds in the reusable pieces from the reference branch (below).

## Reference branch usage — `feat/upgrade-model-round`

The byte-patch was built on `feat/upgrade-model-round`. **Keep it as a reference; do
NOT merge it** (its `modelRound` emits non-matching, possibly game-invalid models).
Three pieces on it are correct and **fold into sub-project B** (cherry-pick or
re-derive):

| Piece | Commit | Use in B |
|---|---|---|
| `restore()` re-encodes `.mdl` as `SqPackType.Model` (+ `uncompressedBytes → {bytes,type}`) | `cca61fa` | wiring — needed regardless of approach |
| `reformatBoneSetsV5toV6` (v6 bone-set layout) | `b185e1e` | serializer bone-set block (research §2.2) |
| `buildRadiusBoundingBox` (per-bone ±radius/20 cube) | `b185e1e` | serializer bounding-box block (research §2.2) |

Discarded from the branch: the `upgradeModel` byte-patch transform (`4e2a557`) and its
`modelRound` wiring — the normalizer replaces them. Branch commits remain in local git
history as reference only.

## Status

- [x] Root-cause + research complete; approach decided (full byte-parity port).
- [x] Correction + research doc + this pivot plan landed on `main`.
- [ ] Sub-project A (MDL geometry codec) — spec, plan, implement.
- [ ] Sub-project B (model normalizer) — spec, plan, implement; ratchet 453 → 0.
