# TEX Codec — Design

**Date:** 2026-07-03
**Status:** Design approved (brainstorming complete) — ready for implementation planning
**Depends on:** Foundation + Container I/O (merged, PR #1), SQPack Codec (merged, PR #2), MTRL Codec (merged, PR #3). Extends those layers; makes **one** small non-additive edit to `src/sqpack/type4.ts` (format-table dedup — see §8).
**Parent spec:** `2026-06-30-dawntrail-modpack-upgrader-design.md` (§4 codecs, §6 confidence strategy).

---

## 1. Goal

Add a self-contained TypeScript module at `src/tex/` that:

1. **Parses a raw uncompressed `.tex` file into a structured `XivTex` model and serializes it back to
   byte-identical bytes** — a faithful (but *lossless*, see §2) port of `XivTex.FromUncompressedTex` /
   `XivTex.ToUncompressedTex` and `Tex.TexHeader` / `Tex.CreateTexFileHeader`.
2. **Decodes texture pixel data to RGBA8888** — a hand-port of `DxtUtil` (BC1/3/4/5/7) plus the
   uncompressed-format unpacks in `DDS.ConvertPixelData`. This is the genuinely new capability: the
   ability to *read* the modpack's own normal / mask / diffuse textures as pixels.
3. **Encodes RGBA pixels to an uncompressed (`A8R8G8B8`) `.tex`, generates mipmaps, and resizes to
   power-of-two** — the pixel-write path the texture transforms will need.

This is the pixel-access foundation for the later Endwalker→Dawntrail **texture transforms**
(index-map generation from normals, hair maps, eye diffuse) — which are a **separate** stage. This
stage builds and verifies the codec + decoder + uncompressed writer only.

### Why the encoder is out of scope (key brainstorming finding)

Our golden oracle, **ConsoleTools, writes regenerated textures *uncompressed***. Every regenerated
texture is encoded at `FrameworkSettings.DefaultTextureFormat`, which defaults to `A8R8G8B8`. Only the
TexTools **GUI** raises it to BC7 (when the user ticks "compress upgrade textures"); ConsoleTools never
sets it, so it stays `A8R8G8B8`. The index-map code confirms this:
`format = DefaultTextureFormat == A8R8G8B8 ? A8R8G8B8 : BC5` (`EndwalkerUpgrade.cs:1105`).

Consequences:

- A lossy **BCn *encoder* (BC5/BC7)** is the one piece that could **never** match the oracle
  byte-for-byte (it is Nvtt-specific) — so it is unverifiable by golden diff and would need its own
  tolerance (PSNR/SSIM) harness. **It is not needed for oracle parity** and is deferred.
- A **BCn *decoder*** is deterministic and exactly matchable — and *is* needed (to read source pixels).
- **Uncompressed encode** (`RGBA → A8R8G8B8`) is trivial and byte-exact, and matches the oracle.

So "tex + BCn" is scoped to **tex codec + BCn decoder + uncompressed encode/mips** — dropping the
hardest, least-verifiable piece.

### Project-goal note (optimization / fidelity)

The end goal is an upgrader whose output is *no less optimized and no less fidelity than the original*.
This is preserved here: the **vast majority** of a modpack's textures are copied through untouched — the
container layer carries their already-compressed BC7/BC5 bytes verbatim (byte-exact, zero size/fidelity
loss). Only the small set of **regenerated** textures are affected by the encode-format choice. Matching
the oracle means those come out uncompressed (larger) for now; re-compressing them to native BC5/BC7 is a
later **optimization layer** (see §9) — deliberately deferred, with no commitment until we are
stress-testing the product.

### Out of scope

- The lossy **BCn encoder** (BC5/BC7) and its tolerance harness (§9).
- The EW→DT **texture transforms** (`CreateIndexFromNormal`, hair, eye, gear) — a later stage.
- **Exotic decode formats** with no current corpus consumer: `X8R8G8B8`, `R32F`, `G16R16F`,
  `G32R32F`, `A32B32G32R32F`, `D16` — added on demand (YAGNI), rejected with a clear error until then.
- DDS file I/O, PNG/TGA/BMP export, `.atex`/VFX specifics beyond what the format shares.

---

## 2. Approach: lossless model (an intentional improvement over C#)

**The correctness twist.** C# `XivTex.ToUncompressedTex` is deliberately **lossy at the header level**:
`FromUncompressedTex` keeps only `TextureFormat`, `Width`, `Height`, `Layers`, `MipCount`, and the raw
mip bytes; `ToUncompressedTex` then **regenerates** a *canonical* 80-byte header via
`CreateTexFileHeader`, dropping `Attributes`, `MipFlag`, `LoDMips[3]`, and the `MipMapOffsets[13]` table.
The reference even notes many real `.tex` files "were written with broken mipmap offsets, and extra data
at the end." A naive parse→serialize would therefore **not** round-trip byte-exact.

**Decision:** our `XivTex` model **retains all 80-byte header fields** (plus the full raw mip-data tail),
so `serializeTex` replays them verbatim → **byte-exact self round-trip over the whole corpus** (the
mtrl-style gate: strong, oracle-free). This is a deliberate divergence that *improves on* C#'s lossy
model — the same kind the mtrl port already made.

**Separately**, we expose a faithful `buildCanonicalTexHeader(format, width, height, mipCount)` — the
`CreateTexFileHeader` port — for **regenerated** textures (what the transforms and the uncompressed
writer emit). Pass-through textures never hit this path; they stay byte-exact at the container level.

The module is self-contained (mirroring `src/mtrl/`). Later transforms compose the pieces on demand:
`decodeSqPackFile → parseTex → decodeToRgba → (transform) → encodeUncompressedTex → encodeSqPackFile`.

**Two write paths (why retention does not distort the future oracle diff).** Bytes leave the codec two
ways, and they do not overlap: the **replay path** (`serializeTex(parseTex(x))`, which replays the
*retained* header — used for the round-trip gate) and the **canonical path**
(`buildCanonicalTexHeader`, the `CreateTexFileHeader` port — used for *regenerated* textures, which is
what we diff against the oracle). The retention decision only touches the replay path; the oracle
comparison runs through the canonical path. So retention has no direct bearing on the diff, and helps it
indirectly: (1) untouched textures bypass the model entirely (opaque container passthrough), so their
decompressed content — header included — matches regardless; (2) because `parseTex → serializeTex` is a
proven identity, any future oracle mismatch on a texture is attributable to a real transform/encode
difference, not to the codec silently normalizing a header; and (3) retention keeps **both** output
behaviours permanently reachable — if matching the oracle ever requires *preserving* an original header
we can replay it, and if it requires *canonicalizing* we already do (`buildCanonicalTexHeader`). Lossy
would have discarded the original header irrecoverably. The genuine oracle-match difficulty lives in the
canonical header port and Nvtt mip/encode parity (§6), which retention neither creates nor solves.

---

## 3. Reference source map (what we are porting)

C# logic lives under `reference/xivModdingFramework/xivModdingFramework/Textures/`.

| C# location | Role | Ported to |
|---|---|---|
| `Enums/XivTexFormat.cs` | Format enum + `GetBitsPerPixel` / `IsCompressedFormat` / `GetMipMinDimension` | `src/tex/types.ts` (single source — see §8) |
| `FileTypes/DDS.cs:380` `CalculateMipMapSizes` | Mip-chain size math | `src/tex/types.ts` `texMipSizes` (single source — see §8) |
| `FileTypes/Tex.cs:71` `TexHeader` (+ `ReadTexHeader` / `ToBytes`) | 80-byte header layout | `src/tex/header.ts` |
| `FileTypes/Tex.cs:1103` `CreateTexFileHeader` | Canonical header for regenerated tex | `src/tex/header.ts` `buildCanonicalTexHeader` |
| `DataContainers/XivTex.cs:94/148` `FromUncompressedTex` / `ToUncompressedTex` | Model ↔ bytes | `src/tex/parse.ts` / `src/tex/serialize.ts` |
| **`richgel999/bc7enc_rdo` (MIT/Unlicense)** — `rgbcx.h` (`unpack_bc1/3/4/5`) + `bc7decomp.cpp` (`unpack_bc7`) | BC1/3/4/5/7 block decode | `src/tex/decode.ts` (+ `src/tex/bc7.ts`) |
| `FileTypes/DDS.cs:453` `ConvertPixelData` (+ `SwapRBColors`, `Read4444/5551/8bit/HalfFloat`) | Uncompressed unpacks + decode dispatch | `src/tex/decode.ts` |

**Licensing note (found during planning).** The reference's `Helpers/DxtUtil.cs` (its DXT1/3/5 + BC4
decoders) carries an **Ms-PL** header (vendored FNA/MonoGame) — **GPL-incompatible per the FSF** — so we
do **not** transcribe it. The reference's BC5/BC7 decode delegates to **`JeremyAnsel.BcnSharp`**, which is
only a **native-DLL P/Invoke wrapper** (no readable C#) around **`richgel999/bc7enc_rdo`** — available under
the **MIT License OR the Unlicense (public domain)**, both **GPL-compatible**. We therefore port **all**
BCn *decoders* directly from **`bc7enc_rdo`** (`rgbcx.h` `unpack_bc1`/`unpack_bc3`/`unpack_bc4`/`unpack_bc5`;
`bc7decomp.cpp` `unpack_bc7`), retaining the MIT copyright notice in `NOTICE`. The block-decode
*algorithms* (565 unpack, 2-bit indices, RGTC/BPTC) are unpatented public standards regardless. The
**uncompressed** unpacks stay ported from GPL `DDS.cs` (GPL→GPL, no issue).

**The 80-byte `.tex` header** (`Tex.cs:71`, little-endian):

| Offset | Field | Type |
|---|---|---|
| 0  | Attributes    | u32 |
| 4  | TextureFormat | u32 |
| 8  | Width         | u16 |
| 10 | Height        | u16 |
| 12 | Depth         | u16 |
| 14 | MipCount (low nibble) / MipFlag (high nibble) | byte |
| 15 | ArraySize     | byte |
| 16 | LoDMips[3]    | u32 × 3 |
| 28 | MipMapOffsets[13] | u32 × 13 |

`Layers = ArraySize * Depth` (per `XivTex.cs:129`). Everything after byte 80 is the raw mip-data tail,
carried verbatim (this preserves any trailing "extra data" and guarantees the round-trip).

---

## 4. Module structure

Mirrors `src/mtrl/` (model / parse / serialize split, with the hard sub-problems isolated).

```
src/tex/types.ts       XivTex model; XivTexFormat constants; format helpers (bitsPerPixel / isCompressed
                       / minDimension); texMipSizes (= CalculateMipMapSizes) — SINGLE SOURCE (§8)
src/tex/header.ts      parseTexHeader / serializeTexHeader (full 80 bytes, lossless);
                       buildCanonicalTexHeader (CreateTexFileHeader port, for regenerated tex)
src/tex/parse.ts       parseTex(bytes, filePath?) -> XivTex        (~FromUncompressedTex, lossless)
src/tex/serialize.ts   serializeTex(tex) -> Uint8Array             (replays retained header; byte-exact)
src/tex/decode.ts      decodeToRgba(tex, layer?) : DxtUtil (BC1/3/4/5/7) + uncompressed unpacks -> RGBA8888
src/tex/encode.ts      encodeUncompressedTex(rgba, width, height, { mips? }) -> XivTex;
                       generateMipmaps(rgba, w, h) ; resizeToPowerOfTwo(rgba, w, h)
src/tex/tex.ts         public API (parse/serialize/decode/encode + type re-exports)
src/index.ts           MODIFY: re-export the tex public API
src/sqpack/type4.ts    MODIFY: import format tables + texMipSizes from src/tex/types (drop inline copies)

test/helpers/make-tex.ts    hand-built canonical .tex byte builders + known BC-block builders
test/tex-types.test.ts      format helpers + texMipSizes
test/tex-header.test.ts     full-header round-trip + canonical-header builder
test/tex-parse.test.ts      parse of hand-built canonical file
test/tex-roundtrip.test.ts  serializeTex(parseTex(x)) === x (synthetic) + index re-export
test/tex-decode.test.ts     known-block BCn decode + uncompressed unpacks -> exact RGBA
test/tex-mipmaps.test.ts    mip chain sizes/count/dims (tier-1) + isolated Nvtt-filter fixture (tier-2, §6)
test/tex-corpus.test.ts     corpus self round-trip (byte-exact); skips gracefully
test/tex-fixtures.test.ts   extracted .tex round-trip + decode smoke; skips if fixtures absent
```

---

## 5. Decode (the new capability)

Port the BCn decoders from **MIT `richgel999/bc7enc_rdo`** (`rgbcx.h` / `bc7decomp.cpp`; not FNA's Ms-PL `DxtUtil` — see the
licensing note in §3). Decode is deterministic, and a spec-conformant decoder **matches** any other
(including whatever the future index-map golden was produced with), so byte-exact parity is achievable.

- **BCn (block) formats:** `DXT1`, `DXT3`, `DXT5`, `BC4`, `BC5`, `BC7` → RGBA8888. BC7 lives in its own
  `src/tex/bc7.ts` (largest decoder; faithful port of `Bc7Sharp` / `bc7decomp`).
- **Uncompressed unpacks** (`DDS.ConvertPixelData`): `A8R8G8B8` (R/B swap), `A4R4G4B4`, `A1R5G5B5`,
  `L8`, `A8`, `A16B16G16R16F`.
- **Deferred formats** (§1 out-of-scope): reject with a clear `unsupported texture format` error until a
  corpus texture needs them.

Output byte order matches `ConvertPixelData` exactly (notably the `A8R8G8B8` R↔B swap), because the
downstream index/mask transforms read specific channels.

`decodeToRgba(tex, layer?)` decodes the **top mip** by default (that is what `GetRawPixels` /
`CreateIndexFromNormal` use); `layer` selects a slice when `Layers > 1`, matching `targetLayer`.

---

## 6. Uncompressed encode + mipmaps/resize

- `encodeUncompressedTex(rgba, width, height, { mips })` → `A8R8G8B8` `XivTex` built via
  `buildCanonicalTexHeader`. Trivial and byte-exact.
- `generateMipmaps(rgba, w, h)` — box (2×2 average) downsample to a full chain.
- `resizeToPowerOfTwo(rgba, w, h)` — the `ResizeXivTx` pre-step (`EndwalkerUpgrade.cs:1098`) for
  non-power-of-two sources.

**Nvtt mip-filter parity (the one soft spot) is NOT blocked on the transforms.** In C#, mip generation
for regenerated textures runs through Nvtt (inside `ConvertToDDS`), so exact byte-parity depends on the
downsample kernel. We validate it in three tiers, earliest first:

1. **No oracle — from day one.** Mip chain length, per-level sizes, and dimensions are pure format math
   (`texMipSizes`); unit-tested directly.
2. **Isolated filter fixture — as soon as `generateMipmaps` exists, no transforms needed.** Capture
   **one** ConsoleTools-produced uncompressed multi-mip `.tex` (any `/upgrade` that regenerates a texture
   emits an `A8R8G8B8` mipped tex — `ConvertToDDS(generateMips=true)` runs Nvtt even for uncompressed).
   Then: decode its **top mip** → RGBA (lossless, it is `A8R8G8B8`), run **our** `generateMipmaps` on
   that exact top mip, and diff our levels `1..N` against the fixture's. This compares **only** the
   filter — decode, transform, and canonical-serialize are all factored out. Nvtt's default is a 2×2 box
   average, which we expect to reproduce exactly; if not, we tune the kernel against this one fixture.
3. **End-to-end golden — later, belt-and-suspenders.** Full `/upgrade` diff once the transforms land;
   confirms decode + transform + mip + serialize together, but is no longer the *only* parity check.

Capturing the tier-2 fixture is a one-time oracle run, fitting the repo's existing oracle/corpus tooling.

---

## 7. Correctness / testing strategy

TDD-style (spec §6), mirroring the mtrl gate. Corpus/fixture-optional tests skip gracefully when inputs
are absent, following the existing `corpusInputs()` / `describe.skipIf` pattern.

1. **Corpus header round-trip (the ground-truth gate).** Every `.tex` inner file across the corpus:
   `decodeSqPackFile(entry) → parseTex → serializeTex`, assert **byte-identical** to the decoded input.
   Wired into the repo's fileless Node-API corpus runner as a `registerTexChecks(pack)` unit (the same
   mechanism as the mtrl/sqpack corpus checks — `corpus-units.ts` + `corpus-register.ts`), **not** a
   standalone `skipIf` file. Because the retained-header model replays all 80 header bytes and the mip
   tail verbatim, this holds **unconditionally** — there is **no** normalization-tolerance branch (unlike
   the mtrl gate); the only textures skipped are those whose SQPack Type-4 *decode* fails (a handful of
   legacy files undecodable by the reference block-recovery heuristic too). Any decodable `.tex` that is
   not byte-exact is a codec bug.
2. **Synthetic decode units (oracle-free).** Hand-built BC blocks with known endpoints/indices → asserted
   RGBA; uncompressed unpacks → exact RGBA.
3. **Synthetic header/round-trip units.** Full-header round-trip; `buildCanonicalTexHeader` field layout;
   `serializeTex(parseTex(x)) === x` over a hand-built canonical file (`test/helpers/make-tex.ts`).
4. **Mip units.** Tier-1 structural (chain sizes/count/dims) + tier-2 isolated Nvtt-filter fixture (§6).
5. **Optional extracted fixtures.** A couple of real `.tex` files for a corpus-free round-trip + decode
   smoke.
6. **Deferred end-to-end.** Index-map golden vs ConsoleTools (uncompressed output) — validates decode +
   canonical-serialize together; lives in the transforms stage.

Unlike mtrl, the byte-exact gate rests on the **lossless retained-header** model (§2), not on the
(intentionally lossy) `ToUncompressedTex` semantics.

---

## 8. Format-table dedup (single source of truth)

The C# has **one** source: `XivTexFormat.cs` defines `GetBitsPerPixel` / `IsCompressedFormat` /
`GetMipMinDimension`, and `DDS.CalculateMipMapSizes` (`DDS.cs:380`) is the single mip-size function —
called by **both** the texture layer (`Tex.cs`) and the SQPack Type 4 layer (`Dat.cs:1077`).

Our `src/sqpack/type4.ts` currently **duplicates** this (its own `BPP` / `COMPRESSED` / `texMipSizes`),
purely because it predates any tex module. This stage restores the single-source structure:

- `src/tex/types.ts` becomes the home for the format constants/helpers and `texMipSizes`.
- `src/sqpack/type4.ts` **imports** them, dropping its inline copies (behaviour-identical; guarded by the
  existing Type 4 tests).

The implied layering (SqPack → tex format module) is itself faithful: in C#, `Dat.cs` already depends on
the Textures namespace for exactly this. This is the plan's only non-additive edit.

---

## 9. Deferred: the optimization (BCn encoder) layer

To reach "no less optimized than the original" for **regenerated** textures, a later stage adds:

- **BC5 encode** (index maps) — hand-writable (two independent BC4 channels: min/max + 3-bit indices).
- **BC7 encode** (color textures) — complex; evaluate a vetted WASM library (e.g. Basis Universal) vs. a
  hand/Emscripten port, under the repo's supply-chain rules (pinned-exact, ≥7-day min age).

Neither can match Nvtt byte-for-byte, so this layer is validated by **decode-within-tolerance**
(PSNR/SSIM), not golden byte-diff. No commitment until we are testing the product in anger.

---

## 10. Environment / constraints

- **No new runtime dependencies** in this stage (the encoder-library decision belongs to §9). The BCn
  decoders are *ported source*, not an imported package.
- **Reference setup:** clone `richgel999/bc7enc_rdo` into the gitignored `reference/bc7enc_rdo`, alongside the
  existing xivModdingFramework checkout, for porting reference (the readable BCn decode source).
- **Attribution:** add the MIT copyright notice (Richard Geldreich Jr, 2020; MIT-or-Unlicense) for the
  ported BCn decoders to `NOTICE`. New files carry the repo's SPDX/GPL header; ported-BCn files
  additionally cite the `bc7enc_rdo` MIT origin in a comment.
- TypeScript + Vitest; Windows + PowerShell; `npm`.
- Extracted `.tex` fixtures are GPL-3.0 framework/game resources covered by the existing NOTICE
  attribution; keep the bundle minimal.
- All integers little-endian.
