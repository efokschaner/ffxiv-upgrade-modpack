# Model Round (v5→v6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port C# `EndwalkerUpgrade.FastMdlv6Upgrade` so the upgrade pipeline
rewrites every `chara/**.mdl` from model version 5 to version 6, byte-matching the
ConsoleTools `/upgrade` golden (burns the 453 `.mdl` ratchet diffs to zero).

**Architecture:** A pure transform `upgradeModel(mdl: XivMdl): boolean` mutates the
already-parsed structured model in place (version/lodCount flip, bone-set v5→v6
reformat, per-bone bounding-box rewrite) — all edits size-preserving, so
`serializeMdl` reproduces bytes identical to C#'s in-place patch. The `modelRound`
stub in `upgrade.ts` becomes real (parse → transform → re-encode), and `restore()`
is fixed to re-encode with the source SqPack entry's own type (Model for `.mdl`).

**Tech Stack:** TypeScript, Vitest, the shipped `.mdl` codec (`src/mdl/*`) and
sqpack codec (`src/sqpack/*`), `ByteBuilder`/`DataView` for byte assembly.

## Global Constraints

- **Byte-exact vs golden.** Upgraded `.mdl` files must byte-match ConsoleTools on
  decompressed content. Models carry **no** intended divergence — do **not** add
  any entry to the divergence allow-list (`test/helpers/upgrade-compare.ts`).
- **End-of-task gate (all green before done):** `npm run check`, then
  `npm run typecheck`, then `npm test`. A lefthook pre-commit hook runs Biome +
  typecheck on every commit; it does NOT run the tests.
- **Formatting is mechanical** — Biome owns it; run `npm run check`, never
  hand-format. No per-file license/SPDX headers.
- **Commit each task with an explicit pathspec** (`git commit -m "..." -- <paths>`).
  The git index may contain unrelated staged files from a concurrent session; a
  bare `git commit` would sweep them into your commit. An explicit pathspec commits
  only the named paths.
- **Single-file test runs:** `npx vitest run <path>`. Full gate: `npm test`.

---

### Task 1: Pure bone-set + bounding-box helpers

**Files:**
- Create: `src/upgrade/model.ts`
- Test: `test/upgrade/model.test.ts`

**Interfaces:**
- Consumes: `ByteBuilder` from `src/util/binary.ts`; `BOUNDING_BOX` (= 32) from
  `src/mdl/types.ts`.
- Produces:
  - `reformatBoneSetsV5toV6(v5: Uint8Array, boneSetCount: number): Uint8Array`
  - `buildRadiusBoundingBox(radius: number): Uint8Array`

- [ ] **Step 1: Write the failing test**

Create `test/upgrade/model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildRadiusBoundingBox,
  reformatBoneSetsV5toV6,
} from "../../src/upgrade/model";

// A valid v5 bone-set entry: 128 B bone data (64 × i16) + u32 count. `bones` seeds the leading shorts.
function v5BoneSet(count: number, ...bones: number[]): Uint8Array {
  const b = new Uint8Array(132);
  const dv = new DataView(b.buffer);
  bones.forEach((v, i) => dv.setUint16(i * 2, v, true));
  dv.setUint32(128, count, true);
  return b;
}

describe("reformatBoneSetsV5toV6", () => {
  it("packs a single even-count set into v6 layout, zero-filling the tail", () => {
    const out = reformatBoneSetsV5toV6(v5BoneSet(2, 0x1111, 0x2222), 1);
    const dv = new DataView(out.buffer);
    expect(out.length).toBe(132); // length preserved
    expect(dv.getUint16(0, true)).toBe(1); // offset = (4-0)/4
    expect(dv.getUint16(2, true)).toBe(2); // count
    expect(dv.getUint16(4, true)).toBe(0x1111);
    expect(dv.getUint16(6, true)).toBe(0x2222);
    expect(Array.from(out.subarray(8))).toEqual(new Array(124).fill(0));
  });

  it("pads an odd-count set to a 4-byte boundary", () => {
    const out = reformatBoneSetsV5toV6(v5BoneSet(1, 0x3333), 1);
    const dv = new DataView(out.buffer);
    expect(dv.getUint16(2, true)).toBe(1); // count
    expect(dv.getUint16(4, true)).toBe(0x3333); // bone
    expect(dv.getUint16(6, true)).toBe(0); // padding short
  });

  it("lays out two sets: header table first, then packed data", () => {
    const v5 = new Uint8Array(264);
    v5.set(v5BoneSet(2, 0xaaaa, 0xbbbb), 0);
    v5.set(v5BoneSet(1, 0xcccc), 132);
    const out = reformatBoneSetsV5toV6(v5, 2);
    const dv = new DataView(out.buffer);
    expect(dv.getUint16(2, true)).toBe(2); // set A count
    expect(dv.getUint16(6, true)).toBe(1); // set B count
    expect(dv.getUint16(0, true)).toBe(2); // A data at pos 8 → (8-0)/4
    expect(dv.getUint16(8, true)).toBe(0xaaaa);
    expect(dv.getUint16(10, true)).toBe(0xbbbb);
    expect(dv.getUint16(4, true)).toBe(2); // B data at pos 12 → (12-4)/4
    expect(dv.getUint16(12, true)).toBe(0xcccc);
  });
});

describe("buildRadiusBoundingBox", () => {
  it("emits ±radius/20 corners with w=1 as 32 bytes", () => {
    const box = buildRadiusBoundingBox(2.0); // d = 0.1
    expect(box.length).toBe(32);
    const dv = new DataView(box.buffer);
    expect(dv.getFloat32(0, true)).toBeCloseTo(-0.1);
    expect(dv.getFloat32(12, true)).toBe(1); // min.w
    expect(dv.getFloat32(16, true)).toBeCloseTo(0.1);
    expect(dv.getFloat32(28, true)).toBe(1); // max.w
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/model.test.ts`
Expected: FAIL — `Cannot find module '../../src/upgrade/model'` (file not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/upgrade/model.ts`:

```ts
import { BOUNDING_BOX } from "../mdl/types";
import { ByteBuilder } from "../util/binary";

const V5_BONESET_ENTRY = 132; // 128 B bone data (64 × i16) + u32 count
const BONE_DATA_LEN = 128;

/**
 * Rebuilds a v5 bone-set block into the v6 compact format: a per-set
 * `[u16 offset, u16 count]` header table, then each set's packed bone data (with a
 * 2-byte pad after odd counts), zero-filling the remainder so the block keeps its
 * original `132 · boneSetCount` length. Port of the bone-set loop in
 * EndwalkerUpgrade.FastMdlv6Upgrade (EndwalkerUpgrade.cs:360-430).
 */
export function reformatBoneSetsV5toV6(
  v5: Uint8Array,
  boneSetCount: number,
): Uint8Array {
  const out = new Uint8Array(V5_BONESET_ENTRY * boneSetCount); // zero-filled
  const outDv = new DataView(out.buffer);
  const inDv = new DataView(v5.buffer, v5.byteOffset, v5.byteLength);

  const counts: number[] = [];
  for (let i = 0; i < boneSetCount; i++) {
    counts.push(inDv.getUint32(i * V5_BONESET_ENTRY + BONE_DATA_LEN, true));
  }

  // Header table: [u16 offset placeholder, u16 count] per set.
  for (let i = 0; i < boneSetCount; i++) {
    outDv.setUint16(i * 4 + 2, counts[i]! & 0xffff, true);
  }

  // Packed bone data; backfill each set's offset = (dataPos − headerPos) / 4.
  let pos = 4 * boneSetCount;
  for (let i = 0; i < boneSetCount; i++) {
    const headerPos = i * 4;
    outDv.setUint16(headerPos, ((pos - headerPos) / 4) & 0xffff, true);
    const count = counts[i]!;
    const src = i * V5_BONESET_ENTRY;
    out.set(v5.subarray(src, src + count * 2), pos);
    pos += count * 2;
    if (count % 2 !== 0) pos += 2; // padding short (already zero)
  }
  return out;
}

/**
 * The uniform radius-derived bounding box FastMdlv6Upgrade writes for every bone
 * (EndwalkerUpgrade.cs:459-472): min/max corners at ∓radius/20, w = 1. 32 bytes
 * (2 × float32×4).
 */
export function buildRadiusBoundingBox(radius: number): Uint8Array {
  const d = radius / 20;
  const b = new ByteBuilder()
    .f32(-d)
    .f32(-d)
    .f32(-d)
    .f32(1)
    .f32(d)
    .f32(d)
    .f32(d)
    .f32(1);
  return b.toUint8Array();
}

// (BOUNDING_BOX is imported for the transform in Task 2; referenced there.)
void BOUNDING_BOX;
```

Note: the `void BOUNDING_BOX;` line is a temporary no-op so the unused import does
not trip lint in this task; Task 2 uses `BOUNDING_BOX` and removes that line.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade/model.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(upgrade): v5->v6 bone-set + radius bounding-box helpers" -- src/upgrade/model.ts test/upgrade/model.test.ts
```

---

### Task 2: `upgradeModel` transform + guards

**Files:**
- Modify: `src/upgrade/model.ts`
- Test: `test/upgrade/model.test.ts`

**Interfaces:**
- Consumes: `XivMdl` from `src/mdl/types.ts`; `parseMdl`/`serializeMdl` from
  `src/mdl/mdl.ts` (tests only); `buildMinimalMdl` from `test/mdl/make-mdl.ts`
  (tests only); the Task 1 helpers.
- Produces: `upgradeModel(mdl: XivMdl): boolean` — mutates `mdl` in place to v6,
  returns `true` iff a change was made (`false` = left untouched).

- [ ] **Step 1: Write the failing test**

Append to `test/upgrade/model.test.ts` (add `parseMdl, serializeMdl` and
`buildMinimalMdl` imports, and `upgradeModel` to the existing model import):

```ts
import { parseMdl, serializeMdl } from "../../src/mdl/mdl";
import { buildMinimalMdl } from "../mdl/make-mdl";
// add `upgradeModel` to the existing `import { ... } from "../../src/upgrade/model"`

describe("upgradeModel guards", () => {
  it("leaves a v6 model unchanged", () => {
    expect(upgradeModel(parseMdl(buildMinimalMdl(6)))).toBe(false);
  });
  it("skips a boneless model (boneSetCount 0)", () => {
    const mdl = parseMdl(buildMinimalMdl(5));
    mdl.modelData.boneSetCount = 0;
    expect(upgradeModel(mdl)).toBe(false);
  });
});

describe("upgradeModel (v5→v6)", () => {
  it("flips version/lodCount, reformats bone sets, rewrites per-bone boxes", () => {
    const mdl = parseMdl(buildMinimalMdl(5)); // boneSetCount 1, boneCount 2, radius 1.5
    mdl.sections.boneSets = v5BoneSet(2, 0x1111, 0x2222);
    const stdBoxes = mdl.sections.boundingBoxes.slice(0, 128); // 4 standard boxes

    expect(upgradeModel(mdl)).toBe(true);

    const hdv = new DataView(
      mdl.header.bytes.buffer,
      mdl.header.bytes.byteOffset,
      mdl.header.bytes.byteLength,
    );
    expect(hdv.getUint16(0, true)).toBe(6); // version
    expect(hdv.getUint8(64)).toBe(1); // lodCount byte
    expect(mdl.modelData.lodCount).toBe(1);
    expect(mdl.modelData.boneSetSize).toBe(64); // 64 × boneSetCount(1)

    expect(new DataView(mdl.sections.boneSets.buffer).getUint16(2, true)).toBe(2); // count in header

    // standard boxes preserved; both per-bone boxes overwritten with the radius box (r 1.5 → d 0.075)
    expect(Array.from(mdl.sections.boundingBoxes.subarray(0, 128))).toEqual(
      Array.from(stdBoxes),
    );
    const box = buildRadiusBoundingBox(1.5);
    expect(Array.from(mdl.sections.boundingBoxes.subarray(128, 160))).toEqual(
      Array.from(box),
    );
    expect(Array.from(mdl.sections.boundingBoxes.subarray(160, 192))).toEqual(
      Array.from(box),
    );
  });

  it("is size-preserving after serialize", () => {
    const seed = parseMdl(buildMinimalMdl(5));
    seed.sections.boneSets = v5BoneSet(2, 0x1111, 0x2222);
    const v5 = serializeMdl(seed);
    const mdl = parseMdl(v5);
    upgradeModel(mdl);
    expect(serializeMdl(mdl).length).toBe(v5.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/model.test.ts`
Expected: FAIL — `upgradeModel is not a function` (not yet exported).

- [ ] **Step 3: Write minimal implementation**

In `src/upgrade/model.ts`: remove the temporary `void BOUNDING_BOX;` line, add the
`XivMdl` import, and append `upgradeModel`:

```ts
import type { XivMdl } from "../mdl/types";
// (keep the existing `import { BOUNDING_BOX } from "../mdl/types";` — or merge into one import)

/**
 * In-place Endwalker→Dawntrail model upgrade (v5→v6). Port of
 * EndwalkerUpgrade.FastMdlv6Upgrade (EndwalkerUpgrade.cs:282-476) — the byte-patch
 * path the modpack `/upgrade` route uses (not the TTModel re-import in FixOldModel).
 * Mutates `mdl` and returns whether any change was made; the caller re-serializes
 * only on `true`. Every edit is size-preserving, so serializeMdl reproduces bytes
 * identical to C#'s in-place patch.
 */
export function upgradeModel(mdl: XivMdl): boolean {
  const md = mdl.modelData;
  // Guards — mirror FastMdlv6Upgrade's early returns (:293, :302, :323).
  if (mdl.header.version !== 5) return false;
  if (mdl.header.meshCount === 0) return false;
  if (md.boneSetCount === 0 || md.boneCount === 0) return false;

  // Header: version 5→6 (@0), lodCount→1 (@64). Must write into header.bytes —
  // serializeMdlHeader replays it verbatim; the scalar fields are read-only walk
  // conveniences (see the MdlHeader note in mdl/types.ts). Update the conveniences too.
  const hdv = new DataView(
    mdl.header.bytes.buffer,
    mdl.header.bytes.byteOffset,
    mdl.header.bytes.byteLength,
  );
  hdv.setUint16(0, 6, true);
  hdv.setUint8(64, 1);
  mdl.header.version = 6;
  mdl.header.lodCount = 1;

  // MdlModelData: collapse to 1 LoD and set the v6 bone-set size (:386-387).
  md.lodCount = 1;
  md.boneSetSize = 64 * md.boneSetCount;

  // Bone-set block v5→v6 (same 132·count length).
  mdl.sections.boneSets = reformatBoneSetsV5toV6(
    mdl.sections.boneSets,
    md.boneSetCount,
  );

  // Per-bone bounding boxes: keep the 4 leading standard boxes; overwrite the next
  // `boneCount` boxes with the radius box. Any furniturePartBoundingBoxCount boxes
  // after them are left untouched (FastMdlv6Upgrade writes exactly boneCount boxes).
  const box = buildRadiusBoundingBox(md.radius);
  const bb = mdl.sections.boundingBoxes.slice();
  for (let i = 0; i < md.boneCount; i++) {
    bb.set(box, BOUNDING_BOX * (4 + i));
  }
  mdl.sections.boundingBoxes = bb;

  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade/model.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(upgrade): upgradeModel v5->v6 transform (port of FastMdlv6Upgrade)" -- src/upgrade/model.ts test/upgrade/model.test.ts
```

---

### Task 3: Wire `modelRound` + fix `restore()` to honour the source SqPack type

**Files:**
- Modify: `src/upgrade/upgrade.ts`
- Test: `test/upgrade/upgrade.test.ts`

**Interfaces:**
- Consumes: `upgradeModel` (Task 2); `parseMdl`/`serializeMdl` from `src/mdl/mdl.ts`;
  `decodeSqPackFile`/`encodeSqPackFile`/`SqPackType` from `src/sqpack/sqpack.ts`.
- Produces: a real `modelRound(option)` in the pipeline; `upgradeModpack` now
  upgrades `chara/**.mdl` v5→v6 and re-encodes them as Model SqPack entries.

- [ ] **Step 1: Write the failing test**

Append to `test/upgrade/upgrade.test.ts` (add imports at the top:
`import { parseMdl, serializeMdl } from "../../src/mdl/mdl";` and
`import { buildMinimalMdl } from "../mdl/make-mdl";`):

```ts
describe("upgradeModpack (model round)", () => {
  it("upgrades a chara/**.mdl v5→v6 and re-encodes it as a Model SqPack entry", () => {
    // The fixture's filler bone set has a garbage count; seed a valid 2-bone set first.
    const seed = parseMdl(buildMinimalMdl(5));
    const bs = new Uint8Array(132);
    new DataView(bs.buffer).setUint32(128, 2, true);
    seed.sections.boneSets = bs;
    const v5 = serializeMdl(seed);

    const input = modpackWithSingleFile(
      "chara/foo/model/foo.mdl",
      encodeSqPackFile(v5, SqPackType.Model),
      FileStorageType.SqPackCompressed,
    );

    const out = upgradeModpack(input);
    const outFile = out.groups[0]!.options[0]!.files[0]!;

    expect(outFile.storage).toBe(FileStorageType.SqPackCompressed);
    const decoded = decodeSqPackFile(outFile.data);
    expect(decoded.type).toBe(SqPackType.Model); // restore() honoured the source type
    expect(parseMdl(decoded.data).header.version).toBe(6); // v5 → v6
  });

  it("leaves an already-v6 chara/**.mdl byte-untouched", () => {
    const v6 = buildMinimalMdl(6);
    const input = modpackWithSingleFile(
      "chara/foo/model/foo.mdl",
      v6,
      FileStorageType.RawUncompressed,
    );
    const out = upgradeModpack(input);
    const outFile = out.groups[0]!.options[0]!.files[0]!;
    expect(Array.from(outFile.data)).toEqual(Array.from(v6));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/upgrade.test.ts`
Expected: FAIL — the model-round test upgrades nothing (skeleton `modelRound` is a
no-op), so `parseMdl(...).header.version` is still 5, or `decoded.type` mismatches.

- [ ] **Step 3: Write the implementation**

In `src/upgrade/upgrade.ts`:

3a. Add imports (near the existing `parseMtrl`/sqpack imports):

```ts
import { parseMdl, serializeMdl } from "../mdl/mdl";
import { upgradeModel } from "./model";
```

3b. Replace `uncompressedBytes` so it also returns the source entry type:

```ts
interface Decoded {
  bytes: Uint8Array;
  /** Source SqPack entry type (Standard/Model/Texture); undefined for a RawUncompressed pmp file. */
  type?: SqPackType;
}

/** Uncompresses a ModpackFile for a codec to read, carrying the source SqPack entry type. */
function uncompressedBytes(f: ModpackFile): Decoded {
  if (f.storage === FileStorageType.SqPackCompressed) {
    const d = decodeSqPackFile(f.data);
    return { bytes: d.data, type: d.type };
  }
  return { bytes: f.data };
}
```

3c. Replace `restore` to re-encode with the source type (drop the old
hardcoded-`Standard` docstring):

```ts
/**
 * Re-wraps transformed uncompressed bytes into the file's original storage form. For a
 * SqPackCompressed source, re-encode with the SOURCE entry's own type — Standard for
 * .mtrl, Model for .mdl — so models stay valid Type-3 entries the game can load; for a
 * RawUncompressed (pmp) source, store raw. Keeps writeModpack's single-storage-form invariant.
 */
function restore(
  f: ModpackFile,
  bytes: Uint8Array,
  type: SqPackType | undefined,
): ModpackFile {
  if (f.storage === FileStorageType.SqPackCompressed) {
    return { ...f, data: encodeSqPackFile(bytes, type ?? SqPackType.Standard) };
  }
  return { ...f, data: bytes };
}
```

3d. Update `materialRound` to the new `uncompressedBytes`/`restore` signatures
(destructure `{ bytes, type }`, pass `type` to `restore`):

```ts
function materialRound(option: ModpackOption): UpgradeInfo[] {
  const infos: UpgradeInfo[] = [];
  option.files = option.files.map((f) => {
    if (!IS_CHARA_MTRL.test(f.gamePath)) return f;
    try {
      const { bytes, type } = uncompressedBytes(f);
      const mtrl = parseMtrl(bytes, f.gamePath);
      const got = upgradeMaterial(mtrl);
      if (got.length === 0) return f; // no update needed
      const restored = restore(f, serializeMtrl(mtrl), type);
      infos.push(...got);
      return restored;
    } catch {
      return f;
    }
  });
  return infos;
}
```

3e. Replace the `modelRound` stub with the real transform, and add the path regex
next to `IS_CHARA_MTRL`:

```ts
const IS_CHARA_MDL = /^chara\/.*\.mdl$/;

/**
 * Round 1 (model half of UpdateEndwalkerFiles): per-option `chara/**.mdl` v5→v6
 * (EndwalkerUpgrade.FastMdlv6Upgrade). Rewrites option.files on the clone; records
 * no UpgradeInfo (models feed no later round).
 */
function modelRound(option: ModpackOption): void {
  option.files = option.files.map((f) => {
    if (!IS_CHARA_MDL.test(f.gamePath)) return f;
    try {
      const { bytes, type } = uncompressedBytes(f);
      const mdl = parseMdl(bytes, f.gamePath);
      if (!upgradeModel(mdl)) return f; // not v5 / boneless → untouched
      return restore(f, serializeMdl(mdl), type);
    } catch {
      // Unparseable or odd model → leave byte-untouched (per-file resilience, mirroring
      // UpdateEndwalkerFiles; FastMdlv6Upgrade no-ops rather than throws on shapes it can't handle).
      return f;
    }
  });
}
```

3f. In `upgradeModpack`, run materials **before** models (matches C#
`UpdateEndwalkerFiles` :168 then :172) and drop the old `modelRound` arg-less
signature call:

```ts
  for (const group of out.groups) {
    for (const option of group.options) {
      upgradeTargets.push(...materialRound(option));
      modelRound(option);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/upgrade/upgrade.test.ts test/upgrade/model.test.ts`
Expected: PASS — including the two new model-round cases and all pre-existing
material-round cases (unchanged behaviour: `.mtrl` still re-encodes as Standard).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(upgrade): wire model round + restore honours source SqPack type" -- src/upgrade/upgrade.ts test/upgrade/upgrade.test.ts
```

---

### Task 4: Corpus ratchet — burn down `.mdl`, re-bless baseline, full gate

**Files:**
- Modify (generated, gitignored): `test/corpus/.upgrade-baseline/*.json` (via bless)

**Interfaces:**
- Consumes: the whole pipeline (Tasks 1-3) + the shipped upgrade golden harness.
- Produces: a shrunken baseline whose `.mdl` diffs are gone (remainder `.tex` +
  `.meta`), and a green `npm test`.

- [ ] **Step 1: Run the full suite to see the `.mdl` burndown (pre-bless)**

Run: `npm test`
Expected: the `upgrade` corpus checks now report FEWER diffs than baseline for
packs that contain v5 `.mdl` files. Because the ratchet fails on any diff **not in
the baseline** but PASSES on a subset, removing diffs keeps packs green — **unless**
a transformed `.mdl` newly diverges (a real bug). Read the output:
  - If all `upgrade` checks pass: the `.mdl` files now byte-match the golden (they
    dropped out of the actual diff set, which is a subset of the baseline). Good —
    proceed to bless to record the shrink.
  - If any `upgrade` check FAILS with an unexpected `.mdl` `mismatch`/`added`/
    `removed`: that model did not byte-match. STOP and debug (see Step 4) — do not
    bless a regression.

- [ ] **Step 2: Confirm the `.mdl` diffs are actually gone**

Run (PowerShell):

```powershell
$b = "test/corpus/.upgrade-baseline"
$before = 0
Get-ChildItem $b -Filter *.json | ForEach-Object {
  $before += ((Get-Content $_.FullName -Raw | ConvertFrom-Json) |
    Where-Object { $_.gamePath -like '*.mdl' }).Count
}
Write-Host "baseline .mdl diffs (pre-bless): $before"
```

Expected: a positive number (currently 453) — this is what the bless will remove.

- [ ] **Step 3: Re-bless the baseline to record the smaller remainder**

Run (PowerShell):

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

Then re-run the Step 2 aggregation and confirm `.mdl` diffs are now **0**, and the
remaining baseline is `.tex` + `.meta` only:

```powershell
$b = "test/corpus/.upgrade-baseline"; $agg = @{}
Get-ChildItem $b -Filter *.json | ForEach-Object {
  (Get-Content $_.FullName -Raw | ConvertFrom-Json) | ForEach-Object {
    $ext = [System.IO.Path]::GetExtension($_.gamePath); if (-not $ext) { $ext = '(none)' }
    $agg[$ext] = 1 + ($agg[$ext] ?? 0)
  }
}
$agg.GetEnumerator() | Sort-Object Value -Descending | Format-Table -Auto
```

Expected: no `.mdl` row; `.tex` (~701) and `.meta` (49) remain.

- [ ] **Step 4 (only if Step 1 failed): debug a non-matching model**

A `.mdl` that does not byte-match means our transform diverged from C#. Use
`superpowers:systematic-debugging`. Fast triage:
  - Confirm the input model is v5 and has bone sets (the transform no-ops otherwise
    — a no-op that still diffs is a *codec* round-trip bug, caught by the existing
    `mdl corpus` check; run `npm test` and look for an `mdl corpus` failure first).
  - Dump the first differing byte offset (the harness `detail` gives byte lengths;
    extend with an offset if needed) and map it to a section: header (0-67),
    bone-set block, or bounding boxes. Compare that section's bytes against a
    hand-run of `FastMdlv6Upgrade` on the same input.
  - Do **not** add an allow-list entry — models are byte-exact by contract
    (Global Constraints).

- [ ] **Step 5: End-of-task gate**

Run, and confirm all green:

```bash
npm run check
npm run typecheck
npm test
```

- [ ] **Step 6: Commit any source touched during debugging**

If Step 4 required a codec/transform fix, commit it by explicit pathspec, e.g.:

```bash
git commit -m "fix(mdl): <specific fix>" -- src/mdl/<file>.ts test/mdl/<file>.test.ts
```

The baseline files under `test/corpus/.upgrade-baseline/` are gitignored — nothing
to commit there.

---

## Self-Review

**Spec coverage** (against `2026-07-06-model-round-design.md`):
- §3 transform (guards, header/modelData flip, bone-set reformat, radius boxes) →
  Tasks 1-2.
- §4 orchestration (real `modelRound`, materials-before-models order, `restore`
  type fix) → Task 3.
- §5.1 v5 round-trip parity gate → **already shipped** as the `mdl corpus` check
  (`test/helpers/corpus-mdl.ts`); referenced in Task 4 Step 4 triage rather than
  re-implemented (a redundant new gate would duplicate it).
- §5.2 unit tests → Tasks 1-2; §5.3 corpus ratchet + bless → Task 4; §5.4 coverage
  is a post-round follow-on (not a code task).
- §6 no allow-list entries → Global Constraints + Task 4 Steps 1/4.

**Placeholder scan:** none — every code step shows complete code; every command has
expected output.

**Type consistency:** `upgradeModel(mdl: XivMdl): boolean`,
`reformatBoneSetsV5toV6(v5, boneSetCount)`, `buildRadiusBoundingBox(radius)`,
`restore(f, bytes, type)`, `uncompressedBytes(f): Decoded` are used identically in
every task and test. `SqPackType.Model` / `decodeSqPackFile().type` match
`src/sqpack/sqpack.ts`.
