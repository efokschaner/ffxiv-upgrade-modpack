# ValidateTexFileData Load-Seam Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the full `EndwalkerUpgrade.ValidateTexFileData` (NPOT resize + mip-offset fixup) into our TTMP load-fix seam, so old packs get the same load-time `.tex` repair ConsoleTools performs.

**Architecture:** Three C# symbols → three TS homes: `fixUpBrokenMipOffsets` in `src/tex/header.ts`, a `resizeForMerge` core extracted from `src/upgrade/texture.ts`, and a new `src/upgrade/validate-tex.ts` orchestrating both; the existing `.tex` branch of `makeTtmpLoadFix` (`src/upgrade/load-fixes.ts`) calls the orchestrator and re-wraps. BC sources fail loud (no BC encoder); everything else is byte-exact.

**Tech Stack:** TypeScript, custom parallel test runner (`npm test`), Biome (`npm run check`), `tsc` (`npm run typecheck`), ConsoleTools golden harness + gitignored corpus ratchet baselines.

**Design:** `docs/superpowers/specs/2026-07-25-validate-tex-load-seam-design.md` — read it first.

## Global Constraints

- **Every line of business logic cites its TexTools provenance** (`file · symbol · lines`) in a header/comment; verify each citation against `reference/` (never port from memory). `reference/` is read-only.
- **Byte-parity is correctness** for binary `.tex` bytes; the golden harness compares **decompressed** content. Intended divergences must be *confirmed*, never merely baselined.
- **Fail loud, never silently diverge** — an unreproducible path throws; it does not best-effort.
- **End-of-task ritual (required, all green):** `npm run check`, then `npm run typecheck`, then `npm test`.
- **Formatting is mechanical** — run `npm run check`; never hand-format or reorder imports by hand.
- No per-file license headers. Corpus (`test/corpus/real|synthetic/`) and baselines are gitignored.

---

## File Structure

- `src/tex/header.ts` (modify) — add `fixUpBrokenMipOffsets` and `assertTexHeaderWritable`. Owner: `Tex.TexHeader` (`Tex.cs`).
- `src/upgrade/texture.ts` (modify) — extract `resizeForMerge` core; `resizeToPow2ForMerge` becomes a wrapper; export `isPowerOfTwo`, `roundToPowerOfTwo`. Owner: `Tex.ResizeXivTx`/`MergePixelData` + `IOUtil`.
- `src/upgrade/validate-tex.ts` (create) — `validateTexFileData` + `UnportedBcReencode`. Owner: `EndwalkerUpgrade.ValidateTexFileData`.
- `src/upgrade/load-fixes.ts` (modify) — rewrite the `.tex` branch. Owner: `WizardData.FromWizardGroup` else-branch + `TTMP.FixOldTexData`.
- `test/tex/header.test.ts` (modify/create) — `fixUpBrokenMipOffsets` unit tests.
- `test/upgrade/validate-tex.test.ts` (create) — Branch A/B + sentinel unit tests.
- `test/upgrade/load-fixes.test.ts` (modify/create) — drop/keep/abort at the seam.
- `scripts/generate-synthetics/build-synthetic-validate-tex.ts` (create) + `scripts/generate-synthetics/build-all.ts` (modify) — synthetic packs.
- `docs/TEXTOOLS_BUGS.md`, `docs/BACKLOG.md`, `docs/backlog/*.md` (modify/delete) — bug register + backlog burndown.

---

### Task 1: `fixUpBrokenMipOffsets` + `assertTexHeaderWritable` (`src/tex/header.ts`)

**Files:**
- Modify: `src/tex/header.ts`
- Test: `test/tex/header.test.ts`

**Interfaces:**
- Consumes: `texMipSizes(format,width,height)` and `XivTex` from `src/tex/types.ts` (already imported by `header.ts`).
- Produces:
  - `fixUpBrokenMipOffsets(header: MipOffsetFixable, texSizeIncludingHeader: number): { headerChanged: boolean; calculatedTexSize: number }` where `MipOffsetFixable = Pick<XivTex, "format" | "width" | "height" | "mipCount" | "lodMips" | "mipMapOffsets">`. Mutates `header.mipMapOffsets` and `header.lodMips` **in place**; NEVER writes `header.mipCount`.
  - `assertTexHeaderWritable(tex: Pick<XivTex, "lodMips" | "mipCount" | "mipFlag">): void` — throws on the `Tex.TexHeader.ToBytes` guards.

- [ ] **Step 1: Write the failing tests**

Add to `test/tex/header.test.ts` (create the file if absent; use the repo's test style — `import { test } from "node:test"` + `node:assert/strict`, matching a sibling like `test/tex/*.test.ts`):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertTexHeaderWritable,
  fixUpBrokenMipOffsets,
} from "../../src/tex/header";
import { A8R8G8B8 } from "../../src/tex/types";

// A8R8G8B8 mip sizes for 4x4: [64, 16, 4, 4] (32bpp; min dim 1; halves to 2x2=16, 1x1=4, then 1x1=4).
test("fixUpBrokenMipOffsets rewrites a broken first offset and trims trailing data", () => {
  const header = {
    format: A8R8G8B8,
    width: 4,
    height: 4,
    mipCount: 1,
    lodMips: [0, 0, 0] as [number, number, number],
    mipMapOffsets: [999, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
  // File claims 80 header + 64 mip0 + 40 trailing garbage = 184.
  const res = fixUpBrokenMipOffsets(header, 184);
  assert.equal(header.mipMapOffsets[0], 80); // first offset forced to 80
  assert.equal(res.headerChanged, true);
  assert.equal(res.calculatedTexSize, 80 + 64); // trailing 40 bytes trimmed
});

test("fixUpBrokenMipOffsets leaves mipCount untouched on the passed header (struct-copy quirk)", () => {
  // A file whose header claims 3 mips but only mip0 fits: the loop reduces the LOCAL mip count,
  // but the caller's header.mipCount must stay 3 (C# passes TexHeader by value; scalar writes to
  // MipCount do not escape). Tex.cs:168-235 + ValidateTexFileData's use at EndwalkerUpgrade.cs:2121.
  const header = {
    format: A8R8G8B8,
    width: 4,
    height: 4,
    mipCount: 3,
    lodMips: [2, 2, 2] as [number, number, number],
    mipMapOffsets: [80, 144, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
  // Only mip0 (64 bytes) fits in an 80+64 = 144-byte file; mip1 would need 16 more.
  const res = fixUpBrokenMipOffsets(header, 144);
  assert.equal(header.mipCount, 3); // UNCHANGED — the quirk
  assert.equal(res.calculatedTexSize, 144);
  assert.deepEqual(header.lodMips, [0, 0, 0]); // clamped to localMipCount(1) - 1 = 0
  assert.equal(res.headerChanged, true);
});

test("assertTexHeaderWritable throws on descending LoDMips", () => {
  assert.throws(
    () =>
      assertTexHeaderWritable({
        lodMips: [2, 1, 0],
        mipCount: 5,
        mipFlag: 0,
      }),
    /LoDMips is not in non-descending order/,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/tex/header.test.ts` (or `npm test -- test/tex/header.test.ts` per the runner). Expected: FAIL — `fixUpBrokenMipOffsets`/`assertTexHeaderWritable` not exported.

- [ ] **Step 3: Implement in `src/tex/header.ts`**

Append (keep existing exports untouched; `serializeTexHeader` stays as-is — it writes retained headers verbatim and must NOT gain validation):

```ts
type MipOffsetFixable = Pick<
  XivTex,
  "format" | "width" | "height" | "mipCount" | "lodMips" | "mipMapOffsets"
>;

/** Port of Tex.TexHeader.FixUpBrokenMipOffsets (Tex.cs:168-235). Rebuilds a broken mip-offset
 *  table using total file size as a heuristic, returning whether anything changed and the size the
 *  .tex SHOULD be.
 *
 *  STRUCT-COPY QUIRK, load-bearing (docs/TEXTOOLS_BUGS.md). C# passes `TexHeader` BY VALUE. Its
 *  writes to the reference-typed `uint[]` fields (`MipMapOffsets`, `LoDMips`) reach the caller
 *  (shared array), but its writes to the scalar `MipCount` stay on the local copy. ValidateTexFileData
 *  then serializes the header with the ORIGINAL `MipCount` and the FIXED offset/lod tables. We
 *  reproduce that exactly: mutate `header.mipMapOffsets` / `header.lodMips` in place and NEVER write
 *  `header.mipCount` (a local `mipCount` mirrors the C# copy's field). Getting this wrong moves bytes
 *  on real corpus packs. */
export function fixUpBrokenMipOffsets(
  header: MipOffsetFixable,
  texSizeIncludingHeader: number,
): { headerChanged: boolean; calculatedTexSize: number } {
  let modified = false;
  let originalMipCount = header.mipCount;
  let mipOffset = 80; // Tex._TexHeaderSize
  if (originalMipCount > 13) originalMipCount = 13;

  // Throws for unknown formats, exactly like DDS.CalculateMipMapSizes (Tex.cs:179 comment).
  const mipSizes = texMipSizes(header.format, header.width, header.height);

  // Local mip count == the C# copy's header.MipCount; deliberately NOT written back to `header`.
  let mipCount = 1;
  if (header.mipMapOffsets[0] !== mipOffset) modified = true;
  header.mipMapOffsets[0] = mipOffset;
  mipOffset += mipSizes[0]!;

  let mipLevel: number;
  for (mipLevel = 1; mipLevel < originalMipCount; ++mipLevel) {
    if (mipLevel >= mipSizes.length) break;
    const mipSize = mipSizes[mipLevel]!;
    if (mipOffset + mipSize > texSizeIncludingHeader) break;
    if (header.mipMapOffsets[mipLevel] !== mipOffset) modified = true;
    header.mipMapOffsets[mipLevel] = mipOffset;
    mipOffset += mipSize;
    mipCount = mipLevel + 1;
  }

  for (let lodLevel = 0; lodLevel < 3; ++lodLevel) {
    if (header.lodMips[lodLevel]! >= mipCount) {
      modified = true;
      header.lodMips[lodLevel] = mipCount - 1;
    }
  }

  for (; mipLevel < 13; ++mipLevel) {
    if (header.mipMapOffsets[mipLevel] !== 0) {
      modified = true;
      header.mipMapOffsets[mipLevel] = 0;
    }
  }

  if (mipCount !== originalMipCount) modified = true;

  return { headerChanged: modified, calculatedTexSize: mipOffset };
}

/** The write-time validation Tex.TexHeader.ToBytes performs before emitting header bytes
 *  (Tex.cs:138-145), messages verbatim. Kept SEPARATE from serializeTexHeader (which writes retained
 *  headers verbatim and must not throw on them); called only where ToBytes' guard is part of the
 *  ported behaviour (validateTexFileData Branch B), where a throw drops the file at the load seam. */
export function assertTexHeaderWritable(
  tex: Pick<XivTex, "lodMips" | "mipCount" | "mipFlag">,
): void {
  if (tex.lodMips[1] < tex.lodMips[0] || tex.lodMips[2] < tex.lodMips[1])
    throw new Error("LoDMips is not in non-descending order.");
  if (tex.lodMips[2] >= tex.mipCount)
    throw new Error("All LoDMips must be strictly lesser than MipCount.");
  if (tex.mipFlag > 15)
    throw new Error("MipFlag must be strictly lesser than 16.");
  if (tex.mipCount > 13)
    throw new Error("MipCount must be strictly lesser than 14.");
}
```

Ensure `XivTex` is imported in `header.ts` (it already imports `type { XivTex }` from `./types`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/tex/header.test.ts`. Expected: PASS. Then `npm run check && npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/tex/header.ts test/tex/header.test.ts
git commit -m "feat(tex): port Tex.TexHeader.FixUpBrokenMipOffsets + ToBytes guard"
```

---

### Task 2: extract `resizeForMerge` core (`src/upgrade/texture.ts`)

**Files:**
- Modify: `src/upgrade/texture.ts`
- Test: `test/upgrade/texture.test.ts` (existing — must stay green)

**Interfaces:**
- Produces (new exports):
  - `resizeForMerge(rgba: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number, format: number): { rgba: Uint8Array; width: number; height: number }` — the guards-then-Bicubic core.
  - `isPowerOfTwo(n: number): boolean`
  - `roundToPowerOfTwo(x: number): number`
- Unchanged behaviour: `resizeToPow2ForMerge` (now a wrapper), `createIndexFromNormal`, `upgradeMaskTex`, `updateEndwalkerHairTextures` — the existing texture tests and corpus goldens must not move.

- [ ] **Step 1: Confirm the existing texture suite is green (baseline)**

Run: `npm test -- test/upgrade/texture.test.ts` (or the runner's equivalent). Expected: PASS. This is the regression oracle for the refactor.

- [ ] **Step 2: Extract the core, keep the wrapper**

Replace the body of `resizeToPow2ForMerge` (currently `src/upgrade/texture.ts:163-203`) so the guards+resize move into `resizeForMerge`, and `resizeToPow2ForMerge` delegates. Keep the entire existing doc comment block above `resizeToPow2ForMerge` (the ELIDED / DIVERGENCE writeup) — move it onto `resizeForMerge`, since that is now where the guards live, and leave a one-line pointer on the wrapper. Add `export` to `isPowerOfTwo` and `roundToPowerOfTwo`.

```ts
// (keep the full existing ELIDED/divergence doc comment here, retargeted to resizeForMerge)
export function resizeForMerge(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  format: number,
): { rgba: Uint8Array; width: number; height: number } {
  // Tex.GetCompressionFormat default: throw (Tex.cs:743), verbatim for the substring-match harness.
  if (!MERGE_SUPPORTED_FORMATS.has(format)) {
    throw new Error(`Format is currently unsupported: ${texFormatName(format)}`);
  }
  // Tex.cs:656-660, non-BC7 arm only (BC7 takes the guard-less DDS.TexConvRawPixels path). Post-resize
  // dims, matching ResizeXivTx overwriting tex.Width/Height (Tex.cs:417-418) before MergePixelData.
  if (format !== BC7 && (dstW < 64 || dstH < 64)) {
    throw new Error("Image is too small for DDS Compressor. (64x64 Minimum Size)");
  }
  return { rgba: resizeBicubic(rgba, srcW, srcH, dstW, dstH), width: dstW, height: dstH };
}

/** NPOT→pow2 wrapper over resizeForMerge for the material-round sites: rounds each dimension
 *  independently (IOUtil.RoundToPowerOfTwo) and short-circuits a pow2 input BEFORE any guard, exactly
 *  as before. The load seam calls resizeForMerge directly to reproduce a Width-for-both-dims bug
 *  (see src/upgrade/validate-tex.ts). */
function resizeToPow2ForMerge(
  rgba: Uint8Array,
  width: number,
  height: number,
  format: number,
): { rgba: Uint8Array; width: number; height: number } {
  if (isPowerOfTwo(width) && isPowerOfTwo(height)) {
    return { rgba, width, height };
  }
  return resizeForMerge(
    rgba,
    width,
    height,
    roundToPowerOfTwo(width),
    roundToPowerOfTwo(height),
    format,
  );
}
```

Change `function isPowerOfTwo` → `export function isPowerOfTwo` and `function roundToPowerOfTwo` → `export function roundToPowerOfTwo` (`src/upgrade/texture.ts:32` and `:51`). Leave `floorPow2`/`ceilPow2` private.

- [ ] **Step 3: Run the texture suite to verify no behavioural change**

Run: `npm test -- test/upgrade/texture.test.ts`. Expected: PASS (byte-identical behaviour — the wrapper computes the same dims it did inline). Then `npm run check && npm run typecheck`.

- [ ] **Step 4: Commit**

```bash
git add src/upgrade/texture.ts
git commit -m "refactor(tex): extract resizeForMerge core, export pow2 helpers"
```

---

### Task 3: `validateTexFileData` orchestrator (`src/upgrade/validate-tex.ts`)

**Files:**
- Create: `src/upgrade/validate-tex.ts`
- Test: `test/upgrade/validate-tex.test.ts`

**Interfaces:**
- Consumes: `resizeForMerge`, `isPowerOfTwo`, `roundToPowerOfTwo` (Task 2); `fixUpBrokenMipOffsets`, `assertTexHeaderWritable`, `serializeTexHeader` (Task 1 + existing `header.ts`); `parseTex`, `decodeToRgba`, `encodeUncompressedTex` (`src/tex/tex.ts`); `isCompressed`, `texFormatName` (`src/tex/types.ts`).
- Produces:
  - `class UnportedBcReencode extends Error`
  - `validateTexFileData(uncompressedTex: Uint8Array): Uint8Array | null`

- [ ] **Step 1: Write the failing tests**

Create `test/upgrade/validate-tex.test.ts`. Build inputs with `encodeUncompressedTex` (A8R8G8B8) for the resize cases; for Branch B, hand-break a POT tex's offset table. Use `parseTexHeader`/`serializeTexHeader` to inspect.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeUncompressedTex, parseTex } from "../../src/tex/tex";
import {
  UnportedBcReencode,
  validateTexFileData,
} from "../../src/upgrade/validate-tex";

function solidRgba(w: number, h: number): Uint8Array {
  const a = new Uint8Array(w * h * 4);
  for (let i = 0; i < a.length; i += 4) {
    a[i] = 10; a[i + 1] = 20; a[i + 2] = 30; a[i + 3] = 255;
  }
  return a;
}

test("Branch A: non-square NPOT A8R8G8B8 resizes to a SQUARE (Width-for-both-dims bug)", () => {
  // 96x64 with mips → NPOT (96 not pow2). RoundToPowerOfTwo(96) = 128 (128-96=32 < 96-64=32? tie→floor=64).
  // Verify against roundToPowerOfTwo directly rather than hard-coding, then assert width===height.
  const src = encodeUncompressedTex(solidRgba(96, 64), 96, 64, { mips: true });
  const out = validateTexFileData(src);
  assert.ok(out, "expected a resized result");
  const tex = parseTex(out!);
  assert.equal(tex.width, tex.height, "bug: height is rounded from WIDTH, so output is square");
});

test("Branch A: BC source throws UnportedBcReencode", () => {
  // Build a minimal DXT5 (compressed) NPOT-with-mips header. Use a hand-assembled tex like the
  // npot-mask-dxt5 synthetic fixture (see scripts/generate-synthetics). Here assert the throw type.
  const dxt5Npot = makeDxt5NpotWithMips(); // helper in this test file; 96x64, mipCount 2
  assert.throws(() => validateTexFileData(dxt5Npot), UnportedBcReencode);
});

test("Branch B: a POT tex with a broken first offset is rewritten, not resized", () => {
  const src = encodeUncompressedTex(solidRgba(4, 4), 4, 4, { mips: true });
  const broken = src.slice();
  // mipMapOffsets[0] lives at byte 28; clobber it to a wrong value.
  new DataView(broken.buffer, broken.byteOffset).setUint32(28, 999, true);
  const out = validateTexFileData(broken);
  assert.ok(out, "expected a rewritten result");
  assert.equal(new DataView(out!.buffer, out!.byteOffset).getUint32(28, true), 80);
});

test("Branch B: an already-correct tex returns null (no change)", () => {
  const src = encodeUncompressedTex(solidRgba(8, 8), 8, 8, { mips: true });
  assert.equal(validateTexFileData(src), null);
});
```

(Implement `makeDxt5NpotWithMips` in the test file by writing an 80-byte header with `format = DXT5`, `width = 96`, `height = 64`, `mipCount = 2`, plausible offsets, followed by two DXT5 mip blobs sized per `texMipSizes(DXT5, …)`. Cite `Tex.cs` for the header layout.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/upgrade/validate-tex.test.ts`. Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/upgrade/validate-tex.ts`**

```ts
// Port of EndwalkerUpgrade.ValidateTexFileData (EndwalkerUpgrade.cs:2100-2129) — the load-time .tex
// repair TTMP.FixOldTexData (TTMP.cs:1413-1460) runs on every .tex of an old pack, called from
// WizardData.FromWizardGroup:705 (the /upgrade + /resave load path). Given the UNCOMPRESSED tex bytes,
// returns fixed bytes, or null when nothing changed. See
// docs/superpowers/specs/2026-07-25-validate-tex-load-seam-design.md.
import {
  assertTexHeaderWritable,
  fixUpBrokenMipOffsets,
  serializeTexHeader,
} from "../tex/header";
import { decodeToRgba, encodeUncompressedTex, parseTex } from "../tex/tex";
import { isCompressed, texFormatName } from "../tex/types";
import {
  isPowerOfTwo,
  resizeForMerge,
  roundToPowerOfTwo,
} from "./texture";

/** Branch A on a BC-compressed source needs Tex.MergePixelData's nvtt re-encode back to the original
 *  BC format, which we have no port of (no BC encoder in the repo). Thrown so the load-fix caller can
 *  FAIL LOUD instead of silently dropping (a faithful drop) or emitting a wrong-format A8R8G8B8 file.
 *  Latent — needs an old-version TTMP with a BC NPOT-with-mips tex; no corpus pack reaches it. Gated
 *  behind docs/backlog/2026-07-22-bc-encoder-merge-pixel-data.md. Design §3.4. */
export class UnportedBcReencode extends Error {}

export function validateTexFileData(uncompressedTex: Uint8Array): Uint8Array | null {
  const tex = parseTex(uncompressedTex);
  const npot = !isPowerOfTwo(tex.width) || !isPowerOfTwo(tex.height);

  // EndwalkerUpgrade.cs:2107 — (!IsPow2(W) || !IsPow2(H)) && MipCount > 1.
  if (npot && tex.mipCount > 1) {
    // EndwalkerUpgrade.cs:2110 — ResizeXivTx(tex, RoundToPowerOfTwo(Width), RoundToPowerOfTwo(WIDTH),
    // false): Width is passed for BOTH dimensions (TexTools bug, docs/TEXTOOLS_BUGS.md). Reproduced.
    const round = roundToPowerOfTwo(tex.width);
    // resizeForMerge fires MergePixelData's two faithful guards (unsupported format, <64 non-BC7),
    // which at THIS seam drop the file (FromWizardGroup catch). It succeeds only for a format
    // MergePixelData supports; for the compressed subset of those we still cannot re-encode → fail loud.
    const src = resizeForMerge(
      decodeToRgba(tex),
      tex.width,
      tex.height,
      round,
      round,
      tex.format,
    );
    if (isCompressed(tex.format)) {
      throw new UnportedBcReencode(
        `validateTexFileData: BC re-encode unported for format ${texFormatName(tex.format)}`,
      );
    }
    // A8R8G8B8 (the only uncompressed format MergePixelData accepts) → lossless BGRA round-trip →
    // ToUncompressedTex yields the same bytes our uncompressed encoder produces. Byte-exact.
    return encodeUncompressedTex(src.rgba, src.width, src.height, { mips: true });
  }

  // Branch B — EndwalkerUpgrade.cs:2116-2124. Fix broken mip offsets; rebuild only if something moved.
  const fix = fixUpBrokenMipOffsets(tex, uncompressedTex.length);
  if (fix.headerChanged || fix.calculatedTexSize !== uncompressedTex.length) {
    assertTexHeaderWritable(tex); // header.ToBytes() guard (Tex.cs:138-145); throw → drop at the seam
    const out = new Uint8Array(fix.calculatedTexSize);
    out.set(serializeTexHeader(tex), 0); // ORIGINAL mipCount + FIXED offset/lod tables (struct-copy quirk)
    out.set(uncompressedTex.subarray(80, fix.calculatedTexSize), 80);
    return out;
  }
  return null;
}
```

Note the `parseTex` result is a full `XivTex` whose `mipMapOffsets`/`lodMips` are the mutable arrays `fixUpBrokenMipOffsets` writes, and whose `mipCount` it leaves alone — so `serializeTexHeader(tex)` emits exactly the C# `header.ToBytes()` output.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/upgrade/validate-tex.test.ts`. Expected: PASS. Then `npm run check && npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/upgrade/validate-tex.ts test/upgrade/validate-tex.test.ts
git commit -m "feat(upgrade): port EndwalkerUpgrade.ValidateTexFileData"
```

---

### Task 4: wire the load-fix `.tex` branch (`src/upgrade/load-fixes.ts`)

**Files:**
- Modify: `src/upgrade/load-fixes.ts:96-104`
- Test: `test/upgrade/load-fixes.test.ts`

**Interfaces:**
- Consumes: `validateTexFileData`, `UnportedBcReencode` (Task 3); `requireBytes`, `restore` (`./upgrade`); `SqPackType` (`../sqpack/sqpack`, already imported).
- Produces: no new exports — `makeTtmpLoadFix`'s `.tex` branch now repairs instead of only validating.

- [ ] **Step 1: Write the failing tests**

Create/extend `test/upgrade/load-fixes.test.ts`. Build a `SqPackCompressedFile` via `encodeSqPackFile(bytes, SqPackType.Texture)` (see `src/sqpack/sqpack.ts`), wrap in the minimal `ModpackFile` shape, and drive the fix from `makeTtmpLoadFix({ needsTexFix: true, needsMdlFix: false })`.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { FileStorageType } from "../../src/model/modpack";
import { encodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { encodeUncompressedTex } from "../../src/tex/tex";
import { makeTtmpLoadFix } from "../../src/upgrade/load-fixes";

function texFile(bytes: Uint8Array) {
  return {
    storage: FileStorageType.SqPackCompressed as const,
    data: encodeSqPackFile(bytes, SqPackType.Texture),
  };
}
const fix = makeTtmpLoadFix({ needsTexFix: true, needsMdlFix: false });

test("keeps and repairs a POT tex with a broken offset", () => {
  const rgba = new Uint8Array(4 * 4 * 4).fill(200);
  const good = encodeUncompressedTex(rgba, 4, 4, { mips: true });
  const broken = good.slice();
  new DataView(broken.buffer, broken.byteOffset).setUint32(28, 999, true);
  const out = fix("chara/x/v01_x.tex", texFile(broken) as never);
  assert.ok(out, "repaired file must be kept, not dropped");
});

test("drops a majorly-broken (undecodable) tex", () => {
  const junk = { storage: FileStorageType.SqPackCompressed as const, data: new Uint8Array([1, 2, 3]) };
  assert.equal(fix("chara/x/v01_x.tex", junk as never), null);
});

test("aborts (throws) on a BC NPOT-with-mips source", () => {
  const dxt5 = texFile(makeDxt5NpotWithMips()); // reuse the Task 3 helper (copy into this file)
  assert.throws(() => fix("chara/x/v01_x.tex", dxt5 as never));
});

test("leaves a ui/*.tex untouched (MakeFileStorageInformationDictionary carve-out)", () => {
  const rgba = new Uint8Array(4 * 4 * 4).fill(1);
  const t = texFile(encodeUncompressedTex(rgba, 4, 4, { mips: true }));
  assert.strictEqual(fix("ui/icon/000001.tex", t as never), t);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/upgrade/load-fixes.test.ts`. Expected: FAIL — the current branch returns the file unchanged (broken offset not repaired; BC source not aborted).

- [ ] **Step 3: Rewrite the `.tex` branch**

Replace `src/upgrade/load-fixes.ts:96-104` (the `if (gates.needsTexFix && IS_TEX.test(gamePath)) { … }` block):

```ts
    if (gates.needsTexFix && IS_TEX.test(gamePath)) {
      // ui/ carve-out from MakeFileStorageInformationDictionary (TTMP.cs:1367), not FromWizardGroup —
      // preserved verbatim from the retired texFixRound; see this module's header comment.
      if (IS_UI.test(gamePath)) return file;
      try {
        // GetUncompressedFile (TTMP.cs:1426): decode the Type-4 entry; a decode failure throws and is
        // caught below → DROP (FixOldTexData's catch → continue on a majorly-broken texture).
        const { bytes } = requireBytes(file, gamePath);
        const fixed = validateTexFileData(bytes);
        return fixed ? restore(file, fixed, SqPackType.Texture) : file;
      } catch (e) {
        // FAIL LOUD for the one path we can't reproduce (BC re-encode); everything else that throws is
        // a faithful drop (majorly-broken tex, or a resize guard TexTools also aborts on → continue).
        if (e instanceof UnportedBcReencode) throw e;
        return null;
      }
    }
```

Update imports at the top of `src/upgrade/load-fixes.ts`: add `import { UnportedBcReencode, validateTexFileData } from "./validate-tex";`. `requireBytes`, `restore` are already imported from `./upgrade`; `SqPackType` from `../sqpack/sqpack`. `decodeSqPackFile` is no longer used by this branch — `npm run check` will drop it from the import if nothing else uses it (verify: the `.meta`/`.mdl` branches use `requireBytes`, not `decodeSqPackFile`). Update the `.tex` bullet in the `makeTtmpLoadFix` doc comment (`load-fixes.ts:58-72`) to say it now runs the full `ValidateTexFileData` (resize + mip-offset fixup), no longer a validity-check-only stub.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/upgrade/load-fixes.test.ts`. Expected: PASS. Then `npm run check && npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/upgrade/load-fixes.ts test/upgrade/load-fixes.test.ts
git commit -m "feat(upgrade): run full ValidateTexFileData at the TTMP load seam"
```

---

### Task 5: synthetic goldens + corpus re-bless

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-validate-tex.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`
- Baselines (gitignored): `test/corpus/.upgrade-baseline/`, `test/corpus/.resave-baseline/`

**Interfaces:**
- Consumes: the shared `scripts/generate-synthetics/pmp-builder.ts` byte-reproducible zip helper and the closest existing TTMP builder as a template — **read `scripts/generate-synthetics/build-synthetic-npot-mask.ts` first** (it hand-assembles NPOT `.tex` payloads, incl. DXT5) and mirror its structure.
- Produces: two synthetic `.ttmp2` packs whose `TTMPVersion` trips `ttmpNeedsTexFix` (use `"2.0"`).

- [ ] **Step 1: Write the builder**

Create `scripts/generate-synthetics/build-synthetic-validate-tex.ts` producing two old-version (`TTMPVersion: "2.0"`) TTMP packs:

1. `validate-tex-branch-b.ttmp2` — a single **power-of-two** `.tex` (e.g. 8×8 A8R8G8B8, `mipCount ≥ 2`) whose stored mip-offset table is deliberately wrong and/or which carries trailing null padding, so ConsoleTools' `FixOldTexData` rewrites the header (Branch B). This gives Branch B a real `/upgrade` golden independent of the two real corpus packs.
2. `validate-tex-branch-a-a8.ttmp2` — a single **A8R8G8B8 NPOT-with-mips** `.tex` (e.g. 96×64, `mipCount ≥ 2`), so ConsoleTools resizes it to a square pow2 (Branch A). Expected **byte-exact** against our output.

Do **not** author a BC NPOT-with-mips pack as a passing corpus pack — ConsoleTools succeeds where we deliberately abort (Task 3), so it cannot be a byte-matching golden. Its abort is already pinned by the Task 3/Task 4 unit tests.

Wire both into `scripts/generate-synthetics/build-all.ts` following the existing registration pattern (one entry per pack).

- [ ] **Step 2: Build the synthetics**

Run: `npm run synthetics`. Expected: the two `.ttmp2` files appear under `test/corpus/synthetic/`. Confirm they are byte-reproducible (re-run; no change).

- [ ] **Step 3: Run the upgrade harness on the new packs (expect first-run golden fetch)**

Run: `npm test`. First run spawns ConsoleTools to build each golden. Expected results:
- `validate-tex-branch-b`: **full byte match** (Branch B is byte-exact) — no baseline entry.
- `validate-tex-branch-a-a8`: **full byte match** (A8R8G8B8 resize is lossless) — no baseline entry.

If either does NOT match, STOP and investigate (a real port bug, not something to bless). Only the documented struct-copy/resampler tolerances are acceptable; a Branch B mismatch means the quirk is wrong.

- [ ] **Step 4: Re-bless the real corpus and report movement**

The full `ValidateTexFileData` will change `.tex` load bytes on old real packs — most importantly it should **remove** the mip-offset `/resave` baseline entries for `Bloodlust - Bibo+.ttmp2` and `chained_collars_v1_1_0.ttmp2` (T2 item). Re-bless:

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

(and the `/resave` baseline env var if the runner uses a distinct one — check `AGENTS.md` / the harness). Record **per-pack before/after entry counts** in the commit message. Investigate — do NOT bless — any pack whose baseline *grows* or whose *payload* newly diverges: that is an unknown NPOT/broken-mip source, potentially the BC abort firing on a real pack (which would be a genuine finding worth escalating).

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-synthetics/build-synthetic-validate-tex.ts scripts/generate-synthetics/build-all.ts test/corpus/.upgrade-baseline test/corpus/.resave-baseline
git commit -m "test(corpus): synthetic ValidateTexFileData goldens + re-bless"
```

(Baselines are gitignored; the `git add` is a no-op if so — note the before/after counts in the message regardless.)

---

### Task 6: register the TexTools bug + burn down the backlog

**Files:**
- Modify: `docs/TEXTOOLS_BUGS.md`
- Delete: `docs/backlog/2026-07-10-imagesharp-resampler.md`
- Modify: `docs/backlog/2026-07-10-fixoldtexdata-load-round.md`, `docs/backlog/2026-07-13-pmp-load-time-tex-fixup.md`, `docs/BACKLOG.md`

- [ ] **Step 1: Register the bugs**

Add two entries to `docs/TEXTOOLS_BUGS.md` (follow the file's existing entry format/numbering):
1. **Width-for-both-dimensions resize** — `ValidateTexFileData` (`EndwalkerUpgrade.cs:2110`) passes `RoundToPowerOfTwo(header.Width)` for the height argument, squishing a non-square NPOT texture to a square. Status: reproduced. Cite `src/upgrade/validate-tex.ts`.
2. **`FixUpBrokenMipOffsets` struct-copy MipCount** — `Tex.TexHeader.FixUpBrokenMipOffsets` (`Tex.cs:168-235`) reduces a local `MipCount` when trimming mips, but because `TexHeader` is passed by value the reduction never reaches the caller, so `ValidateTexFileData` (`EndwalkerUpgrade.cs:2121`) serializes a header whose `MipCount` field can disagree with its own valid-offset count. Status: reproduced. Cite `src/tex/header.ts`.

- [ ] **Step 2: Verify no stale references before deleting item #1**

Run: `Select-String -Path src,test,docs,scripts -Pattern "2026-07-10-imagesharp-resampler" -Recurse` (PowerShell). Expected: the only hits are in `docs/` (backlog index + specs). Update each cite, then delete the item file and its `docs/BACKLOG.md` entry.

- [ ] **Step 3: Narrow the T2 and PMP items**

In `docs/backlog/2026-07-10-fixoldtexdata-load-round.md`: mark the `ValidateTexFileData` resize + mip-offset halves **done** (this spec), narrowing the item to the deferred unconditional recompress (`Tex.CompressTexFile`, `TTMP.cs:1436`) only. In `docs/backlog/2026-07-13-pmp-load-time-tex-fixup.md`: note `fixUpBrokenMipOffsets` is now ported (`src/tex/header.ts`) and ready to wire; the PMP-side `FastValidateTexFile` truncation half remains.

- [ ] **Step 4: Re-rank `docs/BACKLOG.md`**

Remove item #1, shift the prioritized list up, and add a dated pass note (matching the file's existing note style) recording the ship and that the BC-encoder item stays unprioritized per the 2026-07-25 survey (spec §3.4).

- [ ] **Step 5: Full gate + commit**

Run: `npm run check && npm run typecheck && npm test`. Expected: all green.

```bash
git add docs
git commit -m "docs: register ValidateTexFileData bugs, burn down backlog #1 + narrow T2"
```

---

## Self-Review

**Spec coverage:** §1 call path → Task 4. §2 both branches → Task 3. §3.1 module layout → Tasks 1–4. §3.2 Branch A A8R8G8B8/BC split → Task 3. §3.3 width-for-both bug → Task 3 + Task 6. §3.4 drop/keep/abort table → Task 4 (+ Task 3 sentinel). §3.5 load-fix shape → Task 4. §4 blast radius / re-bless → Task 5. §5 recompress deferred → Task 6 (T2 narrowed). §6 tests → Tasks 1,3,4,5. §7 backlog outcome → Task 6. All covered.

**Placeholder scan:** every code step carries full code; the synthetic builder (Task 5) points to a concrete committed template (`build-synthetic-npot-mask.ts`) with exact pack parameters rather than a sketch. `makeDxt5NpotWithMips` is a named test helper whose construction is specified inline.

**Type consistency:** `fixUpBrokenMipOffsets` / `assertTexHeaderWritable` / `resizeForMerge` / `validateTexFileData` / `UnportedBcReencode` signatures match across Tasks 1→3→4. `resizeForMerge(rgba, srcW, srcH, dstW, dstH, format)` is called with `(…, round, round, tex.format)` in Task 3, reproducing the §3.3 bug. `restore(file, fixed, SqPackType.Texture)` matches the `SqPackCompressedFile` overload (Task 4 input is `SqPackCompressedFile`).
