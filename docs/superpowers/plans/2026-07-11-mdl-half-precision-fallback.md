# MDL Half-precision large-vertex-buffer fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the model round failing loud on models whose estimated vertex buffer reaches 8 MB; instead reproduce TexTools' `upgradePrecision=false` fallback (a Half-precision vertex declaration), and port the adjacent hard-cap throw.

**Architecture:** The fail-loud guard lives only in `build-declarations.ts`; the geometry encoder (`encode.ts`) is already precision-agnostic (declaration-driven Half/Float). So the port is: (1) branch the declaration builder on a ported `upgradePrecision` gate, (2) fix that gate's vertex-count estimate to include shape-part vertices, (3) port the `Mdl.cs:2822` post-assembly hard cap into the serializer. Coverage: the real Spring Florals golden plus synthetic unit tests.

**Tech Stack:** TypeScript, Vitest (single-file iteration via `npx vitest run`), the custom parallel runner (`npm test`) as the final gate, Biome for format/lint.

## Global Constraints

- **Byte-parity is correctness.** Output must match ConsoleTools `/upgrade` byte-for-byte except documented divergences. This task targets **byte-exact, no new `DIVERGENCE_RULES` entry**.
- **Every business-logic change cites its C# provenance** (`file · symbol · lines`) in a comment. Named sources here: `Mdl.cs:2468` (`_MaxVertexBufferSize`), `Mdl.cs:2513-2543` (estimate + gate), `Mdl.cs:2614-2711` (declaration branch), `Mdl.cs:2655` (Flow gated on `upgradePrecision`), `Mdl.cs:2822-2825` (hard cap).
- **Split, don't blend.** Declaration logic stays in `build-declarations.ts`; the byte serialization / hard-cap stays in `serialize.ts`. Do not move members between them.
- **Fail loud.** The hard cap must `throw`, not clamp or truncate.
- **End-of-task ritual (required, all green before done):** `npm run check`, then `npm run typecheck`, then `npm test`.
- **Spec:** `docs/superpowers/specs/2026-07-11-mdl-half-precision-fallback-design.md`.

---

## File Structure

- **Modify** `src/mdl/model/build-declarations.ts` — port the `upgradePrecision` gate + Half/Float declaration branch; export `MAX_VERTEX_BUFFER_SIZE`; fix the estimate to include shape-part vertices; rewrite the stale header/doc comments.
- **Modify** `src/mdl/model/serialize.ts` — import `MAX_VERTEX_BUFFER_SIZE`; add the `Mdl.cs:2822` hard-cap throw after the vertex-data block is assembled.
- **Modify** `test/mdl/model/build-declarations.test.ts` — add the Half-declaration + Flow-omission case and the shape-vertex estimate cases.
- **Modify** `test/mdl/model/serialize.test.ts` — add the hard-cap throw case.
- **Add** `test/corpus/real/[V] [AM] Spring Florals.ttmp2` (gitignored) + record its ratchet baseline (bless step).
- **Modify** `BACKLOG.md` — remove the now-implemented `MDL — Half-precision large-vertex-buffer fallback` item.

---

### Task 1: Port the `upgradePrecision` gate + Half/Float declaration branch

**Files:**
- Modify: `src/mdl/model/build-declarations.ts`
- Test: `test/mdl/model/build-declarations.test.ts`

**Interfaces:**
- Consumes: `getUsageInfo(m)`, `hasWeights(m)`, `TTModel`, `VertexElement`, `VertexDataType`, `VertexUsageType`, `dataTypeSize` (all already imported).
- Produces: `buildDeclarations(m: TTModel): VertexElement[][]` (unchanged signature — no longer throws on large buffers); a new **exported** `MAX_VERTEX_BUFFER_SIZE: number` (= `8388608`) that Task 3 imports.

- [ ] **Step 1: Write the failing test** — append to the `describe("buildDeclarations", …)` block in `test/mdl/model/build-declarations.test.ts`:

```ts
it("falls back to a Half-precision declaration (Flow omitted) when the estimate reaches 8MB", () => {
  // upgradePrecision=false path (Mdl.cs:2540-2543 / :2614-2711 / :2655). A shared vertex
  // object filled across a large array reports a big part.vertices.length without allocating
  // ~150k distinct vertices. maxUv=2 (uv2 set) + flow on -> perVertex ~60B; 200k verts
  // (~12MB) trips the >=8MB gate, so Position/Normal become Half4, texcoord Half4, and the
  // Flow element is dropped entirely even though anisotropicLighting is true.
  const m = oneVertModel();
  m.anisotropicLighting = true; // would add a Flow element on the Float path
  const v = m.meshGroups[0]!.parts[0]!.vertices[0]!;
  m.meshGroups[0]!.parts[0]!.vertices = new Array(200_000).fill(v);

  const decl = buildDeclarations(m)[0]!;
  expect(decl.map((e) => [e.usage, e.type, e.count])).toEqual([
    [U.Position, T.Half4, 0],
    [U.BoneWeight, T.Ubyte4n, 0],
    [U.BoneIndex, T.Ubyte4, 0],
    [U.Normal, T.Half4, 0],
    [U.Binormal, T.Ubyte4n, 0],
    [U.Color, T.Ubyte4n, 0],
    [U.TextureCoordinate, T.Half4, 0],
  ]);
  // Half strides: stream0 Half4(8)+Ubyte4n(4)+Ubyte4(4)=16; stream1 Half4(8)+Binormal Ubyte4n(4)
  // +Color Ubyte4n(4)+Texcoord Half4(8)=24 (Flow omitted, no vColor2).
  expect(streamEntrySizes(decl)).toEqual([16, 24, 0]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mdl/model/build-declarations.test.ts -t "Half-precision"`
Expected: FAIL — current code throws `"mdl: vertex buffer would overflow 8MB; Half-precision path unsupported"`.

- [ ] **Step 3: Rewrite `buildDeclarations` to branch on `upgradePrecision`**

In `src/mdl/model/build-declarations.ts`: export the constant, replace the throwing gate with the ported boolean, and branch the element types. Replace lines 15 and 33-114 so the file reads:

```ts
/** Mdl._MaxVertexBufferSize (Mdl.cs:2468, 8 MB). Exported so serialize.ts's port of the
 *  post-assembly hard cap (Mdl.cs:2822) reuses the one source of truth. */
export const MAX_VERTEX_BUFFER_SIZE = 8388608;
```

```ts
/** Port of the element-set construction in MakeUncompressedMdlFile (Mdl.cs:2614-2711),
 *  including the precision gate (Mdl.cs:2513-2543). `upgradePrecision` starts true (the
 *  /upgrade path's Half->Float upgrade) and is declined when the estimated Float vertex
 *  buffer would reach the 8 MB _MaxVertexBufferSize; the declaration then stays Half-
 *  precision (Position/Normal Half4, texcoord Half2/Half4) and the Flow element is dropped
 *  entirely (Mdl.cs:2655 gates it on upgradePrecision). The estimate is precision-independent
 *  (always the Float per-vertex size) and mirrors Mdl.cs:2513-2538, including shape-part
 *  vertices (Mdl.cs:2536-2538).
 *
 *  The element set is model-wide (depends only on getUsageInfo(m), hasWeights(m) and
 *  m.anisotropicLighting), so every mesh group receives an identical declaration (distinct
 *  array references, identical contents). */
export function buildDeclarations(m: TTModel): VertexElement[][] {
  const { usesVColor2, maxUv, needsEightWeights } = getUsageInfo(m);
  const weights = hasWeights(m);
  const flow = m.anisotropicLighting;

  const perVertex = estimatePerVertexSize(
    needsEightWeights,
    maxUv,
    usesVColor2,
    flow,
  );
  let totalVertexCount = 0;
  for (const group of m.meshGroups) {
    for (const part of group.parts) {
      totalVertexCount += part.vertices.length;
    }
  }
  const upgradePrecision =
    perVertex * totalVertexCount < MAX_VERTEX_BUFFER_SIZE;

  const decl: VertexElement[] = [];
  const runningOffset = [0, 0, 0];
  const occ = new Map<VertexUsageType, number>();
  function add(
    stream: number,
    usage: VertexUsageType,
    type: VertexDataType,
  ): void {
    const count = occ.get(usage) ?? 0;
    decl.push({ stream, offset: runningOffset[stream]!, type, usage, count });
    runningOffset[stream]! += dataTypeSize(type);
    occ.set(usage, count + 1);
  }

  add(
    0,
    VertexUsageType.Position,
    upgradePrecision ? VertexDataType.Float3 : VertexDataType.Half4,
  );
  if (weights) {
    add(
      0,
      VertexUsageType.BoneWeight,
      needsEightWeights ? VertexDataType.UByte8 : VertexDataType.Ubyte4n,
    );
    add(
      0,
      VertexUsageType.BoneIndex,
      needsEightWeights ? VertexDataType.UByte8 : VertexDataType.Ubyte4,
    );
  }
  add(
    1,
    VertexUsageType.Normal,
    upgradePrecision ? VertexDataType.Float3 : VertexDataType.Half4,
  );
  add(1, VertexUsageType.Binormal, VertexDataType.Ubyte4n);
  // Mdl.cs:2655: the Flow element is emitted only when upgradePrecision is true -- the Half
  // fallback drops it even if the model uses flow data.
  if (upgradePrecision && flow) {
    add(1, VertexUsageType.Flow, VertexDataType.Ubyte4n);
  }
  add(1, VertexUsageType.Color, VertexDataType.Ubyte4n);
  if (usesVColor2) {
    add(1, VertexUsageType.Color, VertexDataType.Ubyte4n);
  }
  add(
    1,
    VertexUsageType.TextureCoordinate,
    maxUv === 1
      ? upgradePrecision
        ? VertexDataType.Float2
        : VertexDataType.Half2
      : upgradePrecision
        ? VertexDataType.Float4
        : VertexDataType.Half4,
  );
  if (maxUv > 2) {
    add(
      1,
      VertexUsageType.TextureCoordinate,
      upgradePrecision ? VertexDataType.Float2 : VertexDataType.Half2,
    );
  }

  return m.meshGroups.map(() => decl);
}
```

Also update the `estimatePerVertexSize` doc comment (lines 17-19) to drop the "used only to assert our Half->Float upgrade path is safe" framing; it now feeds the live gate:

```ts
/** Per-vertex byte estimate mirroring Mdl.cs:2513-2535's precision-independent vertexSize
 *  (always the Float layout), used to decide upgradePrecision in buildDeclarations. */
```

- [ ] **Step 4: Run the new test and the existing suite for this file**

Run: `npx vitest run test/mdl/model/build-declarations.test.ts`
Expected: PASS — the new Half case passes and both pre-existing cases (small models → Float) still pass unchanged.

- [ ] **Step 5: Commit**

```powershell
git add src/mdl/model/build-declarations.ts test/mdl/model/build-declarations.test.ts
git commit -m @'
feat(mdl): port upgradePrecision=false Half declaration fallback

Replace the fail-loud 8MB guard in buildDeclarations with the ported
precision gate (Mdl.cs:2540-2543): when the estimated Float vertex buffer
reaches _MaxVertexBufferSize, keep a Half-precision declaration (Half4
position/normal, Half2/Half4 texcoord) and drop the Flow element
(Mdl.cs:2655). Export MAX_VERTEX_BUFFER_SIZE for the serializer.
'@
```

---

### Task 2: Fix the vertex-count estimate to include shape-part vertices

**Files:**
- Modify: `src/mdl/model/build-declarations.ts`
- Test: `test/mdl/model/build-declarations.test.ts`

**Interfaces:**
- Consumes: `TTModel` (its `meshGroups[].parts[].shapeParts: Map<string, TTShapePart>`, where `TTShapePart.vertices: TtVertex[]`).
- Produces: no signature change — `buildDeclarations`'s gate now counts `shapeVertCount + baseVertexCount` (Mdl.cs:2536-2538).

- [ ] **Step 1: Write the failing test** — append to the same `describe("buildDeclarations", …)` block:

```ts
it("counts shape-part vertices (excluding 'original') toward the 8MB gate", () => {
  // Mdl.cs:2536-2538: totalVertexCount = shapeVertCount + VertexCount, where shapeVertCount
  // sums every shapePart EXCEPT the "original" key. perVertex here (maxUv=2, no flow) = 56B.
  const under = oneVertModel(); // base 100k verts -> 5.6MB, below the 8MB gate
  const v = under.meshGroups[0]!.parts[0]!.vertices[0]!;
  const part = under.meshGroups[0]!.parts[0]!;
  part.vertices = new Array(100_000).fill(v);

  // (a) An "original" shapePart of 100k must NOT count: total stays 5.6MB -> Float.
  part.shapeParts = new Map([
    ["original", { name: "original", vertices: new Array(100_000).fill(v), vertexReplacements: new Map() }],
  ]);
  expect(buildDeclarations(under)[0]![0]!.type).toBe(T.Float3); // Position stays Float

  // (b) A non-"original" shapePart of 100k DOES count: total 200k*56B = 11.2MB -> Half.
  part.shapeParts.set("shp_a", { name: "shp_a", vertices: new Array(100_000).fill(v), vertexReplacements: new Map() });
  expect(buildDeclarations(under)[0]![0]!.type).toBe(T.Half4); // Position flips to Half
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mdl/model/build-declarations.test.ts -t "shape-part vertices"`
Expected: FAIL on assertion (b) — the estimate ignores shape parts, so 100k base verts (5.6MB) stays under the gate and Position remains `Float3` instead of flipping to `Half4`.

- [ ] **Step 3: Extend the count loop to add shape-part vertices**

In `src/mdl/model/build-declarations.ts`, replace the `totalVertexCount` accumulation loop from Task 1 with:

```ts
  // Mdl.cs:2536-2538: totalVertexCount = shapeVertCount + VertexCount. shapeVertCount sums
  // every shapePart's vertices EXCEPT the "original" key (the base geometry, already counted).
  let totalVertexCount = 0;
  for (const group of m.meshGroups) {
    for (const part of group.parts) {
      totalVertexCount += part.vertices.length;
      for (const [key, shape] of part.shapeParts) {
        if (key !== "original") totalVertexCount += shape.vertices.length;
      }
    }
  }
```

- [ ] **Step 4: Run the file's tests to verify pass**

Run: `npx vitest run test/mdl/model/build-declarations.test.ts`
Expected: PASS — all cases including both (a) exclusion and (b) inclusion.

- [ ] **Step 5: Commit**

```powershell
git add src/mdl/model/build-declarations.ts test/mdl/model/build-declarations.test.ts
git commit -m @'
fix(mdl): include shape-part vertices in the precision-gate estimate

buildDeclarations summed only base vertices; Mdl.cs:2536-2538 counts
shapeVertCount + VertexCount (shape parts excluding the "original" key).
Makes the 8MB upgradePrecision threshold decision byte-faithful for models
with shape data.
'@
```

---

### Task 3: Port the `Mdl.cs:2822` post-assembly hard cap into the serializer

**Files:**
- Modify: `src/mdl/model/serialize.ts` (import from `./build-declarations`; add the throw after `const vertexDataBlock = concatBytes(vertexChunks);`, currently line 195)
- Test: `test/mdl/model/serialize.test.ts`

**Interfaces:**
- Consumes: `MAX_VERTEX_BUFFER_SIZE` (exported by Task 1), `makeUncompressedMdl(model, rm)`, `firstCorpusModel()`, `readEditableModel`, `parseMdl`, `fromRaw`.
- Produces: `makeUncompressedMdl` now throws when the assembled vertex data exceeds 8 MB.

- [ ] **Step 1: Write the failing test** — add to `describe("makeUncompressedMdl", …)` in `test/mdl/model/serialize.test.ts` (import `firstCorpusModel` from `../../helpers/corpus-models` — it is already used by other model tests):

```ts
it("fails loud when the assembled vertex buffer exceeds 8MB even after Half fallback (Mdl.cs:2822)", () => {
  // No practical corpus pack reaches this: the estimate forces Half precision at ~150k verts,
  // and Half is smaller than the Float estimate, so the actual buffer only exceeds 8MB well
  // above that. Inflate a real (valid) corpus model's first part until the Half-encoded buffer
  // crosses the cap. The Half stride is ~28-36B/vertex depending on the model's usage layout;
  // 400k copies (>=~11MB even at the smallest 28B stride) crosses the 8MB cap for any layout,
  // while the ~19MB Float estimate keeps upgradePrecision=false (so the buffer really is Half).
  const cm = firstCorpusModel();
  const rm = readEditableModel(cm.bytes, parseMdl(cm.bytes, cm.gamePath));
  const m = fromRaw(rm);
  m.mdlVersion = 6;
  const part = m.meshGroups[0]!.parts[0]!;
  const v = part.vertices[0]!;
  part.vertices = part.vertices.concat(new Array(400_000).fill(v));
  expect(() => makeUncompressedMdl(m, rm)).toThrow(/Vertex buffer.*too large/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mdl/model/serialize.test.ts -t "8MB"`
Expected: FAIL — no cap exists yet, so `makeUncompressedMdl` returns bytes (or fails a later self-check) instead of throwing the expected message.

- [ ] **Step 3: Add the hard cap in `serialize.ts`**

Add `MAX_VERTEX_BUFFER_SIZE` to the existing import from `./build-declarations` (line 25):

```ts
import {
  buildDeclarations,
  MAX_VERTEX_BUFFER_SIZE,
  streamEntrySizes,
} from "./build-declarations";
```

Immediately after `const vertexDataBlock = concatBytes(vertexChunks);` (line 195), insert:

```ts
  // Mdl.cs:2822-2825: even after the Half-precision fallback, refuse a vertex buffer that
  // exceeds _MaxVertexBufferSize -- a genuine failure, not something to clamp or truncate.
  if (vertexDataBlock.length > MAX_VERTEX_BUFFER_SIZE) {
    throw new Error(
      `mdl: total Vertex buffer data size is too large (${vertexDataBlock.length} > ${MAX_VERTEX_BUFFER_SIZE}); reduce the model's vertex count`,
    );
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/mdl/model/serialize.test.ts -t "8MB"`
Expected: PASS — throws `mdl: total Vertex buffer data size is too large (…)`.

- [ ] **Step 5: Commit**

```powershell
git add src/mdl/model/serialize.ts test/mdl/model/serialize.test.ts
git commit -m @'
feat(mdl): port the >8MB vertex-buffer hard cap (Mdl.cs:2822)

Throw when the assembled vertex data exceeds _MaxVertexBufferSize even after
the Half-precision fallback, mirroring TexTools' InvalidDataException. No
practical corpus pack reaches it; a synthetic test inflates a corpus model.
'@
```

---

### Task 4: Add Spring Florals to the real corpus, bless its baseline, and clear the backlog item

**Files:**
- Add: `test/corpus/real/[V] [AM] Spring Florals.ttmp2` (gitignored — not committed)
- Modify: `BACKLOG.md` (remove the implemented item)

**Interfaces:**
- Consumes: the auto-enumerated corpus golden check (`registerUpgradeCheck`, `test/helpers/corpus-upgrade.ts`) — any `.ttmp2`/`.pmp` under `test/corpus/real/` is picked up automatically; no test code to write.
- Produces: a ratchet baseline for the pack under `test/corpus/.upgrade-baseline/` (gitignored).

- [ ] **Step 1: Confirm the full suite is green before touching the corpus**

Run: `npm run check; npm run typecheck; npm test`
Expected: all green (Tasks 1-3 committed). This is the pre-condition for a meaningful bless.

- [ ] **Step 2: Copy the pack into the real corpus**

```powershell
$src = "C:\Users\user\Documents\XIVModOriginals\AestheticMods\Vermillion's Aesthetics\2022 Releases\May 2022\[V] [AM] Spring Florals\[V] [AM] Spring Florals.ttmp2"
$dst = Join-Path (Resolve-Path "test\corpus\real") "[V] [AM] Spring Florals.ttmp2"
Copy-Item -LiteralPath $src -Destination $dst
Test-Path -LiteralPath $dst
```
Expected: `True`.

- [ ] **Step 3: Run the golden check WITHOUT blessing — observe the actual diff**

Run: `npm test`
Expected: ConsoleTools spawns once to produce + cache the Spring Florals `/upgrade` golden (may take seconds; the check has a 20-min timeout). The pack has **no baseline yet**, so any non-empty diff fails the run. Read the `[upgrade] [V] [AM] Spring Florals.ttmp2: N matched, D diffs …` line.
- If `D == 0`: full byte match — the ideal outcome. Proceed to Step 5 (no bless needed; an empty baseline is a subset of an empty diff).
- If `D > 0`: inspect the diffed gamePaths. Per spec §4.4/§7, decide whether each is (a) a real bug in Tasks 1-3 to fix now, or (b) a genuinely-unrelated pre-existing model path that is out of this task's scope. **Do not bless a diff caused by a bug in this change.** Only proceed to Step 4 if the remaining diffs are confirmed out-of-scope pre-existing gaps; otherwise fix and re-run Step 3.

- [ ] **Step 4 (only if Step 3 left confirmed out-of-scope diffs): record the baseline**

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```
Expected: `[upgrade] blessed [V] [AM] Spring Florals.ttmp2: N matched, D recorded`. Then re-run `npm test` (no env var) and confirm the pack now passes within its baseline. If any out-of-scope diff was recorded, add a `BACKLOG.md` item citing the diffed gamePaths and the suspected C# path, per spec §4.4.

- [ ] **Step 5: Remove the implemented backlog item**

In `BACKLOG.md`, delete the entire bullet beginning `- **MDL — Half-precision large-vertex-buffer fallback (model round `FixOldModel`).**` through the end of that item (the `…found incidentally during the round-5 corpus scan.` line).

- [ ] **Step 6: Final gate + commit the backlog change**

Run: `npm run check; npm run typecheck; npm test`
Expected: all green; the Spring Florals golden passes (full match, or within its blessed baseline).

```powershell
git add BACKLOG.md
git commit -m @'
docs(backlog): drop the MDL Half-precision fallback item (implemented)

The upgradePrecision=false Half declaration path and the Mdl.cs:2822 hard cap
are ported and covered; Spring Florals is in the real corpus with a recorded
golden baseline.
'@
```

Note: the corpus `.ttmp2` and its baseline live under gitignored paths, so only `BACKLOG.md` is committed here.

---

## Self-Review

**Spec coverage:**
- §2a estimate gate → Task 1 (gate) + Task 2 (shapeVertCount fix). ✓
- §2b declaration branch (Half4 position/normal, Half2/Half4 texcoord, Flow omitted) → Task 1. ✓
- §2c hard cap (Mdl.cs:2822) → Task 3. ✓
- §3 encoder already precision-agnostic → no task needed (verified: `encode.ts` handles Half4/Half2). ✓
- §4.3 real golden (Spring Florals) → Task 4. ✓
- §4.3 synthetic unit tests (Half declaration + Flow omission; shape-vert estimate; hard-cap throw) → Tasks 1, 2, 3. ✓
- §4.4 housekeeping (remove backlog item; backlog any out-of-scope diff) → Task 4 Steps 4-5. ✓
- §5 no `DIVERGENCE_RULES` entry → none added; Task 4 targets full match. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command shows expected output. The one conditional (Task 4 Step 3/4) is a genuine decision gate with explicit criteria, not a placeholder. ✓

**Type consistency:** `MAX_VERTEX_BUFFER_SIZE` exported in Task 1, imported in Task 3 — same name. `buildDeclarations`/`streamEntrySizes` signatures unchanged. `TTShapePart.vertices`/`part.shapeParts` (Map) match `tt-model.ts`. Test enum aliases `T`/`U` and helpers `oneVertModel`/`streamEntrySizes` already exist in the test file. `firstCorpusModel`/`readEditableModel`/`parseMdl`/`fromRaw` are the same imports the sibling serialize test uses. ✓
