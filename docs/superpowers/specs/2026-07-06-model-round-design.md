# Model Round — Design (CORRECTED: full model normalizer)

**Date:** 2026-07-06 (corrected 2026-07-06 after the FixOldModel finding)
**Status:** Byte-patch premise SUPERSEDED. Re-scoped as a two-phase port; each
phase gets its own spec→plan. This doc is the model-round master/decomposition
design.
**Parent:** `2026-06-30-dawntrail-modpack-upgrader-design.md` (§8, round 3).
**Research:** `2026-07-06-model-normalizer-research.md` (the authoritative
source map for the port — read it before speccing either phase).

---

## 0. Correction notice — why this was re-scoped

The original version of this spec assumed the modpack `/upgrade` model transform
was `EndwalkerUpgrade.FastMdlv6Upgrade` — a **size-preserving in-place v5→v6 byte
patch**. That was built and run (see the reference branch, §4), and the corpus
immediately falsified it: the `.mdl` burndown was **453 → 452** (one model
matched). Root cause (systematic-debugging, evidence in the research doc):

- ConsoleTools `/upgrade` does **not** rely on `FastMdlv6Upgrade`. It normalizes
  every model via `EndwalkerUpgrade.FixOldModel`, run at **read** time
  (`WizardData.FromModpack`, gated on TTMP version major < 2), which does a full
  `GetXivMdl → TTModel.FromRaw → MakeUncompressedMdlFile` round-trip.
- That round-trip **keeps LoD0 only** (the observed 9→3 mesh collapse), re-welds
  vertices per part, rebuilds vertex declarations, and **re-encodes every vertex**
  with a Half→Float precision upgrade on position/normal/UV. Even already-1-LoD
  models are re-emitted (a 2-byte compaction was observed).
- Our `.mdl` codec **preserves structure by construction** (byte-exact round-trip
  of the *same* bytes; it carries `vertexInfo` and geometry as opaque blobs), so
  it can never reproduce a normalizing golden. Corpus split of the 452 residuals:
  235 need LoD-collapse (>10k byte drop), 211 are single-LoD needing
  compaction/content normalization (71 same-size, different bytes).
- Golden **determinism confirmed** (per a re-run of ConsoleTools): the decompressed
  golden models are byte-identical across runs — a legitimate deterministic
  normalization, not a bad output.

**Decision (user, 2026-07-06):** commit to full byte-parity — port the normalizer
faithfully. Foreseeability note: the foundation §6 and harness §3 both already said
"/upgrade *normalizes* `.mdl` (uncompressed size changes)"; the original
model-round spec missed it.

## 1. What byte-parity actually requires

Reproduce, byte-for-byte, `FixOldModel`'s normalized **uncompressed** model. Per the
research doc, that is a genuine **vertex-geometry re-encode**, not a structural
slice. Concretely:

- **Decode geometry** — parse the 136-byte-per-mesh vertex declarations and fully
  decode LoD0's vertex/index buffers (positions, normals, binormals+handedness,
  flow, 2× colors, 3× UVs, bone weights/indices, indices), block0/block1 streams,
  Half decode (port of `MdlVertexReader`). Currently opaque in `src/mdl`.
- **Rebuild** — keep **LoD0 only**; per-part weld/sort/dedupe of vertices (order and
  count can change vs the source); build a TTModel-equivalent.
- **Re-serialize** (`MakeUncompressedMdlFile`) — rebuild vertex declarations from
  usage, re-encode every vertex with the **Half→Float** widening and the byte
  quantizers, recompute all headers/offsets/counts, v6 bone sets, recomputed
  bounding boxes, copy the handful of opaque `ogMdl` sub-blocks, emit `version=6`,
  `lodCount=1`. The round-trip is deterministic and effectively lossless for the
  game formats, so byte-parity is feasible.

Gate: apply the normalizer to `chara/*.mdl` only when the pack is **TTMP major < 2**
(mirror `DoesModpackNeedFix`, `TTMP.cs:918`). **PMP** packs never call
`FixOldModel` — their models only see `FastMdlv6Upgrade`; the byte-patch (reference
branch, §4) is the correct behavior there. Our corpus is all TTMP v1.x, so every
corpus model is normalized; the PMP path is currently unexercised.

## 2. Scope — this is the largest sub-project so far

Effectively a new **MDL geometry codec** plus a **model rebuilder**, porting a large
fraction of `Mdl.cs` / `TTModel` / `ModelModifiers` / `MdlVertexReader`. Net-new work
(the research doc §6): vertex-declaration parser, geometry decoder, TTModel-equivalent
with weld, `MakeUncompressedMdlFile` serializer, and the gate. Reuse from `src/mdl` is
framing-only (locate blocks, copy opaque sub-blocks, `MdlModelData` read/write).

## 3. Decomposition — two phased sub-projects

Mirrors the repo's "codecs first, then transforms" pattern. Each gets its own
spec→plan→PR; B depends on A.

- **Sub-project A — MDL geometry codec.** Vertex-declaration parse + full geometry
  decode/encode (positions/normals/binormals/flow/colors×2/UV0-2/weights/indices;
  Half↔Float; byte quantizers; block0/block1 streams; per-mesh/part offsets & sizes).
  **Verifiable in isolation**: decode→encode round-trip byte-exact on real corpus
  model geometry (like the sqpack/mtrl/tex codec corpus checks). This de-risks the
  precision-sensitive core (research risks R3/R4/R6) before the harder rebuild.
- **Sub-project B — model normalizer.** TTModel-equivalent (LoD0 weld/sort/dedupe) +
  `MakeUncompressedMdlFile` serializer + LoD-collapse + v6 + gate + wiring into
  `upgrade.ts`. Driven by the corpus `.mdl` golden ratchet (453 → 0). Folds in the
  reusable bits from the reference branch (§4).

Open risks to carry into the phase specs (research doc §6): R1 version→6 (already
empirically confirmed the golden is v6); R2 tangent path (implement binormals-present
first); R3 Half↔Float bit-exactness; R4 float32 radius/bbox order; R5 weld
determinism edge cases; R6 `WriteVertex` full body; R7 every `chara` model changes.

## 4. Reference branch — `feat/upgrade-model-round` (how to use it)

The superseded byte-patch was implemented on branch **`feat/upgrade-model-round`**
and is **kept as a reference**, NOT merged (its `modelRound` would emit non-matching,
possibly game-invalid models). It is NOT abandoned work — three pieces are correct and
**must be folded into sub-project B** when we build it:

- **`restore()` source-SqPack-type fix** (commit `cca61fa`): re-encode `.mdl` as
  `SqPackType.Model` (type 3), not the hardcoded `Standard`. Needed regardless of
  approach. Also carries the `uncompressedBytes → {bytes,type}` threading.
- **`reformatBoneSetsV5toV6`** helper (commit `b185e1e`): the v6 bone-set layout the
  serializer needs (research §2.2; C# `Getv6BoneSet`).
- **`buildRadiusBoundingBox`** helper (commit `b185e1e`): the per-bone ±radius/20 cube
  (research §2.2; C# `Mdl.cs:3732-3746`).

The `upgradeModel` byte-patch orchestration itself (commit `4e2a557` + the `modelRound`
wiring in `cca61fa`) is **discarded** — the normalizer replaces it. Branch commits stay
in local history as the reference; nothing from this branch ships to `main` directly.

Sub-projects A and B are built on **fresh branches off `main`** (A first). B cherry-picks
or re-derives the three reusable pieces above from the reference branch.

## 5. Out of scope

- Round-2 texture generation, round-5 metadata, round-6 partials, round-7 UI.
- PMP model handling beyond the existing byte-patch (unexercised by the corpus; the
  reference-branch `FastMdlv6Upgrade` port is the intended PMP behavior, gated).

## 6. Next steps

1. Land this correction + the research doc + the pivot plan on `main` (done in the
   commit carrying this file).
2. Brainstorm/spec **sub-project A (MDL geometry codec)** on a fresh branch; TDD the
   decode/encode against a corpus geometry round-trip.
3. Brainstorm/spec **sub-project B (model normalizer)**; drive the `.mdl` ratchet to 0.
