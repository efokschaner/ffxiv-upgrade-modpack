# MDL Geometry Codec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone MDL geometry codec — parse/serialize the per-mesh vertex
declaration, decode a mesh's vertex+index buffers (verbatim `MdlVertexReader`), and
re-encode them (declaration-driven, over verbatim `WriteVertex` per-element encoders) —
verified by a byte-exact decode→encode round-trip on real corpus geometry.

**Architecture:** An additive layer under `src/mdl/geometry/` over the existing
`XivMdl` (which keeps carrying `vertexInfo`/`geometry` as opaque blobs; `parseMdl`/
`serializeMdl` are untouched and stay byte-exact). Decode emits SoA `VertexData`
(mirrors `MdlVertexReader`); a straight `transpose` yields AoS `TtVertex[]` (mirrors
`TTVertex`); encode consumes `TtVertex[]` against a target declaration. The SoA→AoS
flip sits at the transpose — the exact seam sub-project B swaps for its weld.

**Tech Stack:** TypeScript, Vitest, Biome. Reference: read-only C# under
`reference/xivModdingFramework/xivModdingFramework/` (never edit/lint/format it).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-06-mdl-geometry-codec-design.md` (authority
  for scope and the two-check gate). Research map:
  `docs/superpowers/specs/2026-07-06-model-normalizer-research.md`.
- **Branch:** fresh off current `main` — `feat/mdl-geometry-codec`. `main` is ahead of
  `origin/main`; branch from `main` HEAD.
- **PowerShell only** (bash tool blocked). Single fast test file:
  `npx vitest run <file>`. Full suite: `npm test`.
- **End-of-task gate (all green):** `npm run check` (Biome — owns formatting, never
  hand-format), `npm run typecheck`, `npm test`.
- **No per-file license headers.** A file porting C# may cite its upstream origin in a
  brief comment; the license notice lives in `NOTICE`.
- **Commit with explicit pathspec** (`git commit -m <msg> -- <paths>`); scoped commits.
  Message body via a single-quoted here-string (`@'…'@`, closing `'@` at column 0).
- **Do not modify** `src/mdl/parse.ts`, `serialize.ts`, `types.ts`, or `mdl.ts` beyond
  the barrel re-exports Task 8 adds. The existing byte-exact `corpus-mdl` check stays green.
- **Enums:** the codebase uses `export enum` (e.g. `SqPackType`); match that.

---

## File structure

| File | Responsibility |
|---|---|
| `src/util/half.ts` (modify) | add `halfToFloat` (exact half→float), beside the existing `floatToHalf` |
| `src/mdl/geometry/format.ts` (create) | `VertexUsageType`/`VertexDataType` enums + `dataTypeSize()` |
| `src/mdl/geometry/declaration.ts` (create) | `VertexElement`; parse/serialize the 136-byte-per-mesh block |
| `src/mdl/geometry/vertex-data.ts` (create) | `Vec2`/`Vec3`/`Rgba`, SoA `VertexData`, AoS `TtVertex`, `transpose` |
| `src/mdl/geometry/offsets.ts` (create) | `parseGeometryLayout` — per-LoD/mesh/part offsets & sizes |
| `src/mdl/geometry/decode.ts` (create) | `decodeVertexData`, `decodeIndices` (verbatim `MdlVertexReader`) |
| `src/mdl/geometry/encode.ts` (create) | `encodeVertexData`, `encodeIndices` (declaration-driven `WriteVertex`) |
| `test/mdl/geometry/*.test.ts` (create) | unit tests per module (synthetic fixtures, no corpus) |
| `test/helpers/corpus-geometry.ts` (create) | A1 source + A2 golden round-trip corpus check |
| `test/helpers/corpus-units.ts` / `corpus-register.ts` (modify) | wire the `geometry` check kind |

---

## Task 1: `halfToFloat` (exact half→float)

**Files:**
- Modify: `src/util/half.ts`
- Test: `test/util/half.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `halfToFloat(raw: number): number` — IEEE-754 binary16 (as a raw u16) →
  number. Exact (every half is representable as a float64/float32).

- [ ] **Step 1: Write the failing test**

Create `test/util/half.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { floatToHalf, halfToFloat } from "../../src/util/half";

describe("halfToFloat", () => {
  it("decodes exact reference bit patterns", () => {
    expect(halfToFloat(0x0000)).toBe(0); // +0
    expect(halfToFloat(0x3c00)).toBe(1); // 1.0
    expect(halfToFloat(0xc000)).toBe(-2); // -2.0
    expect(halfToFloat(0x7c00)).toBe(Number.POSITIVE_INFINITY); // +Inf
    expect(halfToFloat(0xfc00)).toBe(Number.NEGATIVE_INFINITY); // -Inf
    expect(Number.isNaN(halfToFloat(0x7e00))).toBe(true); // NaN
    expect(halfToFloat(0x0001)).toBeCloseTo(5.9604645e-8, 12); // smallest subnormal
  });

  it("round-trips every finite half through floatToHalf (identity)", () => {
    for (let h = 0; h <= 0xffff; h++) {
      const exp = (h >> 10) & 0x1f;
      const mant = h & 0x3ff;
      if (exp === 0x1f) continue; // skip Inf/NaN
      if (mant === 0 && exp === 0 && (h & 0x8000)) continue; // skip -0 (floatToHalf yields +0)
      expect(floatToHalf(halfToFloat(h))).toBe(h);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/util/half.test.ts`
Expected: FAIL — `halfToFloat` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/util/half.ts`:

```ts
/** IEEE-754 binary16 raw uint16 -> number. Exact (every half is representable). */
export function halfToFloat(raw: number): number {
  const sign = raw & 0x8000 ? -1 : 1;
  const exp = (raw >> 10) & 0x1f;
  const mant = raw & 0x3ff;
  if (exp === 0) {
    // Zero or subnormal: value = mant * 2^-24.
    return sign * mant * 2 ** -24;
  }
  if (exp === 0x1f) {
    return mant === 0
      ? sign * Number.POSITIVE_INFINITY
      : Number.NaN;
  }
  // Normal: value = (1 + mant/1024) * 2^(exp-15).
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/util/half.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```powershell
git add test/util/half.test.ts src/util/half.ts
git commit -m "feat(mdl): add exact halfToFloat beside floatToHalf" -- src/util/half.ts test/util/half.test.ts
```

---

## Task 2: Vertex format enums

**Files:**
- Create: `src/mdl/geometry/format.ts`
- Test: `test/mdl/geometry/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `enum VertexUsageType { Position=0x0, BoneWeight=0x1, BoneIndex=0x2, Normal=0x3, TextureCoordinate=0x4, Flow=0x5, Binormal=0x6, Color=0x7 }`
  - `enum VertexDataType { Float2=0x1, Float3=0x2, Float4=0x3, Ubyte4=0x5, Ubyte4n=0x8, Half2=0xd, Half4=0xe, UByte8=0x11 }`
  - `dataTypeSize(t: VertexDataType): number`

- [ ] **Step 1: Write the failing test**

Create `test/mdl/geometry/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  dataTypeSize,
  VertexDataType,
  VertexUsageType,
} from "../../../src/mdl/geometry/format";

describe("vertex format", () => {
  it("enum numeric values equal the wire bytes", () => {
    expect(VertexUsageType.Position).toBe(0x0);
    expect(VertexUsageType.Color).toBe(0x7);
    expect(VertexDataType.Float3).toBe(0x2);
    expect(VertexDataType.Half4).toBe(0xe);
    expect(VertexDataType.UByte8).toBe(0x11);
  });

  it("dataTypeSize matches the SE size table", () => {
    expect(dataTypeSize(VertexDataType.Float2)).toBe(8);
    expect(dataTypeSize(VertexDataType.Float3)).toBe(12);
    expect(dataTypeSize(VertexDataType.Float4)).toBe(16);
    expect(dataTypeSize(VertexDataType.Ubyte4)).toBe(4);
    expect(dataTypeSize(VertexDataType.Ubyte4n)).toBe(4);
    expect(dataTypeSize(VertexDataType.Half2)).toBe(4);
    expect(dataTypeSize(VertexDataType.Half4)).toBe(8);
    expect(dataTypeSize(VertexDataType.UByte8)).toBe(8);
  });

  it("throws on an unknown data type", () => {
    expect(() => dataTypeSize(0x99 as VertexDataType)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mdl/geometry/format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/mdl/geometry/format.ts`:

```ts
// Vertex declaration enums, ported from xivModdingFramework Models/Enums (GPL-3.0).
// The enum numeric value IS the on-wire byte (SE's own translation table; Mdl.cs:5365-5396).

export enum VertexUsageType {
  Position = 0x0,
  BoneWeight = 0x1,
  BoneIndex = 0x2,
  Normal = 0x3,
  TextureCoordinate = 0x4,
  Flow = 0x5,
  Binormal = 0x6,
  Color = 0x7,
}

export enum VertexDataType {
  Float2 = 0x1,
  Float3 = 0x2,
  Float4 = 0x3,
  Ubyte4 = 0x5,
  Ubyte4n = 0x8,
  Half2 = 0xd,
  Half4 = 0xe,
  UByte8 = 0x11,
}

const SIZES: Partial<Record<VertexDataType, number>> = {
  [VertexDataType.Float2]: 8,
  [VertexDataType.Float3]: 12,
  [VertexDataType.Float4]: 16,
  [VertexDataType.Ubyte4]: 4,
  [VertexDataType.Ubyte4n]: 4,
  [VertexDataType.Half2]: 4,
  [VertexDataType.Half4]: 8,
  [VertexDataType.UByte8]: 8,
};

/** Byte size of one element of the given data type (VertexDataType.cs:47-63). */
export function dataTypeSize(t: VertexDataType): number {
  const s = SIZES[t];
  if (s === undefined) throw new Error(`unknown vertex data type 0x${t.toString(16)}`);
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mdl/geometry/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/mdl/geometry/format.ts test/mdl/geometry/format.test.ts
git commit -m "feat(mdl): vertex format enums + dataTypeSize" -- src/mdl/geometry/format.ts test/mdl/geometry/format.test.ts
```

---

## Task 3: Vertex-declaration parse/serialize

**Files:**
- Create: `src/mdl/geometry/declaration.ts`
- Test: `test/mdl/geometry/declaration.test.ts`

**Interfaces:**
- Consumes: `VertexUsageType`, `VertexDataType` (Task 2).
- Produces:
  - `interface VertexElement { stream: number; offset: number; type: VertexDataType; usage: VertexUsageType; count: number }`
  - `parseVertexDeclarations(vertexInfo: Uint8Array, meshCount: number): VertexElement[][]`
  - `serializeVertexDeclarations(decls: VertexElement[][]): Uint8Array`
  - `VERTEX_DATA_HEADER = 136`

On-wire: per mesh, a run of 8-byte descriptors `[stream u8][offset u8][type u8][usage
u8][count u8][3× 0 pad]`, a `0xFF` terminator byte, then zero pad so each mesh occupies
exactly 136 bytes. Parse asserts the 3 pad bytes are zero (`Mdl.cs:574-577`).

- [ ] **Step 1: Write the failing test**

Create `test/mdl/geometry/declaration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseVertexDeclarations,
  serializeVertexDeclarations,
  VERTEX_DATA_HEADER,
  type VertexElement,
} from "../../../src/mdl/geometry/declaration";
import { VertexDataType, VertexUsageType } from "../../../src/mdl/geometry/format";

function meshBlock(elements: number[][]): number[] {
  const b: number[] = [];
  for (const [stream, offset, type, usage, count] of elements) {
    b.push(stream!, offset!, type!, usage!, count!, 0, 0, 0);
  }
  b.push(0xff);
  while (b.length < VERTEX_DATA_HEADER) b.push(0);
  return b;
}

describe("vertex declarations", () => {
  it("parses a two-mesh block into structured elements", () => {
    const bytes = new Uint8Array([
      ...meshBlock([
        [0, 0, VertexDataType.Half4, VertexUsageType.Position, 0],
        [1, 0, VertexDataType.Half4, VertexUsageType.Normal, 0],
      ]),
      ...meshBlock([[0, 0, VertexDataType.Float3, VertexUsageType.Position, 0]]),
    ]);
    const decls = parseVertexDeclarations(bytes, 2);
    expect(decls).toHaveLength(2);
    expect(decls[0]).toEqual<VertexElement[]>([
      { stream: 0, offset: 0, type: VertexDataType.Half4, usage: VertexUsageType.Position, count: 0 },
      { stream: 1, offset: 0, type: VertexDataType.Half4, usage: VertexUsageType.Normal, count: 0 },
    ]);
    expect(decls[1]).toHaveLength(1);
  });

  it("round-trips parse -> serialize byte-exact", () => {
    const bytes = new Uint8Array([
      ...meshBlock([
        [0, 0, VertexDataType.Half4, VertexUsageType.Position, 0],
        [0, 8, VertexDataType.UByte8, VertexUsageType.BoneWeight, 0],
        [1, 0, VertexDataType.Ubyte4n, VertexUsageType.Binormal, 0],
        [1, 4, VertexDataType.Half2, VertexUsageType.TextureCoordinate, 0],
      ]),
    ]);
    const re = serializeVertexDeclarations(parseVertexDeclarations(bytes, 1));
    expect(Array.from(re)).toEqual(Array.from(bytes));
  });

  it("throws when descriptor padding is non-zero", () => {
    const b = meshBlock([[0, 0, VertexDataType.Half4, VertexUsageType.Position, 0]]);
    b[5] = 1; // dirty the pad
    expect(() => parseVertexDeclarations(new Uint8Array(b), 1)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mdl/geometry/declaration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/mdl/geometry/declaration.ts`:

```ts
// Vertex declaration codec: the 136-byte-per-mesh vertex-info block <-> structured
// elements. Ported from xivModdingFramework Mdl.cs (parse :562-600, serialize :2735-2763) (GPL-3.0).

import { VertexDataType, VertexUsageType } from "./format";

export const VERTEX_DATA_HEADER = 136; // Mdl._VertexDataHeaderSize (0x88)

export interface VertexElement {
  stream: number;
  offset: number;
  type: VertexDataType;
  usage: VertexUsageType;
  count: number;
}

/** Parse `meshCount` consecutive 136-byte declaration blocks into per-mesh element lists. */
export function parseVertexDeclarations(
  vertexInfo: Uint8Array,
  meshCount: number,
): VertexElement[][] {
  const decls: VertexElement[][] = [];
  for (let m = 0; m < meshCount; m++) {
    const base = m * VERTEX_DATA_HEADER;
    const elements: VertexElement[] = [];
    let p = base;
    while (true) {
      const stream = vertexInfo[p]!;
      if (stream === 0xff) break;
      const offset = vertexInfo[p + 1]!;
      const type = vertexInfo[p + 2]! as VertexDataType;
      const usage = vertexInfo[p + 3]! as VertexUsageType;
      const count = vertexInfo[p + 4]!;
      if (vertexInfo[p + 5] !== 0 || vertexInfo[p + 6] !== 0 || vertexInfo[p + 7] !== 0) {
        throw new Error(`mdl: non-zero vertex descriptor padding at mesh ${m} offset ${p - base}`);
      }
      elements.push({ stream, offset, type, usage, count });
      p += 8;
    }
    decls.push(elements);
  }
  return decls;
}

/** Serialize per-mesh element lists back to the 136-byte-per-mesh block (inverse of parse). */
export function serializeVertexDeclarations(decls: VertexElement[][]): Uint8Array {
  const out = new Uint8Array(decls.length * VERTEX_DATA_HEADER); // zero-filled = padding + terminator tail
  for (let m = 0; m < decls.length; m++) {
    let p = m * VERTEX_DATA_HEADER;
    for (const e of decls[m]!) {
      out[p] = e.stream;
      out[p + 1] = e.offset;
      out[p + 2] = e.type;
      out[p + 3] = e.usage;
      out[p + 4] = e.count;
      // out[p+5..p+7] already 0
      p += 8;
    }
    out[p] = 0xff; // terminator; remaining bytes stay 0
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mdl/geometry/declaration.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```powershell
git add src/mdl/geometry/declaration.ts test/mdl/geometry/declaration.test.ts
git commit -m "feat(mdl): vertex-declaration parse/serialize" -- src/mdl/geometry/declaration.ts test/mdl/geometry/declaration.test.ts
```

---

## Task 4: Vertex data model + transpose

**Files:**
- Create: `src/mdl/geometry/vertex-data.ts`
- Test: `test/mdl/geometry/vertex-data.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Vec2 = [number, number]`, `type Vec3 = [number, number, number]`, `type Rgba = [number, number, number, number]`
  - SoA `interface VertexData { positions: Vec3[]; normals: Vec3[]; biNormals: Vec3[]; biNormalHandedness: number[]; flowDirections: Vec3[]; flowHandedness: number[]; colors: Rgba[]; colors2: Rgba[]; textureCoordinates0: Vec2[]; textureCoordinates1: Vec2[]; textureCoordinates2: Vec2[]; boneWeights: number[][]; boneIndices: number[][]; indices: number[] }`
  - `emptyVertexData(): VertexData`
  - AoS `interface TtVertex { position: Vec3; normal: Vec3; binormal: Vec3; handedness: boolean; flowDirection: Vec3; vertexColor: Rgba; vertexColor2: Rgba; uv1: Vec2; uv2: Vec2; uv3: Vec2; boneIds: Uint8Array; weights: Uint8Array }` (`boneIds`/`weights` length 8)
  - `transpose(vd: VertexData): TtVertex[]` — straight, order-preserving copy driven by
    `positions.length`; no dedup/sort/zero-skip. Quantizes weights `round(w*255)`.

- [ ] **Step 1: Write the failing test**

Create `test/mdl/geometry/vertex-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyVertexData, transpose } from "../../../src/mdl/geometry/vertex-data";

describe("transpose (identity SoA -> AoS)", () => {
  it("copies each vertex straight across, quantizing weights to bytes", () => {
    const vd = emptyVertexData();
    vd.positions.push([1, 2, 3], [4, 5, 6]);
    vd.normals.push([0, 1, 0], [1, 0, 0]);
    vd.biNormals.push([1, 0, 0], [0, 1, 0]);
    vd.biNormalHandedness.push(255, 0);
    vd.colors.push([10, 20, 30, 40], [50, 60, 70, 80]);
    vd.textureCoordinates0.push([0.25, 0.5], [0.75, 1]);
    vd.boneWeights.push([1, 0, 0, 0], [128 / 255, 127 / 255, 0, 0]);
    vd.boneIndices.push([3, 0, 0, 0], [5, 9, 0, 0]);

    const verts = transpose(vd);
    expect(verts).toHaveLength(2);
    expect(verts[0]!.position).toEqual([1, 2, 3]);
    expect(verts[0]!.handedness).toBe(true); // 255 -> true
    expect(verts[1]!.handedness).toBe(false); // 0 -> false
    expect(verts[0]!.vertexColor).toEqual([10, 20, 30, 40]);
    expect(verts[0]!.uv1).toEqual([0.25, 0.5]);
    expect(Array.from(verts[0]!.weights)).toEqual([255, 0, 0, 0, 0, 0, 0, 0]); // round(1*255)
    expect(Array.from(verts[1]!.weights.slice(0, 2))).toEqual([128, 127]);
    expect(Array.from(verts[1]!.boneIds.slice(0, 2))).toEqual([5, 9]);
  });

  it("fills defaults for absent usages", () => {
    const vd = emptyVertexData();
    vd.positions.push([1, 1, 1]);
    const [v] = transpose(vd);
    expect(v!.normal).toEqual([0, 0, 0]);
    expect(v!.vertexColor).toEqual([255, 255, 255, 255]);
    expect(v!.vertexColor2).toEqual([0, 0, 0, 255]);
    expect(Array.from(v!.weights)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mdl/geometry/vertex-data.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/mdl/geometry/vertex-data.ts`:

```ts
// Decoded-geometry containers. SoA VertexData mirrors xivModdingFramework's VertexData
// (MdlVertexReader output); AoS TtVertex mirrors TTVertex (WriteVertex input). The
// transpose is the identity seam sub-project B replaces with MergeGeometryData (GPL-3.0).

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Rgba = [number, number, number, number];

export interface VertexData {
  positions: Vec3[];
  normals: Vec3[];
  biNormals: Vec3[];
  biNormalHandedness: number[];
  flowDirections: Vec3[];
  flowHandedness: number[];
  colors: Rgba[];
  colors2: Rgba[];
  textureCoordinates0: Vec2[];
  textureCoordinates1: Vec2[];
  textureCoordinates2: Vec2[];
  boneWeights: number[][];
  boneIndices: number[][];
  indices: number[];
}

export function emptyVertexData(): VertexData {
  return {
    positions: [],
    normals: [],
    biNormals: [],
    biNormalHandedness: [],
    flowDirections: [],
    flowHandedness: [],
    colors: [],
    colors2: [],
    textureCoordinates0: [],
    textureCoordinates1: [],
    textureCoordinates2: [],
    boneWeights: [],
    boneIndices: [],
    indices: [],
  };
}

export interface TtVertex {
  position: Vec3;
  normal: Vec3;
  binormal: Vec3;
  handedness: boolean;
  flowDirection: Vec3;
  vertexColor: Rgba;
  vertexColor2: Rgba;
  uv1: Vec2;
  uv2: Vec2;
  uv3: Vec2;
  boneIds: Uint8Array; // length 8
  weights: Uint8Array; // length 8
}

/** Straight, order-preserving SoA -> AoS copy (TTVertex defaults for absent usages).
 *  Distinct from B's weld: no dedup/sort, no zero-weight skip, no UV NaN clamp. */
export function transpose(vd: VertexData): TtVertex[] {
  const n = vd.positions.length;
  const out: TtVertex[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const weights = new Uint8Array(8);
    const boneIds = new Uint8Array(8);
    const w = vd.boneWeights[i];
    const b = vd.boneIndices[i];
    if (w && b) {
      for (let k = 0; k < w.length && k < 8; k++) {
        weights[k] = Math.round(w[k]! * 255);
        boneIds[k] = b[k]!;
      }
    }
    out[i] = {
      position: vd.positions[i] ?? [0, 0, 0],
      normal: vd.normals[i] ?? [0, 0, 0],
      binormal: vd.biNormals[i] ?? [0, 0, 0],
      handedness: vd.biNormalHandedness[i] === undefined ? true : vd.biNormalHandedness[i] !== 0,
      flowDirection: vd.flowDirections[i] ?? [0, 0, 0],
      vertexColor: vd.colors[i] ?? [255, 255, 255, 255],
      vertexColor2: vd.colors2[i] ?? [0, 0, 0, 255],
      uv1: vd.textureCoordinates0[i] ?? [0, 0],
      uv2: vd.textureCoordinates1[i] ?? [0, 0],
      uv3: vd.textureCoordinates2[i] ?? [0, 0],
      weights,
      boneIds,
    };
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mdl/geometry/vertex-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/mdl/geometry/vertex-data.ts test/mdl/geometry/vertex-data.test.ts
git commit -m "feat(mdl): VertexData/TtVertex model + identity transpose" -- src/mdl/geometry/vertex-data.ts test/mdl/geometry/vertex-data.test.ts
```

---

## Task 5: Geometry offsets model

**Files:**
- Create: `src/mdl/geometry/offsets.ts`
- Test: `test/mdl/geometry/offsets.test.ts`

**Interfaces:**
- Consumes: `XivMdl` from `src/mdl/types` (fields `header.meshCount`,
  `modelData.meshPartCount`, `sections.lodHeaders`, `sections.meshHeaders`,
  `sections.meshParts`).
- Produces:
  - `interface LodGeometry { vertexDataOffset: number; indexDataOffset: number; vertexDataSize: number; meshCount: number }`
  - `interface MeshGeometryInfo { vertexCount: number; indexCount: number; meshPartIndex: number; meshPartCount: number; indexDataOffset: number; vertexDataOffset0: number; vertexDataOffset1: number; vertexDataEntrySize0: number; vertexDataEntrySize1: number }`
  - `interface MeshPartRange { indexOffset: number; indexCount: number }`
  - `interface GeometryLayout { lods: LodGeometry[]; meshes: MeshGeometryInfo[]; parts: MeshPartRange[]; meshLod: number[] }`
  - `parseGeometryLayout(mdl: XivMdl): GeometryLayout`

Field layouts (little-endian): LoD header 60 B — `StandardMeshCount u16 @2`,
`WaterMeshCount u16 @14`, `ShadowMeshCount u16 @18`, `FogMeshCount u16 @26`,
`VertexDataSize i32 @44`, `VertexDataOffset i32 @52`, `IndexDataOffset i32 @56`.
`meshCount = Standard+Water+Shadow+Fog` (excludes TerrainShadow; `LevelOfDetail.cs:33`).
Mesh header 36 B — `VertexCount i32 @0`, `IndexCount i32 @4`, `MeshPartIndex i16 @10`,
`MeshPartCount i16 @12`, `IndexDataOffset i32 @16` (u16 units), `VertexDataOffset0 i32
@20`, `VertexDataOffset1 i32 @24`, `VertexDataEntrySize0 u8 @32`,
`VertexDataEntrySize1 u8 @33`. Mesh part 16 B — `IndexOffset i32 @0`, `IndexCount i32 @4`.

- [ ] **Step 1: Write the failing test**

Create `test/mdl/geometry/offsets.test.ts` (builds a synthetic single-LoD `XivMdl`
with 1 mesh / 1 part; only the fields `parseGeometryLayout` reads are populated):

```ts
import { describe, expect, it } from "vitest";
import { parseGeometryLayout } from "../../../src/mdl/geometry/offsets";
import type { XivMdl } from "../../../src/mdl/types";

function lodHeaders(): Uint8Array {
  const b = new Uint8Array(180); // 3 x 60
  const dv = new DataView(b.buffer);
  // LoD0: 1 standard mesh, vertexDataSize=100, vertexDataOffset=1000, indexDataOffset=2000
  dv.setUint16(2, 1, true); // StandardMeshCount
  dv.setInt32(44, 100, true); // VertexDataSize
  dv.setInt32(52, 1000, true); // VertexDataOffset
  dv.setInt32(56, 2000, true); // IndexDataOffset
  return b;
}

function meshHeaders(): Uint8Array {
  const b = new Uint8Array(36);
  const dv = new DataView(b.buffer);
  dv.setInt32(0, 4, true); // VertexCount
  dv.setInt32(4, 6, true); // IndexCount
  dv.setInt16(10, 0, true); // MeshPartIndex
  dv.setInt16(12, 1, true); // MeshPartCount
  dv.setInt32(16, 3, true); // IndexDataOffset (u16 units)
  dv.setInt32(20, 0, true); // VertexDataOffset0
  dv.setInt32(24, 64, true); // VertexDataOffset1
  b[32] = 16; // entrySize0
  b[33] = 20; // entrySize1
  return b;
}

function meshParts(): Uint8Array {
  const b = new Uint8Array(16);
  const dv = new DataView(b.buffer);
  dv.setInt32(0, 0, true); // IndexOffset
  dv.setInt32(4, 6, true); // IndexCount
  return b;
}

function fakeMdl(): XivMdl {
  return {
    header: { meshCount: 1 },
    modelData: { meshPartCount: 1 },
    vertexInfo: new Uint8Array(0),
    sections: {
      lodHeaders: lodHeaders(),
      meshHeaders: meshHeaders(),
      meshParts: meshParts(),
    },
    geometry: new Uint8Array(0),
  } as unknown as XivMdl;
}

describe("parseGeometryLayout", () => {
  it("reads LoD/mesh/part offsets and the LoD partition", () => {
    const layout = parseGeometryLayout(fakeMdl());
    expect(layout.lods[0]!.vertexDataOffset).toBe(1000);
    expect(layout.lods[0]!.indexDataOffset).toBe(2000);
    expect(layout.lods[0]!.meshCount).toBe(1);
    expect(layout.meshes[0]).toMatchObject({
      vertexCount: 4,
      indexCount: 6,
      indexDataOffset: 3,
      vertexDataOffset0: 0,
      vertexDataOffset1: 64,
      vertexDataEntrySize0: 16,
      vertexDataEntrySize1: 20,
    });
    expect(layout.parts[0]).toEqual({ indexOffset: 0, indexCount: 6 });
    expect(layout.meshLod).toEqual([0]); // mesh 0 belongs to LoD 0
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mdl/geometry/offsets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/mdl/geometry/offsets.ts`:

```ts
// Structured per-LoD/mesh/part geometry offsets & sizes, read from the already-sliced
// opaque sections of a parsed XivMdl. Field layouts ported from Mdl.GetXivMdl
// (LoD :475-512, mesh :616-634, part :1362-1373) (GPL-3.0).

import { LOD_HEADER, MESH_HEADER, type XivMdl } from "../types";

export interface LodGeometry {
  vertexDataOffset: number; // absolute file offset
  indexDataOffset: number; // absolute file offset
  vertexDataSize: number;
  meshCount: number; // TotalMeshCount = Standard+Water+Shadow+Fog
}

export interface MeshGeometryInfo {
  vertexCount: number;
  indexCount: number;
  meshPartIndex: number;
  meshPartCount: number;
  indexDataOffset: number; // in u16 units
  vertexDataOffset0: number; // relative to the LoD vertex offset
  vertexDataOffset1: number;
  vertexDataEntrySize0: number;
  vertexDataEntrySize1: number;
}

export interface MeshPartRange {
  indexOffset: number;
  indexCount: number;
}

export interface GeometryLayout {
  lods: LodGeometry[];
  meshes: MeshGeometryInfo[];
  parts: MeshPartRange[];
  meshLod: number[]; // meshLod[meshIndex] = owning LoD index
}

const MESH_PART = 16;

export function parseGeometryLayout(mdl: XivMdl): GeometryLayout {
  const lodDv = new DataView(
    mdl.sections.lodHeaders.buffer,
    mdl.sections.lodHeaders.byteOffset,
    mdl.sections.lodHeaders.byteLength,
  );
  const lods: LodGeometry[] = [];
  for (let l = 0; l < 3; l++) {
    const o = l * LOD_HEADER;
    const meshCount =
      lodDv.getUint16(o + 2, true) + // Standard
      lodDv.getUint16(o + 14, true) + // Water
      lodDv.getUint16(o + 18, true) + // Shadow
      lodDv.getUint16(o + 26, true); // Fog
    lods.push({
      vertexDataSize: lodDv.getInt32(o + 44, true),
      vertexDataOffset: lodDv.getInt32(o + 52, true),
      indexDataOffset: lodDv.getInt32(o + 56, true),
      meshCount,
    });
  }

  const meshDv = new DataView(
    mdl.sections.meshHeaders.buffer,
    mdl.sections.meshHeaders.byteOffset,
    mdl.sections.meshHeaders.byteLength,
  );
  const meshes: MeshGeometryInfo[] = [];
  const meshLod: number[] = [];
  let lodCursor = 0;
  let remaining = lods[0]!.meshCount;
  for (let i = 0; i < mdl.header.meshCount; i++) {
    while (remaining <= 0 && lodCursor < 2) {
      lodCursor++;
      remaining = lods[lodCursor]!.meshCount;
    }
    remaining--;
    meshLod.push(lodCursor);
    const o = i * MESH_HEADER;
    meshes.push({
      vertexCount: meshDv.getInt32(o, true),
      indexCount: meshDv.getInt32(o + 4, true),
      meshPartIndex: meshDv.getInt16(o + 10, true),
      meshPartCount: meshDv.getInt16(o + 12, true),
      indexDataOffset: meshDv.getInt32(o + 16, true),
      vertexDataOffset0: meshDv.getInt32(o + 20, true),
      vertexDataOffset1: meshDv.getInt32(o + 24, true),
      vertexDataEntrySize0: meshDv.getUint8(o + 32),
      vertexDataEntrySize1: meshDv.getUint8(o + 33),
    });
  }

  const partDv = new DataView(
    mdl.sections.meshParts.buffer,
    mdl.sections.meshParts.byteOffset,
    mdl.sections.meshParts.byteLength,
  );
  const parts: MeshPartRange[] = [];
  for (let i = 0; i < mdl.modelData.meshPartCount; i++) {
    const o = i * MESH_PART;
    parts.push({
      indexOffset: partDv.getInt32(o, true),
      indexCount: partDv.getInt32(o + 4, true),
    });
  }

  return { lods, meshes, parts, meshLod };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mdl/geometry/offsets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/mdl/geometry/offsets.ts test/mdl/geometry/offsets.test.ts
git commit -m "feat(mdl): geometry offsets model (LoD/mesh/part)" -- src/mdl/geometry/offsets.ts test/mdl/geometry/offsets.test.ts
```

---

## Task 6: Geometry decoder (verbatim `MdlVertexReader`)

**Files:**
- Create: `src/mdl/geometry/decode.ts`
- Test: `test/mdl/geometry/decode.test.ts`

**Interfaces:**
- Consumes: `VertexElement` (Task 3), `VertexData`/`emptyVertexData`/`Vec2`/`Vec3`/`Rgba`
  (Task 4), `MeshGeometryInfo` (Task 5), `VertexDataType`/`VertexUsageType` (Task 2),
  `halfToFloat` (Task 1).
- Produces:
  - `decodeVertexData(mdl: Uint8Array, mesh: MeshGeometryInfo, elements: VertexElement[], lodVertexOffset: number, lodIndexOffset: number): VertexData`
  - Behavior per `MdlVertexReader.cs`: split elements by stream sorted by `offset`; read
    `vertexCount` vertices from stream0 then stream1; assert each stream fully consumed;
    then read `indexCount` u16 indices at `mesh.indexDataOffset*2 + lodIndexOffset`.
    Positions/normals apply the NaN/Inf→0 clamp (`ReadVector3`); UV decode does not.

- [ ] **Step 1: Write the failing test**

Create `test/mdl/geometry/decode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeVertexData } from "../../../src/mdl/geometry/decode";
import type { VertexElement } from "../../../src/mdl/geometry/declaration";
import { VertexDataType, VertexUsageType } from "../../../src/mdl/geometry/format";
import type { MeshGeometryInfo } from "../../../src/mdl/geometry/offsets";
import { floatToHalf } from "../../../src/util/half";

// One vertex: stream0 = Position Half4 (8 B); stream1 = Binormal Ubyte4n (4) + Color (4).
const elements: VertexElement[] = [
  { stream: 0, offset: 0, type: VertexDataType.Half4, usage: VertexUsageType.Position, count: 0 },
  { stream: 1, offset: 0, type: VertexDataType.Ubyte4n, usage: VertexUsageType.Binormal, count: 0 },
  { stream: 1, offset: 4, type: VertexDataType.Ubyte4, usage: VertexUsageType.Color, count: 0 },
];

const mesh: MeshGeometryInfo = {
  vertexCount: 1,
  indexCount: 3,
  meshPartIndex: 0,
  meshPartCount: 1,
  indexDataOffset: 0, // *2 -> byte 0 within index region
  vertexDataOffset0: 0,
  vertexDataOffset1: 8,
  vertexDataEntrySize0: 8,
  vertexDataEntrySize1: 8,
};

function buildFile(): Uint8Array {
  // Layout: [stream0 @0..8][stream1 @8..16][indices @16..22]
  const bytes = new Uint8Array(32);
  const dv = new DataView(bytes.buffer);
  // Position Half4 = (1.0, -2.0, 0.0, w=1)
  dv.setUint16(0, floatToHalf(1), true);
  dv.setUint16(2, floatToHalf(-2), true);
  dv.setUint16(4, floatToHalf(0), true);
  dv.setUint16(6, floatToHalf(1), true);
  // Binormal Ubyte4n bytes [255, 0, 128, 255]
  bytes.set([255, 0, 128, 255], 8);
  // Color [10, 20, 30, 40]
  bytes.set([10, 20, 30, 40], 12);
  // Indices [0, 1, 2] as u16 at byte 16
  dv.setUint16(16, 0, true);
  dv.setUint16(18, 1, true);
  dv.setUint16(20, 2, true);
  return bytes;
}

describe("decodeVertexData", () => {
  it("decodes a Half4 position, Ubyte4n binormal, color, and indices", () => {
    const vd = decodeVertexData(buildFile(), mesh, elements, 0, 16);
    expect(vd.positions[0]).toEqual([1, -2, 0]);
    // Binormal: b*2/255 - 1. 255 -> 1, 0 -> -1, 128 -> 1/255. Handedness byte = 255.
    expect(vd.biNormals[0]![0]).toBe(1);
    expect(vd.biNormals[0]![1]).toBe(-1);
    expect(vd.biNormalHandedness[0]).toBe(255);
    expect(vd.colors[0]).toEqual([10, 20, 30, 40]);
    expect(vd.indices).toEqual([0, 1, 2]);
  });

  it("clamps NaN/Inf positions to zero (ReadVector3)", () => {
    const bytes = buildFile();
    new DataView(bytes.buffer).setUint16(0, 0x7e00, true); // NaN half in X
    const vd = decodeVertexData(bytes, mesh, elements, 0, 16);
    expect(vd.positions[0]).toEqual([0, 0, 0]);
  });

  it("throws when a stream is not fully consumed", () => {
    const badMesh = { ...mesh, vertexDataEntrySize0: 12 }; // claims 12 but only 8 read
    expect(() => decodeVertexData(buildFile(), badMesh, elements, 0, 16)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mdl/geometry/decode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/mdl/geometry/decode.ts`:

```ts
// Geometry decoder: verbatim port of xivModdingFramework MdlVertexReader.cs (GPL-3.0).
// Reads a mesh's block0/block1 vertex streams and its u16 index buffer into SoA VertexData.

import { halfToFloat } from "../../util/half";
import type { VertexElement } from "./declaration";
import { VertexDataType, VertexUsageType } from "./format";
import type { MeshGeometryInfo } from "./offsets";
import {
  emptyVertexData,
  type Rgba,
  type Vec2,
  type Vec3,
  type VertexData,
} from "./vertex-data";

class Cursor {
  constructor(
    private readonly bytes: Uint8Array,
    private readonly dv: DataView,
    public pos: number,
  ) {}
  u8(): number {
    return this.bytes[this.pos++]!;
  }
  u16(): number {
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  f32(): number {
    const v = this.dv.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
}

function readVector3(c: Cursor, type: VertexDataType): Vec3 {
  let v: Vec3;
  if (type === VertexDataType.Half4) {
    const x = halfToFloat(c.u16());
    const y = halfToFloat(c.u16());
    const z = halfToFloat(c.u16());
    c.u16(); // w, consumed and discarded
    v = [x, y, z];
  } else {
    v = [c.f32(), c.f32(), c.f32()];
  }
  if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) {
    return [0, 0, 0];
  }
  return v;
}

function readByteVector(c: Cursor): { vector: Vec3; handedness: number } {
  const x = (c.u8() * 2) / 255 - 1;
  const y = (c.u8() * 2) / 255 - 1;
  const z = (c.u8() * 2) / 255 - 1;
  const w = c.u8();
  return { vector: [x, y, z], handedness: w };
}

function readColor(c: Cursor): Rgba {
  return [c.u8(), c.u8(), c.u8(), c.u8()];
}

function readDoubleVector(c: Cursor, type: VertexDataType): { vec0: Vec2; vec1: Vec2 } {
  if (type === VertexDataType.Half4) {
    return { vec0: [halfToFloat(c.u16()), halfToFloat(c.u16())], vec1: [halfToFloat(c.u16()), halfToFloat(c.u16())] };
  }
  if (type === VertexDataType.Half2) {
    return { vec0: [halfToFloat(c.u16()), halfToFloat(c.u16())], vec1: [0, 0] };
  }
  if (type === VertexDataType.Float2) {
    return { vec0: [c.f32(), c.f32()], vec1: [0, 0] };
  }
  if (type === VertexDataType.Float4) {
    return { vec0: [c.f32(), c.f32()], vec1: [c.f32(), c.f32()] };
  }
  return { vec0: [0, 0], vec1: [0, 0] };
}

function readByteOrFloatArray(c: Cursor, type: VertexDataType, asFloat: boolean): number[] {
  const raw = new Array<number>(type === VertexDataType.UByte8 ? 8 : 4);
  if (type === VertexDataType.UByte8) {
    // Silly low => high format (MdlVertexReader.cs:117-128).
    raw[0] = c.u8(); raw[4] = c.u8(); raw[1] = c.u8(); raw[5] = c.u8();
    raw[2] = c.u8(); raw[6] = c.u8(); raw[3] = c.u8(); raw[7] = c.u8();
  } else {
    for (let z = 0; z < raw.length; z++) raw[z] = c.u8();
  }
  return asFloat ? raw.map((b) => b / 255) : raw;
}

function readData(vd: VertexData, c: Cursor, e: VertexElement): void {
  switch (e.usage) {
    case VertexUsageType.TextureCoordinate: {
      const r = readDoubleVector(c, e.type);
      if (e.count === 0) {
        vd.textureCoordinates0.push(r.vec0);
        vd.textureCoordinates1.push(r.vec1);
      } else {
        vd.textureCoordinates2.push(r.vec0);
      }
      break;
    }
    case VertexUsageType.Binormal: {
      const r = readByteVector(c);
      vd.biNormals.push(r.vector);
      vd.biNormalHandedness.push(r.handedness);
      break;
    }
    case VertexUsageType.Flow: {
      const r = readByteVector(c);
      vd.flowDirections.push(r.vector);
      vd.flowHandedness.push(r.handedness);
      break;
    }
    case VertexUsageType.Normal:
      vd.normals.push(readVector3(c, e.type));
      break;
    case VertexUsageType.Position:
      vd.positions.push(readVector3(c, e.type));
      break;
    case VertexUsageType.Color:
      (e.count === 0 ? vd.colors : vd.colors2).push(readColor(c));
      break;
    case VertexUsageType.BoneWeight:
      vd.boneWeights.push(readByteOrFloatArray(c, e.type, true));
      break;
    case VertexUsageType.BoneIndex:
      vd.boneIndices.push(readByteOrFloatArray(c, e.type, false));
      break;
  }
}

/** Decode one mesh's vertex + index buffers (MdlVertexReader.ReadVertexData). */
export function decodeVertexData(
  mdl: Uint8Array,
  mesh: MeshGeometryInfo,
  elements: VertexElement[],
  lodVertexOffset: number,
  lodIndexOffset: number,
): VertexData {
  const vd = emptyVertexData();
  const dv = new DataView(mdl.buffer, mdl.byteOffset, mdl.byteLength);
  const block0 = elements.filter((e) => e.stream === 0).sort((a, b) => a.offset - b.offset);
  const block1 = elements.filter((e) => e.stream === 1).sort((a, b) => a.offset - b.offset);

  const block0Offset = mesh.vertexDataOffset0 + lodVertexOffset;
  const c0 = new Cursor(mdl, dv, block0Offset);
  for (let i = 0; i < mesh.vertexCount; i++) for (const e of block0) readData(vd, c0, e);
  const end0 = block0Offset + mesh.vertexCount * mesh.vertexDataEntrySize0;
  if (c0.pos !== end0) throw new Error(`mdl: stream0 not fully consumed (${c0.pos} != ${end0})`);

  const block1Offset = mesh.vertexDataOffset1 + lodVertexOffset;
  const c1 = new Cursor(mdl, dv, block1Offset);
  for (let i = 0; i < mesh.vertexCount; i++) for (const e of block1) readData(vd, c1, e);
  const end1 = block1Offset + mesh.vertexCount * mesh.vertexDataEntrySize1;
  if (c1.pos !== end1) throw new Error(`mdl: stream1 not fully consumed (${c1.pos} != ${end1})`);

  const indexOffset = mesh.indexDataOffset * 2 + lodIndexOffset;
  for (let i = 0; i < mesh.indexCount; i++) vd.indices.push(dv.getUint16(indexOffset + i * 2, true));

  return vd;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mdl/geometry/decode.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```powershell
git add src/mdl/geometry/decode.ts test/mdl/geometry/decode.test.ts
git commit -m "feat(mdl): geometry decoder (MdlVertexReader port)" -- src/mdl/geometry/decode.ts test/mdl/geometry/decode.test.ts
```

---

## Task 7: Geometry encoder (declaration-driven `WriteVertex`)

**Files:**
- Create: `src/mdl/geometry/encode.ts`
- Test: `test/mdl/geometry/encode.test.ts`

**Interfaces:**
- Consumes: `VertexElement` (Task 3), `TtVertex` (Task 4), `VertexDataType`/
  `VertexUsageType` (Task 2), `floatToHalf` (existing).
- Produces:
  - `encodeVertexData(vertices: TtVertex[], elements: VertexElement[]): { stream0: Uint8Array; stream1: Uint8Array }`
  - `encodeIndices(indices: number[]): Uint8Array` — u16 indices, zero-padded so the
    block length is a multiple of 16 bytes (`Dat.Pad(indexDataBlock, 16)`, `Mdl.cs:2819`).
  - Per-element encoders verbatim from `WriteVectorData`/`ConvertVectorBinormalToBytes`
    (`Mdl.cs:4032-4275`). Half4 W regenerated as `wDefault` (1 Position / 0 Normal).
    `(usage, count)` disambiguates color/color2 and uv0/1 vs uv2 (via `count===0`).

- [ ] **Step 1: Write the failing test**

Create `test/mdl/geometry/encode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { VertexElement } from "../../../src/mdl/geometry/declaration";
import { encodeIndices, encodeVertexData } from "../../../src/mdl/geometry/encode";
import { VertexDataType, VertexUsageType } from "../../../src/mdl/geometry/format";
import type { TtVertex } from "../../../src/mdl/geometry/vertex-data";
import { floatToHalf } from "../../../src/util/half";

function vertex(over: Partial<TtVertex>): TtVertex {
  return {
    position: [0, 0, 0], normal: [0, 0, 0], binormal: [0, 0, 0], handedness: true,
    flowDirection: [0, 0, 0], vertexColor: [0, 0, 0, 0], vertexColor2: [0, 0, 0, 0],
    uv1: [0, 0], uv2: [0, 0], uv3: [0, 0],
    boneIds: new Uint8Array(8), weights: new Uint8Array(8), ...over,
  };
}

describe("encodeVertexData", () => {
  it("encodes Half4 position with wDefault=1 in stream0", () => {
    const elements: VertexElement[] = [
      { stream: 0, offset: 0, type: VertexDataType.Half4, usage: VertexUsageType.Position, count: 0 },
    ];
    const { stream0, stream1 } = encodeVertexData([vertex({ position: [1, 0, 0] })], elements);
    const dv = new DataView(stream0.buffer);
    expect(dv.getUint16(0, true)).toBe(floatToHalf(1));
    expect(dv.getUint16(2, true)).toBe(floatToHalf(0));
    expect(dv.getUint16(4, true)).toBe(floatToHalf(0));
    expect(dv.getUint16(6, true)).toBe(floatToHalf(1)); // W = wDefault(Position) = 1
    expect(stream1).toHaveLength(0);
  });

  it("encodes the Ubyte4n binormal quantizer + handedness byte", () => {
    const elements: VertexElement[] = [
      { stream: 1, offset: 0, type: VertexDataType.Ubyte4n, usage: VertexUsageType.Binormal, count: 0 },
    ];
    // [-1,0,1] -> round((v+1)*127.5) = [0,128,255]; handedness true -> byte 255.
    const { stream1 } = encodeVertexData([vertex({ binormal: [-1, 0, 1], handedness: true })], elements);
    expect(Array.from(stream1)).toEqual([0, 128, 255, 255]);
    // handedness false -> byte 0.
    const b = encodeVertexData([vertex({ binormal: [-1, 0, 1], handedness: false })], elements);
    expect(Array.from(b.stream1)).toEqual([0, 128, 255, 0]);
  });

  it("writes bone weights/ids with the UByte8 low->high interleave", () => {
    const elements: VertexElement[] = [
      { stream: 0, offset: 0, type: VertexDataType.UByte8, usage: VertexUsageType.BoneWeight, count: 0 },
      { stream: 0, offset: 8, type: VertexDataType.UByte8, usage: VertexUsageType.BoneIndex, count: 0 },
    ];
    const weights = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]);
    const boneIds = new Uint8Array([20, 21, 22, 23, 24, 25, 26, 27]);
    const { stream0 } = encodeVertexData([vertex({ weights, boneIds })], elements);
    // low=>high: [0,4,1,5,2,6,3,7]
    expect(Array.from(stream0.slice(0, 8))).toEqual([10, 14, 11, 15, 12, 16, 13, 17]);
    expect(Array.from(stream0.slice(8, 16))).toEqual([20, 24, 21, 25, 22, 26, 23, 27]);
  });
});

describe("encodeIndices", () => {
  it("pads the u16 index block to a multiple of 16 bytes with zeros", () => {
    const out = encodeIndices([1, 2, 3]); // 6 bytes -> padded to 16
    expect(out).toHaveLength(16);
    const dv = new DataView(out.buffer);
    expect([dv.getUint16(0, true), dv.getUint16(2, true), dv.getUint16(4, true)]).toEqual([1, 2, 3]);
    expect(Array.from(out.slice(6))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("adds no padding when already aligned", () => {
    expect(encodeIndices([1, 2, 3, 4, 5, 6, 7, 8])).toHaveLength(16); // 16 bytes exactly
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mdl/geometry/encode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/mdl/geometry/encode.ts`:

```ts
// Geometry encoder: declaration-driven, over verbatim per-element encoders ported from
// xivModdingFramework Mdl.cs WriteVertex/WriteVectorData/ConvertVectorBinormalToBytes (GPL-3.0).
// Iterating the declaration in sorted-offset order reproduces WriteVertex byte-for-byte on a
// canonical declaration, and is byte-exact by construction for any decodable source.

import type { VertexElement } from "./declaration";
import { VertexDataType, VertexUsageType } from "./format";
import type { Vec2, Vec3, TtVertex } from "./vertex-data";
import { floatToHalf } from "../../util/half";

const scratch = new DataView(new ArrayBuffer(4));

function pushU16(out: number[], v: number): void {
  out.push(v & 0xff, (v >>> 8) & 0xff);
}
function pushF32(out: number[], v: number): void {
  scratch.setFloat32(0, v, true);
  out.push(scratch.getUint8(0), scratch.getUint8(1), scratch.getUint8(2), scratch.getUint8(3));
}

/** ConvertVectorBinormalToBytes (Mdl.cs:4032-4079). handednessInt = handedness ? -1 : 1. */
function pushBinormalBytes(out: number[], v: Vec3, handednessInt: number): void {
  out.push(Math.round((v[0] + 1) * (255 / 2)) & 0xff);
  out.push(Math.round((v[1] + 1) * (255 / 2)) & 0xff);
  out.push(Math.round((v[2] + 1) * (255 / 2)) & 0xff);
  out.push(handednessInt > 0 ? 0 : 255);
}

/** WriteVectorData (Mdl.cs:4121-4154) for Position/Normal/Binormal/Flow. */
function pushVectorData(out: number[], type: VertexDataType, data: Vec3, handedness: boolean, wDefault: number): void {
  if (type === VertexDataType.Half4) {
    pushU16(out, floatToHalf(data[0]));
    pushU16(out, floatToHalf(data[1]));
    pushU16(out, floatToHalf(data[2]));
    pushU16(out, floatToHalf(wDefault));
  } else if (type === VertexDataType.Float3) {
    pushF32(out, data[0]);
    pushF32(out, data[1]);
    pushF32(out, data[2]);
  } else if (type === VertexDataType.Ubyte4n) {
    pushBinormalBytes(out, data, handedness ? -1 : 1);
  }
}

function pushUv(out: number[], type: VertexDataType, a: Vec2, b: Vec2): void {
  if (type === VertexDataType.Float2 || type === VertexDataType.Float4) {
    pushF32(out, a[0]);
    pushF32(out, a[1]);
    if (type === VertexDataType.Float4) {
      pushF32(out, b[0]);
      pushF32(out, b[1]);
    }
  } else if (type === VertexDataType.Half2 || type === VertexDataType.Half4) {
    pushU16(out, floatToHalf(a[0]));
    pushU16(out, floatToHalf(a[1]));
    if (type === VertexDataType.Half4) {
      pushU16(out, floatToHalf(b[0]));
      pushU16(out, floatToHalf(b[1]));
    }
  }
}

/** Weights/bone-ids: 4 bytes for Ubyte4/Ubyte4n, 8 with low->high interleave for UByte8. */
function pushBoneArray(out: number[], src: Uint8Array, type: VertexDataType): void {
  if (type === VertexDataType.UByte8) {
    out.push(src[0]!, src[4]!, src[1]!, src[5]!, src[2]!, src[6]!, src[3]!, src[7]!);
  } else {
    out.push(src[0]!, src[1]!, src[2]!, src[3]!);
  }
}

function encodeElement(out: number[], e: VertexElement, v: TtVertex): void {
  switch (e.usage) {
    case VertexUsageType.Position:
      pushVectorData(out, e.type, v.position, true, 1);
      break;
    case VertexUsageType.Normal:
      pushVectorData(out, e.type, v.normal, true, 0);
      break;
    case VertexUsageType.Binormal:
      pushVectorData(out, e.type, v.binormal, v.handedness, 0);
      break;
    case VertexUsageType.Flow:
      pushVectorData(out, e.type, v.flowDirection, true, 0);
      break;
    case VertexUsageType.Color:
      out.push(...(e.count === 0 ? v.vertexColor : v.vertexColor2));
      break;
    case VertexUsageType.TextureCoordinate:
      if (e.count === 0) pushUv(out, e.type, v.uv1, v.uv2);
      else pushUv(out, e.type, v.uv3, [0, 0]);
      break;
    case VertexUsageType.BoneWeight:
      pushBoneArray(out, v.weights, e.type);
      break;
    case VertexUsageType.BoneIndex:
      pushBoneArray(out, v.boneIds, e.type);
      break;
  }
}

/** Encode `vertices` against `elements` into the two vertex streams (WriteVertex). */
export function encodeVertexData(
  vertices: TtVertex[],
  elements: VertexElement[],
): { stream0: Uint8Array; stream1: Uint8Array } {
  const block0 = elements.filter((e) => e.stream === 0).sort((a, b) => a.offset - b.offset);
  const block1 = elements.filter((e) => e.stream === 1).sort((a, b) => a.offset - b.offset);
  const out0: number[] = [];
  const out1: number[] = [];
  for (const v of vertices) {
    for (const e of block0) encodeElement(out0, e, v);
    for (const e of block1) encodeElement(out1, e, v);
  }
  return { stream0: new Uint8Array(out0), stream1: new Uint8Array(out1) };
}

/** Encode u16 indices, zero-padded so the block length is a multiple of 16 bytes. */
export function encodeIndices(indices: number[]): Uint8Array {
  const bytes = indices.length * 2;
  const padded = Math.ceil(bytes / 16) * 16;
  const out = new Uint8Array(padded);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < indices.length; i++) dv.setUint16(i * 2, indices[i]!, true);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mdl/geometry/encode.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```powershell
git add src/mdl/geometry/encode.ts test/mdl/geometry/encode.test.ts
git commit -m "feat(mdl): geometry encoder (declaration-driven WriteVertex)" -- src/mdl/geometry/encode.ts test/mdl/geometry/encode.test.ts
```

---

## Task 8: Corpus round-trip gate (A1 source + A2 golden) and wiring

**Files:**
- Create: `test/helpers/corpus-geometry.ts`
- Modify: `test/helpers/corpus-units.ts` (add `"geometry"` to `CheckKind` and
  `enumerateUnits`)
- Modify: `test/helpers/corpus-register.ts` (add `geometry: registerGeometryChecks` to
  `DISPATCH`)
- Modify: `src/mdl/mdl.ts` (re-export the geometry surface for B and for the check)

**Interfaces:**
- Consumes: everything from Tasks 1–7; `loadModpack`/`upgradeModpack`-style helpers,
  `decodeSqPackFile`/`SqPackType`, `allFiles`/`FileStorageType`, `bytesEqual`,
  `upgradeGoldenCached` (existing helpers).
- Produces: `registerGeometryChecks(pack: string): void`.

The check, per decodable `.mdl`, per mesh across all LoDs: `decode → transpose → encode`
and assert re-emitted stream0 / stream1 / padded-index bytes equal the source slices.
A1 runs on the corpus source models (no oracle). A2 repeats on the cached `/upgrade`
golden models (Float-format), skipping gracefully when the golden is a no-op or
uncached-without-oracle.

- [ ] **Step 1: Add the barrel re-exports (no test yet)**

Modify `src/mdl/mdl.ts` to append (keep existing lines):

```ts
export {
  parseVertexDeclarations,
  serializeVertexDeclarations,
  VERTEX_DATA_HEADER,
  type VertexElement,
} from "./geometry/declaration";
export { dataTypeSize, VertexDataType, VertexUsageType } from "./geometry/format";
export {
  emptyVertexData,
  transpose,
  type Rgba,
  type TtVertex,
  type Vec2,
  type Vec3,
  type VertexData,
} from "./geometry/vertex-data";
export {
  parseGeometryLayout,
  type GeometryLayout,
  type LodGeometry,
  type MeshGeometryInfo,
  type MeshPartRange,
} from "./geometry/offsets";
export { decodeVertexData } from "./geometry/decode";
export { encodeIndices, encodeVertexData } from "./geometry/encode";
```

- [ ] **Step 2: Write the corpus check helper**

Create `test/helpers/corpus-geometry.ts`:

```ts
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModpack } from "../../src/index";
import {
  decodeVertexData,
  encodeIndices,
  encodeVertexData,
  parseGeometryLayout,
  parseMdl,
  parseVertexDeclarations,
  transpose,
} from "../../src/mdl/mdl";
import {
  allFiles,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
} from "../../src/model/modpack";
import { decodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { bytesEqual } from "./compare";
import { upgradeGoldenCached } from "./upgrade-golden";

function mdlFilesOf(data: ModpackData): ModpackFile[] {
  return allFiles(data).filter(
    (f) =>
      f.storage === FileStorageType.SqPackCompressed &&
      f.gamePath.toLowerCase().endsWith(".mdl"),
  );
}

/** Byte-exact decode->transpose->encode over every mesh of every decodable model in `data`.
 *  Returns the count of models round-tripped (0 if none decodable). */
function roundTripModels(data: ModpackData, label: string): number {
  let models = 0;
  for (const f of mdlFilesOf(data)) {
    let decoded: ReturnType<typeof decodeSqPackFile>;
    try {
      decoded = decodeSqPackFile(f.data);
    } catch {
      continue; // tolerated undecodable legacy model (mirrors corpus-mdl)
    }
    if (decoded.type !== SqPackType.Model) continue;
    const bytes = decoded.data;
    const mdl = parseMdl(bytes, f.gamePath);
    const layout = parseGeometryLayout(mdl);
    const decls = parseVertexDeclarations(mdl.vertexInfo, mdl.header.meshCount);
    for (let m = 0; m < layout.meshes.length; m++) {
      const mesh = layout.meshes[m]!;
      if (mesh.vertexCount === 0) continue;
      const lod = layout.lods[layout.meshLod[m]!]!;
      const vd = decodeVertexData(bytes, mesh, decls[m]!, lod.vertexDataOffset, lod.indexDataOffset);
      const { stream0, stream1 } = encodeVertexData(transpose(vd), decls[m]!);
      const idx = encodeIndices(vd.indices);

      const b0 = mesh.vertexDataOffset0 + lod.vertexDataOffset;
      const b1 = mesh.vertexDataOffset1 + lod.vertexDataOffset;
      const io = mesh.indexDataOffset * 2 + lod.indexDataOffset;
      const src0 = bytes.subarray(b0, b0 + mesh.vertexCount * mesh.vertexDataEntrySize0);
      const src1 = bytes.subarray(b1, b1 + mesh.vertexCount * mesh.vertexDataEntrySize1);
      const srcIdx = bytes.subarray(io, io + idx.length);

      const where = `${label} ${f.gamePath} mesh ${m}`;
      expect(bytesEqual(stream0, src0), `${where} stream0`).toBe(true);
      expect(bytesEqual(stream1, src1), `${where} stream1`).toBe(true);
      expect(bytesEqual(idx, srcIdx), `${where} indices`).toBe(true);
    }
    models++;
  }
  return models;
}

// Sub-project A gate: decode->encode symmetry on real geometry. A1 runs on the corpus
// SOURCE models (no oracle). A2 repeats on the cached /upgrade golden (Float-format),
// proving the decoder/encoder on normalized data too. See the geometry-codec design spec.
export function registerGeometryChecks(pack: string): void {
  const name = basename(pack);
  const bytes = () => new Uint8Array(readFileSync(pack));

  describe(`geometry corpus: ${name}`, () => {
    it("A1 source round-trip: decode->encode is byte-exact per mesh", () => {
      const n = roundTripModels(loadModpack(name, bytes()), "A1");
      console.log(`[geometry] ${name}: A1 round-tripped ${n} source model(s)`);
    }, 1_200_000);

    it("A2 golden cross-check: decode->encode is byte-exact on Float-format goldens", () => {
      const input = bytes();
      const golden = upgradeGoldenCached(name, input);
      if (golden === null || golden.kind === "noop") {
        console.log(`[geometry] ${name}: A2 skipped (no golden / no-op)`);
        return;
      }
      const n = roundTripModels(golden.data, "A2");
      console.log(`[geometry] ${name}: A2 round-tripped ${n} golden model(s)`);
    }, 1_200_000);
  });
}
```

- [ ] **Step 3: Wire the check kind**

In `test/helpers/corpus-units.ts`, add `"geometry"` to the `CheckKind` union and push a
`geometry` unit per pack (place it right after `mdl`):

```ts
export type CheckKind =
  | "sqpack"
  | "golden"
  | "mtrl"
  | "pmp"
  | "tex"
  | "mdl"
  | "geometry"
  | "upgrade";
```

and inside `enumerateUnits`, after `units.push({ pack, check: "mdl" });`:

```ts
    units.push({ pack, check: "geometry" });
```

In `test/helpers/corpus-register.ts`, import and register:

```ts
import { registerGeometryChecks } from "./corpus-geometry";
```

and add to the `DISPATCH` object:

```ts
  geometry: registerGeometryChecks,
```

- [ ] **Step 4: Run the geometry corpus check + typecheck**

Run: `npx vitest run test/helpers/corpus-geometry.ts`
Expected: PASS. Console shows `[geometry] <pack>: A1 round-tripped N source model(s)`
for each pack; A2 lines show round-tripped counts or `skipped`. If A1 fails on a real
model, read the failure label (`<pack> <gamePath> mesh <m> stream0|stream1|indices`) —
that is a real codec discrepancy or one of the documented edge cases (see below); do
**not** paper over it.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Full gate + commit**

Run: `npm run check; npm run typecheck; npm test`
Expected: all green (Biome clean, types clean, full suite passes including the new
`geometry` units).

```powershell
git add test/helpers/corpus-geometry.ts test/helpers/corpus-units.ts test/helpers/corpus-register.ts src/mdl/mdl.ts
git commit -m "test(mdl): corpus geometry round-trip gate (A1 source + A2 golden)" -- test/helpers/corpus-geometry.ts test/helpers/corpus-units.ts test/helpers/corpus-register.ts src/mdl/mdl.ts
```

---

## Documented edge cases (expected absent in clean SE data; A1 surfaces them loudly)

If A1 fails, the label pinpoints the mesh/stream. These are the known conditions under
which a *correct* codec would still mismatch the source — each is a real finding to
document, not silence:

- **Half4 W ≠ wDefault (R-A1).** Encode regenerates position/normal W as `Half(1)`/
  `Half(0)`. A mismatch means SE stored a different W — investigate before proceeding.
- **Binormal/flow handedness byte ∉ {0, 255}.** Decode keeps the raw byte; encode emits
  0 or 255. A source byte like `1` would not round-trip.
- **NaN/Inf position or normal.** Decode clamps to `(0,0,0)` (`ReadVector3`); the source
  bytes were non-zero.
- **NaN UV.** `floatToHalf(NaN)` yields a canonical NaN that may differ from the source
  NaN bits.

## Risks carried to sub-project B (out of scope here; noted so B's spec picks them up)

- **R3 — absolute Half↔Float SharpDX parity.** Not exercised by A (symmetry only:
  half→float→half is identity). B's golden byte-parity depends on `floatToHalf` matching
  **SharpDX.Half** round-to-nearest-even; add a targeted parity unit test in B.
- **R4 — banker's vs half-up rounding.** `Math.round` is half-up; C# `Math.Round` is
  half-to-even. A's round-trip inputs are exact integers post-decode, so the binormal/
  weight quantizers never hit a `.5` boundary here — but B, feeding arbitrary
  post-weld floats, can, and must reconcile the rounding mode.

---

## Self-review checklist (run before handing off to execution)

1. **Spec coverage** — declaration codec (T3), decoder (T6), encoder incl. Half/Float,
   binormal quantizer, weight interleave, index padding (T7), offsets model (T5),
   transpose seam (T4), `halfToFloat` (T1), A1+A2 gate (T8): all present.
2. **Placeholder scan** — no TBD/TODO; every code step is complete.
3. **Type consistency** — `VertexElement`, `VertexData`, `TtVertex`, `MeshGeometryInfo`,
   `GeometryLayout` names/fields match across T3–T8; `decodeVertexData`/`encodeVertexData`/
   `encodeIndices`/`transpose`/`parseGeometryLayout`/`parseVertexDeclarations` signatures
   are used consistently in the T8 check.
