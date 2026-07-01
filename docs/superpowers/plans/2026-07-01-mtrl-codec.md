# MTRL Codec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `src/mtrl/` module that parses a raw uncompressed `.mtrl` (material) file into a structured `XivMtrl` model and serializes it back to byte-identical bytes.

**Architecture:** A model/parse/serialize split (`types.ts` + `parse.ts` + `serialize.ts`) with the two bit-exact sub-problems — colorset Half rows and the dye blob — isolated in `colorset.ts` and `dye.ts`. Zero changes to the container, model, or SQPack layers except additive binary helpers and an `index.ts` re-export. Later transform stages compose the codecs on demand: `decodeSqPackFile → parseMtrl → transform → serializeMtrl → encodeSqPackFile`. Correctness is anchored on a byte-identical **self round-trip** (`serializeMtrl(parseMtrl(x)) === x`) over the real corpus, plus synthetic oracle-free units.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

## Global Constraints

- **Package min-age:** No new dependencies are added by this plan. If that changes, every dependency must be a release ≥7 days old, pinned EXACT, lockfile committed.
- **Platform:** Windows + PowerShell for all shell/test invocation. Use `npm`.
- **Correctness bar (spec §1):** `serializeMtrl(parseMtrl(x))` is **byte-for-byte identical** to `x` for canonical SE/TexTools `.mtrl` files, validated over the corpus (Task 7).
- **Standalone module:** Do NOT modify `src/container/*`, `src/model/*`, `src/sqpack/*`, or their tests. The only edits outside `src/mtrl/` are additive helpers in `src/util/binary.ts` and re-exports in `src/index.ts`.
- **Reference C# source:** `./reference/xivModdingFramework/` (git-ignored). Cite when verifying format details. Key files: `xivModdingFramework/Materials/FileTypes/Mtrl.cs` (`GetXivMtrl` @174, `XivMtrlToUncompressedMtrl` @556), `xivModdingFramework/Materials/DataContainers/XivMtrl.cs` (model + computed getters), `xivModdingFramework/Materials/DataContainers/ShaderHelpers.cs:480` (`ESamplerId`).
- **No foreign oracle at this layer:** ConsoleTools exposes no command that runs a single `.mtrl` through parse→reserialize, so the corpus self round-trip + synthetic units are the whole gate (spec §3, §7).
- **Endianness:** All MTRL integers are little-endian. Colorset values are raw IEEE-754 half-float `uint16`s; shader constants are IEEE-754 `float32`.
- **License:** New files carry the repo's SPDX/GPL header (copy the 5-line header from `src/util/binary.ts`). Bundled fixtures (Task 8) are GPL-3.0 framework resources — covered by the existing NOTICE attribution.

---

## Testing Strategy

Written TDD-style (spec §7). Synthetic units and the synthetic full-file round-trip are the failing tests written first; the corpus self round-trip is the ground-truth gate. All corpus/fixture-optional tests skip gracefully when their inputs are absent (CI has none), following the repo's existing `corpusInputs()`/`describe.skipIf` pattern.

1. **Synthetic unit tests (oracle-free, first).** `types` computed helpers; `colorset` EW/DT read↔write byte-exact; `dye` EW/DT/none carried verbatim + wrong-length rejected; `parse` of a hand-built structurally-valid file; `samplers` single-UV / double-UV (secondary regenerated on write, dropped on parse) / index-255 empty sampler.
2. **Synthetic full-file round-trip.** `serializeMtrl(parseMtrl(x)) === x` over the hand-built minimal file.
3. **Corpus self round-trip (the real gate).** Every `.mtrl` inner file across the corpus: `decodeSqPackFile(entry).data → parseMtrl → serializeMtrl`, assert byte-identical to the decoded input; log + triage any mismatch.
4. **Bundled fixtures (optional).** The framework's `default_material.mtrl` (EW) and `default_material_dt.mtrl` (DT) copied into `test/fixtures/` seed one EW-format and one DT-format round-trip that runs without the corpus.

---

## File Structure

```
src/util/binary.ts        MODIFY: BinaryReader.readFloat32 + readNullTerminatedString; ByteBuilder.u32 + f32   (Task 1)
src/mtrl/types.ts          CREATE: XivMtrl model + supporting types + computed helpers + sampler constants        (Task 1)
src/mtrl/colorset.ts       CREATE: readColorset / writeColorset (Half rows, byte-exact)                            (Task 2)
src/mtrl/dye.ts            CREATE: readDye / writeDye (raw blob, length-validated)                                 (Task 3)
src/mtrl/parse.ts          CREATE: parseMtrl(bytes, mtrlPath?)            (~ GetXivMtrl)                            (Task 4)
src/mtrl/serialize.ts      CREATE: serializeMtrl(mtrl)                    (~ XivMtrlToUncompressedMtrl)             (Task 5)
src/mtrl/mtrl.ts           CREATE: public API (parseMtrl / serializeMtrl + type re-exports)                        (Task 5)
src/index.ts               MODIFY: re-export the mtrl public API                                                   (Task 5)
test/helpers/make-mtrl.ts  CREATE: hand-built canonical .mtrl byte builders                                        (Task 4, extended Task 6)
test/mtrl-types.test.ts    CREATE                                                                                  (Task 1)
test/mtrl-colorset.test.ts CREATE                                                                                  (Task 2)
test/mtrl-dye.test.ts      CREATE                                                                                  (Task 3)
test/mtrl-parse.test.ts    CREATE                                                                                  (Task 4)
test/mtrl-roundtrip.test.ts CREATE                                                                                 (Task 5)
test/mtrl-samplers.test.ts CREATE                                                                                  (Task 6)
test/mtrl-corpus.test.ts   CREATE: corpus self round-trip; skips gracefully                                        (Task 7)
test/mtrl-fixtures.test.ts CREATE: EW + DT default-material round-trip; skips if fixtures absent                   (Task 8)
```

---

### Task 1: Binary helpers + data model

**Files:**
- Modify: `src/util/binary.ts` (add reader methods + builder methods)
- Create: `src/mtrl/types.ts`
- Test: `test/mtrl-types.test.ts`

**Interfaces:**
- Consumes: existing `BinaryReader`, `ByteBuilder`.
- Produces:
  - `BinaryReader.readFloat32(): number` (advances `pos` by 4)
  - `BinaryReader.readNullTerminatedString(): string` (reads UTF-8 bytes until `0x00`, consumes the terminator)
  - `ByteBuilder.u32(v: number): this`, `ByteBuilder.f32(v: number): this`
  - `src/mtrl/types.ts` exporting: `XivMtrl`, `MtrlTexture`, `MtrlString`, `ShaderKey`, `ShaderConstant`, `TextureSampler`; `EMPTY_SAMPLER_PREFIX`; sampler-id constants; `isEmptySampler(t)`, `colorSetDataSize(m)`, `shaderConstantsDataSize(m)`, `secondarySamplerId(rawId)`, `isPrimaryMapSampler(rawId)`, `getRealSamplerCount(m)`.

- [ ] **Step 1: Write the failing test**

`test/mtrl-types.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import {
  colorSetDataSize, shaderConstantsDataSize, getRealSamplerCount,
  isPrimaryMapSampler, secondarySamplerId,
  SAMPLER_NORMAL_MAP_0, SAMPLER_NORMAL_MAP_1, SAMPLER_COLOR_MAP_1,
  type XivMtrl,
} from "../src/mtrl/types";

function baseMtrl(): XivMtrl {
  return {
    signature: 0x00000301, shaderPackRaw: "character.shpk",
    additionalData: new Uint8Array(4), textures: [], uvMapStrings: [],
    colorsetStrings: [], colorSetData: [], colorSetDyeData: new Uint8Array(0),
    shaderKeys: [], shaderConstants: [], materialFlags: 0, materialFlags2: 0, mtrlPath: "",
  };
}

describe("mtrl computed helpers", () => {
  it("computes colorSetDataSize as data*2 + dye", () => {
    const m = baseMtrl();
    m.colorSetData = new Array(256).fill(0);
    m.colorSetDyeData = new Uint8Array(32);
    expect(colorSetDataSize(m)).toBe(544); // 256*2 + 32
  });

  it("computes shaderConstantsDataSize as sum of values*4", () => {
    const m = baseMtrl();
    m.shaderConstants = [{ constantId: 1, values: [0, 0, 0] }, { constantId: 2, values: [0] }];
    expect(shaderConstantsDataSize(m)).toBe(16); // (3 + 1) * 4
  });

  it("maps primary Map0 samplers to their secondary and rejects others", () => {
    expect(isPrimaryMapSampler(SAMPLER_NORMAL_MAP_0)).toBe(true);
    expect(secondarySamplerId(SAMPLER_NORMAL_MAP_0)).toBe(SAMPLER_NORMAL_MAP_1);
    expect(isPrimaryMapSampler(SAMPLER_NORMAL_MAP_1)).toBe(false);
    expect(secondarySamplerId(0x12345678)).toBeUndefined();
  });

  it("single-UV real sampler count is just samplers present", () => {
    const m = baseMtrl();
    m.uvMapStrings = [{ value: "uv1", flags: 0 }];
    m.textures = [{ texturePath: "n.tex", flags: 0, sampler: { samplerIdRaw: SAMPLER_NORMAL_MAP_0, samplerSettingsRaw: 0 } }];
    expect(getRealSamplerCount(m)).toBe(1);
  });

  it("double-UV Map0 sampler is double-counted unless its secondary already exists", () => {
    const m = baseMtrl();
    m.uvMapStrings = [{ value: "uv1", flags: 0 }, { value: "uv2", flags: 0 }];
    m.textures = [{ texturePath: "n.tex", flags: 0, sampler: { samplerIdRaw: SAMPLER_NORMAL_MAP_0, samplerSettingsRaw: 0 } }];
    expect(getRealSamplerCount(m)).toBe(2); // primary + regenerated secondary

    // If another texture already carries the secondary, it is not double-counted.
    m.textures.push({ texturePath: "n2.tex", flags: 0, sampler: { samplerIdRaw: SAMPLER_NORMAL_MAP_1, samplerSettingsRaw: 0 } });
    expect(getRealSamplerCount(m)).toBe(2); // 2 present, no extra double-write
    expect(SAMPLER_COLOR_MAP_1).toBeGreaterThan(0); // constant is exported
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- mtrl-types`
Expected: FAIL — cannot resolve `../src/mtrl/types`.

- [ ] **Step 3: Extend `src/util/binary.ts`**

Add these methods inside the `BinaryReader` class (after `readBytes`):

```ts
  readFloat32(): number { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  readNullTerminatedString(): string {
    const start = this.pos;
    while (this.view.getUint8(this.pos) !== 0) this.pos += 1;
    const s = new TextDecoder().decode(this.bytes.subarray(start, this.pos));
    this.pos += 1; // consume the null terminator
    return s;
  }
```

Add these methods inside the `ByteBuilder` class (after `u16`):

```ts
  u32(v: number): this {
    this.parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  f32(v: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    this.parts.push(b[0]!, b[1]!, b[2]!, b[3]!);
    return this;
  }
```

> `readNullTerminatedString` mirrors `IOUtil.ReadNullTerminatedString` (`IOUtil.cs:472`) — UTF-8, terminator consumed. `u32` writes the same 4 little-endian bytes as `i32` for any 32-bit pattern but reads intent-clearly for unsigned sampler/key ids; `f32` writes an IEEE-754 float32 matching C#'s `BitConverter.GetBytes(float)`.

- [ ] **Step 4: Write `src/mtrl/types.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

// Internal marker for placeholder textures that only hold an empty (index-255) sampler.
// Never appears in output bytes (placeholders are excluded from the texture count and string
// block). Lowercase so it survives serialize's path lowercasing — see serialize.ts. The C#
// prefix "_EMPTY_SAMPLER_" (Mtrl.cs:70) is uppercase; the exact casing is internal-only.
export const EMPTY_SAMPLER_PREFIX = "_empty_sampler_";

// ESamplerId raw values needed for the sampler double-write decision (ShaderHelpers.cs:480).
export const SAMPLER_NORMAL_MAP_0 = 0xaab4d9e9;
export const SAMPLER_NORMAL_MAP_1 = 0xddb3e97f;
export const SAMPLER_SPECULAR_MAP_0 = 0x1bbc2f12;
export const SAMPLER_SPECULAR_MAP_1 = 0x6cbb1f84;
export const SAMPLER_COLOR_MAP_0 = 0x1e6fef9c;
export const SAMPLER_COLOR_MAP_1 = 0x6968df0a;

export interface TextureSampler {
  samplerIdRaw: number;      // ESamplerId raw CRC (uint32)
  samplerSettingsRaw: number; // packed tiling/LoD settings (uint32)
}

export interface MtrlTexture {
  texturePath: string;
  flags: number;             // ushort
  sampler?: TextureSampler;  // absent when the file bound no sampler to this texture
}

export interface MtrlString {
  value: string;
  flags: number;             // ushort
}

export interface ShaderKey {
  keyId: number;             // uint32
  value: number;             // uint32
}

export interface ShaderConstant {
  constantId: number;        // uint32
  values: number[];          // float32 values
}

export interface XivMtrl {
  signature: number;                 // int32 (default 0x00000301)
  shaderPackRaw: string;             // shader-pack name (e.g. "character.shpk")
  additionalData: Uint8Array;        // opaque; byte 0 carries the 0x08 dye flag
  textures: MtrlTexture[];
  uvMapStrings: MtrlString[];
  colorsetStrings: MtrlString[];
  colorSetData: number[];            // raw half-float uint16s (Half.RawValue); byte-exact
  colorSetDyeData: Uint8Array;       // raw dye blob (0/32/128 bytes)
  shaderKeys: ShaderKey[];
  shaderConstants: ShaderConstant[];
  materialFlags: number;             // ushort (EMaterialFlags1)
  materialFlags2: number;            // ushort (EMaterialFlags2)
  mtrlPath: string;                  // carried for later transform use; does not affect bytes
}

export function isEmptySampler(tex: MtrlTexture): boolean {
  return tex.texturePath.startsWith(EMPTY_SAMPLER_PREFIX);
}

/** Recomputed colorset section size (XivMtrl.cs:105): data halves*2 + dye length. */
export function colorSetDataSize(m: XivMtrl): number {
  return m.colorSetData.length * 2 + m.colorSetDyeData.length;
}

/** Recomputed shader-constant float-block size (XivMtrl.cs:150): sum of values*4. */
export function shaderConstantsDataSize(m: XivMtrl): number {
  let size = 0;
  for (const c of m.shaderConstants) size += c.values.length * 4;
  return size;
}

/** Maps a primary Map0 sampler id to its secondary Map1 id, or undefined if not a primary map. */
export function secondarySamplerId(rawId: number): number | undefined {
  switch (rawId) {
    case SAMPLER_COLOR_MAP_0: return SAMPLER_COLOR_MAP_1;
    case SAMPLER_SPECULAR_MAP_0: return SAMPLER_SPECULAR_MAP_1;
    case SAMPLER_NORMAL_MAP_0: return SAMPLER_NORMAL_MAP_1;
    default: return undefined;
  }
}

export function isPrimaryMapSampler(rawId: number): boolean {
  return secondarySamplerId(rawId) !== undefined;
}

/** Number of samplers written to disk, counting secondary double-writes (XivMtrl.cs:262). */
export function getRealSamplerCount(m: XivMtrl): number {
  let total = m.textures.filter((t) => t.sampler).length;
  if (m.uvMapStrings.length <= 1) return total;
  for (const tex of m.textures) {
    if (!tex.sampler) continue;
    const secondary = secondarySamplerId(tex.sampler.samplerIdRaw);
    if (secondary === undefined) continue;
    if (m.textures.some((x) => x.sampler && x.sampler.samplerIdRaw === secondary)) continue;
    total++;
  }
  return total;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- mtrl-types`
Expected: PASS (5 cases).

- [ ] **Step 6: Typecheck + commit**

```powershell
npm run typecheck
git add src/util/binary.ts src/mtrl/types.ts test/mtrl-types.test.ts
git commit -m "feat(mtrl): add data model, computed helpers, and binary helpers"
```

---

### Task 2: Colorset codec

**Files:**
- Create: `src/mtrl/colorset.ts`
- Test: `test/mtrl-colorset.test.ts`

**Interfaces:**
- Consumes: `BinaryReader`, `ByteBuilder` (Task 1).
- Produces:
  - `readColorset(r: BinaryReader, colorDataSize: number): number[]` — reads `colorDataSize/2` raw half-float uint16s (`Mtrl.cs:274`).
  - `writeColorset(b: ByteBuilder, colorSetData: number[]): void` — writes each raw uint16 (`Mtrl.cs:677`).

- [ ] **Step 1: Write the failing test**

`test/mtrl-colorset.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { BinaryReader, ByteBuilder } from "../src/util/binary";
import { readColorset, writeColorset } from "../src/mtrl/colorset";

function roundtrip(colorDataSize: number): void {
  const values: number[] = [];
  for (let i = 0; i < colorDataSize / 2; i++) values.push((i * 37 + 11) & 0xffff);
  const b = new ByteBuilder();
  writeColorset(b, values);
  const bytes = b.toUint8Array();
  expect(bytes.length).toBe(colorDataSize);
  const out = readColorset(new BinaryReader(bytes), colorDataSize);
  expect(out).toEqual(values);
}

describe("mtrl colorset codec", () => {
  it("round-trips a 512-byte (EW) colorset byte-exact", () => roundtrip(512));
  it("round-trips a 2048-byte (DT) colorset byte-exact", () => roundtrip(2048));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- mtrl-colorset`
Expected: FAIL — cannot resolve `../src/mtrl/colorset`.

- [ ] **Step 3: Write `src/mtrl/colorset.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { BinaryReader, ByteBuilder } from "../util/binary";

/**
 * Reads the colorset as colorDataSize/2 raw half-float uint16s (Half.RawValue), byte-exact.
 * Mirrors the Half list read inside Mtrl.GetXivMtrl (Mtrl.cs:274).
 */
export function readColorset(r: BinaryReader, colorDataSize: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < colorDataSize / 2; i++) out.push(r.readUint16());
  return out;
}

/** Writes each raw half-float uint16 back verbatim. Mirrors Mtrl.XivMtrlToUncompressedMtrl (Mtrl.cs:677). */
export function writeColorset(b: ByteBuilder, colorSetData: number[]): void {
  for (const v of colorSetData) b.u16(v);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- mtrl-colorset`
Expected: PASS (2 cases).

- [ ] **Step 5: Typecheck + commit**

```powershell
npm run typecheck
git add src/mtrl/colorset.ts test/mtrl-colorset.test.ts
git commit -m "feat(mtrl): add colorset Half-row codec"
```

---

### Task 3: Dye codec

**Files:**
- Create: `src/mtrl/dye.ts`
- Test: `test/mtrl-dye.test.ts`

**Interfaces:**
- Consumes: `BinaryReader`, `ByteBuilder` (Task 1).
- Produces:
  - `readDye(r: BinaryReader, len: number): Uint8Array` — reads exactly `len` bytes; throws unless `len ∈ {0, 32, 128}` (`Mtrl.cs:294/320`).
  - `writeDye(b: ByteBuilder, dye: Uint8Array): void` — appends the blob verbatim; throws unless `dye.length ∈ {0, 32, 128}`.

- [ ] **Step 1: Write the failing test**

`test/mtrl-dye.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { BinaryReader, ByteBuilder } from "../src/util/binary";
import { readDye, writeDye } from "../src/mtrl/dye";

function roundtrip(len: number): void {
  const dye = new Uint8Array(len).map((_, i) => (i * 5 + 1) & 0xff);
  const b = new ByteBuilder();
  writeDye(b, dye);
  const bytes = b.toUint8Array();
  expect(bytes.length).toBe(len);
  expect(readDye(new BinaryReader(bytes), len)).toEqual(dye);
}

describe("mtrl dye codec", () => {
  it("carries an Endwalker (32-byte) dye blob verbatim", () => roundtrip(32));
  it("carries a Dawntrail (128-byte) dye blob verbatim", () => roundtrip(128));
  it("carries a zero-length (no dye) blob verbatim", () => roundtrip(0));

  it("rejects an invalid read length", () => {
    expect(() => readDye(new BinaryReader(new Uint8Array(64)), 64)).toThrow(/invalid dye length/);
  });

  it("rejects an invalid write length", () => {
    expect(() => writeDye(new ByteBuilder(), new Uint8Array(16))).toThrow(/invalid dye length/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- mtrl-dye`
Expected: FAIL — cannot resolve `../src/mtrl/dye`.

- [ ] **Step 3: Write `src/mtrl/dye.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { BinaryReader, ByteBuilder } from "../util/binary";

function assertDyeLength(len: number): void {
  if (len !== 0 && len !== 32 && len !== 128) {
    throw new Error(`mtrl: invalid dye length ${len} (expected 0, 32, or 128)`);
  }
}

/**
 * Reads a dye blob of exactly len bytes, kept as a raw Uint8Array like XivMtrl.ColorSetDyeData
 * (a byte[]). The reference does not unpack the dye bitfields; neither do we (Mtrl.cs:294/320).
 */
export function readDye(r: BinaryReader, len: number): Uint8Array {
  assertDyeLength(len);
  return r.readBytes(len);
}

/** Appends the raw dye blob verbatim, validating its length. */
export function writeDye(b: ByteBuilder, dye: Uint8Array): void {
  assertDyeLength(dye.length);
  b.bytes(dye);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- mtrl-dye`
Expected: PASS (5 cases).

- [ ] **Step 5: Typecheck + commit**

```powershell
npm run typecheck
git add src/mtrl/dye.ts test/mtrl-dye.test.ts
git commit -m "feat(mtrl): add dye-blob codec"
```

---

### Task 4: Parse (`GetXivMtrl` port) + test byte builder

**Files:**
- Create: `src/mtrl/parse.ts`
- Create: `test/helpers/make-mtrl.ts`
- Test: `test/mtrl-parse.test.ts`

**Interfaces:**
- Consumes: `BinaryReader` (Task 1); `readColorset` (Task 2); `readDye` (Task 3); model types + `EMPTY_SAMPLER_PREFIX` + `isPrimaryMapSampler` (Task 1).
- Produces:
  - `parseMtrl(bytes: Uint8Array, mtrlPath?: string): XivMtrl` — mirrors `Mtrl.GetXivMtrl` (`Mtrl.cs:174`).
  - `test/helpers/make-mtrl.ts` exporting `buildMinimalMtrl(): Uint8Array` — a hand-built canonical single-UV `.mtrl` (1 texture + 1 UV map + EW colorset + EW dye + 1 shader key + 1 shader constant + 1 NormalMap0 sampler).

- [ ] **Step 1: Write the test byte builder**

`test/helpers/make-mtrl.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { ByteBuilder } from "../../src/util/binary";
import { SAMPLER_NORMAL_MAP_0 } from "../../src/mtrl/types";

const enc = new TextEncoder();

/**
 * A hand-built canonical single-UV .mtrl in the exact layout serializeMtrl produces:
 * header, texture/uv offset tables, string block (padded to 4), additionalData,
 * EW colorset (512 bytes) + EW dye (32 bytes), shader block (1 key, 1 constant),
 * one NormalMap0 sampler on texture 0, then the 4-byte float data block.
 */
export function buildMinimalMtrl(): Uint8Array {
  // String block: "test.tex\0" @0 (9), "uv1\0" @9 (4), "character.shpk\0" @13 (15) = 28 (already %4).
  const stringBlockSize = 28;
  const shaderNameOffset = 13;

  const b = new ByteBuilder();
  b.i32(0x00000301);        // signature
  const fileSizePos = b.length;
  b.u16(0);                 // fileSize (backfilled below)
  b.u16(544);               // colorSetDataSize = 512 colorset + 32 EW dye
  b.u16(stringBlockSize);
  b.u16(shaderNameOffset);
  b.u8(1);                  // texCount
  b.u8(1);                  // mapCount
  b.u8(0);                  // colorsetCount
  b.u8(4);                  // additionalDataSize

  // Offset/flag tables.
  b.u16(0).u16(0);          // texture[0]: offset 0, flags 0
  b.u16(9).u16(0);          // uvMap[0]:  offset 9, flags 0

  // String block.
  b.bytes(enc.encode("test.tex")).u8(0);
  b.bytes(enc.encode("uv1")).u8(0);
  b.bytes(enc.encode("character.shpk")).u8(0);

  // additionalData: 0x08 set because dye is present.
  b.bytes([0x08, 0, 0, 0]);

  // EW colorset: 256 raw uint16s.
  for (let i = 0; i < 256; i++) b.u16((i * 7) & 0xffff);
  // EW dye: 32 bytes.
  for (let i = 0; i < 32; i++) b.u8((i * 3) & 0xff);

  // Shader block header.
  b.u16(4);                 // shaderConstantsDataSize (1 float)
  b.u16(1);                 // shaderKeyCount
  b.u16(1);                 // shaderConstantsCount
  b.u16(1);                 // textureSamplerCount
  b.u16(0x0011);            // materialFlags
  b.u16(0x0022);            // materialFlags2

  // Shader keys.
  b.u32(0x12345678).u32(0x9abcdef0);
  // Shader-constant descriptor: id, offset 0, size 4.
  b.u32(0xcafebabe).u16(0).u16(4);
  // Sampler: NormalMap0 on texture index 0.
  b.u32(SAMPLER_NORMAL_MAP_0).u32(0x00010203).u8(0).bytes([0, 0, 0]);
  // Float data block: one float, exactly representable.
  b.f32(1.5);

  const out = b.toUint8Array();
  new DataView(out.buffer).setUint16(fileSizePos, out.length & 0xffff, true);
  return out;
}
```

- [ ] **Step 2: Write the failing test**

`test/mtrl-parse.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { parseMtrl } from "../src/mtrl/parse";
import { SAMPLER_NORMAL_MAP_0 } from "../src/mtrl/types";
import { buildMinimalMtrl } from "./helpers/make-mtrl";

describe("parseMtrl", () => {
  it("parses the hand-built canonical file into the expected model", () => {
    const m = parseMtrl(buildMinimalMtrl(), "chara/x/material/test.mtrl");

    expect(m.signature).toBe(0x00000301);
    expect(m.mtrlPath).toBe("chara/x/material/test.mtrl");
    expect(m.shaderPackRaw).toBe("character.shpk");

    expect(m.textures).toHaveLength(1);
    expect(m.textures[0]!.texturePath).toBe("test.tex");
    expect(m.textures[0]!.flags).toBe(0);
    expect(m.textures[0]!.sampler).toEqual({ samplerIdRaw: SAMPLER_NORMAL_MAP_0, samplerSettingsRaw: 0x00010203 });

    expect(m.uvMapStrings).toEqual([{ value: "uv1", flags: 0 }]);
    expect(m.colorsetStrings).toEqual([]);

    expect(m.additionalData).toEqual(new Uint8Array([0x08, 0, 0, 0]));
    expect(m.colorSetData).toHaveLength(256);
    expect(m.colorSetData[1]).toBe(7);
    expect(m.colorSetDyeData).toHaveLength(32);

    expect(m.materialFlags).toBe(0x0011);
    expect(m.materialFlags2).toBe(0x0022);
    expect(m.shaderKeys).toEqual([{ keyId: 0x12345678, value: 0x9abcdef0 }]);
    expect(m.shaderConstants).toEqual([{ constantId: 0xcafebabe, values: [1.5] }]);
  });

  it("throws on an unrecognized colorset size", () => {
    const bytes = buildMinimalMtrl();
    // colorSetDataSize is the u16 at offset 6; 600 -> remainder 88, not in {0,32,128}.
    new DataView(bytes.buffer).setUint16(6, 600, true);
    expect(() => parseMtrl(bytes)).toThrow(/unrecognized colorSetDataSize/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- mtrl-parse`
Expected: FAIL — cannot resolve `../src/mtrl/parse`.

- [ ] **Step 4: Write `src/mtrl/parse.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { BinaryReader } from "../util/binary";
import { readColorset } from "./colorset";
import { readDye } from "./dye";
import {
  type XivMtrl, type MtrlTexture, type MtrlString, type ShaderKey, type ShaderConstant,
  EMPTY_SAMPLER_PREFIX, isPrimaryMapSampler,
} from "./types";

/**
 * Parses a raw uncompressed .mtrl file into an XivMtrl. Faithful port of
 * Mtrl.GetXivMtrl(byte[], string) (Mtrl.cs:174). Strict on structurally impossible inputs
 * (unrecognized colorset size), tolerant where C# is (shader constant past the data block).
 */
export function parseMtrl(bytes: Uint8Array, mtrlPath = ""): XivMtrl {
  const r = new BinaryReader(bytes);

  const signature = r.readInt32();
  r.readUint16(); // fileSize — discarded, recomputed on write
  const colorSetDataSizeField = r.readUint16();
  const stringBlockSize = r.readUint16();
  const shaderNameOffset = r.readUint16();
  const texCount = r.readUint8();
  const mapCount = r.readUint8();
  const colorsetCount = r.readUint8();
  const additionalDataSize = r.readUint8();

  // Offset/flag tables: textures, then UV maps, then colorset strings.
  const textures: MtrlTexture[] = [];
  const texPathOffsets: number[] = [];
  for (let i = 0; i < texCount; i++) {
    texPathOffsets.push(r.readInt16());
    textures.push({ texturePath: "", flags: r.readUint16() });
  }
  const uvMapStrings: MtrlString[] = [];
  const mapOffsets: number[] = [];
  for (let i = 0; i < mapCount; i++) {
    mapOffsets.push(r.readInt16());
    uvMapStrings.push({ value: "", flags: r.readUint16() });
  }
  const colorsetStrings: MtrlString[] = [];
  const colorsetOffsets: number[] = [];
  for (let i = 0; i < colorsetCount; i++) {
    colorsetOffsets.push(r.readInt16());
    colorsetStrings.push({ value: "", flags: r.readUint16() });
  }

  // Strings: every offset is relative to the block start; null-terminated UTF-8.
  const stringBlockStart = r.tell();
  for (let i = 0; i < texCount; i++) {
    r.seek(stringBlockStart + texPathOffsets[i]!);
    textures[i]!.texturePath = r.readNullTerminatedString();
  }
  for (let i = 0; i < mapCount; i++) {
    r.seek(stringBlockStart + mapOffsets[i]!);
    uvMapStrings[i]!.value = r.readNullTerminatedString();
  }
  for (let i = 0; i < colorsetCount; i++) {
    r.seek(stringBlockStart + colorsetOffsets[i]!);
    colorsetStrings[i]!.value = r.readNullTerminatedString();
  }
  r.seek(stringBlockStart + shaderNameOffset);
  const shaderPackRaw = r.readNullTerminatedString();

  r.seek(stringBlockStart + stringBlockSize);
  const additionalData = r.readBytes(additionalDataSize);

  // Colorset section (present iff colorSetDataSize > 0).
  let colorSetData: number[] = [];
  let colorSetDyeData = new Uint8Array(0);
  if (colorSetDataSizeField > 0) {
    const colorDataSize = colorSetDataSizeField >= 2048 ? 2048 : 512;
    const remainder = colorSetDataSizeField - colorDataSize;
    if (remainder !== 0 && remainder !== 32 && remainder !== 128) {
      throw new Error(`mtrl: unrecognized colorSetDataSize ${colorSetDataSizeField}`);
    }
    colorSetData = readColorset(r, colorDataSize);
    if (remainder > 0) colorSetDyeData = readDye(r, remainder);
  }

  // Shader block header.
  const shaderConstantsDataSizeField = r.readUint16();
  const shaderKeysCount = r.readUint16();
  const shaderConstantsCount = r.readUint16();
  const textureSamplerCount = r.readUint16();
  const materialFlags = r.readUint16();
  const materialFlags2 = r.readUint16();

  const shaderKeys: ShaderKey[] = [];
  for (let i = 0; i < shaderKeysCount; i++) {
    shaderKeys.push({ keyId: r.readUint32(), value: r.readUint32() });
  }

  const descriptors: { constantId: number; offset: number; size: number }[] = [];
  for (let i = 0; i < shaderConstantsCount; i++) {
    descriptors.push({ constantId: r.readUint32(), offset: r.readInt16(), size: r.readInt16() });
  }

  // Sampler section: assign to textures, with the drop/replace/placeholder rules (Mtrl.cs:356).
  for (let i = 0; i < textureSamplerCount; i++) {
    const sampler = { samplerIdRaw: r.readUint32(), samplerSettingsRaw: r.readUint32() };
    const textureIndex = r.readUint8();
    r.readBytes(3); // padding
    if (textureIndex < textures.length) {
      const tex = textures[textureIndex]!;
      if (tex.sampler !== undefined) {
        // Already bound. A primary Map0/Spec0/Normal0 replaces; anything else (the secondary
        // ...Map1 that SE double-writes for 2-UV materials) is dropped on parse.
        if (isPrimaryMapSampler(sampler.samplerIdRaw)) tex.sampler = sampler;
      } else {
        tex.sampler = sampler;
      }
    } else {
      // Index 255 (or any out-of-range): a fake placeholder texture holds the sampler.
      textures.push({ texturePath: EMPTY_SAMPLER_PREFIX + sampler.samplerIdRaw, flags: 0, sampler });
    }
  }

  // Shader-constant float data block, read sequentially (Mtrl.cs:403). Offsets are recomputed on
  // write, so we do not seek by them here. A descriptor pointing past the block yields zeros.
  const shaderConstants: ShaderConstant[] = [];
  let bytesRead = 0;
  for (const d of descriptors) {
    let values: number[];
    if (bytesRead + d.size <= shaderConstantsDataSizeField) {
      values = [];
      for (let idx = 0; idx < d.size; idx += 4) { values.push(r.readFloat32()); bytesRead += 4; }
    } else {
      values = new Array(Math.floor(d.size / 4)).fill(0);
    }
    shaderConstants.push({ constantId: d.constantId, values });
  }
  while (bytesRead < shaderConstantsDataSizeField) { r.readUint8(); bytesRead += 1; }

  return {
    signature, shaderPackRaw, additionalData,
    textures, uvMapStrings, colorsetStrings,
    colorSetData, colorSetDyeData,
    shaderKeys, shaderConstants,
    materialFlags, materialFlags2, mtrlPath,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- mtrl-parse`
Expected: PASS (2 cases).

- [ ] **Step 6: Typecheck + commit**

```powershell
npm run typecheck
git add src/mtrl/parse.ts test/helpers/make-mtrl.ts test/mtrl-parse.test.ts
git commit -m "feat(mtrl): add parseMtrl (GetXivMtrl port)"
```

---

### Task 5: Serialize (`XivMtrlToUncompressedMtrl` port) + public API

**Files:**
- Create: `src/mtrl/serialize.ts`
- Create: `src/mtrl/mtrl.ts`
- Modify: `src/index.ts` (re-export)
- Test: `test/mtrl-roundtrip.test.ts`

**Interfaces:**
- Consumes: `ByteBuilder` (Task 1); `writeColorset` (Task 2); `writeDye` (Task 3); model + helpers `colorSetDataSize`/`shaderConstantsDataSize`/`getRealSamplerCount`/`isEmptySampler`/`secondarySamplerId` (Task 1); `parseMtrl` (Task 4).
- Produces:
  - `serializeMtrl(mtrl: XivMtrl): Uint8Array` — mirrors `Mtrl.XivMtrlToUncompressedMtrl` (`Mtrl.cs:556`).
  - `src/mtrl/mtrl.ts` re-exporting `parseMtrl`, `serializeMtrl`, and the model types.
  - `src/index.ts` re-exports `parseMtrl`, `serializeMtrl`, and the model types.

- [ ] **Step 1: Write the failing test**

`test/mtrl-roundtrip.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { parseMtrl, serializeMtrl } from "../src/mtrl/mtrl";
import { buildMinimalMtrl } from "./helpers/make-mtrl";

describe("mtrl round-trip", () => {
  it("serializeMtrl(parseMtrl(x)) === x for the hand-built canonical file", () => {
    const x = buildMinimalMtrl();
    const out = serializeMtrl(parseMtrl(x));
    expect(out).toEqual(x);
  });

  it("is exported from the package index", async () => {
    const idx = await import("../src/index");
    expect(typeof idx.parseMtrl).toBe("function");
    expect(typeof idx.serializeMtrl).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- mtrl-roundtrip`
Expected: FAIL — cannot resolve `../src/mtrl/mtrl`.

- [ ] **Step 3: Write `src/mtrl/serialize.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { ByteBuilder } from "../util/binary";
import { writeColorset } from "./colorset";
import { writeDye } from "./dye";
import {
  type XivMtrl, colorSetDataSize, shaderConstantsDataSize, getRealSamplerCount,
  isEmptySampler, secondarySamplerId,
} from "./types";

const enc = new TextEncoder();

function pad4(len: number): number {
  const r = len % 4;
  return r === 0 ? len : len + (4 - r);
}

/**
 * Serializes an XivMtrl back into raw uncompressed .mtrl bytes. Faithful port of
 * Mtrl.XivMtrlToUncompressedMtrl (Mtrl.cs:556). Regenerates the string block, the sampler
 * double-writes, and the normalized header/flags deterministically — byte-exact for canonical
 * inputs (see design spec §5).
 */
export function serializeMtrl(mtrl: XivMtrl): Uint8Array {
  // Lowercase all texture paths (Mtrl.cs:558). Real SE paths are already lowercase (a no-op).
  for (const tex of mtrl.textures) tex.texturePath = tex.texturePath.toLowerCase();

  // Placeholder (empty-sampler) textures are excluded from the count, string block, and tables.
  const realTextures = mtrl.textures.filter((t) => !isEmptySampler(t));

  // Build the string block: texture paths -> uv maps -> colorset strings -> shader pack name.
  const stringBytes: number[] = [];
  const pushString = (s: string): number => {
    const at = stringBytes.length;
    for (const byte of enc.encode(s)) stringBytes.push(byte);
    stringBytes.push(0);
    return at;
  };
  const textureOffsets = realTextures.map((t) => pushString(t.texturePath));
  const mapOffsets = mtrl.uvMapStrings.map((s) => pushString(s.value));
  const colorsetOffsets = mtrl.colorsetStrings.map((s) => pushString(s.value));
  const shaderNameOffset = stringBytes.length;
  pushString(mtrl.shaderPackRaw);
  const stringBlockSize = pad4(stringBytes.length);
  while (stringBytes.length < stringBlockSize) stringBytes.push(0);

  // Toggle the 0x08 dye flag on additionalData[0] (Mtrl.cs:648); guarded on non-empty (spec §8).
  const additionalData = new Uint8Array(mtrl.additionalData);
  if (additionalData.length > 0) {
    if (mtrl.colorSetDyeData.length > 0) additionalData[0]! |= 0x08;
    else additionalData[0]! &= ~0x08 & 0xff;
  }

  const b = new ByteBuilder();
  b.i32(mtrl.signature);
  const fileSizePos = b.length;
  b.u16(0); // fileSize backfilled
  b.u16(colorSetDataSize(mtrl));
  const stringBlockSizePos = b.length;
  b.u16(0); // stringBlockSize backfilled
  const shaderNameOffsetPos = b.length;
  b.u16(0); // shaderNameOffset backfilled
  b.u8(realTextures.length);
  b.u8(mtrl.uvMapStrings.length);
  b.u8(mtrl.colorsetStrings.length);
  b.u8(additionalData.length);

  // Offset/flag tables.
  for (let i = 0; i < realTextures.length; i++) b.u16(textureOffsets[i]!).u16(realTextures[i]!.flags);
  for (let i = 0; i < mtrl.uvMapStrings.length; i++) b.u16(mapOffsets[i]!).u16(mtrl.uvMapStrings[i]!.flags);
  for (let i = 0; i < mtrl.colorsetStrings.length; i++) b.u16(colorsetOffsets[i]!).u16(mtrl.colorsetStrings[i]!.flags);

  b.bytes(stringBytes);
  b.bytes(additionalData);

  writeColorset(b, mtrl.colorSetData);
  if (mtrl.colorSetDyeData.length > 0) writeDye(b, mtrl.colorSetDyeData);

  b.u16(shaderConstantsDataSize(mtrl));
  b.u16(mtrl.shaderKeys.length);
  b.u16(mtrl.shaderConstants.length);
  b.u16(getRealSamplerCount(mtrl));
  b.u16(mtrl.materialFlags);
  b.u16(mtrl.materialFlags2);

  for (const k of mtrl.shaderKeys) b.u32(k.keyId).u32(k.value);

  // Shader-constant descriptors: offsets recomputed sequentially (Mtrl.cs:702).
  let constOffset = 0;
  for (const c of mtrl.shaderConstants) {
    const byteSize = c.values.length * 4;
    b.u32(c.constantId).u16(constOffset).u16(byteSize);
    constOffset += byteSize;
  }

  // Sampler section: write each texture's sampler; regenerate the secondary double-write for
  // 2-UV materials unless another texture already carries it (Mtrl.cs:714).
  const multiUv = mtrl.uvMapStrings.length > 1;
  for (let i = 0; i < mtrl.textures.length; i++) {
    const tex = mtrl.textures[i]!;
    if (!tex.sampler) continue;
    if (isEmptySampler(tex)) {
      b.u32(tex.sampler.samplerIdRaw).u32(tex.sampler.samplerSettingsRaw).u8(255).bytes([0, 0, 0]);
    } else {
      b.u32(tex.sampler.samplerIdRaw).u32(tex.sampler.samplerSettingsRaw).u8(i).bytes([0, 0, 0]);
      if (multiUv) {
        const secondary = secondarySamplerId(tex.sampler.samplerIdRaw);
        if (secondary !== undefined &&
            !mtrl.textures.some((x) => x.sampler && x.sampler.samplerIdRaw === secondary)) {
          b.u32(secondary).u32(tex.sampler.samplerSettingsRaw).u8(i).bytes([0, 0, 0]);
        }
      }
    }
  }

  // Shader-constant float data block, zero-padded to shaderConstantsDataSize if short (Mtrl.cs:774).
  const scds = shaderConstantsDataSize(mtrl);
  let floatBytes = 0;
  for (const c of mtrl.shaderConstants) for (const f of c.values) { b.f32(f); floatBytes += 4; }
  for (let i = floatBytes; i < scds; i++) b.u8(0);

  // Backfill header fields.
  const out = b.toUint8Array();
  const dv = new DataView(out.buffer);
  dv.setUint16(fileSizePos, out.length & 0xffff, true);
  dv.setUint16(stringBlockSizePos, stringBlockSize, true);
  dv.setUint16(shaderNameOffsetPos, shaderNameOffset, true);
  return out;
}
```

> `getRealSamplerCount` (the header's sampler count) counts the secondary double-writes exactly as the write loop emits them, so the header and the sampler section always agree. The `EMPTY_SAMPLER_PREFIX` is lowercase (types.ts), so it still matches after path lowercasing — this is the intended correct behavior (spec §5.2), unlike the C# `.ToLower()` ordering which leaves the uppercase prefix un-matched.

- [ ] **Step 4: Write `src/mtrl/mtrl.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

export { parseMtrl } from "./parse";
export { serializeMtrl } from "./serialize";
export type {
  XivMtrl, MtrlTexture, MtrlString, ShaderKey, ShaderConstant, TextureSampler,
} from "./types";
```

- [ ] **Step 5: Add re-export to `src/index.ts`**

Add after the existing `export { decodeSqPackFile, ... } from "./sqpack/sqpack";` line:

```ts
export { parseMtrl, serializeMtrl } from "./mtrl/mtrl";
export type { XivMtrl, MtrlTexture, MtrlString, ShaderKey, ShaderConstant, TextureSampler } from "./mtrl/types";
```

- [ ] **Step 6: Run test + typecheck to verify pass**

Run: `npm test -- mtrl-roundtrip; npm run typecheck`
Expected: PASS (2 cases); typecheck clean.

- [ ] **Step 7: Commit**

```powershell
git add src/mtrl/serialize.ts src/mtrl/mtrl.ts src/index.ts test/mtrl-roundtrip.test.ts
git commit -m "feat(mtrl): add serializeMtrl and public API"
```

---

### Task 6: Sampler double-write / empty-sampler coverage

**Files:**
- Modify: `test/helpers/make-mtrl.ts` (add two builders)
- Test: `test/mtrl-samplers.test.ts`

**Interfaces:**
- Consumes: `parseMtrl`, `serializeMtrl` (Tasks 4-5); `getRealSamplerCount`, `isEmptySampler`, sampler-id constants (Task 1).
- Produces:
  - `buildDoubleUvMtrl(): Uint8Array` — 1 texture, 2 UV maps, sampler section `[NormalMap0, NormalMap1]` both on index 0 (SE's canonical double-write), no colorset.
  - `buildEmptySamplerMtrl(): Uint8Array` — 1 texture with NormalMap0 (index 0) + a second sampler on index 255, no colorset.

- [ ] **Step 1: Add the two builders to `test/helpers/make-mtrl.ts`**

Add these imports to the existing import from `../../src/mtrl/types`:

```ts
import {
  SAMPLER_NORMAL_MAP_0, SAMPLER_NORMAL_MAP_1, SAMPLER_COLOR_MAP_0,
} from "../../src/mtrl/types";
```

Append these functions:

```ts
/**
 * A canonical 2-UV .mtrl: one texture carrying a NormalMap0 sampler, whose secondary NormalMap1
 * SE double-writes into the sampler section. Parse drops the NormalMap1; serialize regenerates it.
 */
export function buildDoubleUvMtrl(): Uint8Array {
  // Strings: "n.tex\0" @0 (6), "uv1\0" @6 (4), "uv2\0" @10 (4), "character.shpk\0" @14 (15) = 29 -> pad4 32.
  const b = new ByteBuilder();
  b.i32(0x00000301);
  const fileSizePos = b.length;
  b.u16(0);                 // fileSize
  b.u16(0);                 // colorSetDataSize (no colorset)
  b.u16(32);                // stringBlockSize (29 padded to 32)
  b.u16(14);                // shaderNameOffset
  b.u8(1);                  // texCount
  b.u8(2);                  // mapCount
  b.u8(0);                  // colorsetCount
  b.u8(4);                  // additionalDataSize

  b.u16(0).u16(0);          // texture[0]
  b.u16(6).u16(0);          // uvMap[0]
  b.u16(10).u16(0);         // uvMap[1]

  b.bytes(enc.encode("n.tex")).u8(0);
  b.bytes(enc.encode("uv1")).u8(0);
  b.bytes(enc.encode("uv2")).u8(0);
  b.bytes(enc.encode("character.shpk")).u8(0);
  b.u8(0).u8(0).u8(0);      // pad 29 -> 32

  b.bytes([0, 0, 0, 0]);    // additionalData (no dye)

  b.u16(0);                 // shaderConstantsDataSize
  b.u16(0);                 // shaderKeyCount
  b.u16(0);                 // shaderConstantsCount
  b.u16(2);                 // textureSamplerCount (primary + double-written secondary)
  b.u16(0);                 // materialFlags
  b.u16(0);                 // materialFlags2

  // Sampler section: NormalMap0 then its double-written NormalMap1, both index 0, same settings.
  b.u32(SAMPLER_NORMAL_MAP_0).u32(0x00010203).u8(0).bytes([0, 0, 0]);
  b.u32(SAMPLER_NORMAL_MAP_1).u32(0x00010203).u8(0).bytes([0, 0, 0]);

  const out = b.toUint8Array();
  new DataView(out.buffer).setUint16(fileSizePos, out.length & 0xffff, true);
  return out;
}

/**
 * A canonical single-UV .mtrl whose sampler section holds a real sampler (index 0) followed by an
 * empty sampler (index 255). Parse creates a placeholder texture; serialize writes it back last.
 */
export function buildEmptySamplerMtrl(): Uint8Array {
  // Strings: "n.tex\0" @0 (6), "uv1\0" @6 (4), "character.shpk\0" @10 (15) = 25 -> pad4 28.
  const b = new ByteBuilder();
  b.i32(0x00000301);
  const fileSizePos = b.length;
  b.u16(0);                 // fileSize
  b.u16(0);                 // colorSetDataSize (no colorset)
  b.u16(28);                // stringBlockSize (25 padded to 28)
  b.u16(10);                // shaderNameOffset
  b.u8(1);                  // texCount
  b.u8(1);                  // mapCount
  b.u8(0);                  // colorsetCount
  b.u8(4);                  // additionalDataSize

  b.u16(0).u16(0);          // texture[0]
  b.u16(6).u16(0);          // uvMap[0]

  b.bytes(enc.encode("n.tex")).u8(0);
  b.bytes(enc.encode("uv1")).u8(0);
  b.bytes(enc.encode("character.shpk")).u8(0);
  b.u8(0).u8(0).u8(0);      // pad 25 -> 28

  b.bytes([0, 0, 0, 0]);    // additionalData

  b.u16(0);                 // shaderConstantsDataSize
  b.u16(0);                 // shaderKeyCount
  b.u16(0);                 // shaderConstantsCount
  b.u16(2);                 // textureSamplerCount (real + empty)
  b.u16(0);                 // materialFlags
  b.u16(0);                 // materialFlags2

  // Real sampler on texture 0, then an empty sampler on index 255.
  b.u32(SAMPLER_NORMAL_MAP_0).u32(0x00010203).u8(0).bytes([0, 0, 0]);
  b.u32(SAMPLER_COLOR_MAP_0).u32(0x00040506).u8(255).bytes([0, 0, 0]);

  const out = b.toUint8Array();
  new DataView(out.buffer).setUint16(fileSizePos, out.length & 0xffff, true);
  return out;
}
```

- [ ] **Step 2: Write the failing test**

`test/mtrl-samplers.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { parseMtrl, serializeMtrl } from "../src/mtrl/mtrl";
import { getRealSamplerCount, isEmptySampler, SAMPLER_NORMAL_MAP_0, SAMPLER_COLOR_MAP_0 } from "../src/mtrl/types";
import { buildDoubleUvMtrl, buildEmptySamplerMtrl } from "./helpers/make-mtrl";

describe("mtrl sampler handling", () => {
  it("drops the double-written secondary on parse and regenerates it on serialize", () => {
    const x = buildDoubleUvMtrl();
    const m = parseMtrl(x);

    // The secondary NormalMap1 was dropped; only the primary remains on texture 0.
    expect(m.textures).toHaveLength(1);
    expect(m.textures[0]!.sampler!.samplerIdRaw).toBe(SAMPLER_NORMAL_MAP_0);
    expect(getRealSamplerCount(m)).toBe(2); // primary + regenerated secondary

    expect(serializeMtrl(m)).toEqual(x);
  });

  it("round-trips an index-255 empty sampler as an excluded placeholder texture", () => {
    const x = buildEmptySamplerMtrl();
    const m = parseMtrl(x);

    expect(m.textures).toHaveLength(2);
    expect(isEmptySampler(m.textures[0]!)).toBe(false);
    expect(isEmptySampler(m.textures[1]!)).toBe(true);
    expect(m.textures[1]!.sampler!.samplerIdRaw).toBe(SAMPLER_COLOR_MAP_0);

    const out = serializeMtrl(m);
    expect(out[12]).toBe(1); // header texCount byte excludes the placeholder
    expect(out).toEqual(x);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- mtrl-samplers`
Expected: FAIL — `buildDoubleUvMtrl`/`buildEmptySamplerMtrl` not exported.

- [ ] **Step 4: Run test to verify it passes (after Step 1 builders are in place)**

Run: `npm test -- mtrl-samplers`
Expected: PASS (2 cases).

> If either round-trip fails, the mismatch is a real codec bug in the sampler logic (Task 4/5), not a fixture issue — the builders emit SE's canonical sampler ordering. Debug with superpowers:systematic-debugging before adjusting the fixtures.

- [ ] **Step 5: Typecheck + commit**

```powershell
npm run typecheck
git add test/helpers/make-mtrl.ts test/mtrl-samplers.test.ts
git commit -m "test(mtrl): cover sampler double-write and empty-sampler round-trips"
```

---

### Task 7: Corpus self round-trip (the real gate)

**Files:**
- Create: `test/mtrl-corpus.test.ts`

**Interfaces:**
- Consumes: `loadModpack` (`src/index`); `allFiles`, `FileStorageType`, `ModpackFile` (`src/model/modpack`); `decodeSqPackFile`, `SqPackType` (`src/sqpack/sqpack`); `parseMtrl`, `serializeMtrl` (Task 5); `corpusInputs` (`test/helpers/oracle`).

This is the capstone correctness test. It skips entirely when the corpus is absent (CI). For each corpus modpack it reads every `SqPackCompressed` inner file whose game path ends in `.mtrl`, decodes it (Type 2/Standard), parses, reserializes, and asserts byte-identity with the decoded input. Mismatches are logged and fail the test; a legitimate C# normalization on a non-canonical input (string reorder, dye-flag toggle, sampler regeneration) is documented and accepted only after triage (spec §7).

- [ ] **Step 1: Write the test**

`test/mtrl-corpus.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadModpack } from "../src/index";
import { allFiles, FileStorageType, type ModpackFile } from "../src/model/modpack";
import { decodeSqPackFile, SqPackType } from "../src/sqpack/sqpack";
import { parseMtrl, serializeMtrl } from "../src/mtrl/mtrl";
import { corpusInputs } from "./helpers/oracle";

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function mtrlFiles(path: string): ModpackFile[] {
  const data = loadModpack(basename(path), new Uint8Array(readFileSync(path)));
  return allFiles(data).filter(
    (f) => f.storage === FileStorageType.SqPackCompressed && f.gamePath.toLowerCase().endsWith(".mtrl"),
  );
}

const inputs = corpusInputs();

describe.skipIf(inputs.length === 0)("mtrl corpus", () => {
  for (const path of inputs) {
    const name = basename(path);
    it(`self round-trips every .mtrl in ${name}`, () => {
      const files = mtrlFiles(path);
      let tested = 0;
      const mismatches: string[] = [];
      for (const f of files) {
        const decoded = decodeSqPackFile(f.data);
        if (decoded.type !== SqPackType.Standard) continue; // materials are Type 2
        const re = serializeMtrl(parseMtrl(decoded.data, f.gamePath));
        if (bytesEqual(re, decoded.data)) tested++;
        else mismatches.push(`${f.gamePath} (${decoded.data.length} vs ${re.length})`);
      }
      console.log(`[mtrl] ${name}: ${tested}/${files.length} round-tripped`);
      if (mismatches.length) {
        expect.fail(`mtrl round-trip mismatch (${mismatches.length}): ${mismatches.join(", ")}`);
      }
    }, 1_200_000);
  }
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- mtrl-corpus`
Expected (no corpus / CI): SKIPPED. Expected (corpus present, this machine): PASS — every `.mtrl` round-trips byte-identical.

> If mismatches appear, triage each (spec §7): confirm whether it is a legitimate C# normalization on a non-canonical input (accept + document) or a codec bug (fix, then re-run). Do not weaken the assertion to make it pass — investigate with superpowers:systematic-debugging.

- [ ] **Step 3: Commit**

```powershell
git add test/mtrl-corpus.test.ts
git commit -m "test(mtrl): corpus self round-trip gate"
```

---

### Task 8: Bundled EW + DT fixture round-trip

**Files:**
- Create: `test/fixtures/default_material.mtrl` (copied), `test/fixtures/default_material_dt.mtrl` (copied)
- Create: `test/mtrl-fixtures.test.ts`

**Interfaces:**
- Consumes: `parseMtrl`, `serializeMtrl` (Task 5).

Seeds one EW-format and one DT-format round-trip that runs without the corpus, using the framework's own default materials. These are raw uncompressed `.mtrl` files (not SQPack-wrapped), so `parseMtrl` reads them directly. They are GPL-3.0 framework resources, covered by the existing NOTICE attribution.

- [ ] **Step 1: Copy the fixtures**

```powershell
New-Item -ItemType Directory -Force test\fixtures | Out-Null
$res = "reference\xivModdingFramework\xivModdingFramework\Resources\DefaultTextures"
Copy-Item "$res\default_material.mtrl" test\fixtures\default_material.mtrl
Copy-Item "$res\default_material_dt.mtrl" test\fixtures\default_material_dt.mtrl
Get-ChildItem test\fixtures\*.mtrl | Select-Object Name, Length
```

Expected: `default_material.mtrl` (808 bytes, EW), `default_material_dt.mtrl` (2520 bytes, DT).

- [ ] **Step 2: Write the failing test**

`test/mtrl-fixtures.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMtrl, serializeMtrl } from "../src/mtrl/mtrl";

const dir = join(__dirname, "fixtures");
const cases = [
  { name: "default_material.mtrl", label: "Endwalker-format" },
  { name: "default_material_dt.mtrl", label: "Dawntrail-format" },
];

for (const c of cases) {
  const path = join(dir, c.name);
  describe.skipIf(!existsSync(path))(`mtrl fixture (${c.label})`, () => {
    it(`self round-trips ${c.name} byte-identical`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const out = serializeMtrl(parseMtrl(bytes, c.name));
      expect(out).toEqual(bytes);
    });
  });
}
```

- [ ] **Step 3: Run the test**

Run: `npm test -- mtrl-fixtures`
Expected: PASS (2 cases) once the fixtures are copied; SKIPPED if absent.

> If a fixture does not round-trip byte-exact, triage exactly as for the corpus (Task 7). The default materials are authored in canonical form and should round-trip; a mismatch is most likely a codec bug (e.g. DT colorset/dye sizing) to fix, not a fixture to accept.

- [ ] **Step 4: Full suite + commit**

Run: `npm test; npm run typecheck`
Expected: all suites pass or skip; typecheck clean.

```powershell
git add test/fixtures/default_material.mtrl test/fixtures/default_material_dt.mtrl test/mtrl-fixtures.test.ts
git commit -m "test(mtrl): EW + DT default-material fixture round-trip"
```

---

## Self-Review

**Spec coverage:**
- Round-trip codec only (parse + serialize, no EW→DT transform) → Tasks 4-5; no transform logic anywhere. ✓
- Full semantic model faithful to `XivMtrl` (textures/samplers, UV/colorset strings, shader keys/constants, flags, additionalData, colorset Half rows, dye raw blob) → `types.ts` (Task 1). ✓
- Module structure B (model / parse / serialize split, colorset + dye isolated) → file structure. ✓
- Key format details (header fields, offset/flag tables, string block, colorset sizing + dye detection, shader block layout, computed getters) → parse (Task 4) + serialize (Task 5) + helpers (Task 1). ✓
- Dye kept as raw `Uint8Array`, length-validated → `dye.ts` (Task 3). ✓
- Public API `parseMtrl`/`serializeMtrl` + type re-exports + `src/index.ts` → Task 5. ✓
- Round-trip-sensitive reconstructions: string-block rebuild (Task 5), sampler double-write drop/regenerate (Tasks 4-6), lowercasing + 0x08 dye flag + recomputed constant offsets/padding (Task 5). ✓
- Intentional deviations: free-function computed sizes (Task 1); sampler-id as numeric constants only (Task 1); strict on unrecognized colorset size, tolerant on over-range shader constant (Task 4). ✓
- Testing strategy: synthetic units (Tasks 1-3, 6), synthetic full round-trip (Task 5), corpus self round-trip (Task 7), optional EW+DT fixtures (Task 8). ✓
- No new dependencies; standalone module (only additive binary helpers + index re-export). ✓

**Type consistency:** `parseMtrl`/`serializeMtrl` signatures identical across Tasks 4-8. `XivMtrl`/`MtrlTexture`/`MtrlString`/`ShaderKey`/`ShaderConstant`/`TextureSampler` defined in Task 1, used everywhere. `colorSetDataSize`/`shaderConstantsDataSize`/`getRealSamplerCount`/`isEmptySampler`/`secondarySamplerId`/`isPrimaryMapSampler` defined in Task 1, consumed in Tasks 4-6. `readColorset`/`writeColorset` (Task 2), `readDye`/`writeDye` (Task 3) consumed in Tasks 4-5. `readFloat32`/`readNullTerminatedString`/`u32`/`f32` (Task 1) consumed in Tasks 4-5 and the test builders. `buildMinimalMtrl` (Task 4), `buildDoubleUvMtrl`/`buildEmptySamplerMtrl` (Task 6) consumed in Tasks 4-6. Sampler-id constants named consistently (`SAMPLER_NORMAL_MAP_0`, etc.). Consistent.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step has concrete assertions and exact run commands.

**Known execution notes (not blockers):**
- The synthetic round-trip (Task 5) exercises parse and serialize against the same canonical layout, so it validates internal consistency, not SE's exact bytes — the corpus (Task 7) and fixtures (Task 8) are the independent ground truth against real SE materials.
- The `EMPTY_SAMPLER_PREFIX` is deliberately lowercase so it survives serialize's path lowercasing (the correct behavior spec §5.2 specifies); this diverges from the C# uppercase constant, but the prefix never reaches output bytes, so it cannot affect byte-identity.
- Task 4 models a texture's sampler as optional (absent until bound), rather than C#'s always-present default sampler. For canonical files (every bound sampler has a known id) this is byte-identical; the corpus gate confirms.
```