# Model Normalizer (sub-project 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce, byte-for-byte, TexTools `/upgrade`'s `FixOldModel` normalization of a `.mdl` (LoD-collapse + per-part weld + full geometry re-encode + v6 + recomputed headers/bboxes/bone-sets), and wire it into the upgrade pipeline under the TTMP-version gate.

**Architecture:** A new editable-model + serializer layer under `src/mdl/model/`, sitting on top of 3a's `src/mdl/geometry/` codec. Pipeline: `parseMdl` (3a framing) → `readEditableModel` (finish `GetXivMdl` over the opaque slices) → `fromRaw` (weld + merges, port of `TTModel.FromRaw`) → `makeUncompressedMdl` (port of `Mdl.MakeUncompressedMdlFile`) → re-wrap as a `SqPackType.Model` entry. Gate + wiring live in `src/upgrade/`.

**Tech Stack:** TypeScript, Vitest, Biome. No new runtime deps. Reuses 3a's `decodeVertexData`, `encodeVertexData`, `encodeIndices`, `parseVertexDeclarations`, `serializeVertexDeclarations`, `parseGeometryLayout`, and the `TtVertex` type.

## Global Constraints

- **Platform:** Windows / PowerShell only (`bash` blocked). Single fast test: `npx vitest run <file>`. Full gate: `npm test`.
- **End-of-task gate (all green):** `npm run check`, `npm run typecheck`, `npm test`.
- **Formatting is Biome's** — never hand-format; run `npm run check`. No per-file license/SPDX headers.
- **Port fidelity ("split, don't blend", AGENTS.md):** each new module maps to a named C# symbol and cites its source (`file · symbol · lines`) in a header comment. Do not blend logic across C# files/symbols. `reference/` is read-only — never edit/lint/format it.
- **Commits:** explicit pathspec (`git commit -m … -- <paths>`); keep scoped. Branch: `feat/model-normalizer` (already created off `main`).
- **No new deps.** If one becomes unavoidable: pinned-exact, ≥ 7-day min release age — but stop and confirm first.
- **The ratchet is the real gate.** Unit tests (hand-derived micro-fixtures) cover the four computational helpers; everything else is proven by the E2E `.mdl` golden ratchet burning **453 → 0**. Re-bless with `$env:UPDATE_UPGRADE_BASELINE="1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`.

## Reference-detail appendix (extracted from the C#; cite these while implementing)

- **`GetUsageInfo`** (`TTModel.cs:1308–1367`): returns `(usesVColor2, maxUv, needsEightWeights)`. `needsEightWeights` = any vertex has nonzero weight OR bone id in slots 4–7. `maxUv` climbs 1→2 (any `UV2 != (0,0)`) →3 (any `UV3 != (0,0)`). `usesVColor2` = any `VertexColor2 != (0,0,0,255)`.
- **Declaration element order** (`Mdl.cs:2614–2711`), `upgradePrecision=true`: `Position(blk0, Float3)`, `[BoneWeight(blk0, needs8?UByte8:Ubyte4n), BoneIndex(blk0, needs8?UByte8:Ubyte4) if HasWeights]`, `Normal(blk1, Float3)`, `Binormal(blk1, Ubyte4n)`, `[Flow(blk1, Ubyte4n) if AnisotropicLighting]`, `Color(blk1, Ubyte4n, count0)`, `[Color(blk1, Ubyte4n, count1) if usesVColor2]`, `TextureCoordinate(blk1, maxUv==1?Float2:Float4, count0)`, `[TextureCoordinate(blk1, Float2, count1) if maxUv>2]`. Offsets = running per-block byte cursor; per-block totals = per-stream entry sizes. Sizes: Float2=8, Float3=12, Float4=16, Ubyte4=4, Ubyte4n=4, UByte8=8.
- **`Getv6BoneSet`** (`TTModel.cs:1373–1391`): returns packed LE i16 array of `Bones.indexOf(groupBone)` per group bone; length `2·boneCount`, no header/pad. Example group→[5,12,7] ⇒ `05 00 0C 00 07 00`.
- **v6 bone-set block assembly** (`Mdl.cs:3378–3416`): header table `[i16 offsetInDwords][i16 count]` per group (count = packedBytes/2), then each group's packed data padded to 4-byte boundary; `offset = (blockLenBeforeThisData − headerLoc)/4`; `boneSetSize = (blockEnd − dataStart)/2` (shorts in the data region only, excludes header). Example single group [5,12,7] ⇒ `01 00 03 00 | 05 00 0C 00 07 00 00 00`, boneSetSize=4.
- **`FromRaw` order** (`TTModel.cs:2695–2729`): `mergeGeometryData` → `mergeAttributeData` → `mergeMaterialData` → `mergeShapeData` (try/catch → clearShapeData) → `Source=path` → `MdlVersion=raw.MdlVersion` → `fixUpSkinReferences(model, path)` → `mergeFlags` → `UVState=SE_Space` → `calculateTangents`.
- **Weld `MergeGeometryData`** (`ModelModifiers.cs:376–576`): per LoD0 mesh → per part, slice `Indices[IndexOffset−mesh.IndexDataOffset .. +IndexCount]`, `uniqueSortedAscending(ids)` is the new vertex order, remap triangle indices to sorted position; per-part `vertMap` sized `max(id)+1`. `fakePart` when `!HasBonelessParts && MeshBoneSets.Count==0` (one synthetic part over the whole mesh, indexStart=0). NaN UV2/UV3 components → 0. Colors2/flow left at defaults when source arrays are shorter. Per-mesh `Bones` = dedup of `PathData.BoneList[MeshBoneSets[BoneSetIndex].BoneIndices[..count]]`.
- **`calculateTangents` fast path** (`ModelModifiers.cs:2127–2281`): when not forced and any vertex has a nonzero binormal, computes `Tangent = ±(Normal × Binormal)` only, leaving Binormal/Handedness untouched. **Tangent is not serialized ⇒ this is a no-op on output bytes ⇒ omit it, guarded by the R2 corpus scan (Task 3).**
- **Serialize block order** (`Mdl.cs:3883–3906`): pathInfo, basicModel(56B), unkData0, lodData(60B LoD0 + 120 zero), extraMeshes(empty unless HasExtraMeshes), meshData(36B×mesh), attrPathOffsets, unkData1(if non-null), meshPartData(16B×part, if useParts), unkData2, matPathOffsets, bonePathOffsets, boneSets(v6), fullShapeData(if HasShapeData), partBoneSets, neckMorph, patch72(empty), padding, boundingBox. File = `header(68B) ‖ vertexInfo ‖ modelData ‖ vertexData ‖ indexData`. `combinedDataBlockSize` self-check at `Mdl.cs:3908`.
- **bbox math** (`Mdl.cs:2559–2587`, `3681–3746`): per-axis float32 min/max over all LoD0 vertices; `absVect` = per-axis max |component|; `radius = sqrt(absX²+absY²+absZ²)` in float32. Boxes (32 B each = min vec4 + max vec4, w=1): `[0]` origin-clamped (min>0→0, max<0→0), `[1]` unclamped real, `[2]`/`[3]` Water/Fog = 32 zero bytes. Per-bone box = `±radius/20` cube, w=1, one per `ttModel.Bones`. (`buildRadiusBoundingBox` from ref `b185e1e` already emits exactly this 32-byte cube.)
- **v6 bump (R1):** external — the caller sets `ttModel.MdlVersion = 6` before serialize; `lodCount=1` is hardcoded in `MakeUncompressedMdlFile`. **Our normalizer sets `mdlVersion = 6` before serializing.**
- **`restore`/`uncompressedBytes` fold-in** (ref `cca61fa`): `uncompressedBytes(f) → {bytes, type?}`; `restore(f, bytes, type)` re-encodes with the source SqPack `type` (Model for `.mdl`, Standard for `.mtrl`).

---

### Task 1: Thread source `TTMPVersion` + the `needsMdlFix` gate

**Files:**
- Modify: `src/model/modpack.ts` (add `sourceTtmpVersion?: string` to `ModpackMeta`; keep `emptyMeta` valid)
- Modify: `src/container/ttmp2.ts:56` (populate from `mpl.TTMPVersion`)
- Modify: `src/container/ttmp-legacy.ts:73`, `src/container/pmp.ts:103` (leave undefined / set legacy marker)
- Create: `src/upgrade/model.ts` (the `needsMdlFix` gate helper only, for now)
- Test: `test/upgrade/model.test.ts`

**Interfaces:**
- Produces: `ModpackMeta.sourceTtmpVersion?: string`; `needsMdlFix(data: ModpackData): boolean` in `src/upgrade/model.ts`.

- [ ] **Step 1: Write the failing test** — `test/upgrade/model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ModpackFormat, type ModpackData, emptyMeta } from "../../src/model/modpack";
import { needsMdlFix } from "../../src/upgrade/model";

function data(format: ModpackFormat, ttmp?: string): ModpackData {
  return { sourceFormat: format, isSimple: false,
    meta: { ...emptyMeta(), sourceTtmpVersion: ttmp }, groups: [] };
}

describe("needsMdlFix gate", () => {
  it("normalizes TTMP2 below 2.0", () => {
    expect(needsMdlFix(data(ModpackFormat.Ttmp2, "1.3w"))).toBe(true);
    expect(needsMdlFix(data(ModpackFormat.Ttmp2, "1.0s"))).toBe(true);
  });
  it("skips TTMP2 at/above 2.0", () => {
    expect(needsMdlFix(data(ModpackFormat.Ttmp2, "2.1w"))).toBe(false);
    expect(needsMdlFix(data(ModpackFormat.Ttmp2, "2.0"))).toBe(false);
  });
  it("treats legacy .ttmp (no version) as needing the fix", () => {
    expect(needsMdlFix(data(ModpackFormat.TtmpLegacy, undefined))).toBe(true);
  });
  it("never normalizes PMP", () => {
    expect(needsMdlFix(data(ModpackFormat.Pmp, undefined))).toBe(false);
    expect(needsMdlFix(data(ModpackFormat.PmpFolder, undefined))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/model.test.ts`
Expected: FAIL — `needsMdlFix` / `sourceTtmpVersion` not defined.

- [ ] **Step 3: Add the field + gate.** In `src/model/modpack.ts` add `sourceTtmpVersion?: string;` to `ModpackMeta` (after `minimumFrameworkVersion`). Create `src/upgrade/model.ts`:

```ts
// Model-normalizer gate + entry (upgrade layer). Mirrors EndwalkerUpgrade/TTMP
// DoesModpackNeedFix (TTMP.cs:918): FixOldModel runs on .mdl when TTMP major < 2.
import { ModpackFormat, type ModpackData } from "../model/modpack";

/** Parse a TTMPVersion like "1.3w"/"2.1s"/"2.0" to its integer major component. */
function ttmpMajor(v: string | undefined): number {
  if (!v) return 1; // legacy .ttmp predates the 2.x format → needs the fix
  const m = /^(\d+)/.exec(v);
  return m ? Number(m[1]) : 1;
}

/** True when the pack's models get FixOldModel: TTMP (any legacy/v1) with major < 2. PMP never does. */
export function needsMdlFix(data: ModpackData): boolean {
  if (data.sourceFormat === ModpackFormat.Pmp || data.sourceFormat === ModpackFormat.PmpFolder) {
    return false;
  }
  return ttmpMajor(data.meta.sourceTtmpVersion) < 2;
}
```

Then populate the source version. In `src/container/ttmp2.ts` where `minimumFrameworkVersion` is set (~:56), add `sourceTtmpVersion: mpl.TTMPVersion,` to the meta object. Leave `ttmp-legacy.ts`/`pmp.ts` unset (undefined) — `needsMdlFix` handles both.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade/model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full gate + commit**

```powershell
npm run check; npm run typecheck; npm test
git commit -m "feat(upgrade): thread source TTMPVersion + needsMdlFix model gate" -- src/model/modpack.ts src/container/ttmp2.ts src/upgrade/model.ts test/upgrade/model.test.ts
```

---

### Task 2: `restore()` SqPack-type fix + `{bytes,type}` threading (fold ref `cca61fa`)

**Files:**
- Modify: `src/upgrade/upgrade.ts` (`uncompressedBytes`, `restore`, `materialRound` callers)
- Test: `test/upgrade/upgrade.test.ts` (add a case)

**Interfaces:**
- Produces: `uncompressedBytes(f) → { bytes: Uint8Array; type?: SqPackType }`; `restore(f, bytes, type?) → ModpackFile`.
- Consumes: 3a `SqPackType`, `decodeSqPackFile`, `encodeSqPackFile`.

- [ ] **Step 1: Write the failing test** — add to `test/upgrade/upgrade.test.ts`:

```ts
it("restore re-encodes a Model entry as SqPackType.Model", () => {
  // A tiny valid Type-3 (Model) SqPack entry round-trips through restore keeping its type.
  const raw = new Uint8Array([1, 2, 3, 4]);
  const encoded = encodeSqPackFile(raw, SqPackType.Model);
  const f = { gamePath: "chara/x.mdl", data: encoded, storage: FileStorageType.SqPackCompressed };
  const { bytes, type } = uncompressedBytes(f);
  expect(type).toBe(SqPackType.Model);
  const restored = restore(f, bytes, type);
  expect(decodeSqPackFile(restored.data).type).toBe(SqPackType.Model);
});
```

(Import `uncompressedBytes`/`restore` — export them from `upgrade.ts` if not already, or move this assertion into an exported test seam. Prefer exporting the two helpers.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/upgrade.test.ts`
Expected: FAIL — `restore` takes 2 args / helpers not exported.

- [ ] **Step 3: Apply the ref `cca61fa` change** verbatim into `src/upgrade/upgrade.ts`:

```ts
interface Decoded {
  bytes: Uint8Array;
  /** Source SqPack entry type; undefined for a RawUncompressed pmp file. */
  type?: SqPackType;
}

export function uncompressedBytes(f: ModpackFile): Decoded {
  if (f.storage === FileStorageType.SqPackCompressed) {
    const d = decodeSqPackFile(f.data);
    return { bytes: d.data, type: d.type };
  }
  return { bytes: f.data };
}

export function restore(f: ModpackFile, bytes: Uint8Array, type: SqPackType | undefined): ModpackFile {
  if (f.storage === FileStorageType.SqPackCompressed) {
    return { ...f, data: encodeSqPackFile(bytes, type ?? SqPackType.Standard) };
  }
  return { ...f, data: bytes };
}
```

Update `materialRound` to thread the type: `const { bytes, type } = uncompressedBytes(f);` then `parseMtrl(bytes, f.gamePath)` and `restore(f, serializeMtrl(mtrl), type)`.

- [ ] **Step 4: Run tests** — `npx vitest run test/upgrade/upgrade.test.ts` → PASS; also `npx vitest run test/upgrade/material.test.ts` (regression) → PASS.

- [ ] **Step 5: Commit**

```powershell
npm run check; npm run typecheck
git commit -m "fix(upgrade): re-encode source SqPack type in restore (Model for .mdl)" -- src/upgrade/upgrade.ts test/upgrade/upgrade.test.ts
```

---

### Task 3: `model/tt-model.ts` — TT types, `getUsageInfo`, `getV6BoneSet`, R2 scan

**Files:**
- Create: `src/mdl/model/tt-model.ts`
- Test: `test/mdl/model/tt-model.test.ts`

**Interfaces:**
- Consumes: `TtVertex` (from `../geometry/vertex-data`).
- Produces:
  - `interface TTMeshPart { name: string; vertices: TtVertex[]; triangleIndices: number[]; attributes: Set<string>; }`
  - `interface TTMeshGroup { name: string; meshType: number; parts: TTMeshPart[]; material: string; bones: string[]; }`
  - `interface TTModel { source: string; mdlVersion: number; meshGroups: TTMeshGroup[]; attributes: string[]; bones: string[]; materials: string[]; shapeNames: string[]; anisotropicLighting: boolean; flags1: number; }`
  - `getUsageInfo(m: TTModel): { usesVColor2: boolean; maxUv: number; needsEightWeights: boolean }`
  - `hasWeights(m: TTModel): boolean` (any group has any nonzero weight)
  - `getV6BoneSet(m: TTModel, groupIndex: number): Uint8Array` (packed LE i16, no header/pad)

- [ ] **Step 1: Write the failing tests** — `test/mdl/model/tt-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getUsageInfo, getV6BoneSet, type TTModel } from "../../../src/mdl/model/tt-model";

function vert(over: Partial<any> = {}) {
  return { position: [0,0,0], normal: [0,0,0], binormal: [0,0,0], handedness: true,
    flowDirection: [0,0,0], vertexColor: [255,255,255,255], vertexColor2: [0,0,0,255],
    uv1: [0,0], uv2: [0,0], uv3: [0,0], boneIds: new Uint8Array(8), weights: new Uint8Array(8), ...over };
}
function model(groups: any[]): TTModel {
  return { source: "", mdlVersion: 6, meshGroups: groups, attributes: [], bones: [],
    materials: [], shapeNames: [], anisotropicLighting: false, flags1: 0 };
}

describe("getUsageInfo", () => {
  it("detects maxUv, vColor2, eight-weights", () => {
    const w = new Uint8Array(8); w[5] = 3; // nonzero weight in slot 5
    const m = model([{ name: "g", meshType: 0, material: "m", bones: [], parts: [
      { name: "p", attributes: new Set<string>(), triangleIndices: [], vertices: [
        vert({ uv2: [0.5, 0], vertexColor2: [1, 0, 0, 255], weights: w }),
      ] } ] }]);
    expect(getUsageInfo(m)).toEqual({ usesVColor2: true, maxUv: 2, needsEightWeights: true });
  });
  it("defaults to maxUv 1, no vColor2, four weights", () => {
    const m = model([{ name: "g", meshType: 0, material: "m", bones: [], parts: [
      { name: "p", attributes: new Set<string>(), triangleIndices: [], vertices: [vert()] } ] }]);
    expect(getUsageInfo(m)).toEqual({ usesVColor2: false, maxUv: 1, needsEightWeights: false });
  });
});

describe("getV6BoneSet", () => {
  it("packs group bones as LE i16 indices into the model bone list", () => {
    // model bones: A=0,B=1,C=2,D=3,E=4,F=5,... ; group uses [F, ?, ?] mapping to indices 5,12,7
    const bones = Array.from({ length: 13 }, (_, i) => `b${i}`);
    const m = model([{ name: "g", meshType: 0, material: "m", bones: ["b5", "b12", "b7"], parts: [] }]);
    m.bones = bones;
    expect(Array.from(getV6BoneSet(m, 0))).toEqual([0x05,0,0x0c,0,0x07,0]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/mdl/model/tt-model.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/mdl/model/tt-model.ts`.** Header comment cites `TTModel.cs`. Types as in Interfaces. `getUsageInfo` per the appendix (climb maxUv, vColor2 `!= (0,0,0,255)`, eight-weights from slots 4–7 of weights/boneIds). `getV6BoneSet(m, g)`: for each `name` in `m.meshGroups[g].bones`, `idx = m.bones.indexOf(name)`, write LE i16 into a `Uint8Array(bones.length*2)`. `hasWeights`: any weight byte > 0 in any vertex.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/mdl/model/tt-model.test.ts` → PASS.

- [ ] **Step 5: R2 corpus scan (guards omitting tangents).** Add `test/mdl/model/binormals-present.test.ts` that decodes every LoD0 mesh of every corpus `.mdl` (via 3a `parseGeometryLayout` + `parseVertexDeclarations`) and asserts each mesh's declaration contains a `Binormal` usage. This proves the tangent fast path (no byte effect) always applies, so tangent computation can be omitted. If any mesh lacks a binormal, STOP — the full `CalculateTangentsForMesh` recompute must be ported (out-of-plan; escalate).

```ts
// For each corpus mdl: parse, for each LoD0 mesh assert elements.some(e => e.usage === VertexUsageType.Binormal)
```

- [ ] **Step 6: Commit**

```powershell
npm run check; npm run typecheck; npx vitest run test/mdl/model
git commit -m "feat(mdl): TTModel types + getUsageInfo/getV6BoneSet; confirm corpus binormals (R2)" -- src/mdl/model/tt-model.ts test/mdl/model/tt-model.test.ts test/mdl/model/binormals-present.test.ts
```

---

### Task 4: `model/bone-sets.ts` — v6 bone-set block assembly

**Files:**
- Create: `src/mdl/model/bone-sets.ts`
- Test: `test/mdl/model/bone-sets.test.ts`

**Interfaces:**
- Consumes: `TTModel`, `getV6BoneSet` (Task 3).
- Produces: `buildV6BoneSetBlock(m: TTModel): { block: Uint8Array; boneSetSize: number }` — cites `Mdl.cs:3372–3452`.

- [ ] **Step 1: Write the failing test** — `test/mdl/model/bone-sets.test.ts`, using the appendix worked example:

```ts
import { describe, expect, it } from "vitest";
import { buildV6BoneSetBlock } from "../../../src/mdl/model/bone-sets";
import type { TTModel } from "../../../src/mdl/model/tt-model";

it("assembles one group's v6 bone-set block (header + padded data)", () => {
  const m = { source: "", mdlVersion: 6, attributes: [], materials: [], shapeNames: [],
    anisotropicLighting: false, flags1: 0,
    bones: Array.from({ length: 13 }, (_, i) => `b${i}`),
    meshGroups: [{ name: "g", meshType: 0, material: "m", parts: [], bones: ["b5","b12","b7"] }],
  } as unknown as TTModel;
  const { block, boneSetSize } = buildV6BoneSetBlock(m);
  // header: offset=1 (dwords), count=3 ; data: 05 00 0c 00 07 00 + 2 pad bytes
  expect(Array.from(block)).toEqual([0x01,0,0x03,0, 0x05,0,0x0c,0,0x07,0, 0,0]);
  expect(boneSetSize).toBe(4); // (12 - 4) / 2
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/mdl/model/bone-sets.test.ts` → FAIL.

- [ ] **Step 3: Implement `buildV6BoneSetBlock`** per appendix: first pass appends `[i16 0][i16 count]` header per group (`count = getV6BoneSet(m,g).length/2`); second pass, for each group set header offset `= (block.length − headerLoc)/4` then append the packed data and, if `packed.length % 4 !== 0`, 2 zero pad bytes. `boneSetSize = (block.length − 4*groupCount)/2`. Use `DataView`/`ByteBuilder`.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```powershell
npm run check; npm run typecheck
git commit -m "feat(mdl): v6 bone-set block assembly (Getv6BoneSet + header/pad)" -- src/mdl/model/bone-sets.ts test/mdl/model/bone-sets.test.ts
```

---

### Task 5: `model/bounding-box.ts` — extents, radius, bbox block

**Files:**
- Create: `src/mdl/model/bounding-box.ts`
- Test: `test/mdl/model/bounding-box.test.ts`

**Interfaces:**
- Consumes: `TTModel`, `Vec3`.
- Produces:
  - `computeExtents(m: TTModel): { min: Vec3; max: Vec3; abs: Vec3 }` (float32, seeds min=9999/max=-9999/abs=0)
  - `computeRadius(abs: Vec3): number` (float32 `Math.fround` sqrt)
  - `buildBoundingBoxBlock(m: TTModel, radius: number, min: Vec3, max: Vec3): Uint8Array` — 4 model boxes (`[0]` origin-clamped, `[1]` real, `[2]/[3]` zero) + one ±radius/20 cube per model bone. Cites `Mdl.cs:2559–2587, 3681–3746`. (Furniture-part boxes are out of scope — the serializer fails loud if `useFurnitureBBs`, see Task 10.)
  - `buildRadiusBoundingBox(radius): Uint8Array` (32-byte cube; re-derived from ref `b185e1e`).

- [ ] **Step 1: Write the failing test** — `test/mdl/model/bounding-box.test.ts`, using the appendix worked example (verts `(1,2,3),(-4,5,-6),(0,0,0)`):

```ts
import { describe, expect, it } from "vitest";
import { computeExtents, computeRadius, buildRadiusBoundingBox } from "../../../src/mdl/model/bounding-box";

function partModel(positions: number[][]) {
  const verts = positions.map((p) => ({ position: p, normal: [0,0,0], binormal: [0,0,0],
    handedness: true, flowDirection: [0,0,0], vertexColor: [255,255,255,255],
    vertexColor2: [0,0,0,255], uv1: [0,0], uv2: [0,0], uv3: [0,0],
    boneIds: new Uint8Array(8), weights: new Uint8Array(8) }));
  return { meshGroups: [{ parts: [{ vertices: verts }] }] } as any;
}

it("computes float32 min/max/abs and radius", () => {
  const e = computeExtents(partModel([[1,2,3],[-4,5,-6],[0,0,0]]));
  expect(e.min).toEqual([-4,0,-6]);
  expect(e.max).toEqual([1,5,3]);
  expect(e.abs).toEqual([4,5,6]);
  expect(computeRadius(e.abs)).toBeCloseTo(Math.fround(Math.sqrt(77)), 6); // ≈8.7749643
});

it("origin clamp distinguishes box[0] from box[1] on all-positive input", () => {
  const e = computeExtents(partModel([[1,2,3],[4,5,6]]));
  expect(e.min).toEqual([1,2,3]); // box[1] uses this; box[0] min clamps to (0,0,0)
});

it("per-bone cube is ±radius/20 with w=1", () => {
  const dv = new DataView(buildRadiusBoundingBox(20).buffer);
  expect(dv.getFloat32(0, true)).toBe(-1);   // -20/20
  expect(dv.getFloat32(12, true)).toBe(1);   // w
  expect(dv.getFloat32(16, true)).toBe(1);   // +20/20
  expect(dv.getFloat32(28, true)).toBe(1);   // w
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement** per appendix. `computeExtents`: nested loop over `meshGroups→parts→vertices`, per-axis float32 min/max and abs-max (use `Math.fround` on each accumulation to match single precision). `computeRadius`: `Math.fround(Math.sqrt(Math.fround(ax*ax)+Math.fround(ay*ay)+Math.fround(az*az)))`. `buildBoundingBoxBlock`: box[0] = clamp(min>0→0)/clamp(max<0→0); box[1] = min/max; box[2]=box[3]= 32 zero bytes; then `buildRadiusBoundingBox(radius)` × `m.bones.length`. Each real box: min vec4 (w=1) then max vec4 (w=1) via `ByteBuilder.f32`.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```powershell
npm run check; npm run typecheck
git commit -m "feat(mdl): model bounding-box extents/radius/block (float32, per-bone cube)" -- src/mdl/model/bounding-box.ts test/mdl/model/bounding-box.test.ts
```

---

### Task 6: `model/build-declarations.ts` — vertex declarations from usage

**Files:**
- Create: `src/mdl/model/build-declarations.ts`
- Test: `test/mdl/model/build-declarations.test.ts`

**Interfaces:**
- Consumes: `VertexElement`, `VertexDataType`, `VertexUsageType`, `dataTypeSize` (3a); `TTModel`, `getUsageInfo`, `hasWeights`.
- Produces:
  - `buildDeclarations(m: TTModel): VertexElement[][]` (one identical decl per mesh group; `upgradePrecision` always true — corpus never hits the 8 MB overflow; assert it and fail loud if exceeded)
  - `streamEntrySizes(elements: VertexElement[]): [number, number, number]` (per-block byte totals)

- [ ] **Step 1: Write the failing test** — using the appendix worked example (position+normal+binormal+1 color+2 UV+4 weights, precision on):

```ts
import { describe, expect, it } from "vitest";
import { buildDeclarations, streamEntrySizes } from "../../../src/mdl/model/build-declarations";
import { VertexDataType as T, VertexUsageType as U } from "../../../src/mdl/geometry/format";
import type { TTModel } from "../../../src/mdl/model/tt-model";

it("emits Float-upgraded elements in canonical order with running offsets", () => {
  const w = new Uint8Array(8); w[0] = 255; // hasWeights
  const v = { position: [0,0,0], normal: [0,0,0], binormal: [0,0,0], handedness: true,
    flowDirection: [0,0,0], vertexColor: [255,255,255,255], vertexColor2: [0,0,0,255],
    uv1: [0,0], uv2: [0.5,0], uv3: [0,0], boneIds: new Uint8Array(8), weights: w };
  const m = { source:"", mdlVersion:6, attributes:[], bones:[], materials:[], shapeNames:[],
    anisotropicLighting:false, flags1:0,
    meshGroups:[{ name:"g", meshType:0, material:"m", bones:[],
      parts:[{ name:"p", attributes:new Set<string>(), triangleIndices:[], vertices:[v] }] }] } as unknown as TTModel;
  const [decl] = buildDeclarations(m);
  expect(decl).toEqual([
    { stream:0, offset:0,  type:T.Float3,  usage:U.Position,          count:0 },
    { stream:0, offset:12, type:T.Ubyte4n, usage:U.BoneWeight,        count:0 },
    { stream:0, offset:16, type:T.Ubyte4,  usage:U.BoneIndex,         count:0 },
    { stream:1, offset:0,  type:T.Float3,  usage:U.Normal,            count:0 },
    { stream:1, offset:12, type:T.Ubyte4n, usage:U.Binormal,          count:0 },
    { stream:1, offset:16, type:T.Ubyte4n, usage:U.Color,             count:0 },
    { stream:1, offset:20, type:T.Float4,  usage:U.TextureCoordinate, count:0 },
  ]);
  expect(streamEntrySizes(decl)).toEqual([20, 36, 0]);
});
```

(Confirm the exact `VertexDataType`/`VertexUsageType` enum member names against `src/mdl/geometry/format.ts` before finalizing values.)

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement** per appendix element table. Compute `usage = getUsageInfo(m)`, `weights = hasWeights(m)`, `flow = m.anisotropicLighting`. Append elements in order, each with `offset = runningOffset[stream]`, then `runningOffset[stream] += dataTypeSize(type)`. Duplicate Color/UV get `count: 1`. Return the same decl array for every mesh group. `streamEntrySizes` returns the final `runningOffset`. Assert precision (fail loud if estimated buffer ≥ 8388608).

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```powershell
npm run check; npm run typecheck
git commit -m "feat(mdl): rebuild vertex declarations from usage (Half->Float upgrade)" -- src/mdl/model/build-declarations.ts test/mdl/model/build-declarations.test.ts
```

---

### Task 7: `model/read-model.ts` — finish `GetXivMdl` into a `ReadMdl`

**Files:**
- Create: `src/mdl/model/read-model.ts`
- Test: `test/mdl/model/read-model.test.ts`

**Interfaces:**
- Consumes: `XivMdl` (3a `parseMdl`), `parseGeometryLayout`, `parseVertexDeclarations`, `decodeVertexData`, `VertexData`.
- Produces:
  - `interface ReadMesh { vertices: VertexData; meshInfo: { indexDataOffset: number; boneSetIndex: number; materialIndex: number; vertexCount: number; indexCount: number }; parts: { indexOffset: number; indexCount: number }[]; }`
  - `interface ReadMdl { mdlVersion: number; source: string; meshes: ReadMesh[]; boneSets: number[][]; pathData: { attributeList: string[]; boneList: string[]; materialList: string[]; shapeList: string[]; extraPathList: string[] }; shapeData: ShapeData; neckMorph: NeckMorphEntry[]; modelBoundingBoxes: number[][]; flags2: number; og: XivMdl; }`
  - `readEditableModel(mdl: XivMdl): ReadMdl` — cites `Mdl.cs:349–995`.
- Note: LoD0 only (`meshes` = the LoD0 slice per `parseGeometryLayout`).

- [ ] **Step 1: Write the failing test** — parse one real corpus model and assert stable, human-checkable fields (mesh count, first mesh vertex/index counts, first bone name, path list lengths). Pick a small corpus model discovered via the harness helpers; assert against values you first print and eyeball.

```ts
// Load a known corpus .mdl (decompressed) via existing test helpers, then:
const rm = readEditableModel(parseMdl(bytes, path));
expect(rm.meshes.length).toBe(/* LoD0 mesh count */);
expect(rm.pathData.boneList.length).toBeGreaterThan(0);
expect(rm.meshes[0].vertices.positions.length).toBe(rm.meshes[0].meshInfo.vertexCount);
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement `readEditableModel`.** Use `parseGeometryLayout` for LoD0 mesh/part offsets + `parseVertexDeclarations`(from `vertexInfo`) + `decodeVertexData` per mesh. Read `boneSetIndex`/`materialIndex` from the mesh-header slice (cite `Mdl.cs:616–634` for offsets). Parse bone sets from `sections.boneSets` (v5 132-byte vs v6 compact per appendix / research §GetXivMdl-1). Parse the path string block from `sections.pathData` into the five lists (ASCII, NUL-terminated; `"shp"`-prefixed material strings divert to `shapeList`). Parse shapes (`shapeInfo`/`shapeParts`/`shapeData`), neck-morph, and the 4 model bboxes from `sections.boundingBoxes`. Carry `og = mdl` for the serializer's opaque copies.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```powershell
npm run check; npm run typecheck; npx vitest run test/mdl/model/read-model.test.ts
git commit -m "feat(mdl): readEditableModel finishes GetXivMdl over opaque slices" -- src/mdl/model/read-model.ts test/mdl/model/read-model.test.ts
```

---

### Task 8: `model/model-modifiers.ts` — weld + merges + flags (port of `ModelModifiers.cs`)

**Files:**
- Create: `src/mdl/model/model-modifiers.ts`
- Test: `test/mdl/model/weld.test.ts`

**Interfaces:**
- Consumes: `ReadMdl`, `ReadMesh`, `TTModel`, `TtVertex`.
- Produces (all mutate/populate a `TTModel` in place, mirroring the C# statics):
  - `mergeGeometryData(m: TTModel, rm: ReadMdl): void` — weld (`ModelModifiers.cs:376–576`)
  - `mergeAttributeData(m, rm): void` (:578) · `mergeMaterialData(m, rm): void` (:626) · `mergeShapeData(m, rm): void` (:658, throw→caller clears) · `fixUpSkinReferences(m, path): void` (:2309) · `mergeFlags(m, rm): void` (:2284)

- [ ] **Step 1: Write the failing weld test** — the appendix worked micro-example (2 parts, 9 indices, 5 verts):

```ts
import { describe, expect, it } from "vitest";
import { mergeGeometryData } from "../../../src/mdl/model/model-modifiers";
// Build a ReadMdl with one LoD0 mesh: 5 positions (tagged by x), Indices [2,4,2,0,4,2, 3,1,4],
// parts [{indexOffset:0,indexCount:6},{indexOffset:6,indexCount:3}], meshInfo.indexDataOffset:0,
// boneSetIndex with a boneSet resolving to a couple of bone names.

it("welds each part to unique-ascending vertices with remapped indices", () => {
  const m = emptyModel();
  mergeGeometryData(m, rm);
  const [g] = m.meshGroups;
  expect(g.parts[0].vertices.map(v => v.position[0])).toEqual([0,2,4]);
  expect(g.parts[0].triangleIndices).toEqual([1,2,1,0,2,1]);
  expect(g.parts[1].vertices.map(v => v.position[0])).toEqual([1,3,4]);
  expect(g.parts[1].triangleIndices).toEqual([1,0,2]);
});
```

Add a second test for the `fakePart` path (no bone sets → one synthetic part over the whole mesh) and a NaN-UV2 clamp test (`uv2 = [NaN, 0]` → `[0, 0]`).

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement `mergeGeometryData`** per appendix (`ModelModifiers.cs:376–576`): clear `meshGroups`; per LoD0 mesh build a group (name `Group {i}`, meshType via mesh-type ranges, bones via `rm.boneSets[boneSetIndex]`→`boneList` dedup); per part (or one `fakePart`) slice indices, `uniqueSorted` ascending, build `vertMap`, transpose each source vertex to `TtVertex` (guarding short arrays; NaN-clamp UV2/UV3 components; weights `round(w*255)`), remap triangle indices. Then implement `mergeAttributeData`/`mergeMaterialData`/`mergeShapeData`/`fixUpSkinReferences`/`mergeFlags` faithfully from their cited lines (verified by the ratchet in Task 12; add focused tests only where a worked value is derivable). `mergeShapeData` throws are caught by `fromRaw` (Task 9).

- [ ] **Step 4: Run to verify weld tests pass** — PASS.

- [ ] **Step 5: Commit**

```powershell
npm run check; npm run typecheck; npx vitest run test/mdl/model/weld.test.ts
git commit -m "feat(mdl): MergeGeometryData weld + attribute/material/shape/flag merges" -- src/mdl/model/model-modifiers.ts test/mdl/model/weld.test.ts
```

---

### Task 9: `model/from-raw.ts` — `TTModel.FromRaw` orchestration

**Files:**
- Create: `src/mdl/model/from-raw.ts`
- Test: `test/mdl/model/from-raw.test.ts`

**Interfaces:**
- Consumes: `ReadMdl`, the Task 8 merges, `TTModel`.
- Produces: `fromRaw(rm: ReadMdl): TTModel` — cites `TTModel.cs:2695`.

- [ ] **Step 1: Write the failing test** — feed a `readEditableModel` of a real corpus model and assert the assembled `TTModel` invariants: `meshGroups.length` matches LoD0, every part's `triangleIndices` max `< vertices.length`, `materials.length > 0`, `mdlVersion` starts from the source. (Set `mdlVersion` to source here; the v6 bump happens in Task 12.)

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement `fromRaw`** per appendix order: `mergeGeometryData` → `mergeAttributeData` → `mergeMaterialData` → try `mergeShapeData` catch → `clearShapeData` → `source = rm.source` → `mdlVersion = rm.mdlVersion` → `fixUpSkinReferences(m, rm.source)` → `mergeFlags` → (UVState is implicit) → **omit tangents** (justified by Task 3 R2 scan; add a one-line comment citing `ModelModifiers.cs:2127`). Return the `TTModel`.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```powershell
npm run check; npm run typecheck
git commit -m "feat(mdl): fromRaw orchestration (weld+merges, tangents omitted per R2)" -- src/mdl/model/from-raw.ts test/mdl/model/from-raw.test.ts
```

---

### Task 10: `model/serialize.ts` — `MakeUncompressedMdlFile`

**Files:**
- Create: `src/mdl/model/serialize.ts`
- Test: `test/mdl/model/serialize.test.ts`

**Interfaces:**
- Consumes: `TTModel`, `ReadMdl`, `buildDeclarations`/`streamEntrySizes`, `serializeVertexDeclarations`, `encodeVertexData`, `encodeIndices`, `buildV6BoneSetBlock`, `computeExtents`/`computeRadius`/`buildBoundingBoxBlock`.
- Produces: `makeUncompressedMdl(m: TTModel, rm: ReadMdl): Uint8Array` — cites `Mdl.cs:2488–3964`.

- [ ] **Step 1: Write the failing round-trip test** — the serializer's output must be re-parseable by 3a's `parseMdl`, structurally consistent, and v6:

```ts
import { describe, expect, it } from "vitest";
import { parseMdl } from "../../../src/mdl/mdl";
import { readEditableModel } from "../../../src/mdl/model/read-model";
import { fromRaw } from "../../../src/mdl/model/from-raw";
import { makeUncompressedMdl } from "../../../src/mdl/model/serialize";

it("produces a re-parseable v6, lodCount=1 model", () => {
  const rm = readEditableModel(parseMdl(bytes, path));
  const m = fromRaw(rm); m.mdlVersion = 6;
  const out = makeUncompressedMdl(m, rm);
  const re = parseMdl(out, path);
  expect(re.header.version).toBe(6);
  expect(re.header.lodCount).toBe(1);
  expect(re.header.meshCount).toBe(m.meshGroups.length);
  // combinedDataBlockSize self-check must not throw; geometry re-decodes to the same vertex counts.
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement `makeUncompressedMdl`** per the appendix block order and the field tables from research §4:
  - Build vertex/index data blocks: per mesh, `encodeVertexData(part-concatenated vertices, decl)` and `encodeIndices`, capturing `meshVertexOffsets`, `meshIndexOffsets` (in u16 units), 16-byte inter-mesh index padding. (Vertices per mesh = concatenation of its parts' welded vertices; indices offset per-part with the 8-index inter-mesh padding — mirror `Mdl.cs:3268–3312`.)
  - Build `vertexInfoBlock` via `serializeVertexDeclarations(buildDeclarations(m))`.
  - Build the 56-byte model-data block: recompute counts/flags per research §2.3 + the agent's field table; copy the opaque scalar flags from `rm.og.modelData`; `lodCount=1`; back-patch `boneSetSize`.
  - Build lod/mesh/part headers, offset tables (attr/mat/bone path offsets), `buildV6BoneSetBlock`, shape block (if `HasShapeData`), partBoneSets, neck-morph (remapped or emptied), empty patch72, padding (`rm.og` padding bytes), bounding-box block.
  - Copy opaque `unkData0/1/2` from `rm.og.sections`, `ExtraPathList` into the path block, LoD0 `Unknown6/7`.
  - Assemble the 68-byte header; compute + assert `combinedDataBlockSize` (`Mdl.cs:3908`) — throw on mismatch.
  - **Fail loud** if `useFurnitureBBs` (non-chara path, out of scope).
  Implement incrementally, re-running the round-trip test after each block group.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```powershell
npm run check; npm run typecheck; npx vitest run test/mdl/model/serialize.test.ts
git commit -m "feat(mdl): MakeUncompressedMdlFile serializer (v6, LoD0, recomputed headers)" -- src/mdl/model/serialize.ts test/mdl/model/serialize.test.ts
```

---

### Task 11: `normalizeModel` + wire `modelRound`; burn the ratchet

**Files:**
- Modify: `src/upgrade/model.ts` (add `normalizeModel`)
- Modify: `src/upgrade/upgrade.ts` (`modelRound` under the gate; pass gate into `upgradeModpack`)
- Create/extend: `src/mdl/model/index.ts` barrel (optional) + `src/mdl/mdl.ts` re-exports
- Test: the E2E ratchet (`npm test`) + `test/upgrade/model.test.ts` (a `normalizeModel` round-trip)

**Interfaces:**
- Consumes: `parseMdl`, `readEditableModel`, `fromRaw`, `makeUncompressedMdl`.
- Produces: `normalizeModel(bytes: Uint8Array, path: string): Uint8Array`; wired `modelRound(option, gate)`.

- [ ] **Step 1: Write the failing test** — `normalizeModel` on a real corpus model yields a v6, re-parseable model with `lodCount=1`; and add an assertion that `upgradeModpack` on a small TTMP-v1 pack rewrites its `.mdl` entries (size changes).

- [ ] **Step 2: Run to verify it fails** — FAIL (normalizeModel undefined / modelRound is a stub).

- [ ] **Step 3: Implement.** In `src/upgrade/model.ts`:

```ts
export function normalizeModel(bytes: Uint8Array, path: string): Uint8Array {
  const rm = readEditableModel(parseMdl(bytes, path));
  const m = fromRaw(rm);
  m.mdlVersion = 6; // FixOldModel emits v6 (R1: caller-set; ShrinkRay.cs:108)
  return makeUncompressedMdl(m, rm);
}
```

In `src/upgrade/upgrade.ts`, replace the `modelRound` stub to iterate `.mdl` files, and thread a per-pack `gate = needsMdlFix(data)` from `upgradeModpack`:

```ts
function modelRound(option: ModpackOption, gate: boolean): void {
  if (!gate) return;
  option.files = option.files.map((f) => {
    if (!f.gamePath.endsWith(".mdl")) return f;
    const { bytes, type } = uncompressedBytes(f);
    return restore(f, normalizeModel(bytes, f.gamePath), type ?? SqPackType.Model);
  });
}
```

Call `modelRound(option, needsMdlFix(data))` before `materialRound` in `upgradeModpack`. (During burndown, let `normalizeModel` throws surface — do NOT wrap in try/catch.)

- [ ] **Step 4: Burn the ratchet.** Run `npm test`; inspect `.mdl` diffs. Iterate on the serializer/weld/read-model until the `.mdl` baseline reaches **0**. Re-bless as it drops:

```powershell
$env:UPDATE_UPGRADE_BASELINE="1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

Expected end state: `.mdl` residual count **0**, no allow-list/divergence entry for models. If a stubborn class of models remains, debug with `superpowers:systematic-debugging` (compare our bytes vs the golden field-by-field via `parseMdl`).

- [ ] **Step 5: Commit** (may be several commits across the burndown)

```powershell
npm run check; npm run typecheck; npm test
git commit -m "feat(upgrade): wire model normalizer under gate; .mdl ratchet 453->0" -- src/upgrade/model.ts src/upgrade/upgrade.ts src/mdl/mdl.ts
```

---

### Task 12: Retire the plan; whole-branch review; PR

**Files:**
- Delete: `docs/superpowers/plans/2026-07-06-model-normalizer.md` (plans are transient — AGENTS.md)
- Modify: `docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md` §8 (mark 3b shipped)

- [ ] **Step 1: Confirm the gate is fully green** — `npm run check`, `npm run typecheck`, `npm test` all pass; `.mdl` baseline is 0.
- [ ] **Step 2: Request review** via `superpowers:requesting-code-review` (whole-branch, Opus per the kickoff). Address findings via `superpowers:receiving-code-review`.
- [ ] **Step 3: Update roadmap §8** to mark row 3b shipped; delete this plan file.
- [ ] **Step 4: Finish the branch** via `superpowers:finishing-a-development-branch` (open the PR to `main`).

```powershell
git commit -m "docs: retire 3b plan; mark model normalizer shipped in roadmap" -- docs/superpowers/plans/2026-07-06-model-normalizer.md docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md
```

---

## Self-review

**Spec coverage:** §3 module boundaries → Tasks 3–10 (each module). §4 pipeline → Tasks 7/9/10/11. §5 gate+wiring+TTMPVersion+restore → Tasks 1/2/11. §6 fold-ins → Task 2 (`restore`/`cca61fa`), Task 4 (v6 bone-set layout, re-derived), Task 5 (`buildRadiusBoundingBox`/`b185e1e`). §7 verification → helper unit tests (Tasks 3–6, 8) + ratchet (Task 11). §8 risks: R1 Task 11 (set v6), R2 Task 3 (scan) + Task 9 (omit tangents), R3 3a widening + Task 6 (no residual Half), R4 Task 5 (float32), R5 Task 8 (weld edge cases), R6 confirmed benign (fast path floats/exact inverses — no quantizer on recomputed channels), R7 Task 11 (large burndown expected). §9 open items resolved: R1 (external bump), non-chara (fail loud, Task 10), ref commits (read in Task 2/4/5), weld read (Task 8). §10 out-of-scope (furniture, PMP) → fail loud (Tasks 1, 10).

**Placeholder scan:** helper tasks (1–6, 8) carry concrete tests with real expected values from the extracted worked examples; large-port tasks (7, 9, 10) carry precise algorithm specs + citations + corpus/ratchet verification (the faithful-port equivalent of "show the code" — the C# is the authoritative source, transcribed under TDD).

**Type consistency:** `TtVertex` (3a) reused throughout; `ReadMdl`/`ReadMesh` defined in Task 7 and consumed in 8–11; `TTModel`/`getUsageInfo`/`getV6BoneSet` defined in Task 3 and consumed in 4/6/8/10; `uncompressedBytes`/`restore` signatures fixed in Task 2 and used in Task 11.
