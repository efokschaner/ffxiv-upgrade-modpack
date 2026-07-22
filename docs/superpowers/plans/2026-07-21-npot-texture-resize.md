# NPOT Texture Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Bicubic NPOT pre-step that `createIndexFromNormal` and `upgradeMaskTex` have in the C#, so a non-power-of-two source stops silently skipping texture generation.

**Architecture:** One shared helper in `src/upgrade/texture.ts` stands in for `Tex.ResizeXivTx` (`Tex.cs:413-420`): it Bicubic-resizes decoded RGBA to the nearest power of two and reproduces the two hard failures `MergePixelData` (`Tex.cs:637-706`) owns, while deliberately eliding that function's BC compress/decompress round-trip (we have no nvtt-compatible encoder). Both call sites then lose their `TextureResizeUnsupported` throw, the sentinel class and its swallow are deleted, and four synthetic corpus packs give the previously-unoracled mask half a real ConsoleTools golden.

**Tech Stack:** TypeScript, Vitest (via the custom `scripts/run-tests.ts` runner), Biome, `fflate`.

**Spec:** [`docs/superpowers/specs/2026-07-21-npot-texture-resize-design.md`](../specs/2026-07-21-npot-texture-resize-design.md) — read §3 before Task 1.

## Global Constraints

- **Every line of business logic cites TexTools provenance** as `file · symbol · lines` in a comment. Verify each citation against `reference/` — read the C#, do not port from memory.
- **`reference/` is read-only.** Never edit, lint, or format it.
- **Formatting is mechanical.** Run `npm run check` (Biome); never hand-format.
- **End-of-task ritual, all three green before a task is done:** `npm run check`, `npm run typecheck`, `npm test`.
- **No new dependencies.** Everything needed (`resizeBicubic`, `roundToPowerOfTwo`, `buildCanonicalTexHeader`, `concatBytes`) already exists.
- **Corpus is gitignored.** `test/corpus/**` and `test/corpus/.upgrade-baseline/` are local-only; never `git add` them.
- **Bless command:** `$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`
- **Single-corpus-unit debug aid:** `$env:CORPUS_UNIT = "<index>"; npm test` runs one unit and nothing else.
- **Formats `GetCompressionFormat` accepts** (`Tex.cs:718-747`), verbatim: `DXT1, DXT5, BC4, BC5, BC7, A8R8G8B8`.
- **Size guard text** (`Tex.cs:656-660`), verbatim: `Image is too small for DDS Compressor. (64x64 Minimum Size)`.

---

### Task 1: Shared NPOT pre-step + `createIndexFromNormal`

**Files:**
- Modify: `src/upgrade/texture.ts:23-70` (the sentinel doc comment, `createIndexFromNormal`)
- Modify: `test/upgrade/texture.test.ts:38-61` (the `createIndexFromNormal` describe block)

**Interfaces:**
- Consumes: `isPowerOfTwo` / `roundToPowerOfTwo` (`src/upgrade/texture.ts:30-53`, already present); `resizeBicubic(rgba, srcW, srcH, dstW, dstH): Uint8Array` (`src/tex/imagesharp/resample.ts`); `decodeToRgba`, `encodeUncompressedTex`, `parseTex` (`src/tex/tex.ts`); `createIndexTexture(rgba, w, h): Uint8Array` (`src/tex/helpers.ts:36`).
- Produces: `resizeToPow2ForMerge(rgba: Uint8Array, width: number, height: number, format: number): { rgba: Uint8Array; width: number; height: number }` — module-private in `src/upgrade/texture.ts`, consumed by Task 2's `upgradeMaskTex`.

- [ ] **Step 1: Write the failing tests**

Add these imports to the top of `test/upgrade/texture.test.ts` (merge into the existing import blocks; keep Biome's ordering by running `npm run check` afterwards):

```ts
import { buildCanonicalTexHeader } from "../../src/tex/header";
import { BC7, DXT3 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";
```

Add this helper next to `a8r8g8b8Tex` (`test/upgrade/texture.test.ts:30-36`):

```ts
/** A .tex of `format` whose mip 0 is `blocks`, for exercising format/size branches that
 *  `a8r8g8b8Tex` cannot reach. Block sizes are the caller's responsibility. */
function rawTex(
  format: number,
  width: number,
  height: number,
  blocks: Uint8Array,
): Uint8Array {
  return concatBytes([
    buildCanonicalTexHeader(format, width, height, 1),
    blocks,
  ]);
}
```

Replace the existing `it("throws TextureResizeUnsupported for a non-power-of-two normal", ...)` (`:55-60`) with:

```ts
  it("resizes an NPOT normal to its nearest pow2 size (EndwalkerUpgrade.cs:1096-1099)", () => {
    // 400 -> RoundToPowerOfTwo picks 512 (|512-400| = 112 < |400-256| = 144), IOUtil.cs:905-930.
    const w = 400,
      h = 400;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 7 + 3) & 0xff);
    const out = createIndexFromNormal(a8r8g8b8Tex(w, h, rgba));
    const parsed = parseTex(out);
    expect(parsed.width).toBe(512);
    expect(parsed.height).toBe(512);
    const expected = createIndexTexture(
      resizeBicubic(rgba, w, h, 512, 512),
      512,
      512,
    );
    expect(Array.from(decodeToRgba(parsed))).toEqual(Array.from(expected));
  });

  it("leaves an already-pow2 normal unresized (TextureHelpers.cs:368 early return)", () => {
    const w = 64,
      h = 64;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 5 + 1) & 0xff);
    const out = createIndexFromNormal(a8r8g8b8Tex(w, h, rgba));
    const parsed = parseTex(out);
    expect(parsed.width).toBe(w);
    expect(parsed.height).toBe(h);
    expect(Array.from(decodeToRgba(parsed))).toEqual(
      Array.from(createIndexTexture(rgba, w, h)),
    );
  });

  it("throws when a rounded dimension is under 64 (Tex.cs:656-660)", () => {
    // 40 -> RoundToPowerOfTwo picks 32 (|40-32| = 8 < |64-40| = 24), so MergePixelData's
    // TexImpNet size guard fires on the POST-resize dims.
    const rgba = new Uint8Array(40 * 40 * 4);
    expect(() => createIndexFromNormal(a8r8g8b8Tex(40, 40, rgba))).toThrow(
      /64x64 Minimum Size/,
    );
  });

  it("throws on a format GetCompressionFormat rejects (Tex.cs:718-747)", () => {
    // DXT3 decodes fine for us but is absent from GetCompressionFormat's switch, so TexTools
    // aborts the whole upgrade rather than resizing it.
    const blocks = new Uint8Array((400 / 4) * (400 / 4) * 16);
    expect(() => createIndexFromNormal(rawTex(DXT3, 400, 400, blocks))).toThrow(
      /unsupported/i,
    );
  });

  it("exempts BC7 from the <64 guard (Tex.cs:650-653 takes the TexConv path)", () => {
    // Mode-6 blocks: byte0 = 0x40 is six zero bits then the mode bit, LSB-first.
    const blocks = new Uint8Array((40 / 4) * (40 / 4) * 16);
    for (let i = 0; i < blocks.length; i += 16) blocks[i] = 0x40;
    const out = createIndexFromNormal(rawTex(BC7, 40, 40, blocks));
    expect(parseTex(out).width).toBe(32);
  });
```

Leave the existing `it("produces an A8R8G8B8 index tex whose pixels match createIndexTexture", ...)` at `:39-53` untouched.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/upgrade/texture.test.ts`
Expected: the five new tests FAIL (four with `TextureResizeUnsupported`, `"leaves an already-pow2 normal unresized"` passes already). The old `TextureResizeUnsupported` import is still used by the `upgradeMaskTex` tests, so the file still compiles.

- [ ] **Step 3: Implement the shared helper**

In `src/upgrade/texture.ts`, add these imports:

```ts
import { A8R8G8B8, BC4, BC5, BC7, DXT1, DXT5 } from "../tex/types";
```

Insert immediately after `roundToPowerOfTwo` (`src/upgrade/texture.ts:49-53`):

```ts
// Tex.GetCompressionFormat (Tex.cs:718-747): the only XivTexFormats MergePixelData can re-encode.
// Anything else hits its `default:` and throws InvalidDataException. Our decodeToRgba
// (src/tex/decode.ts) accepts strictly more than this (DXT3, A4R4G4B4, A1R5G5B5, L8, A8,
// A16B16G16R16F), so this set is load-bearing rather than incidental.
const MERGE_SUPPORTED_FORMATS = new Set<number>([
  DXT1,
  DXT5,
  BC4,
  BC5,
  BC7,
  A8R8G8B8,
]);

/**
 * Port of Tex.ResizeXivTx (Tex.cs:413-420) as used by the two NPOT pre-steps,
 * EndwalkerUpgrade.cs:1096-1099 (CreateIndexFromNormal) and :2086-2089 (UpgradeMaskTex).
 * Already-pow2 input is returned untouched — C# only calls ResizeXivTx inside the NPOT branch,
 * so nothing here runs for a pow2 texture.
 *
 * ELIDED, DELIBERATELY: step 3 of ResizeXivTx is Tex.MergePixelData (Tex.cs:637-706), which
 * re-encodes the resized pixels into the source's own BC format via TexImpNet/nvtt; the caller
 * then immediately decodes them again. We have no nvtt-compatible encoder, so we hand the
 * resized RGBA straight on. Measured against the ConsoleTools /upgrade golden for
 * `Club Cyberia Motorbike.ttmp2` (a 400x400 DXT5 normal), our output is BYTE-IDENTICAL in all
 * 12 options — CreateIndexTexture reads only the normal's alpha and quantizes it into rows of
 * 17 (TextureHelpers.cs:222-260), which absorbs the round-trip error. See the design spec §3.2.
 * The mask path (upgradeMaskTex) has NO such quantization and, at time of writing, no corpus
 * pack reaching it — see §3.3 and the synthetic packs built for it.
 *
 * NOT elided: the two ways MergePixelData FAILS. Both abort the whole upgrade in C#
 * (EndwalkerUpgrade.cs:1842 has no try/catch; ModpackUpgrader.cs:133-141 rethrows wrapped), so
 * both are plain Errors here. They are checked before the resize rather than after purely to
 * avoid wasted work — either way the call throws.
 */
function resizeToPow2ForMerge(
  rgba: Uint8Array,
  width: number,
  height: number,
  format: number,
): { rgba: Uint8Array; width: number; height: number } {
  if (isPowerOfTwo(width) && isPowerOfTwo(height)) {
    return { rgba, width, height };
  }
  // RoundToPowerOfTwo is never equal to an NPOT input, so ResizeImage's equal-dims early return
  // (TextureHelpers.cs:368) is unreachable from here.
  const w = roundToPowerOfTwo(width);
  const h = roundToPowerOfTwo(height);
  if (!MERGE_SUPPORTED_FORMATS.has(format)) {
    throw new Error(
      `tex resize: format ${format} is currently unsupported by MergePixelData (Tex.cs:718-747)`,
    );
  }
  // Tex.cs:656-660, gated to the non-BC7 arm: BC7 takes the DDS.TexConvRawPixels path
  // (Tex.cs:650-653), which carries no size guard. The dims tested are the POST-resize ones —
  // ResizeXivTx overwrites tex.Width/Height (Tex.cs:417-418) before calling MergePixelData.
  if (format !== BC7 && (w < 64 || h < 64)) {
    throw new Error(
      `tex resize: ${width}x${height} rounds to ${w}x${h} — Image is too small for DDS Compressor. (64x64 Minimum Size) (Tex.cs:656-660)`,
    );
  }
  return { rgba: resizeBicubic(rgba, width, height, w, h), width: w, height: h };
}
```

- [ ] **Step 4: Rewrite `createIndexFromNormal`**

Replace `src/upgrade/texture.ts:55-70` in full with:

```ts
/** Port of CreateIndexFromNormal (EndwalkerUpgrade.cs:1083-1113). Decodes the normal,
 *  NPOT-normalizes it (:1096-1099, see resizeToPow2ForMerge), builds the index map from its
 *  alpha, re-encodes A8R8G8B8 with mips. */
export function createIndexFromNormal(normalTexBytes: Uint8Array): Uint8Array {
  const tex = parseTex(normalTexBytes);
  const src = resizeToPow2ForMerge(
    decodeToRgba(tex),
    tex.width,
    tex.height,
    tex.format,
  );
  const indexRgba = createIndexTexture(src.rgba, src.width, src.height);
  return encodeUncompressedTex(indexRgba, src.width, src.height, {
    mips: true,
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/upgrade/texture.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Observe the corpus movement, then bless**

Run: `npm test`
Expected: FAIL on `Club Cyberia Motorbike.ttmp2`'s `upgrade` unit. Its 12 `payload/added` `_n_c_id.tex` entries are gone (a subset of baseline still passes), but the 12 `manifest/added` `ModsJsons/19` entries convert into `FullPath`/`Name` mismatches — new entries, so the ratchet correctly reds.

Before blessing, record the pack's current entry count:

```powershell
$f = "test/corpus/.upgrade-baseline/00d48b22e50061e6cafafb73525f8234d04e51e889f302320dffc9aceec543d0.json"
(Get-Content $f -Raw | ConvertFrom-Json).Count
```

Expected before: `433`.

Then bless and re-count:

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

**Verification gates — do not proceed past a failure:**
1. Re-count the file above. Confirm **zero** entries match `_n_c_id.tex` with `status = added`.
2. `git status --short` must show **no** corpus files (they are gitignored). Any other pack whose baseline moved means an NPOT source we did not know about — **investigate, do not bless past it**. Diff the baseline directory's mtimes to check:
   ```powershell
   Get-ChildItem test/corpus/.upgrade-baseline | Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-10) } | Select-Object Name, LastWriteTime
   ```
   Only Club Cyberia's `00d48b22…json` should appear.
3. `npm test` green.

- [ ] **Step 7: Run the full ritual and commit**

```powershell
npm run check; npm run typecheck; npm test
```

```bash
git add src/upgrade/texture.ts test/upgrade/texture.test.ts
git commit -m "feat(texture): port the NPOT Bicubic pre-step for createIndexFromNormal"
```

Report in the commit body: the before/after baseline counts and which entries moved class.

---

### Task 2: `upgradeMaskTex` + retire `TextureResizeUnsupported`

**Files:**
- Modify: `src/upgrade/texture.ts` (`upgradeMaskTex` at `:72-88`, the sentinel class at `:23-28`, `upgradeRemainingTextures`' `try`/`catch` at `:213` and `:278-281`)
- Modify: `src/upgrade/unclaimed-hair.ts:197-204` (comment only)
- Modify: `docs/TEXTOOLS_BUGS.md` (around `:334`, prose only)
- Modify: `test/upgrade/texture.test.ts` (`upgradeMaskTex` describe at `:63-82`; `"skips (no throw) a target whose normal is NPOT"` at `:251-271`; the `TextureResizeUnsupported` import at `:20`)

**Interfaces:**
- Consumes: `resizeToPow2ForMerge` from Task 1 (exact signature in Task 1's Interfaces block); `upgradeGearMask(rgba, w, h, legacy): void` (`src/tex/helpers.ts:67`, mutates in place).
- Produces: nothing new. `TextureResizeUnsupported` **ceases to exist** — no later task may reference it.

- [ ] **Step 1: Write the failing tests**

Replace the whole `describe("upgradeMaskTex", ...)` block (`test/upgrade/texture.test.ts:63-82`) with:

```ts
describe("upgradeMaskTex", () => {
  it("upgrades a pow2 mask (non-legacy) byte-exact vs upgradeGearMask", () => {
    const w = 2,
      h = 2;
    const rgba = new Uint8Array([
      10, 0, 20, 200, 30, 255, 40, 100, 5, 60, 70, 255, 1, 2, 3, 4,
    ]);
    const out = upgradeMaskTex(a8r8g8b8Tex(w, h, rgba), false);
    const got = decodeToRgba(parseTex(out));
    const expected = rgba.slice();
    upgradeGearMask(expected, w, h, false);
    expect(Array.from(got)).toEqual(Array.from(expected));
  });

  it("resizes an NPOT mask to its nearest pow2 size (EndwalkerUpgrade.cs:2086-2089)", () => {
    const w = 400,
      h = 400;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 11 + 5) & 0xff);
    const out = upgradeMaskTex(a8r8g8b8Tex(w, h, rgba), true);
    const parsed = parseTex(out);
    expect(parsed.width).toBe(512);
    expect(parsed.height).toBe(512);
    const expected = resizeBicubic(rgba, w, h, 512, 512);
    upgradeGearMask(expected, 512, 512, true);
    expect(Array.from(decodeToRgba(parsed))).toEqual(Array.from(expected));
  });

  it("throws when a rounded dimension is under 64 (Tex.cs:656-660)", () => {
    const rgba = new Uint8Array(40 * 40 * 4);
    expect(() => upgradeMaskTex(a8r8g8b8Tex(40, 40, rgba), false)).toThrow(
      /64x64 Minimum Size/,
    );
  });

  it("throws on a format GetCompressionFormat rejects (Tex.cs:718-747)", () => {
    const blocks = new Uint8Array((400 / 4) * (400 / 4) * 16);
    expect(() => upgradeMaskTex(rawTex(DXT3, 400, 400, blocks), false)).toThrow(
      /unsupported/i,
    );
  });

  it("exempts BC7 from the <64 guard (Tex.cs:650-653 takes the TexConv path)", () => {
    const blocks = new Uint8Array((40 / 4) * (40 / 4) * 16);
    for (let i = 0; i < blocks.length; i += 16) blocks[i] = 0x40;
    const out = upgradeMaskTex(rawTex(BC7, 40, 40, blocks), false);
    expect(parseTex(out).width).toBe(32);
  });
});
```

Replace `it("skips (no throw) a target whose normal is NPOT", ...)` (`:251-271`) with:

```ts
  it("generates the index tex for an NPOT normal instead of skipping it", () => {
    const normalPath = "chara/x/tex/npot_n.tex";
    const indexPath = "chara/x/tex/npot_id.tex";
    const w = 400,
      h = 400;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 3 + 9) & 0xff);
    const o = option([{ gamePath: normalPath, data: a8r8g8b8Tex(w, h, rgba) }]);
    const targets = new Map<string, UpgradeInfo>([
      [
        indexPath,
        {
          usage: EUpgradeTextureUsage.IndexMaps,
          files: { normal: normalPath, index: indexPath },
        },
      ],
    ]);
    upgradeRemainingTextures(o, targets);
    const idxFile = o.files.get(indexPath);
    expect(idxFile).toBeDefined();
    expect(parseTex(idxFile!.data!).width).toBe(512);
  });

  it("propagates a too-small NPOT normal instead of swallowing it (Tex.cs:656-660)", () => {
    const normalPath = "chara/x/tex/tiny_n.tex";
    const indexPath = "chara/x/tex/tiny_id.tex";
    const o = option([
      {
        gamePath: normalPath,
        data: a8r8g8b8Tex(40, 40, new Uint8Array(40 * 40 * 4)),
      },
    ]);
    const targets = new Map<string, UpgradeInfo>([
      [
        indexPath,
        {
          usage: EUpgradeTextureUsage.IndexMaps,
          files: { normal: normalPath, index: indexPath },
        },
      ],
    ]);
    expect(() => upgradeRemainingTextures(o, targets)).toThrow(
      /64x64 Minimum Size/,
    );
  });
```

Remove `TextureResizeUnsupported` from the import block at `:18-24`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/upgrade/texture.test.ts`
Expected: FAIL — the NPOT mask tests throw `TextureResizeUnsupported`, and the "propagates a too-small NPOT normal" test fails because the dispatch catch still swallows it.

- [ ] **Step 3: Rewrite `upgradeMaskTex`**

Replace `src/upgrade/texture.ts:72-88` in full with:

```ts
/** Port of UpgradeMaskTex (EndwalkerUpgrade.cs:2082-2098). Decodes the mask, NPOT-normalizes it
 *  (:2086-2089, see resizeToPow2ForMerge), applies the gear-mask channel remap, re-encodes
 *  A8R8G8B8 with mips.
 *
 *  UNVERIFIED AGAINST TEXTOOLS at the time this was written, unlike the index path: the elided
 *  MergePixelData round-trip (see resizeToPow2ForMerge) is proven byte-neutral only where
 *  CreateIndexTexture's row-of-17 quantization absorbs it. upgradeGearMask has no such
 *  quantization, so a lossy source format's round-trip error would reach the output bytes here.
 *  The npot-mask-* synthetic packs (scripts/generate-synthetics/) exist to close that gap with a
 *  real ConsoleTools golden — see the design spec §3.3/§5.1. */
export function upgradeMaskTex(
  maskTexBytes: Uint8Array,
  legacy: boolean,
): Uint8Array {
  const tex = parseTex(maskTexBytes);
  const src = resizeToPow2ForMerge(
    decodeToRgba(tex),
    tex.width,
    tex.height,
    tex.format,
  );
  upgradeGearMask(src.rgba, src.width, src.height, legacy);
  return encodeUncompressedTex(src.rgba, src.width, src.height, { mips: true });
}
```

- [ ] **Step 4: Delete the sentinel and its swallow**

Delete `src/upgrade/texture.ts:23-28` entirely (the `TextureResizeUnsupported` doc comment and class).

In `upgradeRemainingTextures`, delete the `try {` at `:213` and the `} catch (e) { ... }` at `:278-281`, de-indenting the loop body by two spaces. The result must be a bare `for (const info of targets.values()) { ... }`. Add above the loop:

```ts
  // No try/catch here, matching EndwalkerUpgrade.cs:1842 — UpgradeRemainingTextures does not
  // guard its CreateIndexFromNormal call, so a failure propagates to ModpackUpgrader.cs:133-141
  // and aborts the whole upgrade. (The swallow-and-Trace catch at EndwalkerUpgrade.cs:637-645 is
  // a DIFFERENT call site, gated behind `files == null` at :627 — unreachable on this path.)
```

- [ ] **Step 5: Update the two prose references**

`src/upgrade/unclaimed-hair.ts:197-204` — the comment names `TextureResizeUnsupported` as one of the things this catch swallows. Rewrite that clause so it no longer names a type that does not exist; the catch itself is unchanged and still faithfully reproduces TexTools' bare `catch { continue }`.

`docs/TEXTOOLS_BUGS.md` around `:334` — same edit: the entry says the catch swallows "not just `TextureResizeUnsupported`". Reword to describe the swallowed class without naming the deleted type. Do not change the bug's adjudication.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/upgrade/texture.test.ts`
Expected: PASS.

Then confirm the sentinel is fully gone from source (docs/specs may still discuss it historically):

Run: `npx rg "TextureResizeUnsupported" src test`
Expected: **no output**.

- [ ] **Step 7: Run the full ritual and commit**

```powershell
npm run check; npm run typecheck; npm test
```

Expected: green with **no new bless**. No corpus pack reaches an NPOT mask, so no baseline should move. If one does, stop — that is a discovery worth investigating, not blessing.

```bash
git add src/upgrade/texture.ts src/upgrade/unclaimed-hair.ts docs/TEXTOOLS_BUGS.md test/upgrade/texture.test.ts
git commit -m "feat(texture): port the NPOT pre-step for upgradeMaskTex; retire the resize sentinel"
```

---

### Task 3: Synthetic NPOT-mask packs (the mask side's oracle)

**Files:**
- Modify: `scripts/generate-synthetics/ttmp2-builder.ts` (add a root parameter to `writeTtmp2Files`)
- Modify: `scripts/generate-synthetics/synthetic-mtrl.ts` (add a normal+mask builder)
- Create: `scripts/generate-synthetics/build-synthetic-npot-mask.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`

**Interfaces:**
- Consumes: `writeTtmp2Files(fileName, packName, files)` (`scripts/generate-synthetics/ttmp2-builder.ts:114`); `buildCanonicalTexHeader(format, width, height, mipCount)` (`src/tex/header.ts:54`); `concatBytes` (`src/util/binary.ts`); `ESamplerId` (`src/mtrl/shader.ts:12-26`).
- Produces:
  - `writeTtmp2Files(fileName, packName, files, root?: SyntheticRoot)` — fourth parameter, defaulting to `"synthetic"`; `SyntheticRoot` is re-exported from `pmp-builder.ts`.
  - `buildEwColorsetMaskMtrl(normalTexPath: string, maskTexPath: string): Uint8Array` in `synthetic-mtrl.ts`.

- [ ] **Step 1: Add a root parameter to `writeTtmp2Files`**

`pmp-builder.ts:33` already exports `SyntheticRoot = "synthetic" | "upgrade-error"`; `ttmp2-builder.ts` currently hardcodes its `OUT_DIR` to the synthetic root (`:17-24`). Change `OUT_DIR` to a `CORPUS_DIR` (drop the trailing `"synthetic"` segment), import `type SyntheticRoot` from `./pmp-builder`, and give **both** `writeTtmp2Pack` and `writeTtmp2Files` a trailing `root: SyntheticRoot = "synthetic"` parameter that joins into the output path — mirroring `writePmp` (`pmp-builder.ts:120-141`) exactly. Existing callers pass three arguments and must keep working unchanged.

- [ ] **Step 2: Add the normal+mask material builder**

Append to `scripts/generate-synthetics/synthetic-mtrl.ts`:

```ts
/** As buildEwColorsetMtrl, but with a SECOND texture bound to g_SamplerMask (ESamplerId,
 * shader.ts:23) so the colorset round records a GearMaskLegacy target
 * (EndwalkerUpgrade.cs:973-1006) alongside the IndexMaps one. character.shpk becomes
 * characterlegacy.shpk during the upgrade (EndwalkerUpgrade.cs:747-751), which is what selects
 * the Legacy arm; no mask-as-spec shader key is emitted, so `usesMaskAsSpec` (:909) stays false
 * and the arm is reached. */
export function buildEwColorsetMaskMtrl(
  normalTexPath: string,
  maskTexPath: string,
): Uint8Array {
  const uv = "uv1";
  const shpk = "character.shpk";
  const maskOffset = normalTexPath.length + 1;
  const uvOffset = maskOffset + maskTexPath.length + 1;
  const shaderNameOffset = uvOffset + uv.length + 1;
  const rawStringBlockSize = shaderNameOffset + shpk.length + 1;
  const stringBlockSize = Math.ceil(rawStringBlockSize / 4) * 4;
  const pad = stringBlockSize - rawStringBlockSize;

  const b = new ByteBuilder();
  b.i32(0x00000301); // signature
  const fileSizePos = b.length;
  b.u16(0); // fileSize (backfilled below)
  b.u16(544); // colorSetDataSize = 512 colorset + 32 EW dye
  b.u16(stringBlockSize);
  b.u16(shaderNameOffset);
  b.u8(2); // texCount
  b.u8(1); // mapCount
  b.u8(0); // colorsetCount
  b.u8(4); // additionalDataSize

  b.u16(0).u16(0); // texture[0]: normal, offset 0, flags 0
  b.u16(maskOffset).u16(0); // texture[1]: mask
  b.u16(uvOffset).u16(0); // uvMap[0]

  b.bytes(enc.encode(normalTexPath)).u8(0);
  b.bytes(enc.encode(maskTexPath)).u8(0);
  b.bytes(enc.encode(uv)).u8(0);
  b.bytes(enc.encode(shpk)).u8(0);
  for (let i = 0; i < pad; i++) b.u8(0);

  b.bytes([0x08, 0, 0, 0]); // additionalData: dye present

  for (let i = 0; i < 256; i++) b.u16((i * 7) & 0xffff); // EW colorset
  for (let i = 0; i < 32; i++) b.u8((i * 3) & 0xff); // EW dye

  b.u16(4); // shaderConstantsDataSize (1 float)
  b.u16(1); // shaderKeyCount
  b.u16(1); // shaderConstantsCount
  b.u16(2); // textureSamplerCount
  b.u16(0x0011); // materialFlags
  b.u16(0x0022); // materialFlags2

  b.u32(0x12345678).u32(0x9abcdef0); // shader key (NOT the mask-as-spec key 0xc8bd1def, so
  // `usesMaskAsSpec` (EndwalkerUpgrade.cs:909) stays false and the GearMask arm is reached)
  b.u32(0xcafebabe).u16(0).u16(4); // shader-constant descriptor
  b.u32(SAMPLER_NORMAL_MAP_0).u32(0x00010203).u8(0).bytes([0, 0, 0]); // normal -> texture 0
  b.u32(0x8a4e82b6).u32(0x00010203).u8(1).bytes([0, 0, 0]); // g_SamplerMask -> texture 1
  b.f32(1.5); // float data block

  const out = b.toUint8Array();
  new DataView(out.buffer).setUint16(fileSizePos, out.length & 0xffff, true);
  return out;
}
```

The layout mirrors `buildEwColorsetMtrl` (`:24-72`) exactly; only the string-block offsets, `texCount`, `textureSamplerCount`, and the second sampler descriptor differ. `0x8a4e82b6` is `ESamplerId.g_SamplerMask` (`src/mtrl/shader.ts:23`) — import it rather than hardcoding if the import does not create a cycle.

**Verify before proceeding:** round-trip the output through `parseMtrl` in a scratch script and assert `mtrl.textures.length === 2`, that the two `texturePath`s come back correct, and that `mtrl.shaderPackRaw === "character.shpk"`. A silently malformed `.mtrl` would make the pack no-op and prove nothing.

- [ ] **Step 3: Write the builder**

Create `scripts/generate-synthetics/build-synthetic-npot-mask.ts` producing **two** packs, so a divergence can be attributed:

- `npot-mask-a8.ttmp2` — mask 400×400 **A8R8G8B8**. `GetCompressionFormat` maps this to `CompressionFormat.BGRA`, so TexTools' `MergePixelData` is **lossless**; this pack isolates the Bicubic resize alone and should be byte-exact or within the documented resampler tolerance.
- `npot-mask-dxt5.ttmp2` — mask 400×400 **DXT5**. This is the one that exercises the lossy BC round-trip we elide, which the design spec §3.3 establishes **nothing in the corpus has ever tested**.

Both packs share the same shape: one option carrying three files —
- normal `.tex` at 64×64 A8R8G8B8 (power-of-two, so it never touches the resize path and the `<64` guard cannot fire),
- mask `.tex` at 400×400 in the pack's format,
- the `.mtrl` from `buildEwColorsetMaskMtrl` pointing at both.

Use a `chara/equipment/…` gamePath triple whose material path is **not** in the index-resolver table, so no index-path steal muddies the comparison. Fill both textures with a deterministic non-uniform pattern (`(i * 7 + 3) & 0xff` style) — a flat fill would make a resize difference invisible.

DXT5 block bytes for 400×400: `(400 / 4) * (400 / 4) * 16 = 160000` bytes, matching the real `v01_m0242b0001_n_c.tex` payload size exactly (160080 with the 80-byte header).

- [ ] **Step 4: Wire into `build-all.ts`**

Append `import "./build-synthetic-npot-mask";` to `scripts/generate-synthetics/build-all.ts`.

- [ ] **Step 5: Build the packs and confirm they reach the mask path**

Run: `npm run synthetics`
Expected: `wrote …/test/corpus/synthetic/npot-mask-a8.ttmp2` and `…/npot-mask-dxt5.ttmp2`.

Then confirm in a scratch script (under the scratchpad dir, not the repo) that `upgradeModpack` on each pack produces a mask at 512×512 — if the GearMaskLegacy target was not recorded, the mask comes back untouched at 400×400 and the pack proves nothing. **Do not proceed until both packs show a 512×512 mask.**

- [ ] **Step 6: Get the goldens and compare**

Run: `npm test`
Expected: ConsoleTools runs for each new pack (first-run cache miss, slow) and the `upgrade` unit either passes or reports a diff.

**This is the measurement the whole task exists for. Record, in the commit body:**
- whether `npot-mask-a8` matches byte-for-byte (expected: yes, or resampler-tolerance only);
- whether `npot-mask-dxt5` matches, and if not, the **delta histogram** — count of differing bytes, max delta, and whether the tail decays (float precision) or is systematic (a real round-trip effect).

If `npot-mask-dxt5` diverges: do **not** widen the global `.tex` ±1 tolerance. Either add a narrowly-scoped `DIVERGENCE_RULES` entry in `test/helpers/upgrade-compare.ts` whose `confirm` verifies that specific shape, or record a ratchet baseline and file a backlog item — decide from the histogram, and state the reasoning in the commit.

- [ ] **Step 7: Bless if needed, run the ritual, commit**

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
npm run check; npm run typecheck; npm test
```

```bash
git add scripts/generate-synthetics/
git commit -m "test(synthetics): NPOT-mask packs giving upgradeMaskTex a real ConsoleTools golden"
```

---

### Task 4: Expected-failure packs for the two guards

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-npot-guards.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`

**Interfaces:**
- Consumes: `writeTtmp2Files(fileName, packName, files, root)` and `buildEwColorsetMaskMtrl` from Task 3.
- Produces: nothing consumed by later tasks.

**Purpose:** these guards are behaviour Tasks 1–2 *added*, inferred from reading the C#. If the trace is wrong — a catch not found, texconv quietly coping — we would be failing packs TexTools upgrades fine, which is worse than the original bug. These packs settle it against the real oracle.

- [ ] **Step 1: Write the builder**

Create `scripts/generate-synthetics/build-synthetic-npot-guards.ts` emitting two packs into the **`upgrade-error`** root (the fourth argument added in Task 3), each the same shape as Task 3's packs but with the mask changed:

- `npot-tiny-mask.ttmp2` — mask **40×40 A8R8G8B8**. `RoundToPowerOfTwo(40)` picks 32 (`|40-32| = 8 < |64-40| = 24`), so the post-resize dims are 32×32 and `Tex.cs:656-660` fires.
- `npot-dxt3-mask.ttmp2` — mask **400×400 DXT3** (`(400/4) * (400/4) * 16 = 160000` bytes). DXT3 is absent from `GetCompressionFormat`'s switch (`Tex.cs:718-747`), so its `default:` throws.

Separate packs because either aborts the whole upgrade — one pack cannot demonstrate both.

Keep the normal texture at 64×64 A8R8G8B8 in both, so the *only* thing that can trigger a failure is the mask.

- [ ] **Step 2: Wire into `build-all.ts` and build**

Append `import "./build-synthetic-npot-guards";` to `build-all.ts`.

Run: `npm run synthetics`
Expected: both packs written into `test/corpus/upgrade-error/`.

- [ ] **Step 3: Run and confirm the oracle agrees**

Run: `npm test`

Expected: each pack's `upgrade` unit passes **because both we and ConsoleTools error**. The expected-failure check compares that both sides fail, not the messages.

**If ConsoleTools SUCCEEDS on either pack, the corresponding guard in `resizeToPow2ForMerge` is wrong.** Stop and report rather than papering over it: that means TexTools reaches these inputs by a path the trace missed, and the guard must be removed or narrowed (with the pack moved from `upgrade-error/` to `synthetic/` and blessed as a normal golden). This outcome is a success for the plan — it is exactly what these packs are for.

- [ ] **Step 4: Run the ritual and commit**

```powershell
npm run check; npm run typecheck; npm test
```

```bash
git add scripts/generate-synthetics/
git commit -m "test(synthetics): expected-failure packs pinning the MergePixelData guards"
```

---

### Task 5: Documentation and backlog closure

**Files:**
- Modify: `docs/superpowers/specs/2026-07-21-npot-texture-resize-design.md` (status header + any findings)
- Delete: `docs/backlog/2026-07-21-monster-index-tex-generation-gap.md`
- Modify: `docs/backlog/2026-07-10-imagesharp-resampler.md`
- Modify: `docs/BACKLOG.md`
- Delete: `docs/superpowers/plans/2026-07-21-npot-texture-resize.md` (this file)

- [ ] **Step 1: Grep for references before deleting the closed item**

Run: `npx rg "2026-07-21-monster-index-tex-generation-gap" -l`
Expected: `docs/BACKLOG.md` and the design spec. Per `docs/BACKLOG.md`'s own rule, every citing site must be updated in the same change — a dangling pointer to a deleted file is a plan failure. The spec's reference is historical ("Closes:") and stays.

- [ ] **Step 2: Update the spec's status header**

Change `**Status:** Design approved, not yet implemented.` to `**Status:** Implemented 2026-07-21.` followed by any corrections implementation forced — in particular the Task 3 measurement outcome for `npot-mask-dxt5` and any Task 4 surprise. Follow the shape of `2026-07-21-housing-meta-drop-design.md`'s header, which lists numbered corrections found during implementation.

- [ ] **Step 3: Close item 1 and narrow item 4**

Delete `docs/backlog/2026-07-21-monster-index-tex-generation-gap.md`.

In `docs/backlog/2026-07-10-imagesharp-resampler.md`:
- Narrow "Remaining scope" to T2's `ValidateTexFileData` NPOT resize only (`EndwalkerUpgrade.cs:2100-2113`), cross-referencing `2026-07-10-fixoldtexdata-load-round.md`.
- **Correct the falsified claim** at `:41`: "**No NPOT source exists anywhere in the ~940-pack scan**" is disproven by `Club Cyberia Motorbike.ttmp2`'s 400×400 `v01_m0242b0001_n_c.tex`. Say so explicitly — a corpus-silence claim that turned out wrong is exactly the kind of thing the backlog's "deploying changes the probability term" note warns about.
- Note that `TextureResizeUnsupported` no longer exists.

In `docs/BACKLOG.md`:
- Remove prioritized item 1 and its index entry; renumber the prioritized list.
- Update item 4's summary to the narrowed scope, and drop its "the throw is swallowed by the reproduced TexTools catch-all" framing for the index/mask paths — that swallow is gone.
- Update item 6 (the diagnostics channel): it cites `TextureResizeUnsupported` as one of the two things `unclaimed-hair.ts:197` swallows. Only genuine parse failures remain.
- Add a dated note at the top of the Prioritized section recording this pass, matching the existing `2026-07-21c` style.

- [ ] **Step 4: Delete this plan**

Per `AGENTS.md`: commit the plan when written (already done), then delete it on the branch **before** opening the PR, so the reviewed diff carries only the durable spec and the shipped work.

```bash
git rm docs/superpowers/plans/2026-07-21-npot-texture-resize.md
```

- [ ] **Step 5: Run the ritual and commit**

```powershell
npm run check; npm run typecheck; npm test
```

```bash
git add docs/
git commit -m "docs: close the monster index-tex gap, narrow the resampler item"
```
