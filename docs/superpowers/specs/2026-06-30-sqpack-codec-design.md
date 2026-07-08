# SQPack Codec — Design

**Date:** 2026-06-30
**Status:** Design approved (brainstorming complete) — ready for implementation planning
**Depends on:** Foundation + Container I/O (merged, PR #1). Extends, does not modify, that layer.
**Parent spec:** `2026-06-30-dawntrail-modpack-upgrader-design.md` (§4 codecs, §6 confidence strategy).

---

## 1. Goal

Add a self-contained TypeScript module that **decodes and encodes the SQPack per-file entry format** —
the DEFLATE-based compression wrapper Square Enix puts around every inner game file. This is the
foundational codec every later semantic codec (`.mtrl`, `.tex`, `.mdl`) and transform depends on, and it
unblocks the deferred ConsoleTools **decompressed-content** differential (the biggest current test blind
spot: PR #1's container round-trip validated bytes with *our own reader on both sides*).

Today the container layer treats every inner file as opaque bytes. TTMP stores them SQPack-compressed;
PMP stores them raw. This codec turns those opaque TTMP blobs into raw game-file bytes and back.

### Scope (decided during brainstorming)

- **Full codec:** decode **and** encode.
- **All three entry types:** Type 2 (Standard/binary — `.mtrl`, `.meta`, `.rgsp`), Type 3 (Model —
  `.mdl`), Type 4 (Texture — `.tex`).
- **Correctness bar:** the **decoded (uncompressed) content must be byte-for-byte identical.** Concretely:
  - `decodeSqPackFile(entry)` must byte-match ConsoleTools `/unwrap` output.
  - `decode(encode(decode(entry))) === decode(entry)` byte-for-byte.
  - The **compressed** bytes and the outer zip need only be structurally/semantically equivalent — we do
    **not** reproduce SE's exact compressed output. (This is spec §6's already-decided pass criterion,
    confirmed to apply at this layer: byte-identical decompressed, semantic for the compressed/zip layers.)

### Out of scope

`.dat`/index/repository parsing; `.mdl`/`.tex`/`.mtrl` semantic parsing; any EW→DT transform; byte-exact
SE-matching compression. Type 1 (placeholder/empty) is not present in modpack files — throw a clear error
if encountered.

---

## 2. Approach (chosen: A — standalone module)

A new self-contained unit at `src/sqpack/`, with **zero changes to the container layer**. The proven
byte-identical container round-trip (32/32 real packs) stays frozen; readers/writers keep passing inner
files as opaque `Uint8Array`. Later transform plans call this codec on demand
(decode → transform → encode). Rejected alternatives: integrating decode/encode into the model (touches
the proven container layer for no current benefit); decode-only-now (user declined the thin slice).

---

## 3. Reference source map (what we are porting)

The C# logic lives in `reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/`. Decode is centralized in
`SqPack/FileTypes/Dat.cs`; encode is scattered across `Dat.cs`, `Models/FileTypes/Mdl.cs`, and
`Textures/FileTypes/Tex.cs`, orchestrated by `Mods/SmartImport.cs`.

**Decode — near 1:1 with `Dat.cs`:**

| Our module | C# source |
|---|---|
| `decodeSqPackFile` (dispatch on type int32 at +4) | `Dat.ReadSqPackFile` (`Dat.cs:1016`) |
| `type2/3/4.ts` decode | `Dat.ReadSqPackType2/3/4` (`Dat.cs:623/688/877`) |
| `blocks.ts` `readBlock` | `Dat.ReadCompressedBlock(s)` / `Begin`/`CompleteReadCompressedBlocks` (`Dat.cs:2339+`) |

**Encode — consolidated by us (see §6 deviation #1):**

| Our module | C# source |
|---|---|
| `encodeSqPackFile` (dispatch/detect) | `SmartImport.CreateCompressedFile` (`SmartImport.cs:315`) |
| `type2.ts` encode | `Dat.CompressType2Data` (`Dat.cs:520`) |
| `type3.ts` encode | `Mdl.CompressMdlFile` (`Mdl.cs`) |
| `type4.ts` encode | `Tex.CompressTexFile` (`Tex.cs`) |
| `blocks.ts` `writeBlock` | `IOUtil.Compressor` + inline block framing |

**No upstream tests to port.** The `.sln` references `xivModdingFramework.xUnit` and `exChecker`, but
neither project directory is committed (verified: no `[Fact]`/`[Theory]`/`Assert.` in either reference
repo, no CI). Our test suite is written fresh. The ConsoleTools oracle is therefore the **sole independent
implementation** we can diff against.

---

## 4. Public API

```ts
// src/sqpack/sqpack.ts
export enum SqPackType { Standard = 2, Model = 3, Texture = 4 }

export interface DecodedFile { type: SqPackType; data: Uint8Array; } // data = raw uncompressed game file

export function decodeSqPackFile(entry: Uint8Array): DecodedFile;              // ~ Dat.ReadSqPackFile
export function encodeSqPackFile(data: Uint8Array, type: SqPackType): Uint8Array; // ~ CreateCompressedFile

// convenience for callers that know the file kind by path
export function detectTypeFromGamePath(gamePath: string): SqPackType;         // .mdl→Model, .tex→Texture, else Standard
```

- `decodeSqPackFile` reads `headerLength`/`fileType` (int32s at 0/+4), dispatches to the Type-2/3/4 reader,
  returns the reconstructed uncompressed file.
- `encodeSqPackFile` takes **already-uncompressed** bytes plus a target type and produces a valid entry.
  It does **not** replicate `CreateCompressedFile`'s already-compressed passthrough (our contract is:
  input is uncompressed). The detect helper only chooses a type; it is not a passthrough gate.
- No index/dat/repository parsing — only the per-file *entry* format TTMP stores. PMP files are already
  raw, so they never hit decode; they would only be encoded if a later plan writes them into a TTMP.

---

## 5. Internal structure

### 5.1 Shared block codec — `src/sqpack/blocks.ts`

Every type is a header indexing a list of 128-byte-aligned blocks. One block:

- 16-byte block header: `blockHeaderLen (=16)`, `0`, `compressedLen`, `uncompressedLen`.
- Payload: **raw DEFLATE** of the chunk, unless the block is **stored** — signaled by the
  `compressedLen === 32000` sentinel, in which case `uncompressedLen` raw bytes follow verbatim.
- Padding to the next 128-byte boundary.

- `readBlock(reader) → Uint8Array`: read header; stored → copy; else `inflateSync(compressedLen bytes)`;
  skip padding.
- `writeBlock(rawChunk) → Uint8Array`: **always** `deflateSync(chunk)` (faithful to SE's
  `CompressSmallData`, which never emits stored blocks on write — chunks are ≤16000 bytes so deflated size
  stays well under the 32000 stored sentinel); prepend the 16-byte header; pad to 128. Uncompressed input
  is split into **16000-byte chunks** (matching SE, so any decoder — including `/unwrap` — reads our
  output). The **reader** still handles stored (`32000`) blocks, since older files/tools produced them.

### 5.2 Per-type modules — `src/sqpack/type2.ts`, `type3.ts`, `type4.ts`

Each exposes `decode(entry) → Uint8Array` and `encode(raw) → entry`. Decode+encode of a given type live
together (see §6 deviation #1).

- **Type 2 (Standard):** flat `partCount` block table → concat blocks in order. Encoder is
  `CompressType2Data` line-for-line. Simplest.
- **Type 4 (Texture):** a leading non-mip block followed by a per-mip block group (mip offset/size/count
  table). Decode concats in mip order; encode rebuilds the mip table (`MakeType4DatHeader`, `Dat.cs:1056`).
- **Type 3 (Model) — highest risk:** the entry indexes block groups for vertex-info, model-data, and
  vertex/edge/index buffers across **3 LoDs**. Decode decompresses each group **and emits a reconstructed
  68-byte runtime header** (writing `vInfoRealSize`, `mInfoRealSize`, mesh/material counts, buffer
  offsets and `...RealSizes`, `lodCount`, `flags`) exactly as `ReadSqPackType3` does, so our decode matches
  `/unwrap`. Encode reverses it: recompute per-group block counts/indices/offsets/sizes and the entry
  header. **Coupling note:** the encoder finds buffer boundaries by reading the 68-byte runtime header that
  decode produced — *not* by parsing model semantics — which is what keeps this in the sqpack module and
  defers real `.mdl` parsing to a later plan.

### 5.3 DEFLATE library

Block payloads are **raw DEFLATE** (no zlib/gzip framing; C# uses `DeflateStream`). We already depend on
`fflate` → use its raw `inflateSync`/`deflateSync`. **No new dependency.** Since the bar is decode
round-trip (not byte-match to SE), the compression level is free; pick a valid, reasonably small level and
fall back to a stored block when a chunk doesn't shrink.

---

## 6. Intentional deviations from the C# reference

Anything beyond faithful porting is recorded here with a rationale. It is acceptable to improve on the
reference architecture, provided the deviation is deliberate.

1. **Symmetric per-type modules.** C# centralizes *decode* framing in `Dat.cs` but scatters *encode*
   framing into `Mdl.cs`/`Tex.cs`. We keep decode+encode of each entry type together in one `typeN.ts`.
   *Rationale:* locality — one file owns everything about one entry type; easier to test and reason about.
2. **`sqpack` as a standalone module** coupled only to the runtime/mip header layout, deferring full
   `.mdl`/`.tex` semantic parsing to later transform plans. *Rationale:* keeps the codec independently
   testable against the oracle; the container layer stays frozen.
3. **Encoder takes uncompressed input only** (no already-compressed passthrough). *Rationale:* our call
   sites always hold uncompressed data; the passthrough heuristic belongs to file-import UX we don't have.

---

## 7. Testing / confidence strategy

Three layers, strongest first. All oracle/corpus tests **skip gracefully** when ConsoleTools or the corpus
is absent (CI has neither), following the Task-4 harness pattern already in the repo.

1. **Oracle decode cross-check (closes the known blind spot).** Individual entries are obtained by slicing
   `TTMPD.mpd` (already done by `readTtmp2`) and writing the slice to a temp file.
   - **Type 2 & 3 — direct via `/unwrap`.** `ConsoleTools /unwrap <entry.bin> <out.bin>` (using a *neutral
     matching extension* like `.bin`, so ConsoleTools writes the raw un-sqpacked bytes rather than routing
     `.tex`/`.mdl` through its image/3D exporters) gives an *independent* decompression. Assert
     `decodeSqPackFile(entry).data === out` byte-for-byte. This is the check PR #1's review flagged as
     missing.
   - **Type 4 — via a `/wrap` bridge (game-gated).** ConsoleTools `/unwrap` **deliberately does not
     decompress Type 4** (its guard is `type > 1 && type < 4`; `Program.cs:391`). The foreign check for
     textures instead extracts a raw uncompressed `.tex` from the game (`/extract <gamePath.tex>
     <raw.tex>`), re-wraps it with SE (`/wrap <raw.tex> <se.bin> <gamePath.tex> /sqpack`), and asserts
     `decodeSqPackFile(se.bin).data === raw.tex`. This validates Type-4 decode against SE's encoder. It
     needs the game install; it skips gracefully otherwise, leaving Type 4 covered by the self round-trip
     (layer 2) plus synthetic units (layer 3).
2. **Self round-trip over the corpus.** For every inner file across all 32 packs: `decode → encode →
   decode`; assert the two decoded blobs are byte-identical. Exercises all three types on real data.
3. **Synthetic unit tests.** Hand-built minimal Type-2/3/4 entries (plus a stored-block case) for fast,
   oracle-free coverage of headers, padding, the 16000-byte chunk boundary, and the 32000 stored-block
   sentinel.

Written TDD-style: the synthetic unit tests and self round-trip become the failing tests written first;
the oracle cross-check is the ground-truth gate where ConsoleTools is available.

Not in this plan: the whole-pack `/resave` and `/upgrade` differentials. `/resave` mutates `.mdl` even at
the decompressed level, and `/upgrade` changes transformed files — both belong to the transform plans,
compared on decompressed content once transforms exist.

---

## 8. Edge cases & risks

- **Stored (uncompressed) blocks** — `compressedLen === 32000` sentinel; reader and writer both handle.
- **Legacy malformed block spacing (likely in our corpus).** Endwalker-era TexTools emitted blocks with
  improper padding. `ReadCompressedBlock` (`Dat.cs:2475-2520`) tolerates this: it skips stray leading `0`
  bytes before the `16` block-header marker, and after reading a block it scans the padding for a `16`
  byte and *rewinds* to the next block if found. Because our inputs are **pre-Dawntrail** packs, our
  `readBlock` must port this tolerance faithfully (skip-leading-zeros + padding-rewind), or real corpus
  files will fail to decode. Fixtures for both forms should be added.
- **Type 3 encode is the top risk** — valid block-index/offset/count table reconstruction. Mitigation:
  most oracle fixtures + self round-trip over every real `.mdl` in the corpus.
- **Type 1** — not present in modpack files; throw a clear "invalid/unsupported SQPack type" error.
- **Large models** — Type 2 header may grow beyond 128 bytes for very large files (`CompressType2Data`
  recomputes header size); port that sizing logic faithfully.

---

## 9. File structure (new)

```
src/sqpack/
  sqpack.ts     public API: decodeSqPackFile / encodeSqPackFile / detectTypeFromGamePath, type dispatch
  blocks.ts     readBlock / writeBlock (shared 128-aligned DEFLATE block codec)
  type2.ts      Standard entry decode/encode
  type3.ts      Model entry decode/encode (runtime-header reconstruction)
  type4.ts      Texture entry decode/encode (per-mip)
test/
  sqpack-*.test.ts   synthetic + corpus self round-trip
  helpers/           extend oracle.ts with /unwrap (+ /wrap) wrappers; synthetic-entry builders
```

`src/index.ts` re-exports the public API. `test/helpers/oracle.ts` gains `unwrap(src, dest)` /
`wrap(src, dest)` wrappers alongside the existing `resave`/`upgrade`.
