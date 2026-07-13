# MDL Half-precision large-vertex-buffer fallback

**Date:** 2026-07-11
**Status:** Design — approved, pending implementation plan
**Roadmap:** implements the `MDL — Half-precision large-vertex-buffer fallback` item in
`docs/BACKLOG.md`; sits under the model round (`docs/superpowers/specs/2026-07-06-model-round-design.md`,
`…-model-normalizer-design.md`) and the foundation roadmap
(`docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md` §8).

## 1. Problem

Our model normalizer (`FixOldModel`: `GetXivMdl → TTModel.FromRaw → MakeUncompressedMdlFile`)
currently **fails loud** whenever a model's estimated vertex buffer reaches the 8 MB
`_MaxVertexBufferSize`:

```
src/mdl/model/build-declarations.ts:62-66
  if (total >= MAX_VERTEX_BUFFER_SIZE)
    throw new Error("mdl: vertex buffer would overflow 8MB; Half-precision path unsupported");
```

The guard was safe while the corpus never approached 8 MB. That assumption broke on
**2026-07-10**: `[V] [AM] Spring Florals.ttmp2` (Vermillion, 12 MB) is a real pre-Dawntrail
pack whose model round trips this path. TexTools does **not** fail here — it declines the
Half→Float precision upgrade for that model and emits a **Half-precision vertex declaration**
instead (`Mdl.cs:2540-2543`, consumed by the element-set construction `Mdl.cs:2614-2711`). We
must reproduce that behaviour byte-for-byte.

## 2. What TexTools does (the spec)

Inside `MakeUncompressedMdlFile` (`Mdl.cs:2488-3964`), `upgradePrecision` starts `true` on the
2-arg overload (the `/upgrade` path) and is flipped to `false` by an **estimate** gate, then the
declaration is built from `upgradePrecision`:

**a) The estimate gate (`Mdl.cs:2513-2543`).** A precision-independent per-vertex byte estimate
(always assuming Float sizes, base 48) times the total vertex count:

```
var shapeVertCount   = ttModel.MeshGroups.Sum(m => m.Parts.Sum(p =>
                         p.ShapeParts.Sum(s => s.Key == "original" ? 0 : s.Value.Vertices.Count)));
var totalVertexCount = shapeVertCount + ttModel.VertexCount;
var estimatedVertexBufferSize = vertexSize * totalVertexCount;
if (estimatedVertexBufferSize >= _MaxVertexBufferSize)   // 8388608
    upgradePrecision = false;
```

**b) The declaration branch (`Mdl.cs:2614-2711`).** When `upgradePrecision` is false:

| Usage | `upgradePrecision = true` (current) | `upgradePrecision = false` (new) |
|---|---|---|
| Position (block 0) | `Float3` | `Half4` |
| Normal (block 1) | `Float3` | `Half4` |
| TexCoord, `MaxUv == 1` | `Float2` | `Half2` |
| TexCoord, `MaxUv >= 2` | `Float4` | `Half4` |
| TexCoord 2nd, `MaxUv > 2` | `Float2` | `Half2` |
| **Flow** (block 1) | present iff `useFlowData` | **omitted entirely** — gate is `upgradePrecision && useFlowData` (`Mdl.cs:2655`) |

All other elements (BoneWeight/BoneIndex/Binormal/Color) are unaffected by `upgradePrecision`.

**c) The hard cap (`Mdl.cs:2822-2825`).** After the per-mesh vertex streams are assembled into
the single `vertexDataBlock`, if its total length still exceeds `_MaxVertexBufferSize`, TexTools
throws `InvalidDataException` — a genuine failure even after the Half fallback.

## 3. What we already have

- **The encoder is precision-agnostic.** `src/mdl/geometry/encode.ts` already emits `Half4`,
  `Half2`, `Float3`, `Float4`, `Float2` driven by the declaration element type
  (`pushVectorData`, `pushUv`). Shape vertices flow through the **same** declaration-driven
  encoder (`serialize.ts:167-175`). So no encoder change is required — omitting the Flow element
  from the declaration is sufficient to omit its bytes.
- The estimate helper `estimatePerVertexSize` (`build-declarations.ts:20-31`) already mirrors the
  `vertexSize` arithmetic of `Mdl.cs:2513-2535` exactly.

## 4. Design

Three focused changes plus tests.

### 4.1 `src/mdl/model/build-declarations.ts` — port the branch

1. **Fix the estimate to match `Mdl.cs:2536-2538`.** The current `total` sums only base
   vertices (`part.vertices.length`). Add `shapeVertCount`: for every mesh part, sum the vertex
   counts of its `shapeParts` **excluding the `"original"` key**. This is a latent correctness
   fix independent of the Half path — it makes the 8 MB threshold decision byte-faithful for
   *all* models, not just Spring Florals. Keep the estimate structurally close to the C# (compute
   `totalVertexCount = shapeVertCount + baseVertexCount`, then `perVertex * totalVertexCount`).
2. **Replace the `throw` with the gate.** `const upgradePrecision = total < MAX_VERTEX_BUFFER_SIZE;`
3. **Branch the declaration** on `upgradePrecision`:
   - Position `add(0, Position, upgradePrecision ? Float3 : Half4)`
   - Normal `add(1, Normal, upgradePrecision ? Float3 : Half4)`
   - Flow: only `add(...)` when `upgradePrecision && flow` (faithful to `Mdl.cs:2655` — Flow is
     dropped in the Half path even if the model uses flow data)
   - TexCoord (primary): `maxUv === 1 ? (upgradePrecision ? Float2 : Half2) : (upgradePrecision ? Float4 : Half4)`
   - TexCoord (secondary, `maxUv > 2`): `upgradePrecision ? Float2 : Half2`
4. Update the module/function header comment: it currently asserts "our corpus never approaches
   the 8 MB … so we assert that here and fail loud". Rewrite to describe the ported gate and cite
   `Mdl.cs:2540-2543` / `:2655`.

`streamEntrySizes` needs no change (it derives stride from `dataTypeSize` per element, so Half
strides fall out automatically). `serialize.ts`'s stream-size assertions likewise stay correct.

### 4.2 `src/mdl/model/serialize.ts` — port the hard cap

After the per-mesh loop assembles the vertex data (the running `vertexDataLength` total), add the
`Mdl.cs:2822-2825` guard: if `vertexDataLength > MAX_VERTEX_BUFFER_SIZE`, throw an error mirroring
the C# `InvalidDataException` message (total size + max size + vertex count). Cite the C# lines.
Define/import the 8 MB constant from one place (it already lives in `build-declarations.ts` as
`MAX_VERTEX_BUFFER_SIZE`; export and reuse, or lift to a shared `mdl` constant) rather than
duplicating the literal.

### 4.3 Tests

**Real golden (primary oracle).** Copy `[V] [AM] Spring Florals.ttmp2` into `test/corpus/real/`.
Run the bless step to record its baseline:

```
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

Expected: a **full byte match** to the ConsoleTools `/upgrade` golden with **no** `DIVERGENCE_RULES`
entry. If any `.mdl` diffs remain, that is a real bug to close before this task is done — not a
divergence to accept. (Note: the corpus is gitignored today; the operator plans to make it
available to all developers later, so this golden is the durable AB oracle, not a fresh-clone-only
artifact.)

**Synthetic unit test — Half declaration shape (`test/mdl/model/build-declarations.test.ts`).**
Add a case that forces `upgradePrecision = false` and asserts:
- Position `Half4`, Normal `Half4`, TexCoord `Half2`/`Half4` per `maxUv`,
- **Flow element absent** even when the model has `anisotropicLighting = true`,
- running offsets/stream sizes recomputed for the Half strides.

Because the real gate needs ~175k vertices to cross 8 MB, the fixture stubs the count rather than
materializing it: e.g. a model whose single part reports a large `vertices.length` (or a
shape-part vertex count) sufficient to push the estimate `>= 8 MB`, without allocating 175k real
vertices. Cite the reasoning from `Mdl.cs:2513-2543` like any hand-derived fixture. Also add/extend
a case proving the **estimate now includes shape-part vertices** (a model that stays under 8 MB on
base verts alone but crosses it once `shapeParts` are counted → `upgradePrecision` flips to false).

**Synthetic unit test — hard-cap throw.** In the serializer's test neighbourhood, assert the
`4.2` guard throws when the assembled vertex buffer exceeds 8 MB. No practical corpus pack reaches
this (Spring Florals stays under 8 MB once Half-encoded, since Half is smaller than the Float
estimate that tripped the gate), so a unit test is the only reachable coverage.

### 4.4 Housekeeping

- Remove the `MDL — Half-precision large-vertex-buffer fallback` item from `docs/BACKLOG.md`.
- If the estimate fix or Half branch surfaces any *other* pre-existing model diff on Spring
  Florals that is genuinely out of this scope, file it as a new `docs/BACKLOG.md` item with the audit
  finding rather than expanding this task.

## 5. Divergence policy

**Target byte-exact, no `DIVERGENCE_RULES` entry.** The Half path is deterministic integer/Half
encoding — there is no float-resampler precision concern here (unlike the texture rounds). Any
residual `.mdl` mismatch on Spring Florals is a real bug or a coverage gap, not an accepted
divergence.

## 6. Out of scope

- The texture rounds' NPOT resize / ImageSharp resampler (separate backlog items T1–T3).
- The T4 index-path-overrides table gap.
- Any model behaviour Spring Florals does not exercise beyond the Half fallback + the estimate
  fix + the hard cap.

## 7. Risks / open questions

- **Does Spring Florals fully match once the Half branch lands?** Unknown until we run the golden;
  the pack may exercise a second, unrelated model path. Treat a residual diff per §4.4 — fix if in
  scope, else backlog it. This is the one place the design could grow.
- **Constant location.** Prefer exporting the existing `MAX_VERTEX_BUFFER_SIZE` (or lifting it to
  a shared `src/mdl` constant) over duplicating `8388608`; decide during implementation to keep
  provenance single-sourced.
