# Sub-project 3a — MDL Geometry Codec — Design

**Date:** 2026-07-06
**Status:** Design signed off; ready for an implementation plan.
**Parent:** `2026-07-06-model-round-design.md` (the model-round master/decomposition
design; this is **sub-project A**). Roadmap row 3a in
`2026-06-30-dawntrail-modpack-upgrader-design.md` §8.
**Research:** `2026-07-06-model-normalizer-research.md` — the authoritative source
map. §3 (`MdlVertexReader` read shape), §4 (`vertexInfoBlock` / `WriteVertex`
encoders), §5 (why it is a genuine re-encode), §6 + risks R3/R4/R6 are the input.
**Reference (read-only, gitignored):** `reference/xivModdingFramework/xivModdingFramework/`
— chiefly `Models/FileTypes/Mdl.cs`, `Models/FileTypes/MdlVertexReader.cs`,
`Models/Helpers/ModelModifiers.cs`, `Models/DataContainers/TTModel.cs`.

---

## 0. One-paragraph summary

A standalone **MDL geometry codec**: give structure to the two blobs the current
`src/mdl` carries opaquely (`vertexInfo`, `geometry`). Parse/serialize the
136-byte-per-mesh **vertex declaration**; **decode** a mesh's vertex + index buffers
(verbatim `MdlVertexReader`); **encode** them back (declaration-driven, over verbatim
`WriteVertex` per-element encoders — byte-identical to `WriteVertex` on a canonical
declaration); expose
the per-LoD/mesh/part **offset & size** model needed to locate geometry. Verified in
isolation by a **byte-exact decode→encode round-trip** on real corpus geometry — no
full normalizer, no oracle for the primary gate. This de-risks the precision-sensitive
core (R3/R4/R6) before sub-project B builds the weld + `MakeUncompressedMdlFile`.

## 1. Scope

### In
- **Vertex-declaration codec** — parse/serialize the 136-byte-per-mesh vertex-info
  block ↔ structured `VertexElement[]` (`{stream, offset, type, usage, count}`).
- **Geometry decoder** — port `MdlVertexReader.ReadVertexData`: decode a mesh's vertex
  buffer (positions, normals, binormals+handedness, flow+handedness, colors×2, UV0–2,
  bone weights, bone indices) and index buffer, honoring the block0/block1 stream walk,
  Half decode, and the byte normalizations.
- **Geometry encoder** — port `WriteVertex`/`WriteVectorData`/`ConvertVectorBinormalToBytes`:
  re-emit stream0/stream1 vertex bytes from structured vertices against a **given target
  declaration** (Half *and* Float output paths), plus indices re-emitted with the
  16-byte block padding.
- **Geometry-offsets model** — structured per-LoD/mesh/part vertex & index offsets and
  sizes, and per-part index ranges (enough to locate LoD0 for B's weld).

### Not in (deferred to sub-project B — the model normalizer)
The LoD0 weld/sort/dedupe, the declaration *rebuild from usage*
(`GetUsageInfo`/`AddVertexHeader`), `MakeUncompressedMdlFile` whole-file serialization,
LoD-collapse, v6 bone sets / bounding boxes, the TTMP-major-<2 gate, and the
`upgrade.ts` wiring. A parses/serializes an **existing** declaration and
decodes/encodes against a **given** declaration; it never invents declarations.

## 2. Architecture — additive layer over `XivMdl`

A adds a new directory `src/mdl/geometry/` and **does not modify** `parse.ts` /
`serialize.ts` / `types.ts`. `XivMdl` keeps carrying `vertexInfo` and `geometry` as
opaque blobs, and the existing byte-exact `serializeMdl(parseMdl(x)) === x` corpus
check (`test/helpers/corpus-mdl.ts`) stays green by construction. A's functions *read*
those blobs (plus the already-sliced opaque LoD/mesh/part sections) and produce
structured views; the geometry-offsets model reads the existing opaque section slices
rather than re-slicing the file.

Every decode function is a verbatim transcription of its `MdlVertexReader` counterpart.
The per-element **byte encoders** (Half widen, `ConvertVectorBinormalToBytes`, the weight
low→high interleave, color/weight quantizers) are verbatim `WriteVectorData`/`WriteVertex`
transcriptions; the encoder's top level is **declaration-driven** — it iterates the target
declaration's elements in sorted-offset order and dispatches each to its per-element
encoder, rather than replaying `WriteVertex`'s hardcoded field sequence (§5 explains why
this is a strict generalization that still reproduces `WriteVertex` byte-for-byte).
Faithfulness over cleverness for the precision-sensitive core (kickoff mandate; R6).

### Modules

| File | Purpose | C# origin |
|---|---|---|
| `src/mdl/geometry/format.ts` | `VertexUsageType` / `VertexDataType` enums (numeric value = wire byte) + `dataTypeSize()` | `VertexUsageType.cs`, `VertexDataType.cs`, `VertexTypeDictionary`/`VertexUsageDictionary` (`Mdl.cs:5365-5396`) |
| `src/mdl/geometry/declaration.ts` | parse/serialize 136-byte-per-mesh block ↔ `VertexElement[]` | `Mdl.cs:562-600` (parse) / `2735-2763` (serialize) |
| `src/mdl/geometry/offsets.ts` | per-LoD/mesh/part vertex+index offset & size accessors | LoD (60 B) / mesh (36 B) / part (16 B) header layout |
| `src/mdl/geometry/vertex-data.ts` | SoA `VertexData`, AoS `TtVertex`, identity `transpose()` | `VertexData`, `TTVertex` (`TTModel.cs:86-110`) |
| `src/mdl/geometry/decode.ts` | `decodeVertexData(...) → VertexData`; `decodeIndices(...) → number[]` | `MdlVertexReader.ReadVertexData` / `ReadData` / `Read*` |
| `src/mdl/geometry/encode.ts` | `encodeVertexData(TtVertex[], VertexElement[]) → {stream0, stream1}`; `encodeIndices(number[]) → Uint8Array` | `Mdl.cs:4164 WriteVertex`, `4081/4121 WriteVectorData`, `4032 ConvertVectorBinormalToBytes` |

Plus one addition to `src/util/float16.ts`: **`halfToFloat(raw: number): number`**, the
exact reverse of the existing `floatToHalf`. Half→float is exact and
implementation-independent, so it carries no parity risk (see R3).

## 3. Data model

### 3.1 Wire enums (`format.ts`)
The stored type/usage bytes equal the enum numeric values, so no translation table is
needed beyond the enums themselves:

- `VertexDataType`: `Float2=0x1, Float3=0x2, Float4=0x3, Ubyte4=0x5, Ubyte4n=0x8,
  Half2=0xD, Half4=0xE, UByte8=0x11`. `dataTypeSize` in bytes:
  `Float2=8, Float3=12, Float4=16, Ubyte4=4, Ubyte4n=4, Half2=4, Half4=8, UByte8=8`.
- `VertexUsageType`: `Position=0x0, BoneWeight=0x1, BoneIndex=0x2, Normal=0x3,
  TextureCoordinate=0x4, Flow=0x5, Binormal=0x6, Color=0x7`.

### 3.2 `VertexElement` (`declaration.ts`)
`{ stream: number; offset: number; type: VertexDataType; usage: VertexUsageType; count: number }`.
A mesh declaration is `VertexElement[]`. The 136-byte on-wire form per mesh is a run of
8-byte descriptors `[stream u8][offset u8][type u8][usage u8][count u8][3× 0 pad]`,
terminated by a `0xFF` byte, then zero-padded so the mesh occupies exactly 136 bytes
(`VERTEX_DATA_HEADER`). Parse asserts the 3 padding bytes are zero (`Mdl.cs:574-577`).

### 3.3 SoA `VertexData` (`vertex-data.ts`, decoder output — mirrors `VertexData`)
Parallel arrays, appended per vertex exactly as `ReadData` does:
`positions: Vec3[]`, `normals: Vec3[]`, `biNormals: Vec3[]`, `biNormalHandedness: number[]`,
`flowDirections: Vec3[]`, `flowHandedness: number[]`, `colors: Rgba[]`, `colors2: Rgba[]`,
`textureCoordinates0: Vec2[]`, `textureCoordinates1: Vec2[]`, `textureCoordinates2: Vec2[]`,
`boneWeights: number[][]` (each `b/255`), `boneIndices: number[][]` (raw bytes),
`indices: number[]`. (`Vec2/Vec3` are plain number tuples; `Rgba` a 4-byte tuple.)

### 3.4 AoS `TtVertex` (`vertex-data.ts`, encoder input — mirrors `TTVertex`)
`{ position: Vec3; normal: Vec3; binormal: Vec3; handedness: boolean;
flowDirection: Vec3; vertexColor: Rgba; vertexColor2: Rgba; uv1/uv2/uv3: Vec2;
boneIds: Uint8Array(8); weights: Uint8Array(8) }`. Weights/bone-ids are **bytes**
(as in `TTVertex`), sized 8; only 4 or 8 are consumed per the `BoneIndex` type.

## 4. Decode — verbatim `ReadVertexData` (`decode.ts`)

Input: the mesh's stream0/stream1/index byte ranges (from §7), its `VertexElement[]`,
and `vertexCount`/`indexCount`. Steps (`MdlVertexReader.cs:16-61`):

1. Split elements into `block0` (stream 0) and `block1` (stream 1), each **sorted by
   `offset`** (`ReadVertexData:27-28`).
2. For `i` in `0..vertexCount`: for each block0 element in order, `readData` from a
   cursor over stream0. Assert the cursor consumes exactly `vertexCount ·
   entrySize0` bytes (`:39-40`). Repeat for block1/stream1 (`:42-52`).
3. Indices: read `indexCount` u16 (`:54-58`).

`readData` dispatch by usage (`ReadData:63-110`), each a verbatim port:
- **TextureCoordinate** → `readDoubleVector`; `count==0` fills UV0 (+UV1 for the 2nd
  vector of Half4/Float4), `count!=0` fills UV2. (`ReadDoubleVector:224-273`.)
- **Binormal** / **Flow** → `readByteVector`: `x/y/z = b·2/255−1`, `w` = handedness
  byte (`ReadByteVector:204-212`).
- **Normal** / **Position** → `readVector3`: Half4 reads 4 halves keeps xyz, else 3
  singles; **NaN/Inf on any component → `(0,0,0)`** (`ReadVector3:173-201`).
- **Color** → 4 raw bytes; `count==0` → colors, else colors2 (`ReadColor:214-222`).
- **BoneWeight** → `readFloatArray`: 4 or 8 bytes → `b/255` floats; **UByte8 uses the
  low→high interleave** (`ReadFloatArray:113-144`).
- **BoneIndex** → `readByteArray`: 4 or 8 raw bytes; same UByte8 interleave
  (`ReadByteArray:146-171`).

Half decode uses the new `halfToFloat`; `readSingle` uses `readFloat32`; float32 values
are kept as JS numbers (they already are single-precision from the buffer).

## 5. Encode — verbatim `WriteVertex` (`encode.ts`)

Input: `TtVertex[]` and the **target** `VertexElement[]` (the *same* declaration for
A's round-trip; a rebuilt DT declaration when B calls it).

**Why declaration-driven, not a literal `WriteVertex` replay.** `WriteVertex`
(`Mdl.cs:4164-4300`) appends fields in a hardcoded sequence — stream0: Position, weights,
bone-ids; stream1: Normal, Binormal, Flow, Color(s), UV(s). That sequence *is* the SE
canonical layout, and it is byte-exact only against a declaration whose element offsets
follow that same order. A instead iterates the declaration's elements **in sorted-offset
order** and, per vertex, dispatches each element on `(usage, count, type)` to its
per-element byte encoder. Because a mesh only decodes when `ReadVertexData`'s assertion
holds (elements gap-free, sorted-offset order = physical order, sizes sum to the stream
entry size), writing elements in that order is **byte-exact by construction** for any
decodable source — with no hidden "source is laid out canonically" assumption. Given a
canonical declaration (SE source, or B's rebuilt one, where offset order = Position,
BoneWeight, BoneIndex | Normal, Binormal, Flow, Color…, UV…), this dispatch visits
elements in exactly `WriteVertex`'s order and emits **byte-identical** output — so B is
fully served. The `(usage, count)` pair disambiguates the doubled channels
(Color count 0 vs 1 → color/color2; TextureCoordinate count 0 vs 1 → uv0/uv1 vs uv2),
exactly as `ReadData` does on decode.

Per-element byte encoders (the R6 precision core), verbatim from `WriteVectorData`
(`:4121-4154`):
- **Half4** → `floatToHalf(x/y/z)` + a 4th half of `wDefault` (**1 for Position, 0 for
  Normal**; `:4135-4137`). *This regenerates W — see R-A1.*
- **Float3** → three float32 (the precision-upgraded path B uses; `:4141-4146`).
- **Ubyte4n** (binormal/flow) → `ConvertVectorBinormalToBytes`: per component
  `round((v+1)·255/2)` as a byte; handedness byte `0` if `handedness>0` else `255`
  (`:4032-4079`). Handedness passed as `−1` when `TtVertex.handedness` true, else `1`
  (`:4149`).
- UV Float2/Float4 → float32; Half2/Half4 → `floatToHalf` (`:4239-4275`).
- Color → 4 raw bytes (`:4217-4231`).
- BoneWeight / BoneIndex → raw bytes from `TtVertex.weights`/`.boneIds` (already
  quantized in the transpose, §6): **4 bytes for Ubyte4/Ubyte4n, 8 bytes with the
  low→high interleave for UByte8** (`WriteVertex:4173-4210`, mirror of
  `ReadFloatArray`/`ReadByteArray`).

`encodeIndices`: emit `indexCount` u16, then **zero-pad the block to a multiple of 16
bytes** (`Mdl.cs:2819`). A returns the encoded stream0, stream1, and padded index
bytes; assembling them into the whole-file vertex/index buffers at their offsets is B's
job (A's round-trip compares each stream against the corresponding source slice).

## 6. The transpose seam — identity in A, weld in B (`vertex-data.ts`)

A ships `transpose(VertexData) → TtVertex[]`: a **straight, order-preserving copy** with
no dedup, no sort, no zero-weight skip. For each vertex `i` it copies every list's
`[i]` across, quantizing bone weights `round(w·255)` and copying bone-ids as bytes
(this is the only float→byte step, and it is exact because the decode was `b/255`).

This is deliberately **distinct** from B's weld (`MergeGeometryData`,
`ModelModifiers.cs:422-565`), which additionally: collects unique index-referenced
vertex ids and **sorts** them (reordering/dedup), **skips bone slots whose weight is 0**
(leaving them at the `TTVertex` default 0), and **NaN-clamps UV2/UV3 components to 0**.
Those are normalization behaviors that make B match the *golden*, not the *source*; A's
identity transpose omits them so the round-trip stays byte-exact against the source. The
seam is where TexTools puts the SoA→AoS flip, so B swaps the identity transpose for the
real weld with no change to decode or encode.

## 7. Geometry-offsets model (`offsets.ts`)

Parse just enough of the already-sliced opaque sections to locate geometry and drive
B's weld:

- **LoD headers** (`sections.lodHeaders`, 3 × 60 B): per LoD, `vertexDataOffset`,
  `indexDataOffset` (absolute file offsets), and the mesh index range. Enough to supply
  `lodVertexOffset`/`lodIndexOffset` to the decoder.
- **Mesh headers** (`sections.meshHeaders`, 36 B each): per mesh `vertexCount`,
  `indexCount`, `vertexDataOffset0/1`, `vertexDataEntrySize0/1`, `indexDataOffset`
  (in u16 units — the decoder multiplies by 2, `MdlVertexReader.cs:25`), `partOffset`,
  `partCount`.
- **Mesh-part headers** (`sections.meshParts`, 16 B each): per part `indexOffset`,
  `indexCount` — the per-part index ranges the weld consumes.

Read-only structured accessors; they do not change how `parseMdl` slices the file.

## 8. Verification gate

Two corpus checks registered alongside the existing codec checks
(`test/helpers/corpus-*.ts`, wired via `corpus-register.ts`), each iterating the corpus
packs' `.mdl` files decoded through the SQPack Type-3 codec (skipping the same
undecodable legacy models `corpus-mdl.ts` skips).

### 8.1 A1 — source round-trip (primary; no oracle)
For every decodable corpus `.mdl`, for **every mesh across all LoDs**:
`decode → transpose → encode`, and assert the re-emitted `stream0`, `stream1`, and
padded index bytes are **byte-identical** to the corresponding source slices. Proves:
Half decode/encode symmetry, the binormal quantizer round-trip, the 8-byte weight
low→high interleave, color/weight byte quantizers, and 16-byte index padding. Fully
self-contained — runs on a fresh clone with only the corpus, no ConsoleTools.

A1 passing **also** confirms the R-A1 assumption empirically: because encode regenerates
Half4 W as `Half(wDefault)`, byte-exactness proves SE stored W = wDefault
(1 position / 0 normal). Any pack that violates it fails loudly (the right outcome).

### 8.2 A2 — golden cross-check (secondary; uses the upgrade cache, skips if absent)
For each cached ConsoleTools `/upgrade` golden `.mdl` (Float-format, v6, normalized —
obtained via the existing `upgradeGoldenCached` path), run the same
`decode → transpose → encode` round-trip against the **golden's own** declaration and
assert byte-exact. This exercises the `Float3`/`Float2`/`Float4` decode+encode paths on
real normalized data, which the Half-format source models never touch. When no golden
cache and no oracle are available, the check **skips** rather than failing (unlike the
`upgrade` gate), so A stays runnable without TexTools.

Neither A1 nor A2 validates **absolute** Half→Float SharpDX parity (both are pure
decode/encode symmetry, and half→float→half is identity for any correct pair). That
absolute parity is exercised only by B's golden byte-parity gate; see R3.

## 9. Risks & edge cases

- **R-A1 — Half4 W regeneration (new).** Encode discards the source W and writes
  `Half(wDefault)`. A1 byte-exactness is therefore conditional on SE source always
  storing W = wDefault. Expected to hold across the corpus; confirmed the moment A1 is
  green. Moot for B (golden positions/normals are Float3, no W).
- **R3 — absolute Half↔Float parity (deferred to B).** `floatToHalf` (existing) claims
  .NET `System.Half` round-to-nearest-even; the reference uses **`SharpDX.Half`**.
  A does not depend on absolute parity (symmetry only). B's golden gate does — flag a
  targeted `floatToHalf` vs SharpDX parity spike/unit test for B. `halfToFloat` is exact
  and carries no such risk.
- **R4 — float32 rounding.** No radius/bbox math in A (that is B). A's per-element math
  matches the reference's single-precision expectations; use `Math.fround` only where
  the C# intermediate is a `float` and it would otherwise widen.
- **R6 — `WriteVertex` verbatim.** The whole point of `encode.ts`; A1 is its gate,
  including the weight low→high interleave.
- **NaN/Inf inputs.** Decode faithfully applies `ReadVector3`'s position/normal
  NaN/Inf→0 clamp; UV decode has no clamp. A source with a NaN/Inf **position/normal**,
  or a NaN **UV** whose bit pattern differs from `floatToHalf`'s canonical NaN, would
  not round-trip — expected absent in clean SE data, and A1 surfaces it loudly if
  present (then documented as a skip/finding, not silently tolerated).
- **Undecodable legacy models.** Skipped exactly as `corpus-mdl.ts` does (SQPack Type-3
  decode failure); counted and logged, never a silent pass.

## 10. Hand-off to sub-project B

B consumes A unchanged: the SoA `VertexData` (decoder output), the AoS `TtVertex` +
`encodeVertexData`/`encodeIndices` (encoder), the geometry-offsets model (to locate
LoD0 and per-part index ranges), and the `declaration.ts` serializer (to emit the
declaration it rebuilds). B replaces the identity `transpose` with `MergeGeometryData`,
adds the declaration *rebuild from usage*, `MakeUncompressedMdlFile`, LoD-collapse, v6,
the gate, and the `upgrade.ts` wiring — driving the `.mdl` golden ratchet (453 → 0).

## 11. Out of scope

Everything in §1 "Not in", plus: PMP model handling, the v5↔v6 bone-set /
bounding-box helpers (B, from the reference branch), and any change to the existing
`parseMdl`/`serializeMdl`/`XivMdl` byte-exact round-trip.
