# Sub-project 3b — Model Normalizer — Design

**Date:** 2026-07-06
**Status:** Design signed off; implementation pending (fresh branch `feat/model-normalizer`).
**Parent (roadmap):** `2026-06-30-dawntrail-modpack-upgrader-design.md` §8, row **3b**.
**Master design:** `2026-07-06-model-round-design.md` (the model-round decomposition; this
is its **phase B**).
**Research (authoritative source map):** `2026-07-06-model-normalizer-research.md` — read
it before implementing any piece; this spec cites into it and into
`reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/` (abbreviated `…/`).
**Prerequisite:** sub-project **3a — MDL geometry codec** (`src/mdl/geometry/`), merged to
`main` (PR #12). B consumes 3a's decoder, encoder, declaration codec, and offset model.

---

## 1. Purpose & scope

Reproduce, **byte-for-byte**, what ConsoleTools `/upgrade` does to a `.mdl` when producing
its decompressed golden, and wire it into the upgrade pipeline. Per the research doc, that
transform is `EndwalkerUpgrade.FixOldModel` run at modpack **read** time — a full
`GetXivMdl → TTModel.FromRaw → MakeUncompressedMdlFile` round-trip that keeps **LoD0 only**,
re-welds vertices per part, rebuilds vertex declarations, re-encodes every vertex (with a
**Half→Float** precision upgrade), recomputes all headers/offsets/counts, emits **v6** with
v6 bone sets and recomputed bounding boxes, and copies a handful of opaque `ogMdl` sub-blocks.
It is a genuine geometry re-encode, **not** a structural byte-slice (research §5).

This is the largest sub-project so far. The precision-sensitive core (vertex decode/encode,
Half↔Float, declaration bytes) already shipped as **3a** and is corpus-round-trip tested; B is
the **model rebuilder + serializer + gate + wiring** on top of it.

**In scope:** the `chara` model path faithfully (every model-bearing `.mdl` in this TTMP-v1.x
corpus is `chara`). **Out of scope:** PMP model handling (never calls `FixOldModel`; see §4),
non-chara/furniture model structure (unexercised — fail loud, §4), and all other upgrade rounds.

## 2. Byte-parity is feasible because the round-trip is lossless

The re-encode is deterministic and effectively lossless for the game formats (research §2.5,
§5), which is what makes exact parity achievable:

- **Half decode → Float re-emit** is exact: position/normal/UV output is the widened binary16
  values stored as binary32 (reuse 3a's exact `halfToFloat`).
- **Binormal / color / weight / index** byte channels round-trip to themselves (decode is the
  exact inverse of encode).
- **Tangents are not recomputed when binormals exist**: `FromRaw`'s `CalculateTangents` takes
  the fast `CalculateTangentsFromBinormalsForPart` path, which derives the (unstored) tangent
  and leaves the stored binormal untouched — so tangent recalc does not affect output bytes.
  **Correction 2026-07-21:** the "when binormals exist" precondition is no longer universal over
  the corpus — see R2 in §8.

The residual precision risk is confined to the IEEE-754 half↔float conversion (R3) and the
float32 radius / bounding-box math (R4); see §8.

## 3. Module boundaries (port fidelity: split, don't blend)

New code lives under **`src/mdl/model/`** (the editable-model + serializer layer) plus wiring
in **`src/upgrade/`**. `parse.ts` stays the byte-exact **framing** layer; everything structured
is read *out of* the opaque `XivMdl.sections` slices — the pattern `geometry/offsets.ts`
already established. Layering is one-directional: **framing → `geometry/` codec → `model/`
normalizer**, mirroring C# (`Mdl.cs` serialize depends on `TTModel`, which depends on decoded
`VertexData`). Per the `AGENTS.md` "split, don't blend" convention, each module maps to a named
C# symbol and cites its source; we do not merge logic across C# files/symbols.

| C# source (`file · symbol · lines`) | TS module | Notes |
|---|---|---|
| `TTModel.cs` — container + `GetUsageInfo` (:1308) + `Getv6BoneSet` (:1373) | `model/tt-model.ts` | TTModel members stay with their owner |
| `TTModel.FromRaw` (:2695) | `model/from-raw.ts` | orchestrator |
| `ModelModifiers.cs` — `MergeGeometryData` (:376), `MergeAttribute/Material/Shape` (:578/626/658), `MergeFlags` (:2284), `FixUpSkinReferences` (:2309), `CalculateTangents` (:1851) | `model/model-modifiers.ts` | mirrors the one C# file; the weld **may** split to `model/weld.ts` (cite :376–575) as it is the R5 hotspot with focused tests |
| `Mdl.GetXivMdl` remaining reads (:349–995: bone-set contents, path strings→names, shapes, neck-morph, model bboxes) | `model/read-model.ts` | finishes `GetXivMdl` over the opaque slices (the `offsets.ts` precedent) |
| `Mdl.MakeUncompressedMdlFile` (:2488–3964) | `model/serialize.ts` | serializer body |
| bbox math (`Mdl.cs` :2562–2587 radius, :3673–3772 block) | `model/bounding-box.ts` | factored out for its unit tests, as `geometry/` already factors `Mdl.cs` |
| decl rebuild-from-usage (`Mdl.cs` :2594–2767) | `model/build-declarations.ts` | produces `VertexElement[][]`, then hands to 3a's `serializeVertexDeclarations` |
| `Mdl.WriteVertex` / `WriteVectorData` / `ConvertVectorBinormalToBytes` (:4164/:4121/:4032) | — | **already 3a's `geometry/encode.ts`; reused, not re-ported** |
| vertex-info block bytes (`Mdl.cs` :562/2735) | — | **already 3a's `geometry/declaration.ts`; reused** |

`TtVertex` (3a `geometry/vertex-data.ts`) is the encoder's vertex-row contract and **stays in
`geometry/`**; `model/tt-model.ts` builds `TTModel`/`TTMeshGroup`/`TTMeshPart` *around* it.
Moving it up into `model/` would invert the dependency. 3a's `transpose` identity seam stays
(still used by 3a's own geometry round-trip test); B's real weld replaces the seam only in the
normalizer path. **No 3a reorganization** — it already traces cleanly and is merged/tested.

## 4. Data flow — the `normalizeModel` pipeline

`normalizeModel(bytes) → bytes`, porting `FixOldModel` (research §1.3):

```
parseMdl (3a)                     framing + opaque section slices
   │
   ▼
read-model.ts   readEditableInputs(XivMdl)
   │   decode LoD0 geometry (3a decodeVertexData over parseGeometryLayout +
   │   parseVertexDeclarations); resolve per-mesh bone-name lists (bone sets ×
   │   BoneList); parse path strings → attr/bone/mat/shape names + extra paths;
   │   shapes; neck-morph; model bboxes; opaque copy-through blobs
   ▼
from-raw.ts     fromRaw(inputs) → TTModel        (TTModel.FromRaw)
   │   model-modifiers.ts: mergeGeometryData (per-part unique→sort→dedupe→remap; R5),
   │   MergeAttribute/Material/Shape/Flags, FixUpSkinReferences,
   │   calculateTangents (binormals-present fast path only; R2)
   ▼
serialize.ts    makeUncompressedMdlFile(ttModel, ogMdl) → bytes   (§ research 4 order)
       build-declarations.ts  usage → VertexElement[][] → 3a serializeVertexDeclarations
       geometry via 3a encodeVertexData/encodeIndices (Half→Float widen)
       model-data block (56 B) recompute (counts/flags/radius)
       bone-sets: TTModel.Getv6BoneSet (v6 layout) — build fresh from bone lists
       bounding-box.ts: model/water/fog bbox from verts (Math.fround; R4) + per-bone cube
       LoD/mesh/part headers, offset tables, shapes, neck-morph, padding, header
       assembly; combinedDataBlockSize self-check; emit version=6, lodCount=1
```

**LoD-collapse:** keep LoD0 only; LoD1/2 LoD-header structs become 120 zero bytes;
`meshCount = ttModel.MeshGroups.Count` (the observed 9→3). Sections copied opaque from
`ogMdl` (research §2.4): `UnkData0/1/2`, `ExtraPathList` strings, padding bytes, LoD0
`Unknown6/7`, and the `ModelData` scalar flags in research §2.3.

## 5. Gate, wiring & integration

**Gate `needsMdlFix`** (mirror `DoesModpackNeedFix`, `TTMP.cs:918`; research §1.2):
- **PMP / PmpFolder → never** (no `FixOldModel` in `PMP.cs`; those models only ever get the
  size-preserving `FastMdlv6Upgrade`, unexercised by this corpus).
- **TTMP2 / TtmpLegacy → normalize iff `TTMPVersion` major < 2.**
- Applied to **every `.mdl`**, **not** a `chara/` path filter — the version gate is the
  faithful one; "chara" is only what this corpus contains (research §1.2).

**Integration — thread the source `TTMPVersion`.** It is parsed at `manifest-types.ts:30` but
dropped before reaching `ModpackData` (`ttmp2.ts:56` surfaces only `minimumFrameworkVersion`, a
*different* field). Add a source-version field to `ModpackData`/`ModpackMeta`, populate from
`mpl.TTMPVersion` in `ttmp2.ts`; legacy `.ttmp` → treat as `< 2`; PMP → field absent (gate
returns false). The write side already bumps `TTMPVersion` to `2.1*` (`ttmp2.ts:162`).

**Non-chara models** (bg/furniture carry extra structure, e.g. `furniturePartBoundingBoxCount`):
unexercised by the corpus, so implement the chara path faithfully and **fail loud** if the
serializer meets furniture-part structure it does not model (consistent with 3a's throw-rather-
than-silently-diverge stance). Documented gap, not silent mis-handling.

**Error handling in `modelRound`:** during ratchet burndown a normalization throw should
**surface** (so the ratchet exposes the gap) — *not* be swallowed the way `materialRound`
swallows C#-NRE-abandon cases. Production resilience (one bad model must not fail a whole
upgrade) is a later hardening, out of scope for parity.

**Wiring in `upgrade.ts`:**
- Replace the `modelRound` stub (`upgrade.ts:109`): for each `.mdl` the gate accepts,
  `normalizeModel(bytes)` → `restore(..., SqPackType.Model)`. Stays **before** `materialRound`
  (matches C#, where normalization is a read-time transform preceding `UpdateEndwalkerFiles`).
- **`restore()` SqPack-type fix** (ref `cca61fa`; resolves the existing TODO at `upgrade.ts:70`):
  `uncompressedBytes` returns `{bytes, type}`; `restore(f, bytes, type)` re-encodes with the
  source entry type, so a `.mdl` becomes a valid `SqPackType.Model` (type-3) entry.

## 6. Reference-branch fold-ins (`feat/upgrade-model-round`; NOT merged)

Re-derive (not merge) these into their correct homes; read the commits at plan time:
- **`restore()` SqPack-type fix + `{bytes,type}` threading** — ref `cca61fa` → `upgrade.ts` (§5).
- **v6 bone-set layout** — ref `b185e1e` (`reformatBoneSetsV5toV6`): the byte layout is reusable,
  but the **mechanism differs** — the discarded byte-patch reformatted *existing v5 bytes*,
  whereas the normalizer **builds fresh** from each mesh's bone-name list. So the serializer's
  builder is `TTModel.Getv6BoneSet` semantics (in `tt-model.ts`); we borrow the layout, not the
  transform.
- **`buildRadiusBoundingBox`** — ref `b185e1e` → `model/bounding-box.ts`. **R4 caveat:** covers
  only the per-bone ±radius/20 cube; the 4-corner model/water/fog bbox from vertices is new.

The discarded reference `upgradeModel` byte-patch (ref `4e2a557` + the `cca61fa` wiring) is
replaced by this normalizer.

## 7. Verification

- **Primary gate — the E2E `.mdl` golden ratchet, 453 → 0**, byte-exact, **no allow-list
  entry** (models carry no intended divergence; anything non-matching is a bug). Re-bless the
  baseline as diffs burn down
  (`$env:UPDATE_UPGRADE_BASELINE="1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`).
  Expect a large burndown — **every** chara model in a <2.0 pack changes (R7).
- **Secondary — hand-derived micro-fixture unit tests** (C# cannot run here; the ratchet is the
  fidelity oracle) for: the weld (tiny mesh, known index ranges → known sorted/deduped remap),
  `build-declarations` (known usage → element set/order/types), v6 bone sets (synthetic bone list
  → known layout bytes), and bbox math (known vertex set through `Math.fround` min/max → known
  float bytes; per-bone cube).
- 3a's corpus geometry round-trip already vouches for decode/encode, so B adds only rebuild +
  serialize coverage. **End-of-task gate** stays green `npm run check` + `typecheck` + `test`.

## 8. Risks (R1–R7; research §6)

- **R1 — v6 bump mechanism.** Output version is `ttModel.MdlVersion` (from the source), yet
  goldens are v6. Either trace who bumps v5→v6 in the `FixOldModel` path, or just **emit v6 +
  v6 bone sets** (empirically confirmed). The `mdlVersion≥6` bone-set branch is a good test
  discriminator. **Resolve in the plan.**
- **R2 — tangent path.** Implement the binormals-present fast path first; the plan adds a corpus
  scan confirming all LoD0 meshes carry binormals (deferring the heavy `CalculateTangentsForMesh`).
  **R2 FIRED, 2026-07-21.** The corpus scan that discharged this risk no longer holds: the furniture
  `.mdl` parse fix let `bgcommon/hou/outdoor/general/0112/bgparts/gar_b0_m0112.mdl` reach the scan,
  and its mesh 0 carries **no** binormals — so the deferred `CalculateTangentsForMesh` is now
  reachable, and `normalizeModel` runs it silently rather than failing loud (a throw at that seam
  would drop the file, which is worse). The scan
  (`test/mdl/model/binormals-present.test.ts`) now asserts the exception set rather than unanimity.
  Tracked in [`docs/backlog/2026-07-21-unported-tangent-recompute.md`](../../backlog/2026-07-21-unported-tangent-recompute.md);
  read it before acting on this risk — it explains why the obvious fail-loud is the wrong close, and
  that no golden oracle covers the one model that reaches it.
- **R3 — Half↔Float bit-exactness.** Reuse 3a's exact widening; **assert no residual Half
  channels remain** in the v6 output so a `floatToHalf` mismatch cannot bite.
- **R4 — float32 accumulation order.** Model/water/fog bbox must use `Math.fround` single
  precision and C#'s min/max scan order (`Mdl.cs:2562–2587`, radius `absVect.Length()` at :2587).
  The folded-in helper only covers the per-bone cube — the 4-corner box is new, parity-sensitive.
- **R5 — weld edge cases.** Read `MergeGeometryData` to completion (`fakePart` for boneless/no-
  boneset meshes, NaN UV2 handling, `Colors2`/flow presence gating) *before* implementing.
- **R6 — rounding mode.** 3a's quantizers use `Math.round` (half-up); C# `Math.Round` is
  banker's (half-to-even). Current analysis: likely **benign on the fast path** — widened
  position/normal/UV go out as *floats* (no byte quantizer), and binormal/color/weight are
  decoded bytes re-encoded through their exact inverse, so no real `.5` boundary arises unless a
  channel is *recomputed*. **Verify empirically**; touch 3a's quantizers only if a genuine
  banker's-rounding mismatch appears.
- **R7 — scope of change.** Every chara model in a <2.0 pack re-emits (even already-1-LoD/2-mesh
  models shift a couple of bytes). Budget a large burndown, not a few files.

## 9. Open items to resolve during the plan

1. The exact **v6 version-bump mechanism** (R1) — trace or confirm-and-emit.
2. Confirm **no real non-chara restriction** exists in `FromRaw`/`MakeUncompressedMdlFile`
   beyond what §5's fail-loud stance covers.
3. Read reference commits `cca61fa` and `b185e1e` for the exact fold-in details (§6).
4. Read `MergeGeometryData` (`ModelModifiers.cs:376–575`) fully for R5 before coding the weld.

## 10. Out of scope

PMP model handling (the gated `FastMdlv6Upgrade` byte-patch is the intended PMP behavior, and
the corpus does not exercise it); non-chara/furniture model structure (fail loud); all other
upgrade rounds (round-2 textures, round-5 metadata, round-6 partials, round-7 UI).
