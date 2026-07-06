# MDL Normalization in TexTools `/upgrade` — Port Research

Goal: reproduce, byte-for-byte, what ConsoleTools `/upgrade` does to a `.mdl` when
producing its decompressed golden. All citations are into
`reference/xivModdingFramework/xivModdingFramework/` (paths abbreviated as `…/`).

**Headline result up front:** the LoD-collapse + v6 + geometry shrink you observed is
**NOT** produced by `FastMdlv6Upgrade` and **NOT** by the Type-3 re-compressor. It is
produced by `EndwalkerUpgrade.FixOldModel`, which runs during the modpack **read**
(`WizardData.FromModpack`) and does a full `GetXivMdl → TTModel.FromRaw →
MakeUncompressedMdlFile` round-trip. That round-trip re-parses LoD0 only, re-welds
vertices per part, and **re-encodes every vertex** (including a Half→Float **precision
upgrade**). This is a large port, not a byte patch.

---

## 1. The exact normalization call path (Q1)

### 1.1 Orchestration
- `ModpackUpgrader.UpgradeModpack(path, newPath, …)`
  (`…/Mods/ModpackUpgrader.cs:212`) →
  - `data = await UpgradeModpack(path, includePartials)` (:214), whose first act is
    `WizardData.FromModpack(path)` (`…/Mods/ModpackUpgrader.cs:58`). **This is the read
    step, and it is where model normalization happens.**
  - then `UpdateEndwalkerFiles(o.StandardData.Files)` (:99) — materials + the
    *in-place* `FastMdlv6Upgrade` (see §1.4, largely a no-op here).
  - then `data.Data.WriteModpack(newPath, true)` (:218) — re-compress + write.

### 1.2 Read step → the normalizer (THE CRUX)
`WizardData.FromModpack` (TTMP branch) reaches `FromWizardGroup`
(`…/Mods/WizardData.cs:650`). For every file it computes:
- `needsMdlFix = (upgradesNeeded & NeedsMdlFix)` (`…/Mods/WizardData.cs:662`).
- For `.mdl` files, when `needsMdlFix`:
  `finfo = await EndwalkerUpgrade.FixOldModel(finfo);` (`…/Mods/WizardData.cs:724`).

`upgradesNeeded` comes from `TTMP.DoesModpackNeedFix(version)`
(`…/Mods/FileTypes/TTMP.cs:918`):
```
if (major < 2)  return NeedsTexFix | NeedsMdlFix;   // ← models get FixOldModel
if (major==2 && minor==0) return NeedsTexFix;
return None;
```
So **model normalization is gated on the modpack's TexTools version being < 2.0**.
(The same gate exists on the raw import path, `…/Mods/FileTypes/TTMP.cs:741` and
`:1382–1387`.)

**Verified against the corpus:** every model-bearing `.ttmp2` in
`test/corpus/inputs/` reports `TTMPVersion` `1.0x`/`1.3x` (major = 1). Therefore
`FixOldModel` runs on every `chara/*.mdl` in those packs. This is exactly the pack
class that shows the 9→3 collapse. Deduction confirmed empirically.

### 1.3 `FixOldModel` — the whole normalizer in 4 lines
`…/Mods/EndwalkerUpgrade.cs:190`:
```csharp
var uncomp = await TransactionDataHandler.GetUncompressedFile(file);
var mdl = Mdl.GetXivMdl(uncomp);          // parse  (Mdl.cs:349)
var ttm = await TTModel.FromRaw(mdl);      // to editable model, LoD0 only (TTModel.cs:2695)
uncomp = Mdl.MakeUncompressedMdlFile(ttm, mdl);  // re-serialize v6 (Mdl.cs:2488)
```
The result is stored back as an `UncompressedIndividual` file (:199–206). The
normalized **uncompressed** bytes are produced *here*, before any compression.

### 1.4 Why the other two candidates are ruled out
- **`FastMdlv6Upgrade`** (`…/Mods/EndwalkerUpgrade.cs:282`, called from
  `UpdateEndwalkerModel` :264): a size-preserving in-place patch. It only writes
  `version=6` (:376), `lodCount=1` in the header (:381) and in `MdlModelData`
  (:387), rewrites bone sets to v6 format (:392–430), and rewrites bone bounding
  boxes (:469–473). **It does not touch `meshCount`, does not drop LoD1/2 mesh
  headers, and does not touch geometry.** It also early-returns unless `version==5`
  (:293) — so after `FixOldModel` has already produced a v6 file, `FastMdlv6Upgrade`
  is a **no-op** on the upgrade path. It cannot yield `meshCount 9→3` or the geometry
  shrink.
- **`Mdl.CompressMdlFile`** (`…/Models/FileTypes/Mdl.cs:2148`), reached on write via
  `WriteModpack → ToModOption → TransactionDataHandler.GetCompressedFile`
  (`…/Mods/WizardData.cs:439`) → `SmartImport.CreateCompressedFile`
  (`…/SqPack/FileTypes/TransactionDataHandler.cs:327`) →
  `Mdl.CompressMdlFile` (`…/Mods/SmartImport.cs:362`). This is a **pure, lossless
  Type-3 compressor**: it reads all 3 LoDs' vertex/index offsets & sizes from the
  header (Mdl.cs:2172–2179), compresses each block, and copies `meshCount`,
  `materialCount`, `lodCount` verbatim from the input header into the Type-3 header
  (Mdl.cs:2388–2392). Decompressing it returns the input uncompressed bytes exactly.
  It changes nothing structural. (The write route never routes a model back through
  `MakeCompressedMdlFile`/`TTModel`; that overload is only used by TexTools' own
  import/merge/root-clone flows, not by modpack upgrade.)

**Conclusion (Q1):** normalization = `FixOldModel`'s `GetXivMdl → TTModel.FromRaw →
MakeUncompressedMdlFile` round-trip, executed at read time, gated on TTMP version
major < 2. The write-side compressor is lossless and merely preserves that result.

---

## 2. What the normalization does, in order (Q2)

The transform is a decode-to-editable-model then re-emit. Enumerated by effect:

### 2.1 LoD-collapse rule
- **Only LoD0 survives.** `MergeGeometryData` iterates `rawMdl.LoDList[0].MeshDataList`
  exclusively (`…/Models/Helpers/ModelModifiers.cs:387`). LoD1/2 meshes are never read
  into the TTModel, so they cannot be written back.
- The rule is **"keep LoD0, drop everything else"** — it is *not* "drop empty LoDs" and
  it does *not* respect the source `lodCount`. Output `lodCount` is hard-coded to 1
  (`_LoDCount = 1`, Mdl.cs:2494; written at :2955 and header :3955).
- Consequences: `meshCount` becomes `ttModel.MeshGroups.Count` = the LoD0 mesh count
  (Mdl.cs:2935, 2946, 3927) → your `9→3`. LoD1/2 mesh headers, part headers, bone sets
  and their vertex/index byte ranges all vanish (they were never in the model). LoD1/2
  LoD-header structs are written as 120 zero bytes (Mdl.cs:3874–3875). Geometry shrinks
  to LoD0-only (→ `54084`).

### 2.2 v5 → v6 changes
- Version field → 6 (Mdl.cs:3919; `mdlVersion` from `ttModel.MdlVersion`, which
  `FromRaw` set from the source; a v5 source keeps 5 unless something bumps it — see
  Risk R1).
- **Bone sets switch to v6 format**: for `mdlVersion >= 6`, `Getv6BoneSet` per mesh with
  a `[short offset][short count]` header table followed by packed bone-index shorts and
  2-byte padding to 4-byte alignment (Mdl.cs:3378–3416). For v5 they'd be the fixed
  128-byte arrays (:3419–3445). The `BoneSetSize` field is back-patched (:3449–3451).
- **Bone bounding boxes** rewritten as a ±`radius/20` cube per model bone
  (Mdl.cs:3732–3746; also the FastMdl path :459–473). Original per-bone boxes are
  discarded (except used to detect and null "bad" boxes, :3704–3726).
- Model/water/fog bounding boxes recomputed from actual vertex extents
  (Mdl.cs:3681–3702), with the origin-box clamp (`min>0 → 0`, `max<0 → 0`).

### 2.3 Header/field recomputation (everything is recomputed, not copied)
`MdlModelData` / basic-model block (Mdl.cs:2929–3056) recomputes: `radius` (from
vertex extents, :2587/:2945), `meshCount`, `attributeCount`, `meshPartCount`,
`materialCount`, `boneCount`, `boneSetCount` (= mesh count when weighted, :2943),
shape counts, `lodCount=1`, bgChange/crestChange indices & flags (flags2/3 toggled
for extra meshes / boneless parts / crest/material change). A handful of fields are
copied opaquely from `ogMdl.ModelData`: `Flags1`, `ElementIdCount`,
`TerrainShadowMeshCount`, `TerrainShadowPartCount`, `NeckMorphTableSize`, `Unknown13`,
`Unknown15/16/17`. **Patch 7.2 face table is dropped** (written as 2 zero bytes,
Mdl.cs:3048–3049; block emitted empty, :3656).

### 2.4 Sections copied opaquely from `ogMdl` (must be preserved to match)
- `UnkData0.Unknown` (element-id block) — Mdl.cs:3061, 3886.
- `UnkData1.TerrainShadowMeshHeader` — :3216, 3891.
- `UnkData2.Unknown` — :3339, 3896.
- `PathData.ExtraPathList` (extra strings appended to path block) — :2906–2917.
- `Padding` byte + `PaddedBytes` — :3665–3666, 3904.
- Neck-morph table: preserved but bone indices **remapped** by bone *name* into new
  BoneSet[0]; dropped wholesale if any bone can't be matched (:3592–3649).
- LoD0 `Unknown6`/`Unknown7` copied into the LoD header (:3855–3856), with the first
  2 bytes of `Unknown7` zeroed if neck-morph was dropped (:3860–3864).

### 2.5 Vertex data & index data: FULLY RE-ENCODED (not copied)
This is the decisive scope fact.
- **Per-part re-weld**: `MergeGeometryData` (ModelModifiers.cs:422–500) splits each
  mesh into parts by index range, collects the *unique* vertex IDs referenced by each
  part's indices, **sorts them ascending**, and remaps. Vertex order and count within a
  mesh can therefore change vs. the source buffer.
- **Vertex declarations rebuilt from scratch** (Mdl.cs:2594–2767) from
  `ttModel.GetUsageInfo()` — element set/order/types are regenerated, not copied.
- **Precision upgrade** (`upgradePrecision = true` by default on the 2-arg overload
  `FixOldModel` uses, Mdl.cs:2488): Position `Half4→Float3` (:2620), Normal
  `Half4→Float3` (:2643), UV `Half2→Float2` / `Half4→Float4` (:2689/2697). Binormal,
  Color, BoneWeight, BoneIndex stay byte formats.
- **Every vertex re-emitted** through `GetBasicGeometryData`/`WriteVertex`
  (Mdl.cs:3982–4021, 2776). Indices re-emitted as u16 against the remapped IDs
  (:4012–4017), each mesh's index block padded to 16 bytes (:2819).

**Precision round-trip is deterministic and essentially lossless**, which is what makes
byte-exact parity feasible:
- Half→float decode (`MdlVertexReader.ReadVector3` Mdl path, `MdlVertexReader.cs:177`)
  is exact; re-emitting as Float3 just stores those exact floats. So position/normal/UV
  bytes are the widened halfs — reproducible if we match IEEE-754 binary16→binary32
  exactly (SharpDX `Half`).
- Binormal: `byte b → b*2/255−1` (`MdlVertexReader.cs:206`) then re-encode
  `round((v+1)*255/2)` (`ConvertVectorBinormalToBytes`, Mdl.cs:4059–4061) → returns `b`.
  Exact round-trip. Handedness byte preserved (0↔false, else true).
- Color/Weight/Index: byte→(b/255)→`round(f*255)` = b. Exact.
- **Tangents/binormals are NOT recomputed when binormals exist**: `FromRaw` calls
  `CalculateTangents` (TTModel.cs:2728), which for meshes that already have binormals
  takes the fast path `CalculateTangentsFromBinormalsForPart` (ModelModifiers.cs:2127–
  2137) — it derives the (unstored) tangent and leaves the binormal untouched. Since SE
  format stores binormal (not tangent), tangent recalc does not affect output bytes.
  Full tangent recalculation only fires if binormals are missing (Risk R2).

---

## 3. The read model shape — `GetXivMdl` → in-memory (Q3)

`Mdl.GetXivMdl(byte[], path)` (`…/Models/FileTypes/Mdl.cs:349`) parses the full runtime
MDL into `XivMdl` (`…/Models/DataContainers/XivMdl.cs`). Constants: `_MdlHeaderSize =
0x44` (68), `_VertexDataHeaderSize = 0x88` (136) (Mdl.cs:83–84); LoD header = 60 bytes;
mesh header = 36 bytes; bounding box = 32 bytes.

Fields the normalizer actually consumes downstream:
- `MdlVersion`, `LoDList[0]` with `MeshDataList[]` (each `MeshData` = `MeshInfo` +
  `MeshPartList` + decoded `VertexData`), `GetMeshType`/mesh-type ranges.
- `MeshBoneSets[]` (bone index lists) → per-mesh bone name lists via `PathData.BoneList`.
- `PathData` (attributes, bones, materials, shapes, `ExtraPathList`, `BoneList`).
- `ModelData` (the 56-byte struct) — for the copied/opaque fields in §2.3–2.4.
- `MeshShapeData` (shape info/part/data lists), `NeckMorphTable`, `BoneBoundingBoxes`,
  `UnkData0/1/2`, `PaddingSize`/`PaddedBytes`, per-LoD `Unknown6/7`.

Decoded vertex arrays live on `MeshData.VertexData` (`MdlVertexReader.ReadVertexData`,
called at Mdl.cs:1048): `Positions`, `Normals`, `BiNormals`+`BiNormalHandedness`,
`FlowDirections`+`FlowHandedness`, `Colors`, `Colors2`, `TextureCoordinates0/1/2`,
`BoneWeights`, `BoneIndices`, `Indices`. Streams are read block0 then block1, each
element ordered by `DataOffset` (`MdlVertexReader.cs:27–49`).

`TTModel.FromRaw` (TTModel.cs:2695) then builds the editable `TTModel`:
`MeshGroups[ Parts[ Vertices[TTVertex], TriangleIndices, Bones ] ]`, plus model-level
`Attributes`, `Bones`, `Materials`, `ShapeNames`, flags, `MdlVersion`, `Source`. Steps:
`MergeGeometryData` (:2708), `MergeAttributeData`, `MergeMaterialData`,
`MergeShapeData`, `FixUpSkinReferences`, `MergeFlags`, `CalculateTangents` (:2728).

---

## 4. The write/serialize order + computed fields (Q4)

`MakeUncompressedMdlFile(ttModel, ogMdl)` (`…/Models/FileTypes/Mdl.cs:2488`). Output
file layout = `header ‖ vertexInfoBlock ‖ modelDataBlock ‖ vertexDataBlock ‖
indexDataBlock` (assembled at Mdl.cs:3964). `modelDataBlock` internal order
(Mdl.cs:3883–3906):

1. `pathInfoBlock` — `[count u32][blockSize u32]` then UTF-8 NUL-terminated strings in
   order attributes, bones, materials, shapes, extra-paths; padded to 4 (Mdl.cs:2830–
   2925). Offsets captured for the offset tables below.
2. `basicModelBlock` — 56-byte model-data struct, all fields recomputed (§2.3),
   `boneSetSize` back-patched at :3449.
3. `unknownDataBlock0` = `ogMdl.UnkData0.Unknown` (opaque).
4. `lodDataBlock` — LoD0 header (60 B) with mesh-type offsets/counts, LoD distances
   (`0.0`, `100.0`), edge-geometry offset, `Unknown6/7`, vertex/index sizes & offsets;
   then 120 zero bytes for LoD1/2 (Mdl.cs:3817–3875). Written last because it needs
   `combinedDataBlockSize` (:3813), the sum of every preceding block, = the absolute
   offset where vertex data starts.
5. `extraMeshesBlock` — only if `HasExtraMeshes` (:3780–3803).
6. `meshDataBlock` — 36-byte mesh header per LoD0 mesh: vertexCount, indexCount,
   materialIndex, partOffset (running `totalParts`), partCount, boneSetIndex (=mesh
   idx when weighted, else 255), indexOffset, the 3 vertex-stream offsets, the 3
   per-stream entry sizes, and `vertexStreamCountPlusFlags` (Mdl.cs:3070–3193). Offsets
   come from the freshly built geometry (`meshVertexOffsets`, `meshIndexOffsets`).
7. `attributePathDataBlock` — u32 offsets into path block (:3200–3211).
8. `unknownDataBlock1` = `ogMdl.UnkData1.TerrainShadowMeshHeader` (opaque, may be null).
9. `meshPartDataBlock` — 16-byte part header: indexOffset (recomputed with 8-index
   padding between meshes), indexCount, attributeMask, boneOffset, boneCount
   (:3220–3333). Only when `useParts`.
10. `unknownDataBlock2` = `ogMdl.UnkData2.Unknown` (opaque).
11. `matPathOffsetDataBlock`, 12. `bonePathOffsetDataBlock` — u32 offset tables.
13. `boneSetsBlock` — v6 or v5 bone sets (§2.2).
14. `FullShapeDataBlock` — shape info (offset + per-LoD sum/count, LoD1+ zeroed),
    shape parts, raw shape index replacements (:3459–3555).
15. `partBoneSetsBlock` — `[size u32]` then per-mesh `0..boneCount-1` shorts
    (:3564–3585).
16. `neckMorphDataBlock` — preserved+remapped or empty (:3592–3649).
17. `unknownPatch72DataBlock` — **empty** (Patch 7.2 dropped, :3656).
18. `paddingDataBlock` — `ogMdl.PaddingSize` byte + `PaddedBytes` (:3663–3666).
19. `boundingBoxDataBlock` — 4 model boxes (2 real, 2 zero) + per-bone cubes
    + optional furniture part boxes (:3673–3772).

**Header** (68 B, Mdl.cs:3916–3961): `version(6)`, `256`, `vertexInfoBlock.Count`,
`modelDataBlock.Count`, `meshCount`, materialCount, then vertex-buffer offsets (LoD0
real, LoD1/2 = end-of-index), index-buffer offsets, vertex-buffer sizes (LoD0 real,
rest 0), index-buffer sizes (LoD0 real, rest 0), `lodCount=1`, `flags=0x01`, 2 pad
bytes. A self-check at :3908 asserts `combinedDataBlockSize` matches, else throws.

`vertexInfoBlock` (Mdl.cs:2594–2767): per mesh, a stream of 8-byte element descriptors
`[block][offset][type][usage][count][3 pad]`, `0xFF` end flag, zero-padded so each
mesh occupies exactly `_VertexDataHeaderSize` (136) bytes.

**Opaque-vs-recomputed summary:** recomputed = header, vertexInfo, model-data struct,
LoD/mesh/part headers, bone sets, bounding boxes, all offset tables, all geometry.
Copied opaque from `ogMdl` = UnkData0/1/2, ExtraPathList strings, padding bytes,
LoD0 Unknown6/7, and the handful of `ModelData` scalar flags in §2.3.

---

## 5. Minimal operation set — structural slice vs. re-encode (Q5)

**Verdict: it genuinely requires parsing and re-emitting the vertex/index buffers. It
is NOT expressible as structural slicing of LoD0's byte ranges.** Reasons:

1. **Vertex re-weld reorders/dedupes vertices per part** (ModelModifiers.cs:436–440,
   sorted unique IDs). The output vertex buffer is not a substring of the input.
2. **Precision upgrade changes vertex formats** Half→Float for position/normal/UV
   (Mdl.cs:2620/2643/2689). Per-vertex stride and byte content change; a copy is
   impossible.
3. **Vertex declarations are regenerated** from `GetUsageInfo` (Mdl.cs:2594+), so the
   136-byte vertex-info block differs from the source even structurally.
4. **Index buffers are re-emitted** against remapped IDs with fresh 16-byte padding
   (Mdl.cs:4012–4017, 2819).

The good news for feasibility: the re-encode is **deterministic and effectively
lossless** for the game formats (Half decode is exact; all byte-normalized fields
round-trip to themselves; binormals/handedness/colors/weights are preserved bit-exact
per §2.5). So a faithful port that (a) decodes LoD0 vertices exactly like
`MdlVertexReader`, (b) reproduces the per-part weld/sort, (c) rebuilds declarations
from the same usage logic, and (d) re-emits with the same Half→Float widening and the
same `Math.Round` byte quantizers, will match the golden. The remaining precision risk
is confined to the IEEE-754 half↔float conversion and any float32 rounding in radius /
bounding-box computation (see Risks).

Minimal (but still full-fidelity) operation sequence:
1. `GetXivMdl` parse (header, ModelData, all sections, LoD0 `MeshData` incl. decoded
   `VertexData`).
2. Build TTModel LoD0 only: per mesh → per part → unique-sorted vertex set → `TTVertex`
   list; remap indices; per-mesh bone name list; attributes/materials/shapes/flags.
3. Serialize per §4: rebuild declarations, re-encode geometry (precision upgrade),
   recompute all headers/offsets/counts, v6 bone sets, bounding boxes; copy the opaque
   `ogMdl` sub-blocks; emit `lodCount=1`, `version=6`.

---

## 6. Scope assessment — reuse vs. new work (Q6)

### What we can reuse from `src/mdl`
- **Framing only.** `src/mdl/parse.ts` + `types.ts` already split the file into header +
  `MdlModelData` fields + ~20 **opaque** section slices + one opaque `geometry` blob.
  That is enough to *locate* blocks and to copy the opaque sub-blocks (§2.4), and the
  `MdlModelData` read/write is directly reusable.
- `src/mdl/serialize.ts` (byte-exact replay) is useful as the "copy opaque section"
  primitive but cannot produce a normalized file — it only replays what it parsed.

### What is genuinely new (the bulk of the work)
1. **Vertex-declaration parser** — decode the 136-byte per-mesh vertex-info block into
   `{block, offset, type, usage, count}` elements (currently opaque `vertexInfo`).
2. **Geometry decoder** — port `MdlVertexReader` (positions/normals/binormals/flow/
   colors×2/UV0-2/weights/indices), block0/block1 stream walk, Half decode, byte
   normalizations. Currently `geometry` is fully opaque — this is net-new.
3. **Per-LoD/mesh/part offset & size model** — we need LoD0's vertex/index offsets and
   sizes and per-mesh/part index ranges to drive the weld. Not currently parsed.
4. **TTModel-equivalent** — mesh/part/vertex containers, weld/sort, bone-name sets,
   attribute bitmasks, shape parts, material index mapping.
5. **Serializer** — port `MakeUncompressedMdlFile` end to end (§4): declaration
   rebuild, `WriteVertex` encoders (Half→Float widen, `ConvertVectorBinormalToBytes`
   rounding, color/weight quantizers), v6 bone sets (`Getv6BoneSet`), bounding-box math,
   all offset/count recomputation, header assembly, the `combinedDataBlockSize` check.
6. **Gate** — only apply to `chara/*.mdl` when the pack is TTMP major < 2 (mirror
   `DoesModpackNeedFix`). PMP packs do **not** get `FixOldModel` (no such call exists in
   `PMP.cs`); their models only see `FastMdlv6Upgrade`. Match the source's gating or we
   will diverge on PMP model files.

### Open questions / risks
- **R1 — where does `version` actually become 6?** Output version is
  `ttModel.MdlVersion` (Mdl.cs:2490), set by `FromRaw` from the *source* MDL
  (TTModel.cs:2720). A v5 source would then re-serialize as **v5** unless something
  bumps it. Yet goldens are v6. Trace who sets `MdlVersion=6` before/inside
  `MakeUncompressedMdlFile` for the FixOldModel path (candidate: an unread step in
  `FromRaw`/`MergeFlags`, or a default). **Verify empirically** that the FixOldModel
  output is v6 with v6 bone sets — I did not find the explicit bump and flag it as the
  single most important thing to confirm before coding. (Note the §2.2 bone-set branch
  keys on `mdlVersion >= 6`; if version stayed 5 the bone sets would be the 128-byte v5
  layout — a good discriminator when testing.)
- **R2 — tangent recompute path.** If any LoD0 mesh lacks binormals, `FromRaw` runs the
  full `CalculateTangentsForMesh` welded computation (ModelModifiers.cs:2140+), which is
  large and float-sensitive. Confirm corpus models all carry binormals (they should),
  so we can implement only the "binormals present → keep binormal" path initially.
- **R3 — Half↔Float bit-exactness.** Position/Normal/UV output = SharpDX `Half`→`float`
  widening. Must reproduce binary16→binary32 (incl. subnormals/NaN→0 clamp at
  MdlVertexReader.cs:195-200) exactly. Low algorithmic risk, high "get-a-bit-wrong" risk.
- **R4 — float32 accumulation order** in radius (`absVect.Length()`, Mdl.cs:2587) and
  bounding boxes must use `Math.Fround`-style single precision and the same min/max
  scan order (Mdl.cs:2562–2581) to match the 4 model-box + per-bone-cube floats.
- **R5 — weld determinism details.** `fakePart` handling for boneless/no-boneset meshes
  (ModelModifiers.cs:416–420), NaN UV2 handling (:505+, not fully read), and
  Colors2/flow presence gating. Read the remainder of `MergeGeometryData`
  (ModelModifiers.cs:500–575) before implementing.
- **R6 — `WriteVertex` full body** (Mdl.cs:4081+, `WriteVectorData` etc.) not read to
  completion here; port it verbatim including handedness/wDefault handling and the
  8-byte weight "low→high" interleave (mirror of MdlVertexReader.cs:117–128).
- **R7 — the "2-byte smaller modelDataSize" on an already-1-LoD/2-mesh model** is fully
  consistent with this re-serialize (bone-set/padding/offset recomputation), i.e. even
  no-collapse models are re-emitted, not byte-copied. Expect *every* `chara` model in a
  <2.0 pack to change, and budget parity work accordingly.
