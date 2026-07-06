# MTRL Codec — Design

**Date:** 2026-07-01
**Status:** Design approved (brainstorming complete) — ready for implementation planning
**Depends on:** Foundation + Container I/O (merged, PR #1) and SQPack Codec (merged, PR #2). Extends, does not modify, either layer.
**Parent spec:** `2026-06-30-dawntrail-modpack-upgrader-design.md` (§4 codecs, §6 confidence strategy).

---

## 1. Goal

Add a self-contained TypeScript module that **parses a raw uncompressed `.mtrl` (material) file into a
structured `XivMtrl` model and serializes it back to bytes** — a faithful port of
`Mtrl.GetXivMtrl(byte[])` and `Mtrl.XivMtrlToUncompressedMtrl` from
`reference/xivModdingFramework/xivModdingFramework/Materials/`.

This is the first *semantic* codec (the SQPack codec handled the compression wrapper; this handles the
file format inside it). It is a prerequisite for the Endwalker→Dawntrail material transform (a later
stage), which mutates the parsed model (colorset 512→2048 bytes, index-map path derivation, shader
constants) before reserializing.

### Scope (decided during brainstorming)

- **Round-trip codec only:** parse **and** serialize. **No EW→DT transform** in this stage — that is a
  separate later stage, mirroring the codec-only rhythm the SQPack stage followed.
- **Full semantic model, faithful to `XivMtrl` 1:1:** textures + samplers, UV-map strings, colorset
  strings, shader keys, shader constants (per-constant float arrays), material flags, additional data,
  colorset (Half rows), dye data (raw blob — see §3.1).
- **Correctness bar:** faithful port of the C# semantics, validated by byte-identical **self round-trip**
  — `serializeMtrl(parseMtrl(x)) === x` — over real corpus `.mtrl` files. See §7.

### Out of scope

Any EW→DT material transform (index-map generation, shader-constant migration, colorset expansion);
semantic decoding of the dye bitfields into flag structs (kept as a raw blob — this is what `XivMtrl`
itself does); `.tex`/`.mdl` codecs; colorset-image export; texture-path validation/creation
(`ImportMtrl`'s file-existence checks — those depend on a game/transaction context we do not have).

---

## 2. Approach (chosen: standalone module, structure B)

A new self-contained unit at `src/mtrl/`, with **zero changes to the container, model, or SQPack layers**.
The proven byte-identical container round-trip and the SQPack codec stay frozen; readers/writers keep
passing inner files as opaque `Uint8Array`. Later transform stages compose the codecs on demand:
`decodeSqPackFile` → `parseMtrl` → transform → `serializeMtrl` → `encodeSqPackFile`.

**Module structure (approach B — model / parse / serialize split, with colorset + dye isolated).**
Chosen over a single-file port (A) and a model + combined-codec file (C) because the two genuinely
bit-exact sub-problems — colorset Half rows and the dye blob — become small, independently testable units,
and the fiddly round-trip reconstructions (string-block rebuild, sampler double-write) live in a focused
`serialize.ts` with their own synthetic tests. This matches the repo's established granularity
(`src/sqpack/` splits shared `blocks.ts` from per-type modules).

---

## 3. Reference source map (what we are porting)

The C# logic lives in `reference/xivModdingFramework/xivModdingFramework/Materials/`.

| Our module | C# source |
|---|---|
| `parseMtrl` | `Mtrl.GetXivMtrl(byte[] bytes, string internalMtrlPath)` (`Mtrl.cs:174`) |
| `serializeMtrl` | `Mtrl.XivMtrlToUncompressedMtrl(XivMtrl)` (`Mtrl.cs:556`) |
| `types.ts` model + computed sizes | `XivMtrl` + `MtrlTexture`/`MtrlString`/`ShaderKey`/`ShaderConstant`/`TextureSampler` (`XivMtrl.cs`) |
| `colorset.ts` | the `Half` list read/write inside `GetXivMtrl`/`XivMtrlToUncompressedMtrl` |
| `dye.ts` | `ColorSetDyeData` (`byte[]`) handling inside the same two methods |

**No upstream tests to port** (confirmed during the SQPack stage: the referenced xUnit/exChecker projects
are not committed). Our test suite is written fresh. Unlike SQPack's `/unwrap`, **ConsoleTools exposes no
command that runs a single `.mtrl` through parse→reserialize**, so there is no foreign oracle at this
layer — the corpus self round-trip plus synthetic units are the whole gate (§7).

---

## 3.1 Key format details (verified against the reference)

**Header (fixed).** signature (int32) · fileSize (u16) · colorSetDataSize (u16) · stringBlockSize (u16) ·
shaderNameOffset (u16) · texCount (byte) · mapCount (byte) · colorsetCount (byte) ·
additionalDataSize (byte).

**Offset/flag tables** (each entry `int16 offset` + `u16 flags`): textures, then UV maps, then colorsets.
Strings live in a block starting right after the tables; every offset is relative to that block start;
strings are null-terminated UTF-8. The shader-pack name is another string at `shaderNameOffset`.

**Colorset section** (present iff `colorSetDataSize > 0`): `colorDataSize = colorSetDataSize >= 2048 ?
2048 : 512`; read `colorDataSize / 2` half-floats. Trailing dye blob: if
`colorSetDataSize == colorDataSize + 32` → **Endwalker** dye (32 bytes); if `== colorDataSize + 128` →
**Dawntrail** dye (128 bytes); otherwise no dye. On write, `colorSetDataSize` is **recomputed** as
`colorSetData.length * 2 + dye.length` — the model stores the data, not the size.

**Dye data is kept as a raw `Uint8Array`, matching `XivMtrl.ColorSetDyeData` (a `byte[]`) exactly.** The
reference does *not* unpack the dye bitfields into a struct; neither do we. `dye.ts` carries the blob
verbatim and validates its length (0, 32, or 128).

**Shader block:** shaderConstantsDataSize (u16) · shaderKeyCount (u16) · shaderConstantsCount (u16) ·
textureSamplerCount (u16) · materialFlags (u16) · materialFlags2 (u16) · then shaderKeys
(`u32 id, u32 value` each) · shaderConstant descriptors (`u32 id, int16 offset, int16 size` each) ·
the sampler section · the shader-constant float data block. Each constant's floats are sliced from the
data block at `[offset, offset+size)`; on write, offsets are **recomputed sequentially**
(`offset += values.length * 4`) and the block is zero-padded to `shaderConstantsDataSize` if short.

**Computed getters (derived, never stored):** `colorSetDataSize`, `shaderConstantsDataSize`
(`Σ values.length * 4`), `shaderKeyCount`, `shaderConstantsCount`, and `getRealSamplerCount()` (§5).

---

## 4. Public API

```ts
// src/mtrl/mtrl.ts
export function parseMtrl(bytes: Uint8Array, mtrlPath?: string): XivMtrl;   // ~ Mtrl.GetXivMtrl(byte[])
export function serializeMtrl(mtrl: XivMtrl): Uint8Array;                    // ~ Mtrl.XivMtrlToUncompressedMtrl
export type { XivMtrl, MtrlTexture, MtrlString, ShaderKey, ShaderConstant, TextureSampler };
```

`src/index.ts` re-exports these alongside the existing container/SQPack API. `mtrlPath` is carried on the
model (`XivMtrl.mtrlPath`) for later transform use; it does not affect the byte output.

### Data model (`types.ts`) — mirrors `XivMtrl`

- `XivMtrl`: `signature: number`, `shaderPackRaw: string`, `additionalData: Uint8Array`,
  `textures: MtrlTexture[]`, `uvMapStrings: MtrlString[]`, `colorsetStrings: MtrlString[]`,
  `colorSetData: number[]` (raw half-float uint16s = `Half.RawValue`; byte-exact),
  `colorSetDyeData: Uint8Array`, `shaderKeys: ShaderKey[]`, `shaderConstants: ShaderConstant[]`,
  `materialFlags: number`, `materialFlags2: number`, `mtrlPath: string`.
- `MtrlTexture { texturePath: string; flags: number; sampler?: TextureSampler }`
- `MtrlString { value: string; flags: number }`
- `ShaderKey { keyId: number; value: number }`
- `ShaderConstant { constantId: number; values: number[] }`  (float32 values)
- `TextureSampler { samplerIdRaw: number; samplerSettingsRaw: number }`
- Computed helpers: `colorSetDataSize(m)`, `shaderConstantsDataSize(m)`, `getRealSamplerCount(m)`, etc.
- `EMPTY_SAMPLER_PREFIX` constant — the placeholder `texturePath` prefix for fake textures that only
  hold an empty (index-255) sampler.

Sampler-id semantics (`ESamplerId`) are only needed as **numeric constants** for the double-write
decision (ColorMap0/Spec0/Normal0 → …Map1). We port just those constants, not the full enum/tiling model.

---

## 5. Round-trip-sensitive reconstructions (where byte-exactness is earned)

These are the direct analogues of the SQPack Type-3 risk: parse deliberately drops/normalizes some data
that serialize must regenerate deterministically. Byte-exactness holds because SE/TexTools author files in
the canonical form these reconstructions produce.

1. **String-block rebuild.** Parse resolves strings by offset (which could, in principle, be shared or
   reordered). Serialize emits them fresh in fixed order — texture paths → UV-map strings → colorset
   strings → shader-pack name — each null-terminated, then pads the block to a multiple of 4.
   `stringBlockSize` and `shaderNameOffset` are backfilled. Byte-exact for canonical inputs; a
   reordered/deduped/differently-padded input normalizes (triage, §7).

2. **Sampler double-write.** Parse reads the sampler section sequentially, mapping each sampler to its
   `textureIndex`; when a texture already holds a sampler, a ColorMap0/Spec0/Normal0 **replaces** it and
   any other **is skipped** — so the secondary ColorMap1/Spec1/Normal1 that SE double-writes for 2-UV
   materials is *dropped on parse*. Samplers with index 255 create a fake placeholder texture
   (`EMPTY_SAMPLER_PREFIX + id`). Serialize reverses this: it writes each texture's sampler, and when
   `uvMapStrings.length > 1` and the sampler is ColorMap0/Spec0/Normal0 it **regenerates** the secondary
   (…Map1) — unless another texture already carries that secondary. `textureSamplerCount` in the header is
   `getRealSamplerCount()`, which counts the doubled samplers. Placeholder textures are excluded from the
   texture count and string block but write their sampler with index 255.

3. **Normalizations faithful to C#.** Texture paths are lowercased on write. `additionalData[0]` bit
   `0x08` is set when dye data is present and cleared when absent. Shader-constant offsets are recomputed
   sequentially and the value block is zero-padded to `shaderConstantsDataSize` if short.

---

## 6. Intentional deviations from the C# reference

1. **Model / parse / serialize split with colorset + dye isolated** (structure B). C# keeps everything in
   `Mtrl.cs` + `XivMtrl.cs`. *Rationale:* the bit-exact sub-problems get focused, oracle-free tests; the
   round-trip reconstructions are easier to reason about in a dedicated `serialize.ts`.
2. **Computed sizes as free functions, not throwing setters.** C# exposes `ColorSetDataSize` /
   `ShaderConstantsDataSize` as getters whose setters throw. We expose them as pure helper functions over
   the model. *Rationale:* idiomatic TS; same derived values, no dead setter surface.
3. **Sampler-id modelled as numeric constants, not the full `ESamplerId`/tiling enum.** *Rationale:* only
   the double-write decision needs sampler identity at this stage; the rest is transform-stage concern.
4. **Parse is strict, not repairing.** Where C# silently blanks a shader constant whose descriptor points
   past the data block, we match that tolerant behavior; but structurally impossible offsets (string
   offset outside the block, unrecognized colorset size) throw a clear `mtrl:`-prefixed error rather than
   producing silent garbage. *Rationale:* fail loudly on real corruption; the corpus round-trip is the
   safety net, and silent mis-parse would defeat it.

---

## 7. Testing / confidence strategy

Written TDD-style: synthetic units and the synthetic full-file round-trip are the failing tests written
first; the corpus self round-trip is the ground-truth gate. All corpus tests **skip gracefully** when the
corpus is absent (CI has none), following the harness pattern already in the repo.

1. **Synthetic unit tests (oracle-free, first).**
   - `colorset`: 256-row / 512-byte (EW) and 1024-row / 2048-byte (DT) read↔write byte-exact.
   - `dye`: EW 32-byte, DT 128-byte, and none — carried verbatim; wrong length rejected.
   - `samplers`: single-UV, double-UV (secondary regenerated on write, dropped on parse), and an
     index-255 empty sampler (fake placeholder texture round-trips).
   - `roundtrip`: a hand-built minimal but structurally valid `.mtrl` (header + one texture + one UV map +
     a colorset + a couple shader keys/constants) → `serializeMtrl(parseMtrl(x)) === x`.

2. **Corpus self round-trip (the real gate).** For every TTMP inner file across the corpus whose game path
   ends in `.mtrl`: `decodeSqPackFile(entry).data` → `parseMtrl` → `serializeMtrl`, assert byte-identical
   to the decoded input. Exercises real SE/TexTools materials (EW-format colorsets, real shader
   constants/keys, 1- and 2-UV samplers). Any non-identical file is reported in the test output and
   triaged: a legitimate C# normalization (lowercasing, string reorder, dye-flag toggle, sampler
   regeneration on a non-canonical input) is documented and accepted; anything else is a codec bug to fix.

3. **Bundled fixtures (optional, noted for the plan).** The framework ships
   `Resources/DefaultTextures/default_material.mtrl` (EW) and `default_material_dt.mtrl` (DT). Copying
   these small GPL-covered files into `test/mtrl/fixtures/` would seed one EW-format and one DT-format
   round-trip case that runs even without the corpus. Decide during planning.

Not in this stage: any `/resave` or `/upgrade` differential (those are transform-stage gates, compared on
decompressed content once the EW→DT material transform exists).

---

## 8. Edge cases & risks

- **Sampler double-write is the top risk** (§5.2) — the parse-drops/serialize-regenerates asymmetry must
  be exact. Mitigation: dedicated synthetic sampler tests + corpus round-trip over every real 2-UV mtrl.
- **String-block rebuild** (§5.1) — canonical order/padding must match SE. Mitigation: corpus round-trip;
  triage any reorder.
- **Shader-constant float bit-exactness.** We read/write IEEE-754 float32 (matching C#'s `float`). A
  signaling-NaN payload could theoretically canonicalize through `DataView.getFloat32/setFloat32`; this is
  vanishingly unlikely in real shader constants. If a corpus file exposes it, fall back to storing the raw
  4-byte value per element. Flagged, not pre-solved.
- **Colorset size not in {0, 512(+0/32/128), 2048(+0/32/128)}** — throw a clear error; do not guess.
- **`additionalData` length ≠ 4** — the model carries whatever `additionalDataSize` says; the `0x08`
  dye-flag toggle only touches byte 0, guarded on non-empty.

---

## 9. File structure (new)

```
src/mtrl/
  mtrl.ts        public API: parseMtrl / serializeMtrl + type re-exports
  types.ts       XivMtrl model + supporting types + computed-size helpers + EMPTY_SAMPLER_PREFIX
  parse.ts       parseMtrl(bytes, mtrlPath?)               (~ GetXivMtrl)
  serialize.ts   serializeMtrl(mtrl)                        (~ XivMtrlToUncompressedMtrl)
  colorset.ts    readColorset / writeColorset (Half rows, byte-exact)
  dye.ts         readDye / writeDye (raw blob, length-validated)
test/
  mtrl-colorset.test.ts   synthetic colorset units
  mtrl-dye.test.ts        synthetic dye units
  mtrl-samplers.test.ts   synthetic sampler double-write / empty-sampler units
  mtrl-roundtrip.test.ts  synthetic full-file round-trip
  mtrl-corpus.test.ts     corpus self round-trip (SQPack-decode .mtrl → parse → serialize); skips gracefully
```

`src/index.ts` re-exports the public API. Requires binary helpers already present from earlier stages
(`BinaryReader`, `ByteBuilder`, `concatBytes`); a null-terminated-UTF-8 string reader is added where the
codec needs it (small helper in `parse.ts` or `src/util/binary.ts`).
