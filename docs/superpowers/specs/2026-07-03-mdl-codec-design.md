# MDL Codec — Design

**Date:** 2026-07-03
**Status:** Design approved (brainstorming complete) — ready for implementation planning
**Depends on:** Foundation + Container I/O (PR #1), SQPack Codec incl. Type 3 model decode/encode
(PR #2), MTRL Codec (PR #3), TEX Codec (PR #5). Purely **additive** — the only edits outside
`src/mdl/` are `src/index.ts` re-exports and the test-corpus registration wiring (§7).
**Parent spec:** `2026-06-30-dawntrail-modpack-upgrader-design.md` (§4 codecs, §6 confidence strategy).

---

## 1. Goal

Add a self-contained TypeScript module at `src/mdl/` that:

1. **Parses a decompressed runtime `.mdl` file into a structured `XivMdl` model** via a faithful
   **structural walk** of the model-data block, and
2. **Serializes it back to byte-identical bytes** — a self round-trip that is the ground-truth gate
   (the mtrl/tex pattern), validated over the corpus.

The model exposes the fixed **`MdlModelData`** struct as editable fields and locates every
model-data section by structural offset, so the **deferred** Endwalker→Dawntrail model upgrade
(`FastMdlv6Upgrade`, §9) can be built cleanly on top in a later stage.

This is the model-format foundation. It is deliberately **not** the full geometry codec.

### Why this is a walker, not the full `Mdl.cs` codec (key brainstorming finding)

The reference's **modpack-upgrade** model path is `EndwalkerUpgrade.UpdateEndwalkerModel` →
`FastMdlv6Upgrade` (`EndwalkerUpgrade.cs:250/282`): a **targeted, size-preserving v5→v6 binary
patch** on a single decompressed model. It does **not** round-trip the model through
`Mdl.GetXivMdl` / `TTModel` / `MakeUncompressedMdlFile` (the ~4,500-line geometry codec — that path
is `FixOldModel`, used elsewhere, not on the upgrade path). To reproduce the upgrade we need only:

- a **structural walk** of the model-data block (to locate bone sets, shape data, bounding boxes),
- the fixed **`MdlModelData`** struct (`MdlModelData.cs`), and
- bounding-box read/write helpers (`Mdl.ReadBoundingBox` / `WriteBoundingBox`).

No vertex/index buffer decoding, no `TTModel`, no vertex-declaration interpretation. Geometry is
carried through as opaque bytes.

### Out of scope

- The **`FastMdlv6Upgrade` v5→v6 transform itself** — a later stage (§9). This stage builds and
  verifies the walker + serializer + `MdlModelData` struct only, exactly as the tex stage built the
  codec/decoder and deferred the texture transforms.
- The full **geometry codec**: `Mdl.GetXivMdl` semantic parse (vertex declarations, mesh/part
  geometry, shape vertex data), `TTModel` conversion, `MakeUncompressedMdlFile`.
- **Semantic parsing** of individual model-data sections beyond `MdlModelData` (bone indices, shape
  entries, attribute/material/bone path strings, LoD/mesh headers) — these are carried as named byte
  slices (§4); a later stage promotes any it needs to structured form.
- SQPack Type 3 compression/decompression (already owned by `src/sqpack/type3.ts`); `.mdl` DDS/FBX
  import/export; non-`.mdl` model formats.

---

## 2. Approach: a slice-based structural walk with a total-consumed assertion

The SQPack Type 3 layer (`src/sqpack/type3.ts`, `decodeSqPackFile`) already decompresses a `.mdl`
entry into the **uncompressed runtime `.mdl`** layout:

```
[68-byte MDL header] [vertexInfo block] [modelData block] [geometry: vertex/index buffers]
```

`parseMdl` operates on this decoded buffer (mirroring `parseTex`, which operates on the Type-4
decoded output). It:

1. Parses the **68-byte MDL header** into fields (`version`, `meshCount`, `lodCount`, `flags`, and
   the geometry offsets/sizes the header carries).
2. Carries the **vertexInfo block** (the per-mesh vertex-declaration headers,
   `_VertexDataHeaderSize · meshCount` = 136·meshCount bytes) as an opaque slice.
3. **Walks the modelData block**, computing each section's byte length from counts (from
   `MdlModelData`, `meshCount`, flags, and — for one section — the LoD0 header) and slicing it out.
   `MdlModelData` is the single section parsed into editable fields; the rest are **named byte
   slices**.
4. Carries any **trailing** bytes between the last named section and the geometry as an opaque slice
   (see below), then the **geometry** as an opaque slice.

**The correctness twist (why a slice walk is still a real gate — with one refinement from the corpus).**
A naive "slice everything, then concat" round-trips byte-exact *regardless of whether the section
boundaries are correct*, so it would validate nothing. To make the walk meaningful, the walker
**computes every section length structurally and asserts the running offset does not overrun the
modelData block** (`modelDataSize`, known from the header). Any bytes remaining between the last named
section (the bounding boxes) and `modelDataSize` are carried verbatim as an opaque **`trailing`**
slice. So the gate is:

- **Structural (no-overrun):** `Σ(named section lengths) ≤ modelDataSize` for every corpus model — an
  over-read (the failure mode a mis-sized section usually produces, via a garbage downstream count)
  throws loudly. For the **vast majority** of corpus models the sum lands *exactly* on
  `modelDataSize` (`trailing` is empty), so the named-section math is validated exactly on those.
- **Byte-exact:** `serializeMdl(parseMdl(x)) === x` for every corpus model (validates lossless
  replay, including `MdlModelData`'s Read/Write being exact inverses and the `trailing` slice).

**Why `trailing` exists (corpus finding).** The reference `GetXivMdl` does **not** require the
model-data sections to be contiguous with the geometry: it reads geometry via the LoD0
`VertexDataOffset` as an **absolute random-access offset** into the file (decoupled from the parse
stream position, `Mdl.cs:1048`), and includes corrective handling for misaligned files (`Mdl.cs:1000-1027`,
noting "certain penumbra MDLs, and very old TexTools MDLs"). Some real mods carry a trailing region the
reference never parses as a named section — empirically an extra `32·BoneCount`-byte per-bone
bounding-box block that an **older TexTools/Penumbra writer generation** appended (the current
framework writer no longer populates it — `boneBoundingBoxDataBlock` at `Mdl.cs:3906` is now dead) but
`GetXivMdl` reads past. `modelDataSize` (header) includes it; the geometry begins exactly at
`modelDataStart + modelDataSize`, so `trailing = [endOfBoundingBoxes, modelDataStart + modelDataSize)`
is captured opaquely and replayed. This mirrors tex's opaque mip tail: a small, deliberate opacity
where the reference itself is non-contiguous, in
exchange for unconditional byte-exact round-trip.

This mirrors the mtrl/tex philosophy: **the corpus self round-trip is the ground-truth, oracle-free
gate**, here backed by the no-overrun structural check and the exact-landing that holds for almost all
models.

The pre-Dawntrail corpus contains **v5** models (that is what the upgrade exists to fix) as well as
v6, so the gate exercises both bone-set encodings (§5).

---

## 3. Reference source map (what we are porting)

C# logic lives under `reference/xivModdingFramework/xivModdingFramework/Models/`.

| C# location | Role | Ported to |
|---|---|---|
| `FileTypes/Mdl.cs:83-84` `_MdlHeaderSize=0x44` / `_VertexDataHeaderSize=0x88` | Layout constants (68 / 136) | `src/mdl/types.ts` |
| `FileTypes/Mdl.cs:349-995` `GetXivMdl` (the model-data walk) | Section order + per-section sizes | `src/mdl/parse.ts` (structural walk) |
| `DataContainers/MdlModelData.cs` (`Read`/`Write` + flag enums) | Fixed model-data struct | `src/mdl/model-data.ts`, `src/mdl/types.ts` |
| `FileTypes/Mdl.cs:1190/1210` `ReadBoundingBox` / `WriteBoundingBox` | Bounding-box helpers (2×Vector4 = 32 B) | consumed as slices here; helpers land with the §9 transform |
| `FileTypes/Mdl.cs:741` (v6) + `:779-797` (v5) | **Version-dependent** bone-set block length (v6: `BoneSetSize·2 + BoneSetCount·4`; v5: fixed `132·BoneSetCount`) | `src/mdl/parse.ts` (§5) |
| `Mods/EndwalkerUpgrade.cs:282` `FastMdlv6Upgrade` | The v5→v6 transform | **Deferred** (§9) |

### The 68-byte MDL header (`Mdl.cs`, little-endian)

The fields this stage needs by offset (the remainder are carried verbatim):

| Offset | Field | Type | Use |
|---|---|---|---|
| 0  | Version | u16 | 5 vs ≥6 selects bone-set format (§5) |
| 4  | VertexInfoSize | u32 | length of the vertexInfo block (expected `== 136·MeshCount`) |
| 8  | ModelDataSize | u32 | length of the modelData block — the walk's total-consumed target (§2) |
| 12 | MeshCount | u16 | sizes vertexInfo (136·n) + several sections |
| 64 | LoDCount | u8 | informational; file always stores 3 LoD headers |
| 65 | Flags | u8 | — |

(These are the runtime-header fields `src/sqpack/type3.ts` reconstructs at those offsets; the walker
reads them and carries the remaining header bytes verbatim.) `_endOfVertexDataHeaders = 68 +
136·MeshCount` is where the modelData block begins; the vertexInfo block spans
`[68, _endOfVertexDataHeaders)` and equals `[68, 68 + VertexInfoSize)`. The modelData block spans
`[_endOfVertexDataHeaders, _endOfVertexDataHeaders + ModelDataSize)`; the walk must consume exactly
`ModelDataSize` bytes.

### The modelData block — full section order (from `GetXivMdl`)

Every length is count-driven. `md` = the parsed `MdlModelData`.

| # | Section | Length (bytes) | Source |
|---|---|---|---|
| 1  | pathData | `8 + PathBlockSize` (u32 PathCount, u32 PathBlockSize, then the string block) | `Mdl.cs:374-387` |
| 2  | **MdlModelData** (parsed) | fixed struct (`MdlModelData.Read`) | `Mdl.cs:~455` |
| 3  | elementIds | `32 · md.ElementIdCount` | `Mdl.cs:459` |
| 4  | lodHeaders | `60 · 3` (always 3 LoD) | `Mdl.cs:475-516` |
| 5  | extraMeshHeader | `120` **iff** `md.Flags2 & HasExtraMeshes`, else `0` (3 LoD × 10 types × 4 B; `LightShaft`..`Shadow` exclusive = ordinals 3..12) | `Mdl.cs:518-531` |
| 6  | meshHeaders | `36 · MeshCount` (header @12) | `Mdl.cs:~540-660` |
| 7  | attributeOffsets | `4 · md.AttributeCount` | `Mdl.cs:669` |
| 8  | terrainShadowMeshHeaders | `20 · N`, **N = LoD0 header's TerrainShadow mesh count** (see wrinkle below) | `Mdl.cs:682-686` |
| 9  | meshParts | `16 · md.MeshPartCount` | `Mdl.cs:~690` |
| 10 | terrainShadowParts | `12 · md.TerrainShadowPartCount` | `Mdl.cs:706` |
| 11 | materialOffsets | `4 · md.MaterialCount` | `Mdl.cs:~710` |
| 12 | boneOffsets | `4 · md.BoneCount` | `Mdl.cs:731-734` |
| 13 | boneSets | **version-dependent** (§5): v6 `md.BoneSetSize·2 + md.BoneSetCount·4`; v5 `132·md.BoneSetCount` | `Mdl.cs:741`/`:779-797` |
| 14 | shapeInfo | `(4 + 3·2 + 3·2) · md.ShapeCount` = `16 · md.ShapeCount` (name offset + 3 LoD u16 offsets + 3 LoD i16 counts) | `Mdl.cs:813-850` |
| 15 | shapeParts | `12 · md.ShapePartCount` | `Mdl.cs:853-863` |
| 16 | shapeData | `4 · md.ShapeDataCount` | `Mdl.cs:866-874` |
| 17 | partBoneSet | `4 + (BoneIndexCount)` — u32 length prefix, then `BoneIndexCount/2 · 2` bytes of indices | `Mdl.cs:896-909` |
| 18 | neckMorphTable | `32 · md.NeckMorphTableSize` (3f + u32 + 3f + 4 B) | `Mdl.cs:914-943` |
| 19 | patch72 | `16 · md.Patch72TableSize` | `Mdl.cs:948-951` |
| 20 | padding | `1 + PaddingSize` (u8 size, then that many bytes) | `Mdl.cs:957-958` |
| 21 | boundingBoxes | `32 · (4 + md.BoneCount + md.FurniturePartBoundingBoxCount)` (4 model + per-bone + furniture; 32 B each) | `Mdl.cs:969-994` |

After section 21 the running offset must **not exceed** `_endOfVertexDataHeaders + vertexInfoSize +
modelDataSize` (the start of geometry); any bytes up to it are carried as the opaque `trailing` slice
(§2). The walker asserts no-overrun.

**Wrinkle — section 8 is not purely `MdlModelData`-driven.** `GetXivMdl` sizes the terrain-shadow
mesh-header slice from the **LoD0 header's** TerrainShadow `(index,count)` range (`Mdl.cs:497-499`,
`684`), not directly from `md.TerrainShadowMeshCount`. So the walker peeks that u16 out of the
already-sliced `lodHeaders` (a fixed offset within LoD0's 60 bytes). The plan pins the exact offset;
the two values are expected to agree and the walker may cross-check them. For virtually all `chara`
models this count is 0 (the slice is empty); it is non-zero only for some `bg`/furniture models,
which the corpus round-trip will cover.

---

## 4. Module structure

Mirrors `src/mtrl/` and `src/tex/` (model / parse / serialize split, hard sub-problem isolated).

```
src/mdl/types.ts        XivMdl model; MdlModelData interface; flag enums (EMeshFlags1/2/3);
                        layout constants (MDL_HEADER=68, VERTEX_DATA_HEADER=136, LOD_HEADER=60,
                        MESH_HEADER=36, BOUNDING_BOX=32, …)
src/mdl/header.ts       parseMdlHeader / serializeMdlHeader (68 bytes, retained verbatim)
src/mdl/model-data.ts   parseMdlModelData / serializeMdlModelData (fixed struct; exact inverses)
src/mdl/parse.ts        parseMdl(bytes, filePath?) -> XivMdl  (the structural walk + consumed assert)
src/mdl/serialize.ts    serializeMdl(mdl) -> Uint8Array       (replay header + vInfo + sections + geometry)
src/mdl/mdl.ts          public API (parseMdl / serializeMdl + type re-exports)
src/index.ts            MODIFY: re-export the mdl public API

test/mdl/make-mdl.ts        hand-built minimal v5 + v6 .mdl byte builders
test/mdl/mdl-types.test.ts  MdlModelData round-trip + constants
test/mdl/mdl-parse.test.ts  parse of hand-built v5/v6 files: header fields, MdlModelData, section spans
test/mdl/mdl-roundtrip.test.ts  serializeMdl(parseMdl(x)) === x (synthetic) + index re-export
test/helpers/corpus-mdl.ts      registerMdlChecks(pack) — corpus self round-trip gate
test/helpers/corpus-units.ts    MODIFY: add "mdl" CheckKind + per-pack unit
test/helpers/corpus-register.ts MODIFY: dispatch "mdl" -> registerMdlChecks
```

### The `XivMdl` model (shape)

```
interface XivMdl {
  header: MdlHeader;              // 68-byte header fields (retained; serialized verbatim)
  vertexInfo: Uint8Array;         // opaque vertex-declaration headers (136 · meshCount)
  modelData: MdlModelData;        // parsed, editable (§ MdlModelData.cs)
  sections: {                     // named byte slices of the modelData block (order = §3 table)
    pathData; elementIds; lodHeaders; extraMeshHeader; meshHeaders; attributeOffsets;
    terrainShadowMeshHeaders; meshParts; terrainShadowParts; materialOffsets; boneOffsets;
    boneSets; shapeInfo; shapeParts; shapeData; partBoneSet; neckMorphTable; patch72;
    padding; boundingBoxes;       // each a Uint8Array
    trailing;                     // opaque bytes between boundingBoxes and geometry (usually empty; §2)
  };
  geometry: Uint8Array;           // opaque vertex + index buffers
  filePath?: string;              // carried for later transform use; does not affect bytes
}
```

`serializeMdl` concatenates: `header ++ vertexInfo ++ pathData ++ serialize(modelData) ++
elementIds ++ … ++ boundingBoxes ++ geometry`, in the §3 order.

---

## 5. Bone sets: the version-dependent section (the one real subtlety)

Bone-set **internal** encoding differs by MDL version (`Mdl.cs:743-797`):

- **v5:** each set is a fixed `64 × i16` bone-index array (128 B) followed by an `i32` count (4 B) —
  `132 · BoneSetCount` bytes.
- **v6:** a meta table of `BoneSetCount × (i16 offset, i16 count)` followed by variable-length
  bone-index arrays (each `count` i16, padded to a 4-byte boundary), zero-filled to the block end.

**This stage does not parse bone-set internals**, but the block length is **version-dependent** — it
is NOT the single `Mdl.cs:741` formula (an earlier draft of this spec wrongly assumed it was):

```
boneSetBlockLength = version >= 6
  ? md.BoneSetSize · 2 + md.BoneSetCount · 4     (v6; Mdl.cs:741)
  : 132 · md.BoneSetCount                        (v5; fixed 64×i16 + i32 per set, Mdl.cs:779-797)
```

**Why the `Mdl.cs:741` formula is v6-only (corpus-verified).** In real **v5** files `BoneSetSize` is
`0` (or otherwise ≠ `64·BoneSetCount`), so the formula collapses to `4·BoneSetCount` and drastically
under-reads. The C# v5 reader (`Mdl.cs:779-797`) never consults `BoneSetSize` — it reads a *fixed*
`BoneSetCount × (64 i16 + i32)` = `132·BoneSetCount` bytes; `totalBoneBlockSize` (`Mdl.cs:741`) is
computed but used **only** in the v6 branch. This is corroborated by `FastMdlv6Upgrade`, which *sets*
`BoneSetSize = 64·BoneSetCount` while upgrading — precisely because a v5 file does not already hold
that value. So the walker branches on `header.version`. The §9 transform (which must *re-encode* v5
sets into v6) is where per-set parsing lands.

`version` is still read from the header (offset 0) and retained, so the deferred transform and any
diagnostics can branch on it.

---

## 6. Serialize: lossless replay

`serializeMdl` replays the retained header, the opaque `vertexInfo`, the model-data sections in
order (`MdlModelData` re-serialized via its exact-inverse `Write`; all other sections replayed as
their retained slices), the opaque `trailing` slice, and the opaque `geometry`. Byte-exact for any
parsed input.

Because the sections plus `trailing` are contiguous non-overlapping slices covering the whole file
and `MdlModelData.Write` is the exact inverse of `Read`, `serializeMdl(parseMdl(x)) === x` holds
unconditionally for any model the walker accepts (i.e. any model whose named sections do not overrun
`modelDataSize`). Models the walker *rejects* (over-read) are surfaced loudly, not silently
normalized.

---

## 7. Correctness / testing strategy

TDD (parent spec §6), mirroring the tex gate. Corpus/fixture-optional tests skip gracefully when
inputs are absent, following the existing `corpusInputs()` / fileless Node-API corpus runner.

1. **Corpus self round-trip (the ground-truth gate).** Every `.mdl` inner file across the corpus:
   `decodeSqPackFile(entry) → parseMdl → serializeMdl`, assert **byte-identical** to the decoded
   input. Wired into the fileless corpus runner as a `registerMdlChecks(pack)` unit (the same
   mechanism as the mtrl/tex/sqpack corpus checks — `corpus-units.ts` + `corpus-register.ts`), not a
   standalone `skipIf` file. The parse's no-overrun assertion (`consumed ≤ modelDataSize`, remainder
   carried as `trailing`) runs inside this, so an over-read fails the pack loudly. Models whose SQPack
   Type-3 *decode* fails (the same handful of legacy files already undecodable) are the only skips; any
   decodable `.mdl` that is not byte-exact, or whose named sections overrun `modelDataSize`, is a codec
   bug.
2. **Synthetic parse/round-trip units (oracle-free, written first).** Hand-built **minimal v5 and v6**
   `.mdl` files (`test/mdl/make-mdl.ts`) with distinctive counts → assert header fields,
   `MdlModelData` fields, and each section's span; `serializeMdl(parseMdl(x)) === x`.
3. **`MdlModelData` unit.** `Read`/`Write` are exact inverses over a hand-built struct with
   distinctive field values.
4. **Optional extracted fixtures.** A couple of real `.mdl` files (one v5, one v6) for a corpus-free
   round-trip; skip if absent.

There is **no oracle diff in this stage** — that belongs to §9 (the transform is what the oracle
`/upgrade` changes; the walker is an identity and needs no oracle, exactly as the tex codec did not).

---

## 8. Layering / faithfulness note

The implied layering (mdl codec sits above the SQPack Type-3 layer, consuming its decoded output) is
faithful to the reference: `Mdl.GetXivMdl(byte[])` likewise parses the already-decompressed model.
This stage adds **no** non-additive edits — unlike the tex stage's one format-table dedup, there is
no shared table to reconcile (the Type-3 layer already reads the model header fields it needs
inline, and continues to). The only outside edits are `src/index.ts` re-exports and the three-line
corpus-runner wiring (§4).

---

## 9. Deferred: the Endwalker→Dawntrail model upgrade (`FastMdlv6Upgrade`)

A later stage adds the actual v5→v6 model fix (`EndwalkerUpgrade.cs:282`), built on this walker:

- read `version`; **no-op unless v5** (return input unchanged — most models);
- bail on boneless models (`BoneSetCount == 0 || BoneCount == 0`) — matching the reference's safety
  guard;
- set the version to 6 and LoD count to 1 **by writing into `header.bytes`** (version u16@0, lodCount
  u8@64 — the parsed `MdlHeader` scalar fields are read-only walk conveniences that `serializeMdlHeader`
  ignores), and set `modelData.LoDCount = 1`, `modelData.BoneSetSize = 64 · BoneSetCount` (these
  `MdlModelData` fields DO round-trip through `serializeMdlModelData`);
- **re-encode the `boneSets` section** from the v5 layout to the compact v6 layout (this is the one
  section that needs per-set parsing — deferred here precisely because the identity walker does not
  need it);
- overwrite the `boundingBoxes` section's per-bone boxes with the radius-derived box
  (`ReadBoundingBox`/`WriteBoundingBox`, `_Divisor = 20`).

`FastMdlv6Upgrade` is **size-preserving** (an in-place patch in the reference), so the transformed
model re-serializes through the same section machinery. Its correctness gate is the **oracle
`/upgrade` decompressed-content differential** already flagged as deferred in
`test/helpers/corpus-golden.ts` — this stage delivers the parse/serialize half that makes that diff
possible.

---

## 10. Environment / constraints

- **No new dependencies** (the walker is ported source; the SQPack Type-3 layer already handles
  compression).
- **Reference:** the existing gitignored `reference/xivModdingFramework` checkout (`Mdl.cs`,
  `MdlModelData.cs`, `EndwalkerUpgrade.cs`). GPL-3.0 → GPL-3.0 port; no per-file license/SPDX
  headers (licensing is carried repo-wide by LICENSE + NOTICE).
- **Extracted `.mdl` fixtures** (if added) are GPL-3.0 framework/game resources covered by the
  existing NOTICE attribution; keep the bundle minimal.
- TypeScript + Vitest; Windows + PowerShell; `npm`. All integers little-endian.
