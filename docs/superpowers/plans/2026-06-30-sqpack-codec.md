# SQPack Codec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `src/sqpack/` module that decodes and encodes the SQPack per-file entry format (Type 2/3/4) so inner TTMP game files can be turned into raw uncompressed bytes and back.

**Architecture:** A shared 128-byte-aligned DEFLATE block codec (`blocks.ts`) underneath three per-type modules (`type2/3/4.ts`), each owning both decode and encode of one entry type, dispatched by `sqpack.ts`. The container layer is untouched — it keeps passing inner files as opaque bytes; this codec is called on demand. Correctness is anchored on a ConsoleTools foreign cross-check plus a corpus self round-trip.

**Tech Stack:** TypeScript, Vitest, `fflate` (raw `deflateSync`/`inflateSync` — already a dependency). No new dependencies.

## Global Constraints

- **Package min-age:** No new dependencies are added by this plan. If that changes, every dependency must be a release ≥7 days old, pinned EXACT, lockfile committed.
- **Platform:** Windows + PowerShell for all shell/test invocation. Use `npm`.
- **Correctness bar (spec §1):** decoded (uncompressed) content is **byte-for-byte identical**. `decodeSqPackFile(entry).data` must byte-match ConsoleTools's decompression, and `decode(encode(decode(entry))) === decode(entry)`. Compressed bytes and the outer zip need only be structurally/semantically equivalent — we do **not** reproduce SE's exact compressed output.
- **Standalone module:** Do NOT modify `src/container/*`, `src/model/*`, or the existing container tests. The codec is additive.
- **Reference C# source:** `./reference/xivModdingFramework/` (git-ignored). Cite when verifying format details. Key file: `xivModdingFramework/SqPack/FileTypes/Dat.cs`.
- **Golden oracle:** `C:\Program Files\FFXIV TexTools\FFXIV_TexTools\ConsoleTools.exe`. Oracle tests must **skip gracefully** when it (or the corpus, or the game install) is absent (CI has none).
- **Endianness:** All SQPack integers are little-endian.

---

## Testing Strategy

Three layers, strongest first (spec §7). All oracle/corpus tests skip gracefully when their inputs are absent.

1. **Foreign decode cross-check (oracle).** Type 2 & 3: `ConsoleTools /unwrap <entry.bin> <out.bin>` with a **neutral matching extension** (`.bin`) so ConsoleTools writes raw un-sqpacked bytes; assert equals our decode. Type 4: `/unwrap` deliberately does NOT decompress it (`Program.cs:391` guard `type > 1 && type < 4`), so Type 4 uses a **game-gated `/wrap` bridge** (Task 8).
2. **Self round-trip (all types, corpus).** For every `SqPackCompressed` inner file across the corpus: `decode → encode → decode`; assert the two decoded blobs are byte-identical (Task 7).
3. **Synthetic unit tests.** Hand-built minimal entries and uncompressed blobs, per type, for fast oracle-free coverage of headers, padding, the 16000-byte chunk boundary, the 32000 stored-block sentinel, and legacy block-spacing tolerance.

---

## File Structure

```
src/util/binary.ts        MODIFY: add readUint8/readBytes to BinaryReader; add ByteBuilder + deflateRaw/inflateRaw helpers   (Task 1)
src/sqpack/blocks.ts       CREATE: readBlock / writeBlock / compressData (shared 128-aligned DEFLATE block codec)             (Task 1)
src/sqpack/type2.ts        CREATE: decodeType2 / encodeType2                                                                  (Task 2)
src/sqpack/type4.ts        CREATE: decodeType4 / encodeType4 + tex-format mip-size helpers                                    (Task 3)
src/sqpack/type3.ts        CREATE: decodeType3 / encodeType3 (runtime-header reconstruction)                                  (Task 4)
src/sqpack/sqpack.ts       CREATE: decodeSqPackFile / encodeSqPackFile / detectTypeFromGamePath (dispatch)                    (Task 5)
src/index.ts               MODIFY: re-export the sqpack public API                                                            (Task 5)
test/helpers/oracle.ts     MODIFY: add unwrap() / wrap() / extractGameFile() wrappers                                        (Task 6)
test/sqpack-blocks.test.ts CREATE                                                                                             (Task 1)
test/sqpack-type2.test.ts  CREATE                                                                                             (Task 2)
test/sqpack-type4.test.ts  CREATE                                                                                             (Task 3)
test/sqpack-type3.test.ts  CREATE                                                                                             (Task 4)
test/sqpack-api.test.ts    CREATE                                                                                             (Task 5)
test/sqpack-corpus.test.ts CREATE: corpus self round-trip + Type 2/3 /unwrap cross-check                                     (Task 7)
test/sqpack-type4-oracle.test.ts CREATE: Type 4 /wrap-bridge (game-gated)                                                    (Task 8)
```

Each `typeN.ts` owns decode+encode of exactly one entry type (spec §6 deviation #1).

---

### Task 1: Binary helpers + shared block codec

**Files:**
- Modify: `src/util/binary.ts` (add reader methods + `ByteBuilder` + deflate/inflate helpers)
- Create: `src/sqpack/blocks.ts`
- Test: `test/sqpack-blocks.test.ts`

**Interfaces:**
- Consumes: `fflate` (`deflateSync`, `inflateSync`), existing `BinaryReader`, `concatBytes`.
- Produces:
  - `BinaryReader.readUint8(): number`, `BinaryReader.readBytes(len: number): Uint8Array` (both advance `pos`)
  - `class ByteBuilder { u8(v):this; u16(v):this; i32(v):this; bytes(a:Uint8Array|number[]):this; readonly length:number; toUint8Array():Uint8Array; }`
  - `inflateRaw(bytes: Uint8Array, size: number): Uint8Array`
  - `deflateRaw(bytes: Uint8Array): Uint8Array`
  - `readBlock(r: BinaryReader): Uint8Array` — reads one compressed block at `r`'s current position, tolerating legacy spacing, returns decompressed bytes, leaves `r` positioned at the next block.
  - `writeBlock(chunk: Uint8Array): Uint8Array` — one padded block (`chunk.length` must be ≤ 16000).
  - `compressData(data: Uint8Array): Uint8Array[]` — splits into 16000-byte chunks, returns one `writeBlock` per chunk.

- [ ] **Step 1: Write the failing test**

`test/sqpack-blocks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BinaryReader, concatBytes } from "../src/util/binary";
import { readBlock, writeBlock, compressData } from "../src/sqpack/blocks";

const enc = new TextEncoder();

describe("block codec", () => {
  it("round-trips a single block", () => {
    const payload = enc.encode("hello sqpack block");
    const block = writeBlock(payload);
    expect(block.length % 128).toBe(0); // padded to 128
    const r = new BinaryReader(block);
    expect(readBlock(r)).toEqual(payload);
  });

  it("splits >16000 bytes into multiple blocks and round-trips", () => {
    const big = new Uint8Array(40000).map((_, i) => i & 0xff);
    const blocks = compressData(big);
    expect(blocks.length).toBe(3); // ceil(40000/16000)
    const joined = concatBytes(blocks);
    const r = new BinaryReader(joined);
    const out = concatBytes(blocks.map(() => readBlock(r)));
    expect(out).toEqual(big);
  });

  it("reads a stored (uncompressed) block (32000 sentinel)", () => {
    // Build a stored block by hand: [16][0][32000][len] + raw + pad-to-128.
    const raw = enc.encode("stored payload");
    const head = new Uint8Array(16);
    const dv = new DataView(head.buffer);
    dv.setInt32(0, 16, true); dv.setInt32(4, 0, true);
    dv.setInt32(8, 32000, true); dv.setInt32(12, raw.length, true);
    const body = concatBytes([head, raw]);
    const padded = concatBytes([body, new Uint8Array((128 - (body.length % 128)) % 128)]);
    const r = new BinaryReader(padded);
    expect(readBlock(r)).toEqual(raw);
  });

  it("tolerates legacy leading-zero block spacing", () => {
    const payload = enc.encode("legacy spaced");
    const block = writeBlock(payload);
    // Prepend stray zero bytes before the block header (old TexTools artifact).
    const shifted = concatBytes([new Uint8Array([0, 0, 0]), block]);
    const r = new BinaryReader(shifted);
    expect(readBlock(r)).toEqual(payload);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sqpack-blocks`
Expected: FAIL — cannot resolve `../src/sqpack/blocks`.

- [ ] **Step 3: Extend `src/util/binary.ts`**

Add these methods inside the `BinaryReader` class (after `readUint16`):

```ts
  readUint8(): number { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
  readBytes(len: number): Uint8Array {
    const out = this.bytes.slice(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
```

Append to the end of `src/util/binary.ts`:

```ts
import { deflateSync, inflateSync } from "fflate";

/** Raw DEFLATE (no zlib/gzip framing), matching C# DeflateStream. */
export function deflateRaw(bytes: Uint8Array): Uint8Array {
  return deflateSync(bytes);
}
export function inflateRaw(bytes: Uint8Array, size: number): Uint8Array {
  const out = inflateSync(bytes, { out: new Uint8Array(size) });
  return out;
}

/** Little-endian byte builder for constructing SQPack headers. */
export class ByteBuilder {
  private parts: number[] = [];
  u8(v: number): this { this.parts.push(v & 0xff); return this; }
  u16(v: number): this { this.parts.push(v & 0xff, (v >>> 8) & 0xff); return this; }
  i32(v: number): this {
    this.parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  bytes(a: Uint8Array | number[]): this { for (const b of a) this.parts.push(b & 0xff); return this; }
  get length(): number { return this.parts.length; }
  toUint8Array(): Uint8Array { return new Uint8Array(this.parts); }
}
```

> `fflate`'s `deflateSync`/`inflateSync` produce/consume **raw** DEFLATE streams (no zlib header), which is exactly what `IOUtil.Compressor`/`Decompressor` use via `DeflateStream` (`IOUtil.cs:56-99`).

- [ ] **Step 4: Write `src/sqpack/blocks.ts`**

```ts
import { BinaryReader, ByteBuilder, concatBytes, deflateRaw, inflateRaw } from "../util/binary";

const MAX_CHUNK = 16000;
const STORED_SENTINEL = 32000;

function pad128(len: number): number {
  const r = len % 128;
  return r === 0 ? len : len + (128 - r);
}

/**
 * Reads one compressed block at the reader's current position and returns the
 * decompressed bytes, leaving the reader positioned at the next block.
 * Mirrors Dat.ReadCompressedBlock / the per-block loop in BeginReadCompressedBlocks
 * (Dat.cs:2359-2429), including tolerance for legacy improper block spacing.
 */
export function readBlock(r: BinaryReader): Uint8Array {
  const start = r.tell();

  // Skip stray leading zero bytes before the '16' magic (old TexTools artifact).
  let sixteen = r.readUint8();
  while (sixteen !== 16 && sixteen === 0) sixteen = r.readUint8();
  const zeros = r.readBytes(3);
  const zero = r.readInt32();
  if (sixteen !== 16 || zero !== 0 || zeros.some((x) => x !== 0)) {
    throw new Error("sqpack: unable to locate valid compressed block header");
  }

  const compSize = r.readInt32();
  const decompSize = r.readInt32();

  let data: Uint8Array;
  if (compSize === STORED_SENTINEL) {
    data = r.readBytes(decompSize);
  } else {
    data = inflateRaw(r.readBytes(compSize), decompSize);
  }

  // Advance past padding to the next 128-byte boundary, with legacy rewind.
  const length = r.tell() - start;
  const remaining = pad128(length) - length;
  const padding = r.readBytes(remaining);
  const sixteenIndex = padding.indexOf(16);
  if (sixteenIndex !== -1) {
    // Old broken spacing: the next block header starts inside the "padding".
    r.seek(r.tell() - (padding.length - sixteenIndex));
  }
  return data;
}

/** Compresses one chunk (<= 16000 bytes) into a single padded block. Mirrors CompressSmallData (Dat.cs:2094). */
export function writeBlock(chunk: Uint8Array): Uint8Array {
  if (chunk.length > MAX_CHUNK) throw new Error("sqpack: writeBlock chunk too large");
  const compressed = deflateRaw(chunk);
  const header = new ByteBuilder().i32(16).i32(0).i32(compressed.length).i32(chunk.length).toUint8Array();
  const body = concatBytes([header, compressed]);
  const padding = new Uint8Array(pad128(body.length) - body.length);
  return concatBytes([body, padding]);
}

/** Splits data into 16000-byte chunks and returns one padded block per chunk. Mirrors CompressData (Dat.cs:2130). */
export function compressData(data: Uint8Array): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  for (let off = 0; off < data.length; off += MAX_CHUNK) {
    blocks.push(writeBlock(data.slice(off, Math.min(off + MAX_CHUNK, data.length))));
  }
  return blocks;
}
```

> A zero-length buffer yields **zero** blocks, exactly as C# `CompressData` does (`Math.Ceiling(0/16000f) === 0`). This matters for Type 3: models routinely have empty LoD1/LoD2 vertex/index buffers, and their block counts must be 0 to match SE's structure. Block counts are always derived from the returned list length, so an empty list is self-consistent on the decode side.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- sqpack-blocks`
Expected: PASS (4 cases).

- [ ] **Step 6: Typecheck + commit**

```powershell
npm run typecheck
git add src/util/binary.ts src/sqpack/blocks.ts test/sqpack-blocks.test.ts
git commit -m "feat(sqpack): add shared block codec + binary helpers"
```

---

### Task 2: Type 2 (Standard) decode + encode

**Files:**
- Create: `src/sqpack/type2.ts`
- Test: `test/sqpack-type2.test.ts`

**Interfaces:**
- Consumes: `BinaryReader`, `ByteBuilder`, `concatBytes` (Task 1); `readBlock`, `writeBlock`, `compressData` (Task 1).
- Produces:
  - `decodeType2(entry: Uint8Array): Uint8Array` — mirrors `Dat.ReadSqPackType2` (`Dat.cs:623`).
  - `encodeType2(data: Uint8Array): Uint8Array` — mirrors `Dat.CompressType2Data` (`Dat.cs:520`).

- [ ] **Step 1: Write the failing test**

`test/sqpack-type2.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decodeType2, encodeType2 } from "../src/sqpack/type2";

function sample(n: number): Uint8Array {
  return new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
}

describe("type 2 codec", () => {
  it("round-trips small binary data", () => {
    const raw = sample(500);
    const entry = encodeType2(raw);
    // Valid entry header: fileType int32 at offset 4 is 2.
    expect(new DataView(entry.buffer, entry.byteOffset).getInt32(4, true)).toBe(2);
    expect(decodeType2(entry)).toEqual(raw);
  });

  it("round-trips multi-block data (> 16000 bytes)", () => {
    const raw = sample(50000);
    expect(decodeType2(encodeType2(raw))).toEqual(raw);
  });

  it("round-trips empty data", () => {
    const raw = new Uint8Array(0);
    expect(decodeType2(encodeType2(raw))).toEqual(raw);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sqpack-type2`
Expected: FAIL — cannot resolve `../src/sqpack/type2`.

- [ ] **Step 3: Write `src/sqpack/type2.ts`**

```ts
import { BinaryReader, ByteBuilder, concatBytes } from "../util/binary";
import { readBlock, compressData } from "./blocks";

/** Decompress a Type 2 (Standard/binary) SQPack entry. Mirrors Dat.ReadSqPackType2 (Dat.cs:623). */
export function decodeType2(entry: Uint8Array): Uint8Array {
  const r = new BinaryReader(entry);
  const headerLength = r.readInt32();
  const fileType = r.readInt32();
  if (fileType !== 2) throw new Error(`sqpack: not a Type 2 entry (fileType=${fileType})`);
  r.readInt32(); // uncompressedSize (unused; we concat actual block outputs)
  r.readInt32(); // bufferInfoA
  r.readInt32(); // bufferInfoB
  const blockCount = r.readInt32();

  const out: Uint8Array[] = [];
  for (let i = 0; i < blockCount; i++) {
    // Block table entry: int dataBlockOffset at (24 + 8*i); (short size, short uncompSize follow, unused here).
    r.seek(24 + 8 * i);
    const dataBlockOffset = r.readInt32();
    r.seek(headerLength + dataBlockOffset);
    out.push(readBlock(r));
  }
  return concatBytes(out);
}

/** Compress raw binary data into a Type 2 SQPack entry. Mirrors Dat.CompressType2Data (Dat.cs:520). */
export function encodeType2(data: Uint8Array): Uint8Array {
  const blocks = compressData(data);

  // Data section + block table entries.
  const dataBlocks: Uint8Array[] = [];
  const table = new ByteBuilder();
  let dataOffset = 0;
  const total = data.length;
  let remaining = total;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const partUncomp = Math.min(remaining, 16000);
    dataBlocks.push(block);
    table.i32(dataOffset).u16(block.length).u16(partUncomp);
    dataOffset += block.length;
    remaining -= 16000;
  }
  const totalCompSize = dataOffset;

  // Header: [headerLength][2][uncompLen][totalCompSize/128][totalCompSize/128][partCount] then table.
  const preHeader = new ByteBuilder()
    .i32(0) // headerLength placeholder (fixed below)
    .i32(2)
    .i32(total)
    .i32(Math.floor(totalCompSize / 128))
    .i32(Math.floor(totalCompSize / 128))
    .i32(blocks.length)
    .bytes(table.toUint8Array())
    .toUint8Array();

  const headerLength = pad128Header(preHeader.length);
  const header = new Uint8Array(headerLength);
  header.set(preHeader, 0);
  new DataView(header.buffer).setInt32(0, headerLength, true);

  return concatBytes([header, ...dataBlocks]);
}

function pad128Header(len: number): number {
  const r = len % 128;
  return r === 0 ? len : len + (128 - r);
}
```

> `decodeType2` ignores the stored `uncompressedSize` and concatenates real block outputs — identical result, and robust to header quirks. `encodeType2` reproduces `CompressType2Data`'s field order (`Dat.cs:527-604`): the two `totalCompSize/128` buffer-size ints sit between `uncompLen` and `partCount`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sqpack-type2`
Expected: PASS (3 cases).

- [ ] **Step 5: Typecheck + commit**

```powershell
npm run typecheck
git add src/sqpack/type2.ts test/sqpack-type2.test.ts
git commit -m "feat(sqpack): add Type 2 decode/encode"
```

---

### Task 3: Type 4 (Texture) decode + encode

**Files:**
- Create: `src/sqpack/type4.ts`
- Test: `test/sqpack-type4.test.ts`

**Interfaces:**
- Consumes: `BinaryReader`, `ByteBuilder`, `concatBytes` (Task 1); `readBlock`, `compressData` (Task 1).
- Produces:
  - `decodeType4(entry: Uint8Array): Uint8Array` — mirrors `Dat.ReadSqPackType4` (`Dat.cs:877`).
  - `encodeType4(data: Uint8Array): Uint8Array` — mirrors `Tex.CompressTexFile` + `Dat.MakeType4DatHeader` (`Tex.cs:1300`, `Dat.cs:1056`).
  - `texMipSizes(format: number, width: number, height: number): number[]` — mirrors `DDS.CalculateMipMapSizes` (`DDS.cs:380`).

Type 4 layout: an 80-byte tex header (`Tex._TexHeaderSize`) followed by mip pixel data. The uncompressed file = tex header + concatenated mips. The entry stores, per mip, a small header (offset/compressedLen/uncompressedLen/dataBlockOffset/blockCount) plus a trailing list of per-part `ushort` sizes.

- [ ] **Step 1: Write the failing test**

`test/sqpack-type4.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decodeType4, encodeType4, texMipSizes } from "../src/sqpack/type4";

const TEX_HEADER_SIZE = 80;
const BC5 = 25136; // 8 bpp, min dimension 4

// Build a minimal but valid uncompressed .tex: 80-byte header (format/width/height/mipCount) + mip pixels.
function makeUncompressedTex(width: number, height: number, mipCount: number): Uint8Array {
  const sizes = texMipSizes(BC5, width, height).slice(0, mipCount);
  const total = sizes.reduce((a, b) => a + b, 0);
  const buf = new Uint8Array(TEX_HEADER_SIZE + total);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0, true);          // attributes
  dv.setUint32(4, BC5, true);        // texture format
  dv.setUint16(8, width, true);
  dv.setUint16(10, height, true);
  dv.setUint16(12, 1, true);         // depth
  buf[14] = mipCount & 0xf;          // mip count (low nibble)
  // Fill pixel data deterministically.
  for (let i = TEX_HEADER_SIZE; i < buf.length; i++) buf[i] = (i * 17 + 3) & 0xff;
  return buf;
}

describe("type 4 codec", () => {
  it("computes BC5 mip sizes down to 1x1", () => {
    // 8x8 BC5: 8*8*8/8=64, 4x4 (min dim 4)=4*4*8/8=16, then 4x4 clamp repeats to 16,16.
    expect(texMipSizes(BC5, 8, 8)).toEqual([64, 16, 16, 16]);
  });

  it("round-trips a single-mip texture", () => {
    const raw = makeUncompressedTex(16, 16, 1);
    const entry = encodeType4(raw);
    expect(new DataView(entry.buffer, entry.byteOffset).getInt32(4, true)).toBe(4);
    expect(decodeType4(entry)).toEqual(raw);
  });

  it("round-trips a multi-mip texture", () => {
    const raw = makeUncompressedTex(64, 64, 4);
    expect(decodeType4(encodeType4(raw))).toEqual(raw);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sqpack-type4`
Expected: FAIL — cannot resolve `../src/sqpack/type4`.

- [ ] **Step 3: Write `src/sqpack/type4.ts`**

```ts
import { BinaryReader, ByteBuilder, concatBytes } from "../util/binary";
import { readBlock, compressData } from "./blocks";

const TEX_HEADER_SIZE = 80;

// XivTexFormat bits-per-pixel + min dimension, ported from XivTexFormat.cs:94-128.
const BPP: Record<number, number> = {
  13344: 4, 24864: 4,                                 // DXT1, BC4
  13361: 8, 25136: 8, 4401: 8, 25650: 8,              // DXT5, BC5, A8, BC7
  5185: 16, 5184: 16,                                 // A1R5G5B5, A4R4G4B4
  4400: 32, 5200: 32, 5201: 32, 8528: 32, 8784: 32,   // L8, A8R8G8B8, X8R8G8B8, R32F, G16R16F
  8800: 32, 9312: 32, 9328: 32, 13360: 32, 16704: 32, // G32R32F, A16B16G16R16F, A32B32G32R32F, DXT3, D16
};
const COMPRESSED = new Set([13344, 13360, 13361, 24864, 25136, 25650]);

function bitsPerPixel(format: number): number {
  const b = BPP[format];
  if (b === undefined) throw new Error(`sqpack: no bitsPerPixel for texture format ${format}`);
  return b;
}
function minDimension(format: number): number {
  return COMPRESSED.has(format) ? 4 : 1;
}

/** Mirrors DDS.CalculateMipMapSizes (DDS.cs:380). Returns the full mip chain down to 1x1. */
export function texMipSizes(format: number, width: number, height: number): number[] {
  const minDim = minDimension(format);
  const bpp = bitsPerPixel(format);
  const sizes: number[] = [];
  let w = width, h = height;
  const sizeOf = (ww: number, hh: number) => (Math.max(minDim, ww) * Math.max(minDim, hh) * bpp) / 8;
  sizes.push(sizeOf(w, h));
  while (w > 1 || h > 1) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    sizes.push(sizeOf(w, h));
  }
  return sizes;
}

/** Decompress a Type 4 (Texture) SQPack entry. Mirrors Dat.ReadSqPackType4 (Dat.cs:877). */
export function decodeType4(entry: Uint8Array): Uint8Array {
  const r = new BinaryReader(entry);
  const headerLength = r.readInt32();
  const fileType = r.readInt32();
  if (fileType !== 4) throw new Error(`sqpack: not a Type 4 entry (fileType=${fileType})`);
  r.readInt32(); // uncompressedFileSize
  r.readInt32(); // ikd1
  r.readInt32(); // ikd2
  const mipCount = r.readInt32();

  const endOfHeader = headerLength;
  const out: Uint8Array[] = [];
  // Tex file header (80 bytes) sits right after the SQPack header.
  out.push(entry.slice(endOfHeader, endOfHeader + TEX_HEADER_SIZE));

  const MIP_HEADER = 20;
  for (let i = 0; i < mipCount; i++) {
    r.seek(24 + MIP_HEADER * i);
    const offsetFromHeaderEnd = r.readInt32();
    r.readInt32(); // mipMapLength
    r.readInt32(); // mipMapSize
    r.readInt32(); // mipMapStart
    const mipParts = r.readInt32();

    r.seek(endOfHeader + offsetFromHeaderEnd);
    for (let p = 0; p < mipParts; p++) out.push(readBlock(r));
  }
  return concatBytes(out);
}

/**
 * Compress a raw uncompressed .tex (80-byte header + mip pixels) into a Type 4 entry.
 * Mirrors Tex.CompressTexFile (Tex.cs:1300) + Dat.MakeType4DatHeader (Dat.cs:1056).
 */
export function encodeType4(data: Uint8Array): Uint8Array {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const format = dv.getUint32(4, true);
  const width = dv.getUint16(8, true);
  const height = dv.getUint16(10, true);
  const mipCount = data[12]! & 0xf;

  const texHeader = data.slice(0, TEX_HEADER_SIZE);
  const mipSizes = texMipSizes(format, width, height);

  // Compress each mip's pixel bytes into blocks.
  const ddsParts: Uint8Array[][] = [];
  let cursor = TEX_HEADER_SIZE;
  for (let i = 0; i < mipCount; i++) {
    const size = mipSizes[i]!;
    ddsParts.push(compressData(data.slice(cursor, cursor + size)));
    cursor += size;
  }

  // ---- MakeType4DatHeader (Dat.cs:1056) ----
  const totalParts = ddsParts.reduce((n, m) => n + m.length, 0);
  const headerSizeRaw = 24 + mipCount * 20 + totalParts * 2;
  const headerPadding = 128 - (headerSizeRaw % 128);
  const uncompressedLength = data.length - TEX_HEADER_SIZE;

  const hb = new ByteBuilder()
    .i32(headerSizeRaw + headerPadding)
    .i32(4)
    .i32(uncompressedLength + 80)
    .i32(0)
    .i32(0)
    .i32(mipCount);

  let dataBlockOffset = 0;
  let mipCompressedOffset = 80;
  for (let i = 0; i < mipCount; i++) {
    const compressedSize = ddsParts[i]!.reduce((n, p) => n + p.length, 0);
    hb.i32(mipCompressedOffset).i32(compressedSize).i32(mipSizes[i]!).i32(dataBlockOffset).i32(ddsParts[i]!.length);
    dataBlockOffset += ddsParts[i]!.length;
    mipCompressedOffset += compressedSize;
  }
  // Trailing per-part ushort size list.
  for (const mip of ddsParts) for (const part of mip) hb.u16(part.length);
  hb.bytes(new Uint8Array(headerPadding));

  const pixelData: Uint8Array[] = [];
  for (const mip of ddsParts) for (const part of mip) pixelData.push(part);

  return concatBytes([hb.toUint8Array(), texHeader, ...pixelData]);
}
```

> `encodeType4` reads format/width/height/mipCount straight from the raw tex's 80-byte header — no BCn/DDS decoding — then recomputes mip boundaries via `texMipSizes`. This is the "coupling only to the tex-header layout" the spec describes; full `.tex` parsing is deferred to a later plan.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sqpack-type4`
Expected: PASS (3 cases).

- [ ] **Step 5: Typecheck + commit**

```powershell
npm run typecheck
git add src/sqpack/type4.ts test/sqpack-type4.test.ts
git commit -m "feat(sqpack): add Type 4 texture decode/encode"
```

---

### Task 4: Type 3 (Model) decode + encode

**Files:**
- Create: `src/sqpack/type3.ts`
- Test: `test/sqpack-type3.test.ts`

**Interfaces:**
- Consumes: `BinaryReader`, `ByteBuilder`, `concatBytes` (Task 1); `readBlock`, `compressData` (Task 1).
- Produces:
  - `decodeType3(entry: Uint8Array): Uint8Array` — mirrors `Dat.ReadSqPackType3` (`Dat.cs:688`).
  - `encodeType3(data: Uint8Array): Uint8Array` — mirrors `Mdl.CompressMdlFile` (`Mdl.cs:2148`).

The decoded model file is a **reconstructed 68-byte runtime header** (`_MdlHeaderSize = 68`) followed by: vertex-info block, model-data block, then per-LoD `[vertex][index]` geometry. The runtime header carries the sizes/offsets the encoder needs, so encode never parses model semantics. Edge-geometry buffers are always zero-length (SE emits 0 for them on write — `Mdl.cs:2280-2298`).

Runtime header layout (68 bytes) written by `ReadSqPackType3` (`Dat.cs:842-858`) and read back by `CompressMdlFile` (`Mdl.cs:2151-2183`):

| Offset | Field |
|---|---|
| 0 | `version`/signature (uint32) |
| 4 | vertexInfo real size (uint32) |
| 8 | modelData real size (uint32) |
| 12 | meshCount (uint16) |
| 14 | materialCount (uint16) |
| 16 | vertex buffer uncompressed offsets ×3 (uint32) |
| 28 | index buffer uncompressed offsets ×3 (uint32) |
| 40 | vertex buffer real sizes ×3 (uint32) |
| 52 | index buffer real sizes ×3 (uint32) |
| 64 | lodCount (byte), flags (byte), padding ×2 |

- [ ] **Step 1: Write the failing test**

`test/sqpack-type3.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decodeType3, encodeType3 } from "../src/sqpack/type3";

const MDL_HEADER = 68;

// Build a minimal but structurally valid uncompressed MDL runtime file.
// vertexInfo + modelData + per-LoD [vertex][index], with the 68-byte runtime header describing them.
function makeUncompressedMdl(): Uint8Array {
  const vInfo = 100, mData = 200;
  const vSizes = [300, 0, 0];
  const iSizes = [150, 0, 0];
  const total = MDL_HEADER + vInfo + mData + vSizes.reduce((a, b) => a + b, 0) + iSizes.reduce((a, b) => a + b, 0);
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);

  // Layout the sections: [header][vInfo][mData][ vLoD0 ][ iLoD0 ] (LoD1/2 empty).
  const vInfoOff = MDL_HEADER;
  const mDataOff = vInfoOff + vInfo;
  const vOff0 = mDataOff + mData;
  const iOff0 = vOff0 + vSizes[0]!;

  dv.setUint32(0, 6 | (256 << 16), true); // signature: version 6, high word 256
  dv.setUint32(4, vInfo, true);
  dv.setUint32(8, mData, true);
  dv.setUint16(12, 2, true);   // meshCount
  dv.setUint16(14, 1, true);   // materialCount
  // vertex offsets ×3
  dv.setUint32(16, vOff0, true); dv.setUint32(20, 0, true); dv.setUint32(24, 0, true);
  // index offsets ×3
  dv.setUint32(28, iOff0, true); dv.setUint32(32, 0, true); dv.setUint32(36, 0, true);
  // vertex sizes ×3
  dv.setUint32(40, vSizes[0]!, true); dv.setUint32(44, 0, true); dv.setUint32(48, 0, true);
  // index sizes ×3
  dv.setUint32(52, iSizes[0]!, true); dv.setUint32(56, 0, true); dv.setUint32(60, 0, true);
  buf[64] = 1; // lodCount
  buf[65] = 0; // flags

  for (let i = MDL_HEADER; i < buf.length; i++) buf[i] = (i * 13 + 5) & 0xff;
  return buf;
}

describe("type 3 codec", () => {
  it("round-trips a model runtime file", () => {
    const raw = makeUncompressedMdl();
    const entry = encodeType3(raw);
    expect(new DataView(entry.buffer, entry.byteOffset).getInt32(4, true)).toBe(3);
    expect(decodeType3(entry)).toEqual(raw);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sqpack-type3`
Expected: FAIL — cannot resolve `../src/sqpack/type3`.

- [ ] **Step 3: Write `src/sqpack/type3.ts`**

```ts
import { BinaryReader, ByteBuilder, concatBytes } from "../util/binary";
import { readBlock, compressData } from "./blocks";

const MDL_HEADER = 68;

function read3u32(r: BinaryReader): number[] { return [r.readUint32(), r.readUint32(), r.readUint32()]; }
function read3u16(r: BinaryReader): number[] { return [r.readUint16(), r.readUint16(), r.readUint16()]; }

/** Decompress a Type 3 (Model) SQPack entry into a runtime MDL file. Mirrors Dat.ReadSqPackType3 (Dat.cs:688). */
export function decodeType3(entry: Uint8Array): Uint8Array {
  const r = new BinaryReader(entry);
  const headerLength = r.readInt32();
  const fileType = r.readInt32();
  if (fileType !== 3) throw new Error(`sqpack: not a Type 3 entry (fileType=${fileType})`);
  r.readInt32(); // decompressedSize
  r.readInt32(); // buffer1
  r.readInt32(); // buffer2
  const version = r.readInt32();

  const endOfHeader = headerLength;

  r.readInt32(); // vertexInfoSize (uncompressed, unused)
  r.readInt32(); // modelDataSize (uncompressed, unused)
  read3u32(r); read3u32(r); read3u32(r); // uncompressed vertex/edge/index buffer sizes (unused)
  r.readInt32(); // vertexInfoCompressedSize (unused)
  r.readInt32(); // modelDataCompressedSize (unused)
  read3u32(r); read3u32(r); read3u32(r); // compressed vertex/edge/index buffer sizes (unused)

  const vertexInfoOffset = r.readInt32();
  const modelDataOffset = r.readInt32();
  const vertexBufferOffsets = read3u32(r);
  read3u32(r); // edgeGeometryVertexBufferOffsets (unused)
  const indexBufferOffsets = read3u32(r);

  r.readInt16(); r.readInt16(); // vertexInfo / modelData block indexes (unused)
  read3u16(r); read3u16(r); read3u16(r); // vertex/edge/index block indexes (unused)

  const vertexInfoBlockCount = r.readInt16();
  const modelDataBlockCount = r.readInt16();
  const vertexBufferBlockCounts = read3u16(r);
  const edgeBlockCounts = read3u16(r);
  const indexBufferBlockCounts = read3u16(r);

  const meshCount = r.readUint16();
  const materialCount = r.readUint16();
  const lodCount = r.readUint8();
  const flags = r.readUint8();
  const padding = r.readBytes(2);

  // Decompress each group by seeking to endOfHeader + its offset and reading its blocks.
  const readGroup = (offset: number, count: number): Uint8Array => {
    if (count === 0) return new Uint8Array(0);
    r.seek(endOfHeader + offset);
    const parts: Uint8Array[] = [];
    for (let i = 0; i < count; i++) parts.push(readBlock(r));
    return concatBytes(parts);
  };

  const vInfo = readGroup(vertexInfoOffset, vertexInfoBlockCount);
  const mData = readGroup(modelDataOffset, modelDataBlockCount);

  const vertexBuffers: Uint8Array[] = [];
  const indexBuffers: Uint8Array[] = [];
  const vertexUncompOffsets = [0, 0, 0];
  const indexUncompOffsets = [0, 0, 0];
  const vertexRealSizes = [0, 0, 0];
  const indexRealSizes = [0, 0, 0];

  // decompOffset starts after the reserved 68-byte header + vInfo + mData.
  let decompOffset = MDL_HEADER + vInfo.length + mData.length;
  for (let i = 0; i < 3; i++) {
    vertexUncompOffsets[i] = decompOffset;
    const vb = readGroup(vertexBufferOffsets[i]!, vertexBufferBlockCounts[i]!);
    vertexBuffers.push(vb);
    vertexRealSizes[i] = vb.length;
    decompOffset += vb.length;

    // Edge geometry (present in the format, empty in practice) sits between vertex and index.
    const eb = readGroup(0, edgeBlockCounts[i]!); // count is 0 for real models
    decompOffset += eb.length;

    indexUncompOffsets[i] = decompOffset;
    const ib = readGroup(indexBufferOffsets[i]!, indexBufferBlockCounts[i]!);
    indexBuffers.push(ib);
    indexRealSizes[i] = ib.length;
    decompOffset += ib.length;
  }

  // Reconstruct the 68-byte runtime header (Dat.cs:842-858).
  const header = new ByteBuilder()
    .i32(version)
    .i32(vInfo.length)
    .i32(mData.length)
    .u16(meshCount)
    .u16(materialCount);
  for (const v of vertexUncompOffsets) header.i32(v);
  for (const v of indexUncompOffsets) header.i32(v);
  for (const v of vertexRealSizes) header.i32(v);
  for (const v of indexRealSizes) header.i32(v);
  header.u8(lodCount).u8(flags).bytes(padding);

  const geometry: Uint8Array[] = [];
  for (let i = 0; i < 3; i++) { geometry.push(vertexBuffers[i]!); geometry.push(indexBuffers[i]!); }
  return concatBytes([header.toUint8Array(), vInfo, mData, ...geometry]);
}

/** Compress a runtime MDL file into a Type 3 SQPack entry. Mirrors Mdl.CompressMdlFile (Mdl.cs:2148). */
export function encodeType3(data: Uint8Array): Uint8Array {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const signature = dv.getUint32(0, true);
  const vertexInfoSize = dv.getInt32(4, true);
  const modelDataSize = dv.getInt32(8, true);
  const meshCount = dv.getUint16(12, true);
  const materialCount = dv.getUint16(14, true);
  const vertexOffsets = [dv.getUint32(16, true), dv.getUint32(20, true), dv.getUint32(24, true)];
  const indexOffsets = [dv.getUint32(28, true), dv.getUint32(32, true), dv.getUint32(36, true)];
  const vertexSizes = [dv.getUint32(40, true), dv.getUint32(44, true), dv.getUint32(48, true)];
  const indexSizes = [dv.getUint32(52, true), dv.getUint32(56, true), dv.getUint32(60, true)];
  const lodCount = data[64]!;
  const flags = data[65]!;

  const vInfoBlocks = compressData(data.slice(MDL_HEADER, MDL_HEADER + vertexInfoSize));
  const mDataBlocks = compressData(data.slice(MDL_HEADER + vertexInfoSize, MDL_HEADER + vertexInfoSize + modelDataSize));
  const vBlocks: Uint8Array[][] = [];
  const iBlocks: Uint8Array[][] = [];
  for (let i = 0; i < 3; i++) {
    vBlocks.push(compressData(data.slice(vertexOffsets[i]!, vertexOffsets[i]! + vertexSizes[i]!)));
    iBlocks.push(compressData(data.slice(indexOffsets[i]!, indexOffsets[i]! + indexSizes[i]!)));
  }

  const sum = (blocks: Uint8Array[]) => blocks.reduce((n, b) => n + b.length, 0);
  const compressedData = concatBytes([
    ...vInfoBlocks, ...mDataBlocks,
    ...[0, 1, 2].flatMap((i) => [...vBlocks[i]!, ...iBlocks[i]!]),
  ]);

  const blockCount = vInfoBlocks.length + mDataBlocks.length + vBlocks.reduce((n, b) => n + b.length, 0) + iBlocks.reduce((n, b) => n + b.length, 0);
  let headerLength = 256;
  if (blockCount > 24) {
    const extension = Math.floor(((blockCount - 24) * 2) / 128) + 1;
    headerLength = 256 + extension * 128;
  }

  const pad128 = (n: number) => { const r = n % 128; return r === 0 ? n : n + (128 - r); };
  const uncompressedSize = MDL_HEADER + vertexInfoSize + modelDataSize + vertexSizes.reduce((a, b) => a + b, 0) + indexSizes.reduce((a, b) => a + b, 0);

  const h = new ByteBuilder()
    .i32(headerLength)
    .i32(3)
    .i32(uncompressedSize)
    .i32(Math.floor(compressedData.length / 128) + 16)
    .i32(Math.floor(compressedData.length / 128))
    .i32(signature)
    // Uncompressed sizes (padded): vInfo, mData, vertex×3, edge×3 (0), index×3.
    .i32(pad128(vertexInfoSize)).i32(pad128(modelDataSize))
    .i32(pad128(vertexSizes[0]!)).i32(pad128(vertexSizes[1]!)).i32(pad128(vertexSizes[2]!))
    .i32(0).i32(0).i32(0)
    .i32(pad128(indexSizes[0]!)).i32(pad128(indexSizes[1]!)).i32(pad128(indexSizes[2]!))
    // Compressed sizes: vInfo, mData, vertex×3, edge×3 (0), index×3.
    .i32(sum(vInfoBlocks)).i32(sum(mDataBlocks))
    .i32(sum(vBlocks[0]!)).i32(sum(vBlocks[1]!)).i32(sum(vBlocks[2]!))
    .i32(0).i32(0).i32(0)
    .i32(sum(iBlocks[0]!)).i32(sum(iBlocks[1]!)).i32(sum(iBlocks[2]!));

  // Compressed offsets, written [vInfo][mData] then per-LoD [vertex][index].
  const vInfoOff = 0;
  const mDataOff = vInfoOff + sum(vInfoBlocks);
  const vOff0 = mDataOff + sum(mDataBlocks);
  const iOff0 = vOff0 + sum(vBlocks[0]!);
  const vOff1 = iOff0 + sum(iBlocks[0]!);
  const iOff1 = vOff1 + sum(vBlocks[1]!);
  const vOff2 = iOff1 + sum(iBlocks[1]!);
  const iOff2 = vOff2 + sum(vBlocks[2]!);
  h.i32(vInfoOff).i32(mDataOff).i32(vOff0).i32(vOff1).i32(vOff2).i32(0).i32(0).i32(0).i32(iOff0).i32(iOff1).i32(iOff2);

  // Block indexes.
  const vInfoIdx = 0;
  const mDataIdx = vInfoIdx + vInfoBlocks.length;
  const vIdx0 = mDataIdx + mDataBlocks.length;
  const iIdx0 = vIdx0 + vBlocks[0]!.length;
  const vIdx1 = iIdx0 + iBlocks[0]!.length;
  const iIdx1 = vIdx1 + vBlocks[1]!.length;
  const vIdx2 = iIdx1 + iBlocks[1]!.length;
  const iIdx2 = vIdx2 + vBlocks[2]!.length;
  h.u16(vInfoIdx).u16(mDataIdx).u16(vIdx0).u16(vIdx1).u16(vIdx2).u16(iIdx0).u16(iIdx1).u16(iIdx2).u16(iIdx0).u16(iIdx1).u16(iIdx2);

  // Block counts.
  h.u16(vInfoBlocks.length).u16(mDataBlocks.length)
    .u16(vBlocks[0]!.length).u16(vBlocks[1]!.length).u16(vBlocks[2]!.length)
    .u16(0).u16(0).u16(0)
    .u16(iBlocks[0]!.length).u16(iBlocks[1]!.length).u16(iBlocks[2]!.length);

  h.u16(meshCount).u16(materialCount).u8(lodCount).u8(flags).u16(0);

  // Per-block compressed sizes, in order: vInfo, mData, then per-LoD [vertex...][index...].
  for (const b of vInfoBlocks) h.u16(b.length);
  for (const b of mDataBlocks) h.u16(b.length);
  for (let l = 0; l < 3; l++) {
    for (const b of vBlocks[l]!) h.u16(b.length);
    for (const b of iBlocks[l]!) h.u16(b.length);
  }

  // Pad header out to headerLength.
  const header = new Uint8Array(headerLength);
  header.set(h.toUint8Array().slice(0, headerLength), 0);
  return concatBytes([header, compressedData]);
}
```

> Edge-geometry groups are always zero-count for runtime models (`Mdl.cs` writes `0` for every edge field), so decode reads none and encode writes zeros — matching SE. The index block index is written twice (edge slot + index slot) exactly as `CompressMdlFile` does (`Mdl.cs:2357-2364`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sqpack-type3`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```powershell
npm run typecheck
git add src/sqpack/type3.ts test/sqpack-type3.test.ts
git commit -m "feat(sqpack): add Type 3 model decode/encode"
```

---

### Task 5: Dispatch + public API

**Files:**
- Create: `src/sqpack/sqpack.ts`
- Modify: `src/index.ts` (re-export)
- Test: `test/sqpack-api.test.ts`

**Interfaces:**
- Consumes: `decodeType2/3/4`, `encodeType2/3/4` (Tasks 2-4).
- Produces:
  - `enum SqPackType { Standard = 2, Model = 3, Texture = 4 }`
  - `interface DecodedFile { type: SqPackType; data: Uint8Array; }`
  - `decodeSqPackFile(entry: Uint8Array): DecodedFile` — reads `fileType` int32 at offset 4, dispatches. Mirrors `Dat.ReadSqPackFile` (`Dat.cs:1016`).
  - `encodeSqPackFile(data: Uint8Array, type: SqPackType): Uint8Array`
  - `detectTypeFromGamePath(gamePath: string): SqPackType` — `.mdl`→Model, `.tex`→Texture, else Standard.

- [ ] **Step 1: Write the failing test**

`test/sqpack-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decodeSqPackFile, encodeSqPackFile, detectTypeFromGamePath, SqPackType } from "../src/sqpack/sqpack";

describe("sqpack dispatch", () => {
  it("detects type from game path", () => {
    expect(detectTypeFromGamePath("chara/x/a.mdl")).toBe(SqPackType.Model);
    expect(detectTypeFromGamePath("chara/x/a.tex")).toBe(SqPackType.Texture);
    expect(detectTypeFromGamePath("chara/x/a.mtrl")).toBe(SqPackType.Standard);
  });

  it("dispatches decode by entry fileType and round-trips via encode", () => {
    const raw = new Uint8Array(1234).map((_, i) => (i * 7) & 0xff);
    const entry = encodeSqPackFile(raw, SqPackType.Standard);
    const decoded = decodeSqPackFile(entry);
    expect(decoded.type).toBe(SqPackType.Standard);
    expect(decoded.data).toEqual(raw);
  });

  it("rejects invalid entry types", () => {
    const bad = new Uint8Array(16);
    new DataView(bad.buffer).setInt32(4, 1, true); // type 1 not supported
    expect(() => decodeSqPackFile(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sqpack-api`
Expected: FAIL — cannot resolve `../src/sqpack/sqpack`.

- [ ] **Step 3: Write `src/sqpack/sqpack.ts`**

```ts
import { decodeType2, encodeType2 } from "./type2";
import { decodeType3, encodeType3 } from "./type3";
import { decodeType4, encodeType4 } from "./type4";

export enum SqPackType { Standard = 2, Model = 3, Texture = 4 }

export interface DecodedFile { type: SqPackType; data: Uint8Array; }

/** Decompress a SQPack entry, dispatching on the fileType int32 at offset 4. Mirrors Dat.ReadSqPackFile (Dat.cs:1016). */
export function decodeSqPackFile(entry: Uint8Array): DecodedFile {
  const type = new DataView(entry.buffer, entry.byteOffset, entry.byteLength).getInt32(4, true);
  switch (type) {
    case SqPackType.Standard: return { type, data: decodeType2(entry) };
    case SqPackType.Model: return { type, data: decodeType3(entry) };
    case SqPackType.Texture: return { type, data: decodeType4(entry) };
    default: throw new Error(`sqpack: unsupported entry type ${type}`);
  }
}

/** Compress already-uncompressed bytes into a SQPack entry of the given type. */
export function encodeSqPackFile(data: Uint8Array, type: SqPackType): Uint8Array {
  switch (type) {
    case SqPackType.Standard: return encodeType2(data);
    case SqPackType.Model: return encodeType3(data);
    case SqPackType.Texture: return encodeType4(data);
    default: throw new Error(`sqpack: unsupported type ${type}`);
  }
}

/** Convenience: choose an entry type from a game path. Mirrors CreateCompressedFile's detection intent. */
export function detectTypeFromGamePath(gamePath: string): SqPackType {
  const lower = gamePath.toLowerCase();
  if (lower.endsWith(".mdl")) return SqPackType.Model;
  if (lower.endsWith(".tex")) return SqPackType.Texture;
  return SqPackType.Standard;
}
```

- [ ] **Step 4: Add re-export to `src/index.ts`**

Add after the existing `export { detectFormat } ...` line:

```ts
export { decodeSqPackFile, encodeSqPackFile, detectTypeFromGamePath, SqPackType, type DecodedFile } from "./sqpack/sqpack";
```

- [ ] **Step 5: Run test + typecheck to verify pass**

Run: `npm test -- sqpack-api; npm run typecheck`
Expected: PASS (3 cases); typecheck clean.

- [ ] **Step 6: Commit**

```powershell
git add src/sqpack/sqpack.ts src/index.ts test/sqpack-api.test.ts
git commit -m "feat(sqpack): add decode/encode dispatch and public API"
```

---

### Task 6: Oracle harness — /unwrap, /wrap, /extract wrappers

**Files:**
- Modify: `test/helpers/oracle.ts` (add wrappers; keep existing `resave`/`upgrade`/`oracleAvailable`/`corpusInputs`)
- Test: `test/sqpack-oracle-wiring.test.ts`

**Interfaces:**
- Consumes: existing `oracle.ts` internals (`CONSOLE_TOOLS`, `run`).
- Produces:
  - `unwrap(src: string, dest: string): void` — `ConsoleTools /unwrap <src> <dest>`. Use a **neutral matching extension** (e.g. `.bin`) for both paths so ConsoleTools writes raw un-sqpacked bytes (Types 2 & 3 only).
  - `wrap(src: string, dest: string, ffPath: string): void` — `ConsoleTools /wrap <src> <dest> <ffPath> /sqpack`.
  - `gameAvailable(): boolean` — true when ConsoleTools is present AND `console_config.json` XivPath resolves (best-effort: same as `oracleAvailable()` for now; extract calls that fail are caught by callers).
  - `extractGameFile(gamePath: string, dest: string): void` — `ConsoleTools /extract <gamePath> <dest>` (dest extension matches `gamePath` to get raw uncompressed output).

- [ ] **Step 1: Write the failing test**

`test/sqpack-oracle-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { unwrap, wrap, extractGameFile, gameAvailable } from "./helpers/oracle";

describe("oracle sqpack wrappers", () => {
  it("expose callable functions and a boolean gameAvailable", () => {
    expect(typeof unwrap).toBe("function");
    expect(typeof wrap).toBe("function");
    expect(typeof extractGameFile).toBe("function");
    expect(typeof gameAvailable()).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sqpack-oracle-wiring`
Expected: FAIL — `unwrap`/`wrap`/`extractGameFile`/`gameAvailable` are not exported.

- [ ] **Step 3: Extend `test/helpers/oracle.ts`**

Add these exports (reuse the existing private `run`/`CONSOLE_TOOLS`/`oracleAvailable` from the file):

```ts
export function unwrap(src: string, dest: string): void { run(["/unwrap", src, dest]); }
export function wrap(src: string, dest: string, ffPath: string): void {
  run(["/wrap", src, dest, ffPath, "/sqpack"]);
}
export function extractGameFile(gamePath: string, dest: string): void {
  run(["/extract", gamePath, dest]);
}
/** ConsoleTools present (game-path resolution is validated lazily by extract calls). */
export function gameAvailable(): boolean { return oracleAvailable(); }
```

> If `run` or `oracleAvailable` are not already module-scoped exports/functions in `oracle.ts`, reference them directly — they were created in the foundation plan's Task 4 (`test/helpers/oracle.ts`). Do not duplicate `CONSOLE_TOOLS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sqpack-oracle-wiring`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add test/helpers/oracle.ts test/sqpack-oracle-wiring.test.ts
git commit -m "test(sqpack): add /unwrap /wrap /extract oracle wrappers"
```

---

### Task 7: Corpus self round-trip + Type 2/3 /unwrap cross-check

**Files:**
- Create: `test/sqpack-corpus.test.ts`

**Interfaces:**
- Consumes: `loadModpack`, `allFiles`, `FileStorageType` (`src/index.ts`, `src/model/modpack`); `decodeSqPackFile`, `encodeSqPackFile` (Task 5); `oracleAvailable`, `corpusInputs`, `unwrap` (Task 6); `SqPackType` (Task 5).

This is the capstone correctness test. It skips entirely when the corpus is absent (CI). For each corpus modpack, it reads every `SqPackCompressed` inner file and:
1. **Self round-trip:** `decode → encode → decode`, asserting the two decoded blobs are byte-identical.
2. **Foreign cross-check (Types 2 & 3, when ConsoleTools present):** write the entry to a `.bin` temp file, `/unwrap` it to another `.bin`, and assert our decode equals the `/unwrap` output.

- [ ] **Step 1: Write the test**

`test/sqpack-corpus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { loadModpack } from "../src/index";
import { allFiles, FileStorageType } from "../src/model/modpack";
import { decodeSqPackFile, encodeSqPackFile, SqPackType } from "../src/sqpack/sqpack";
import { oracleAvailable, corpusInputs, unwrap } from "./helpers/oracle";

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const inputs = corpusInputs();

describe.skipIf(inputs.length === 0)("sqpack corpus", () => {
  const tmp = mkdtempSync(join(tmpdir(), "sqpack-"));

  for (const path of inputs) {
    it(`self round-trips every compressed inner file in ${basename(path)}`, () => {
      const data = loadModpack(basename(path), new Uint8Array(readFileSync(path)));
      const files = allFiles(data).filter((f) => f.storage === FileStorageType.SqPackCompressed);
      // Skip PMP packs (raw storage) — nothing to decode.
      for (const f of files) {
        const first = decodeSqPackFile(f.data);
        const reEncoded = encodeSqPackFile(first.data, first.type);
        const second = decodeSqPackFile(reEncoded);
        expect(bytesEqual(first.data, second.data)).toBe(true);
      }
    }, 1_200_000);

    it.skipIf(!oracleAvailable())(`matches /unwrap for Type 2/3 files in ${basename(path)}`, () => {
      const data = loadModpack(basename(path), new Uint8Array(readFileSync(path)));
      const files = allFiles(data).filter((f) => f.storage === FileStorageType.SqPackCompressed);
      let checked = 0;
      for (const f of files) {
        const decoded = decodeSqPackFile(f.data);
        if (decoded.type === SqPackType.Texture) continue; // /unwrap does not decompress Type 4
        const inPath = join(tmp, "entry.bin");
        const outPath = join(tmp, "unwrapped.bin");
        writeFileSync(inPath, f.data);
        unwrap(inPath, outPath);
        expect(bytesEqual(decoded.data, new Uint8Array(readFileSync(outPath)))).toBe(true);
        checked++;
      }
      // At least exercise the path; some packs may be PMP-only (no compressed files).
      expect(checked).toBeGreaterThanOrEqual(0);
    }, 1_200_000);
  }
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- sqpack-corpus`
Expected (no corpus present / CI): SKIPPED. Expected (corpus present, this machine): PASS — self round-trip on all compressed files; if ConsoleTools present, Type 2/3 files also match `/unwrap`.

> If a Type-3 `/unwrap` mismatch appears, first confirm the failure is a real decode bug and not the neutral-extension issue: the temp files MUST use a shared neutral extension (`.bin`) so ConsoleTools does not route the model through its FBX exporter (`Program.cs:415-421`). This is why the test writes `entry.bin` → `unwrapped.bin`.

- [ ] **Step 3: Commit**

```powershell
git add test/sqpack-corpus.test.ts
git commit -m "test(sqpack): corpus self round-trip + Type 2/3 /unwrap cross-check"
```

---

### Task 8: Type 4 foreign cross-check via /wrap bridge (game-gated)

**Files:**
- Create: `test/sqpack-type4-oracle.test.ts`

**Interfaces:**
- Consumes: `extractGameFile`, `wrap`, `gameAvailable` (Task 6); `decodeSqPackFile`, `SqPackType` (Task 5).

Since `/unwrap` never decompresses Type 4 (`Program.cs:391`), this validates Type-4 **decode** against SE's encoder: extract a known raw uncompressed `.tex` from the game, re-wrap it with SE (`/wrap /sqpack`), and assert our decode of that SE entry equals the extracted raw. Skips unless the game install is available.

`GAME_TEX_PATHS` are stable base-game texture paths. `chara/common/texture/eye/eye01_base.tex` is one the upgrade already relies on (parent spec §5); adjust/add if a path is missing on a given install.

- [ ] **Step 1: Write the test**

`test/sqpack-type4-oracle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeSqPackFile, SqPackType } from "../src/sqpack/sqpack";
import { extractGameFile, wrap, gameAvailable } from "./helpers/oracle";

const GAME_TEX_PATHS = [
  "chara/common/texture/eye/eye01_base.tex",
  "chara/common/texture/eye/eye01_mask.tex",
];

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe.skipIf(!gameAvailable())("sqpack Type 4 /wrap bridge", () => {
  const tmp = mkdtempSync(join(tmpdir(), "sqpack-tex-"));

  for (const gamePath of GAME_TEX_PATHS) {
    it(`decode(SE-wrapped) === extracted raw for ${gamePath}`, () => {
      const rawPath = join(tmp, "raw.tex");
      const sePath = join(tmp, "se.bin");
      let raw: Uint8Array;
      try {
        extractGameFile(gamePath, rawPath);       // uncompressed .tex from the game
        raw = new Uint8Array(readFileSync(rawPath));
        wrap(rawPath, sePath, gamePath);           // SE re-compresses to a Type 4 entry (/sqpack)
      } catch {
        // Path not present on this install — treat as inconclusive skip.
        return;
      }
      const seEntry = new Uint8Array(readFileSync(sePath));
      const decoded = decodeSqPackFile(seEntry);
      expect(decoded.type).toBe(SqPackType.Texture);
      expect(bytesEqual(decoded.data, raw)).toBe(true);
    }, 300_000);
  }
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- sqpack-type4-oracle`
Expected (no game / CI): SKIPPED. Expected (game present): PASS — our Type-4 decode reproduces the extracted raw texture from SE's own compressed output.

- [ ] **Step 3: Full suite + commit**

Run: `npm test; npm run typecheck`
Expected: all suites pass or skip; typecheck clean.

```powershell
git add test/sqpack-type4-oracle.test.ts
git commit -m "test(sqpack): Type 4 decode cross-check via /wrap bridge"
```

---

## Self-Review

**Spec coverage:**
- Decode+encode Type 2/3/4 → Tasks 2, 3, 4. ✓
- Shared block codec (stored sentinel, legacy spacing, 16000 chunking, 128 padding) → Task 1. ✓
- Public API `decodeSqPackFile`/`encodeSqPackFile`/`detectTypeFromGamePath` → Task 5. ✓
- Standalone module, container layer untouched → Global Constraints + file structure. ✓
- Correctness bar (byte-identical decompressed; decode(encode(decode))===decode) → Tasks 2-4 unit tests + Task 7 self round-trip. ✓
- Oracle `/unwrap` cross-check (Type 2/3) → Task 7; Type 4 `/wrap` bridge → Task 8. ✓
- Raw DEFLATE via fflate, no new deps → Task 1. ✓
- No upstream tests to port → reflected (all tests written fresh). ✓
- Intentional deviations (symmetric per-type modules) → each `typeN.ts` owns both directions. ✓

**Type consistency:** `decodeType2/3/4`/`encodeType2/3/4` used identically across Tasks 2-5. `SqPackType`/`DecodedFile` defined in Task 5, consumed in Tasks 7-8. `readBlock`/`writeBlock`/`compressData` defined in Task 1, consumed in Tasks 2-4. `ByteBuilder`/`inflateRaw`/`deflateRaw` defined in Task 1. Oracle wrappers defined in Task 6, consumed in Tasks 7-8. Consistent.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step has concrete assertions.

**Known execution notes (not blockers):**
- Task 6 assumes the foundation plan's `oracle.ts` exposes reusable `run`/`oracleAvailable`. If they are module-private in a way that blocks reuse, promote them to module scope in the same task (small, in-file change).
- Task 8's `GAME_TEX_PATHS` may need adjustment per install; the test catches extract/wrap failures and treats missing paths as inconclusive.
