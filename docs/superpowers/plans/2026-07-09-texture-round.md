# Texture Round (Round 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `EndwalkerUpgrade.UpgradeRemainingTextures` — generate the Dawntrail index maps, gear masks, and hair maps from the material round's `UpgradeInfo` targets — byte-exact against the ConsoleTools `/upgrade` golden, burning the 701 baselined `.tex` diffs toward zero.

**Architecture:** Two new modules. `src/tex/helpers.ts` ports the pure per-texel pixel math from `TextureHelpers.cs` (`bankersRound`, `modifyPixels`, `createIndexTexture`, `upgradeGearMask`, `createHairMaps`). `src/upgrade/texture.ts` ports the `EndwalkerUpgrade.cs` orchestration (`createIndexFromNormal`, `upgradeMaskTex`, `updateEndwalkerHairTextures`, and the `upgradeRemainingTextures` dispatch) — decoding source textures to RGBA via the existing `src/tex` codec, applying a transform, and re-encoding as uncompressed A8R8G8B8. `src/upgrade/upgrade.ts` is rewired: pass 1 collects targets into one first-wins-deduped map; pass 2 re-iterates every option and applies that map, generating a texture only where the option locally holds the source. All generation is deterministic integer math → byte-exact. The single non-deterministic step (ImageSharp resize, for NPOT sources or hair size mismatch) is NOT ported here: helpers throw a narrow sentinel and the dispatch skips that one target (a localized, ratchet-baselined gap), leaving the resampler + scoped divergence rule to a gated follow-up decided by the coverage assessment.

**Tech Stack:** TypeScript, Vitest, Biome. Existing `src/tex` codec (`parseTex`, `decodeToRgba`, `encodeUncompressedTex`), `src/sqpack` (`encodeSqPackFile`, `SqPackType`), the corpus `/upgrade` golden harness + ratchet.

## Global Constraints

- **Byte-parity is correctness.** Output must be byte-identical to ConsoleTools `/upgrade` (decompressed content) except documented divergences. (AGENTS.md)
- **Every business-logic line cites TexTools provenance** as `file · symbol · lines` in a header/comment. (AGENTS.md)
- **Split, don't blend.** `TextureHelpers.cs` logic → `src/tex/helpers.ts`; `EndwalkerUpgrade.cs` logic → `src/upgrade/texture.ts`. Never merge the two. (AGENTS.md)
- **Fail loud, never silently diverge.** Unreproduced structures throw; the only softened case is resize-unsupported, which throws a narrow sentinel caught+skipped at the dispatch boundary (documented, ratchet-visible). (AGENTS.md)
- **No per-file license headers.** Upstream origin may be cited in a brief comment; license lives in `NOTICE`/`LICENSE`. (AGENTS.md)
- **C# `Math.Round` is banker's rounding** (round-half-to-even) — port as `bankersRound`, never JS `Math.round`. (spec §4.4)
- **Formatting is mechanical** — run `npm run check`; do not hand-format. (AGENTS.md)
- **End-of-task gate:** `npm run check`, `npm run typecheck`, `npm test` all green. (AGENTS.md)

## Reference: exact C# provenance

| Concern | C# source |
|---|---|
| `ModifyPixels` | `TextureHelpers.cs:31` |
| `RemapByte` (banker's round) | `TextureHelpers.cs:216` |
| `CreateIndexTexture` | `TextureHelpers.cs:222` |
| `CreateHairMaps` | `TextureHelpers.cs:261` |
| `UpgradeGearMask` | `TextureHelpers.cs:288` |
| `CreateIndexFromNormal` | `EndwalkerUpgrade.cs:1083` |
| `UpdateEndwalkerHairTextures` | `EndwalkerUpgrade.cs:1175` |
| `UpgradeMaskTex` | `EndwalkerUpgrade.cs:2082` |
| `UpgradeRemainingTextures` dispatch | `EndwalkerUpgrade.cs:1832` |
| Two-pass orchestration + first-wins dedup | `ModpackUpgrader.cs:88`–`144` |
| Dedup keys | index=`files.index` (`:970`); hair=`files.normal` (`:1141`); gear=`files.mask_old` (`:1003`/`:1024`) |
| `DefaultTextureFormat = A8R8G8B8` | `XivCache.cs:68` |

Channel order (settled): `decodeToRgba` returns **RGBA** (matches C# `GetRawPixels`); transforms mutate RGBA in place; `encodeUncompressedTex(rgba,…)` re-packs to the tex's stored BGRA (already parity-tested in `test/tex/tex-encode.test.ts`).

---

### Task 1: Pixel-math foundation — `bankersRound` + `modifyPixels`

**Files:**
- Create: `src/tex/helpers.ts`
- Test: `test/tex/tex-helpers.test.ts`

**Interfaces:**
- Produces: `bankersRound(x: number): number` (round-half-to-even), `modifyPixels(rgba: Uint8Array, width: number, height: number, fn: (offset: number) => void): void`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/tex/tex-helpers.test.ts
import { describe, expect, it } from "vitest";
import { bankersRound, modifyPixels } from "../../src/tex/helpers";

describe("bankersRound", () => {
  it("rounds halves to even (matches C# Math.Round default)", () => {
    expect(bankersRound(0.5)).toBe(0);
    expect(bankersRound(1.5)).toBe(2);
    expect(bankersRound(2.5)).toBe(2);
    expect(bankersRound(3.5)).toBe(4);
    expect(bankersRound(-0.5)).toBe(-0);
    expect(bankersRound(-1.5)).toBe(-2);
  });
  it("rounds non-halves normally", () => {
    expect(bankersRound(120.0)).toBe(120);
    expect(bankersRound(132.98)).toBe(133);
    expect(bankersRound(2.4)).toBe(2);
  });
});

describe("modifyPixels", () => {
  it("invokes fn at every 4-byte pixel offset in row-major order", () => {
    const rgba = new Uint8Array(2 * 2 * 4);
    const offsets: number[] = [];
    modifyPixels(rgba, 2, 2, (o) => offsets.push(o));
    expect(offsets).toEqual([0, 4, 8, 12]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tex/tex-helpers.test.ts`
Expected: FAIL — `bankersRound`/`modifyPixels` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/tex/helpers.ts
// Pure per-texel pixel transforms ported from xivModdingFramework
// Textures/TextureHelpers.cs. No ImageSharp, no block compression: every
// function here is deterministic integer math, so its output is byte-exact.

/** C#'s default Math.Round is banker's rounding (round-half-to-even), unlike JS
 *  Math.round (half-up). TextureHelpers.cs:219 / CreateIndexTexture:247 rely on it. */
export function bankersRound(x: number): number {
  const r = Math.round(x);
  // Math.round rounds .5 up; correct only the exact-half case to nearest-even.
  if (Math.abs(x - Math.trunc(x)) === 0.5) {
    const floor = Math.floor(x);
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return r;
}

/** Port of TextureHelpers.ModifyPixels (TextureHelpers.cs:31): calls `fn` with the
 *  byte offset of every pixel, row-major. C# parallelizes per row; we run serially
 *  (the actions are independent and order-insensitive within our single-threaded port). */
export function modifyPixels(
  rgba: Uint8Array,
  width: number,
  height: number,
  fn: (offset: number) => void,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      fn((width * y + x) * 4);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tex/tex-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/tex/helpers.ts test/tex/tex-helpers.test.ts
git commit -m "feat(tex): bankersRound + modifyPixels (TextureHelpers.cs)"
```

---

### Task 2: `createIndexTexture`

**Files:**
- Modify: `src/tex/helpers.ts`
- Test: `test/tex/tex-helpers.test.ts`

**Interfaces:**
- Consumes: `modifyPixels`.
- Produces: `createIndexTexture(normalRgba: Uint8Array, width: number, height: number): Uint8Array` — returns a fresh RGBA index buffer.

- [ ] **Step 1: Write the failing test** (fixtures hand-derived from `CreateIndexTexture`, `TextureHelpers.cs:222`)

```typescript
// append to test/tex/tex-helpers.test.ts
import { createIndexTexture } from "../../src/tex/helpers";

describe("createIndexTexture", () => {
  // Each pixel's index output depends ONLY on the normal's alpha (byte +3).
  // Derived by hand from TextureHelpers.cs:222 (RGBA out = [newRow, newBlend, 0, 255]).
  const cases: Array<[number, [number, number, number, number]]> = [
    [0, [4, 255, 0, 255]],
    [8, [4, 135, 0, 255]],
    [17, [4, 0, 0, 255]],
    [25, [4, 0, 0, 255]], // blendRem 25>17 & <26 -> clamp to 17
    [26, [21, 255, 0, 255]], // blendRem 26 -> next row
    [34, [21, 255, 0, 255]],
    [255, [123, 0, 0, 255]],
  ];
  it.each(cases)("alpha %i -> index pixel", (alpha, expected) => {
    const normal = new Uint8Array([0, 0, 0, alpha]); // 1x1, only alpha matters
    expect(Array.from(createIndexTexture(normal, 1, 1))).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tex/tex-helpers.test.ts -t createIndexTexture`
Expected: FAIL — `createIndexTexture` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to src/tex/helpers.ts

/** Port of TextureHelpers.CreateIndexTexture (TextureHelpers.cs:222). Reads ONLY the
 *  normal's alpha channel; emits an RGBA index map [newRow, newBlend, 0, 255].
 *  (255*blendRem/17 is always an exact integer, so no rounding ambiguity here.) */
export function createIndexTexture(
  normalRgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  modifyPixels(out, width, height, (offset) => {
    const originalCset = normalRgba[offset + 3]!;
    let blendRem = originalCset % 34;
    let originalRow = Math.trunc(originalCset / 17);
    if (blendRem > 17) {
      if (blendRem < 26) {
        blendRem = 17;
      } else {
        blendRem = 0;
        originalRow++;
      }
    }
    const newBlend = 255 - Math.round((blendRem / 17.0) * 255.0);
    const newRow = (Math.trunc(originalRow / 2) * 17 + 4) & 0xff;
    out[offset + 0] = newRow;
    out[offset + 1] = newBlend;
    out[offset + 2] = 0;
    out[offset + 3] = 255;
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tex/tex-helpers.test.ts -t createIndexTexture`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/tex/helpers.ts test/tex/tex-helpers.test.ts
git commit -m "feat(tex): createIndexTexture (TextureHelpers.cs:222)"
```

---

### Task 3: `upgradeGearMask` (legacy + new)

**Files:**
- Modify: `src/tex/helpers.ts`
- Test: `test/tex/tex-helpers.test.ts`

**Interfaces:**
- Consumes: `modifyPixels`.
- Produces: `upgradeGearMask(maskRgba: Uint8Array, width: number, height: number, legacy: boolean): void` — mutates in place.

- [ ] **Step 1: Write the failing test** (hand-derived from `UpgradeGearMask`, `TextureHelpers.cs:288`)

```typescript
// append to test/tex/tex-helpers.test.ts
import { upgradeGearMask } from "../../src/tex/helpers";

describe("upgradeGearMask", () => {
  it("non-legacy: R=spec, G=255-gloss (min 1), B=ao, A unchanged", () => {
    const m = new Uint8Array([10, 0, 20, 200]); // ao=10, gloss=0, spec=20
    upgradeGearMask(m, 1, 1, false);
    expect(Array.from(m)).toEqual([20, 255, 10, 200]);
  });
  it("non-legacy: roughness floors at 1 when gloss is 255", () => {
    const m = new Uint8Array([10, 255, 20, 200]);
    upgradeGearMask(m, 1, 1, false);
    expect(Array.from(m)).toEqual([20, 1, 10, 200]);
  });
  it("legacy: roughness = gloss (no invert)", () => {
    const m = new Uint8Array([10, 50, 20, 200]);
    upgradeGearMask(m, 1, 1, true);
    expect(Array.from(m)).toEqual([20, 50, 10, 200]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tex/tex-helpers.test.ts -t upgradeGearMask`
Expected: FAIL — not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to src/tex/helpers.ts

/** Port of TextureHelpers.UpgradeGearMask (TextureHelpers.cs:288). Mutates the mask in
 *  place: R<-spec(oldB), G<-roughness, B<-ao(oldR); alpha untouched. Non-legacy inverts
 *  gloss->roughness and floors 0 at 1; legacy keeps gloss as roughness. */
export function upgradeGearMask(
  maskRgba: Uint8Array,
  width: number,
  height: number,
  legacy: boolean,
): void {
  modifyPixels(maskRgba, width, height, (offset) => {
    const ao = maskRgba[offset + 0]!;
    const gloss = maskRgba[offset + 1]!;
    const spec = maskRgba[offset + 2]!;
    let rough = gloss;
    if (!legacy) {
      rough = (255 - gloss) & 0xff;
      if (rough === 0) rough = 1;
    }
    maskRgba[offset + 0] = spec;
    maskRgba[offset + 1] = rough;
    maskRgba[offset + 2] = ao;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tex/tex-helpers.test.ts -t upgradeGearMask`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/tex/helpers.ts test/tex/tex-helpers.test.ts
git commit -m "feat(tex): upgradeGearMask legacy+new (TextureHelpers.cs:288)"
```

---

### Task 4: `createHairMaps`

**Files:**
- Modify: `src/tex/helpers.ts`
- Test: `test/tex/tex-helpers.test.ts`

**Interfaces:**
- Consumes: `modifyPixels`, `bankersRound`.
- Produces: `createHairMaps(normalRgba: Uint8Array, maskRgba: Uint8Array, width: number, height: number): void` — mutates BOTH buffers in place.

- [ ] **Step 1: Write the failing test** (hand-derived from `CreateHairMaps`, `TextureHelpers.cs:261`; note originals must be read before overwrite)

```typescript
// append to test/tex/tex-helpers.test.ts
import { createHairMaps } from "../../src/tex/helpers";

describe("createHairMaps", () => {
  it("shuffles mask channels and copies mask.A into normal.B", () => {
    const normal = new Uint8Array([10, 20, 30, 40]);
    const mask = new Uint8Array([0, 100, 200, 50]); // m0..m3
    createHairMaps(normal, mask, 1, 1);
    // normal[2] = old mask[3] = 50
    expect(Array.from(normal)).toEqual([10, 20, 50, 40]);
    // mask: [0]=oldm1=100, [1]=RemapByte(255-oldm0=255)=255, [2]=49, [3]=oldm0=0
    expect(Array.from(mask)).toEqual([100, 255, 49, 0]);
  });
  it("applies the roughness floor remap (RemapByte 0..255 -> 10..255) with banker's round", () => {
    const normal = new Uint8Array([0, 0, 0, 0]);
    const mask = new Uint8Array([155, 0, 0, 0]); // newGreen = 255-155 = 100
    createHairMaps(normal, mask, 1, 1);
    // RemapByte(100,0,255,10,255) = round(100/255*245 + 10) = round(106.078) = 106
    expect(mask[1]).toBe(106);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tex/tex-helpers.test.ts -t createHairMaps`
Expected: FAIL — not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to src/tex/helpers.ts

/** RemapByte (TextureHelpers.cs:216): linear rescale of one byte, banker's-rounded,
 *  clamped to [0,255]. */
function remapByte(
  value: number,
  oldMin: number,
  oldMax: number,
  newMin: number,
  newMax: number,
): number {
  const z =
    ((value - oldMin) / (oldMax - oldMin)) * (newMax - newMin) + newMin;
  return Math.max(Math.min(bankersRound(z), 255), 0);
}

/** Port of TextureHelpers.CreateHairMaps (TextureHelpers.cs:261). Mutates normal + mask
 *  in place. Reads original mask bytes before overwriting (C# evaluates newGreen and the
 *  normal.B copy from the pre-mutation mask). */
export function createHairMaps(
  normalRgba: Uint8Array,
  maskRgba: Uint8Array,
  width: number,
  height: number,
): void {
  modifyPixels(maskRgba, width, height, (offset) => {
    const m0 = maskRgba[offset + 0]!;
    const m1 = maskRgba[offset + 1]!;
    const m3 = maskRgba[offset + 3]!;
    const newGreen = remapByte((255 - m0) & 0xff, 0, 255, 10, 255);
    normalRgba[offset + 2] = m3; // Normal Blue <- Mask Alpha (highlight color)
    maskRgba[offset + 3] = m0; // Mask Alpha <- old Mask Red (albedo)
    maskRgba[offset + 0] = m1; // Mask Red <- old Mask Green (specular power)
    maskRgba[offset + 1] = newGreen; // Mask Green <- roughness
    maskRgba[offset + 2] = 49; // Mask Blue <- SSS thickness constant
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tex/tex-helpers.test.ts -t createHairMaps`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/tex/helpers.ts test/tex/tex-helpers.test.ts
git commit -m "feat(tex): createHairMaps + remapByte (TextureHelpers.cs:261)"
```

---

### Task 5: `createIndexFromNormal` + resize sentinel

**Files:**
- Create: `src/upgrade/texture.ts`
- Test: `test/upgrade/texture.test.ts`

**Interfaces:**
- Consumes: `parseTex`, `decodeToRgba`, `encodeUncompressedTex` (from `src/tex`); `createIndexTexture` (Task 2).
- Produces: `class TextureResizeUnsupported extends Error`; `createIndexFromNormal(normalTexBytes: Uint8Array): Uint8Array` — returns the uncompressed index `.tex` bytes; throws `TextureResizeUnsupported` when the normal is NPOT.

- [ ] **Step 1: Write the failing test**

```typescript
// test/upgrade/texture.test.ts
import { describe, expect, it } from "vitest";
import { decodeToRgba, encodeUncompressedTex, parseTex } from "../../src/tex/tex";
import { createIndexTexture } from "../../src/tex/helpers";
import {
  createIndexFromNormal,
  TextureResizeUnsupported,
} from "../../src/upgrade/texture";

function a8r8g8b8Tex(width: number, height: number, rgba: Uint8Array): Uint8Array {
  return encodeUncompressedTex(rgba, width, height, { mips: false });
}

describe("createIndexFromNormal", () => {
  it("produces an A8R8G8B8 index tex whose pixels match createIndexTexture", () => {
    const w = 2, h = 2;
    // Alpha values 0/17/34/255; RGB arbitrary.
    const rgba = new Uint8Array([
      1, 2, 3, 0, 4, 5, 6, 17, 7, 8, 9, 34, 10, 11, 12, 255,
    ]);
    const idxTex = createIndexFromNormal(a8r8g8b8Tex(w, h, rgba));
    const parsed = parseTex(idxTex);
    expect(parsed.width).toBe(w);
    expect(parsed.height).toBe(h);
    const got = decodeToRgba(parsed);
    const expected = createIndexTexture(rgba, w, h);
    expect(Array.from(got)).toEqual(Array.from(expected));
  });

  it("throws TextureResizeUnsupported for a non-power-of-two normal", () => {
    const rgba = new Uint8Array(3 * 2 * 4);
    expect(() => createIndexFromNormal(a8r8g8b8Tex(3, 2, rgba))).toThrow(
      TextureResizeUnsupported,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/texture.test.ts`
Expected: FAIL — module `src/upgrade/texture` not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/upgrade/texture.ts
// Port of the texture-generation orchestration from xivModdingFramework
// Mods/EndwalkerUpgrade.cs (UpgradeRemainingTextures and its helpers). Pixel math
// lives in src/tex/helpers.ts (TextureHelpers.cs); this module only decodes source
// textures, applies a transform, and re-encodes as uncompressed A8R8G8B8
// (DefaultTextureFormat = A8R8G8B8, XivCache.cs:68).

import { createIndexTexture } from "../tex/helpers";
import { decodeToRgba, encodeUncompressedTex, parseTex } from "../tex/tex";

/** Thrown when a source texture would require an ImageSharp resize (NPOT normalize or
 *  hair normal/mask size mismatch) that this round does not yet port. Caught+skipped at
 *  the dispatch boundary so one un-generatable target degrades to a ratchet-baselined
 *  diff rather than crashing the whole pack. See spec §4.4/§5. */
export class TextureResizeUnsupported extends Error {}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** Port of CreateIndexFromNormal (EndwalkerUpgrade.cs:1083). Decodes the normal, builds
 *  the index map from its alpha, re-encodes A8R8G8B8 with mips. NPOT normals need a
 *  Bicubic resize (:1098) we don't port -> throw the resize sentinel. */
export function createIndexFromNormal(normalTexBytes: Uint8Array): Uint8Array {
  const tex = parseTex(normalTexBytes);
  if (!isPowerOfTwo(tex.width) || !isPowerOfTwo(tex.height)) {
    throw new TextureResizeUnsupported(
      `index: NPOT normal ${tex.width}x${tex.height} needs a resize (EndwalkerUpgrade.cs:1098)`,
    );
  }
  const normalRgba = decodeToRgba(tex);
  const indexRgba = createIndexTexture(normalRgba, tex.width, tex.height);
  return encodeUncompressedTex(indexRgba, tex.width, tex.height, { mips: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade/texture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/upgrade/texture.ts test/upgrade/texture.test.ts
git commit -m "feat(upgrade): createIndexFromNormal + resize sentinel (EndwalkerUpgrade.cs:1083)"
```

---

### Task 6: `upgradeMaskTex`

**Files:**
- Modify: `src/upgrade/texture.ts`
- Test: `test/upgrade/texture.test.ts`

**Interfaces:**
- Consumes: `parseTex`, `decodeToRgba`, `encodeUncompressedTex`; `upgradeGearMask` (Task 3); `isPowerOfTwo`, `TextureResizeUnsupported` (Task 5).
- Produces: `upgradeMaskTex(maskTexBytes: Uint8Array, legacy: boolean): Uint8Array` — returns the upgraded uncompressed mask `.tex` bytes; throws `TextureResizeUnsupported` for NPOT masks.

- [ ] **Step 1: Write the failing test**

```typescript
// append to test/upgrade/texture.test.ts
import { upgradeGearMask } from "../../src/tex/helpers";
import { upgradeMaskTex } from "../../src/upgrade/texture";

describe("upgradeMaskTex", () => {
  it("upgrades a pow2 mask (non-legacy) byte-exact vs upgradeGearMask", () => {
    const w = 2, h = 2;
    const rgba = new Uint8Array([
      10, 0, 20, 200, 30, 255, 40, 100, 5, 60, 70, 255, 1, 2, 3, 4,
    ]);
    const out = upgradeMaskTex(a8r8g8b8Tex(w, h, rgba), false);
    const got = decodeToRgba(parseTex(out));
    const expected = rgba.slice();
    upgradeGearMask(expected, w, h, false);
    expect(Array.from(got)).toEqual(Array.from(expected));
  });
  it("throws TextureResizeUnsupported for a NPOT mask", () => {
    const rgba = new Uint8Array(6 * 4 * 4);
    expect(() => upgradeMaskTex(a8r8g8b8Tex(6, 4, rgba), true)).toThrow(
      TextureResizeUnsupported,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/texture.test.ts -t upgradeMaskTex`
Expected: FAIL — `upgradeMaskTex` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to src/upgrade/texture.ts (add upgradeGearMask to the helpers import)

/** Port of UpgradeMaskTex (EndwalkerUpgrade.cs:2082). Decodes the mask, applies the
 *  gear-mask channel remap, re-encodes A8R8G8B8 with mips. NPOT masks resize (:2088) ->
 *  throw the resize sentinel. */
export function upgradeMaskTex(
  maskTexBytes: Uint8Array,
  legacy: boolean,
): Uint8Array {
  const tex = parseTex(maskTexBytes);
  if (!isPowerOfTwo(tex.width) || !isPowerOfTwo(tex.height)) {
    throw new TextureResizeUnsupported(
      `gearmask: NPOT mask ${tex.width}x${tex.height} needs a resize (EndwalkerUpgrade.cs:2088)`,
    );
  }
  const rgba = decodeToRgba(tex);
  upgradeGearMask(rgba, tex.width, tex.height, legacy);
  return encodeUncompressedTex(rgba, tex.width, tex.height, { mips: true });
}
```

Update the import line at the top of `src/upgrade/texture.ts`:

```typescript
import { createIndexTexture, upgradeGearMask } from "../tex/helpers";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade/texture.test.ts -t upgradeMaskTex`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/upgrade/texture.ts test/upgrade/texture.test.ts
git commit -m "feat(upgrade): upgradeMaskTex (EndwalkerUpgrade.cs:2082)"
```

---

### Task 7: `updateEndwalkerHairTextures`

**Files:**
- Modify: `src/upgrade/texture.ts`
- Test: `test/upgrade/texture.test.ts`

**Interfaces:**
- Consumes: `parseTex`, `decodeToRgba`, `encodeUncompressedTex`; `createHairMaps` (Task 4); `isPowerOfTwo`, `TextureResizeUnsupported`.
- Produces: `updateEndwalkerHairTextures(normalTexBytes: Uint8Array, maskTexBytes: Uint8Array): { normal: Uint8Array; mask: Uint8Array }` — the two regenerated uncompressed `.tex` blobs; throws `TextureResizeUnsupported` when either is NPOT or the two differ in size.

- [ ] **Step 1: Write the failing test**

```typescript
// append to test/upgrade/texture.test.ts
import { createHairMaps } from "../../src/tex/helpers";
import { updateEndwalkerHairTextures } from "../../src/upgrade/texture";

describe("updateEndwalkerHairTextures", () => {
  it("regenerates normal+mask byte-exact vs createHairMaps (equal pow2 sizes)", () => {
    const w = 2, h = 2;
    const nRgba = new Uint8Array([
      10, 20, 30, 40, 11, 21, 31, 41, 12, 22, 32, 42, 13, 23, 33, 43,
    ]);
    const mRgba = new Uint8Array([
      0, 100, 200, 50, 1, 101, 201, 51, 2, 102, 202, 52, 3, 103, 203, 53,
    ]);
    const res = updateEndwalkerHairTextures(
      a8r8g8b8Tex(w, h, nRgba),
      a8r8g8b8Tex(w, h, mRgba),
    );
    const expN = nRgba.slice();
    const expM = mRgba.slice();
    createHairMaps(expN, expM, w, h);
    expect(Array.from(decodeToRgba(parseTex(res.normal)))).toEqual(Array.from(expN));
    expect(Array.from(decodeToRgba(parseTex(res.mask)))).toEqual(Array.from(expM));
  });
  it("throws TextureResizeUnsupported when normal and mask differ in size", () => {
    const n = a8r8g8b8Tex(4, 4, new Uint8Array(4 * 4 * 4));
    const m = a8r8g8b8Tex(2, 2, new Uint8Array(2 * 2 * 4));
    expect(() => updateEndwalkerHairTextures(n, m)).toThrow(TextureResizeUnsupported);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/texture.test.ts -t updateEndwalkerHairTextures`
Expected: FAIL — not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to src/upgrade/texture.ts (add createHairMaps to the helpers import)

/** Port of UpdateEndwalkerHairTextures (EndwalkerUpgrade.cs:1175). Decodes normal + mask,
 *  applies CreateHairMaps, re-encodes both A8R8G8B8 with mips. C# resizes each to pow2
 *  (:1195) then to their common max size (ResizeImages, :1205, Bicubic); we do not port
 *  that resampler, so any NPOT input or size mismatch throws the resize sentinel. When
 *  sizes already match and are pow2 (the common case), ResizeImages is a no-op (early
 *  return, TextureHelpers.cs:368) and the result is byte-exact. */
export function updateEndwalkerHairTextures(
  normalTexBytes: Uint8Array,
  maskTexBytes: Uint8Array,
): { normal: Uint8Array; mask: Uint8Array } {
  const nTex = parseTex(normalTexBytes);
  const mTex = parseTex(maskTexBytes);
  for (const t of [nTex, mTex]) {
    if (!isPowerOfTwo(t.width) || !isPowerOfTwo(t.height)) {
      throw new TextureResizeUnsupported(
        `hair: NPOT texture ${t.width}x${t.height} needs a resize (EndwalkerUpgrade.cs:1195)`,
      );
    }
  }
  if (nTex.width !== mTex.width || nTex.height !== mTex.height) {
    throw new TextureResizeUnsupported(
      `hair: normal ${nTex.width}x${nTex.height} != mask ${mTex.width}x${mTex.height} needs a resize (EndwalkerUpgrade.cs:1205)`,
    );
  }
  const nRgba = decodeToRgba(nTex);
  const mRgba = decodeToRgba(mTex);
  createHairMaps(nRgba, mRgba, nTex.width, nTex.height);
  return {
    normal: encodeUncompressedTex(nRgba, nTex.width, nTex.height, { mips: true }),
    mask: encodeUncompressedTex(mRgba, mTex.width, mTex.height, { mips: true }),
  };
}
```

Update the helpers import line to:

```typescript
import { createHairMaps, createIndexTexture, upgradeGearMask } from "../tex/helpers";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade/texture.test.ts -t updateEndwalkerHairTextures`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/upgrade/texture.ts test/upgrade/texture.test.ts
git commit -m "feat(upgrade): updateEndwalkerHairTextures (EndwalkerUpgrade.cs:1175)"
```

---

### Task 8: `upgradeRemainingTextures` dispatch

**Files:**
- Modify: `src/upgrade/texture.ts`
- Test: `test/upgrade/texture.test.ts`

**Interfaces:**
- Consumes: `createIndexFromNormal`, `upgradeMaskTex`, `updateEndwalkerHairTextures`, `TextureResizeUnsupported`; `EUpgradeTextureUsage`, `UpgradeInfo` (`src/upgrade/upgrade-info.ts`); `ModpackOption`, `ModpackFile`, `FileStorageType` (`src/model/modpack`); `encodeSqPackFile`, `SqPackType` (`src/sqpack/sqpack`); `uncompressedBytes` (`src/upgrade/upgrade.ts`).
- Produces: `upgradeRemainingTextures(option: ModpackOption, targets: Map<string, UpgradeInfo>): void` — mutates `option.files`, adding/replacing generated `.tex` entries for every target whose source(s) the option holds. Hair with exactly one of normal/mask present throws (ports `:1862`); a `TextureResizeUnsupported` from any generator is caught and that target skipped.

- [ ] **Step 1: Write the failing test**

```typescript
// append to test/upgrade/texture.test.ts
import { FileStorageType, type ModpackOption } from "../../src/model/modpack";
import { EUpgradeTextureUsage, type UpgradeInfo } from "../../src/upgrade/upgrade-info";
import { upgradeRemainingTextures } from "../../src/upgrade/texture";

function option(files: Array<{ gamePath: string; data: Uint8Array }>): ModpackOption {
  return {
    name: "O", description: "", image: "", priority: 0,
    fileSwaps: {}, manipulations: [],
    files: files.map((f) => ({
      gamePath: f.gamePath,
      data: f.data,
      storage: FileStorageType.RawUncompressed,
    })),
  };
}

describe("upgradeRemainingTextures", () => {
  it("generates the index tex into the option holding the normal", () => {
    const w = 2, h = 2;
    const normalPath = "chara/x/tex/foo_n.tex";
    const indexPath = "chara/x/tex/foo_id.tex";
    const rgba = new Uint8Array([1, 2, 3, 0, 4, 5, 6, 17, 7, 8, 9, 34, 10, 11, 12, 255]);
    const o = option([{ gamePath: normalPath, data: a8r8g8b8Tex(w, h, rgba) }]);
    const targets = new Map<string, UpgradeInfo>([
      [indexPath, { usage: EUpgradeTextureUsage.IndexMaps, files: { normal: normalPath, index: indexPath } }],
    ]);
    upgradeRemainingTextures(o, targets);
    const idxFile = o.files.find((f) => f.gamePath === indexPath);
    expect(idxFile).toBeDefined();
    const got = decodeToRgba(parseTex(idxFile!.data));
    expect(Array.from(got)).toEqual(Array.from(createIndexTexture(rgba, w, h)));
  });

  it("no-ops a target whose source is absent from the option", () => {
    const o = option([{ gamePath: "chara/x/tex/other.tex", data: a8r8g8b8Tex(2, 2, new Uint8Array(16)) }]);
    const targets = new Map<string, UpgradeInfo>([
      ["chara/x/tex/foo_id.tex", { usage: EUpgradeTextureUsage.IndexMaps, files: { normal: "chara/x/tex/foo_n.tex", index: "chara/x/tex/foo_id.tex" } }],
    ]);
    upgradeRemainingTextures(o, targets);
    expect(o.files.some((f) => f.gamePath === "chara/x/tex/foo_id.tex")).toBe(false);
  });

  it("throws when hair has the normal but not the mask", () => {
    const o = option([{ gamePath: "n.tex", data: a8r8g8b8Tex(2, 2, new Uint8Array(16)) }]);
    const targets = new Map<string, UpgradeInfo>([
      ["n.tex", { usage: EUpgradeTextureUsage.HairMaps, files: { normal: "n.tex", mask: "m.tex" } }],
    ]);
    expect(() => upgradeRemainingTextures(o, targets)).toThrow(/Normal and Mask/);
  });

  it("skips (no throw) a target whose normal is NPOT", () => {
    const normalPath = "chara/x/tex/npot_n.tex";
    const indexPath = "chara/x/tex/npot_id.tex";
    const o = option([{ gamePath: normalPath, data: a8r8g8b8Tex(3, 2, new Uint8Array(3 * 2 * 4)) }]);
    const targets = new Map<string, UpgradeInfo>([
      [indexPath, { usage: EUpgradeTextureUsage.IndexMaps, files: { normal: normalPath, index: indexPath } }],
    ]);
    expect(() => upgradeRemainingTextures(o, targets)).not.toThrow();
    expect(o.files.some((f) => f.gamePath === indexPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/texture.test.ts -t upgradeRemainingTextures`
Expected: FAIL — `upgradeRemainingTextures` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to src/upgrade/texture.ts

import {
  FileStorageType,
  type ModpackFile,
  type ModpackOption,
} from "../model/modpack";
import { encodeSqPackFile, SqPackType } from "../sqpack/sqpack";
import { EUpgradeTextureUsage, type UpgradeInfo } from "./upgrade-info";
import { uncompressedBytes } from "./upgrade";

function findFile(option: ModpackOption, gamePath: string): ModpackFile | undefined {
  return option.files.find((f) => f.gamePath === gamePath);
}

/** Writes a generated uncompressed .tex into the option, mirroring the storage form of a
 *  reference source file in the same option (a ttmp source is SqPackCompressed -> encode a
 *  Type-4 Texture entry; a pmp source is RawUncompressed -> store raw). Replaces any
 *  existing entry at that path. */
function writeGeneratedTex(
  option: ModpackOption,
  gamePath: string,
  texBytes: Uint8Array,
  reference: ModpackFile,
): void {
  const file: ModpackFile =
    reference.storage === FileStorageType.SqPackCompressed
      ? { gamePath, storage: FileStorageType.SqPackCompressed, data: encodeSqPackFile(texBytes, SqPackType.Texture) }
      : { gamePath, storage: FileStorageType.RawUncompressed, data: texBytes };
  const existing = option.files.findIndex((f) => f.gamePath === gamePath);
  if (existing >= 0) option.files[existing] = file;
  else option.files.push(file);
}

/** Port of UpgradeRemainingTextures (EndwalkerUpgrade.cs:1832). For each target, generate
 *  its texture(s) only if the option locally holds the required source(s); a resize-
 *  unsupported target is skipped (baselined diff), everything else stays fail-loud. */
export function upgradeRemainingTextures(
  option: ModpackOption,
  targets: Map<string, UpgradeInfo>,
): void {
  for (const info of targets.values()) {
    try {
      if (info.usage === EUpgradeTextureUsage.IndexMaps) {
        const normal = findFile(option, info.files.normal!);
        if (!normal) continue;
        const idx = createIndexFromNormal(uncompressedBytes(normal).bytes);
        writeGeneratedTex(option, info.files.index!, idx, normal);
      } else if (info.usage === EUpgradeTextureUsage.HairMaps) {
        const normal = findFile(option, info.files.normal!);
        const mask = findFile(option, info.files.mask!);
        if (normal && mask) {
          const res = updateEndwalkerHairTextures(
            uncompressedBytes(normal).bytes,
            uncompressedBytes(mask).bytes,
          );
          writeGeneratedTex(option, info.files.normal!, res.normal, normal);
          writeGeneratedTex(option, info.files.mask!, res.mask, mask);
        } else if (normal || mask) {
          throw new Error(
            `hair: Normal and Mask must be in the same option (EndwalkerUpgrade.cs:1862): ${info.files.normal} / ${info.files.mask}`,
          );
        }
      } else {
        // GearMaskNew / GearMaskLegacy
        const old = findFile(option, info.files.mask_old!);
        if (!old) continue;
        const legacy = info.usage === EUpgradeTextureUsage.GearMaskLegacy;
        const data = upgradeMaskTex(uncompressedBytes(old).bytes, legacy);
        writeGeneratedTex(option, info.files.mask_new!, data, old);
      }
    } catch (e) {
      if (e instanceof TextureResizeUnsupported) continue; // localized baselined gap
      throw e;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade/texture.test.ts -t upgradeRemainingTextures`
Expected: PASS. Then run the whole file: `npx vitest run test/upgrade/texture.test.ts` — all PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/upgrade/texture.ts test/upgrade/texture.test.ts
git commit -m "feat(upgrade): upgradeRemainingTextures dispatch (EndwalkerUpgrade.cs:1832)"
```

---

### Task 9: Wire the two-pass pipeline into `upgrade.ts`

**Files:**
- Modify: `src/upgrade/upgrade.ts:140-167`
- Test: `test/upgrade/upgrade.test.ts`

**Interfaces:**
- Consumes: `upgradeRemainingTextures` (Task 8), `EUpgradeTextureUsage`, `UpgradeInfo`.
- Produces: `upgradeModpack` now runs pass 1 (model+material, collecting a first-wins target map) then pass 2 (`upgradeRemainingTextures` per option). Removes the `textureRound`/`partials` stubs' texture responsibility (keep `partials` stub for round 6).

- [ ] **Step 1: Write the failing test** (end-to-end: an option with a colorset mtrl + its normal → the index `.tex` is generated)

```typescript
// append to test/upgrade/upgrade.test.ts
import { describe as d2, expect as e2, it as i2 } from "vitest";
import { encodeUncompressedTex, decodeToRgba, parseTex } from "../../src/tex/tex";
import { createIndexTexture } from "../../src/tex/helpers";
import { FileStorageType, ModpackFormat, type ModpackData } from "../../src/model/modpack";
import { serializeMtrl } from "../../src/mtrl/mtrl";
// Build a minimal EW colorset mtrl whose normal sampler points at foo_n.tex, plus the
// normal .tex, in one option. After upgradeModpack, foo_id.tex must exist and match.
```

Then add the test body using the existing `characterColorsetMtrl`-style helpers already in `test/upgrade/material.test.ts` (import the mtrl builder pattern; construct the `.mtrl` bytes via `serializeMtrl`, and the normal via `encodeUncompressedTex(rgba, 2, 2, {mips:false})`). Assert:

```typescript
d2("upgradeModpack texture round (e2e)", () => {
  i2("generates the index tex for a colorset mtrl's normal", () => {
    const w = 2, h = 2;
    const rgba = new Uint8Array([1, 2, 3, 0, 4, 5, 6, 17, 7, 8, 9, 34, 10, 11, 12, 255]);
    const data: ModpackData = buildColorsetPack("chara/x/tex/foo_n.tex", encodeUncompressedTex(rgba, w, h, { mips: false }));
    const out = upgradeModpack(data);
    const files = out.groups[0]!.options[0]!.files;
    const idx = files.find((f) => f.gamePath === "chara/x/tex/foo_id.tex");
    e2(idx).toBeDefined();
    e2(Array.from(decodeToRgba(parseTex(idx!.data)))).toEqual(
      Array.from(createIndexTexture(rgba, w, h)),
    );
  });
});
```

Where `buildColorsetPack(normalPath, normalTexBytes)` constructs a `ModpackData` with one group/option containing (a) a character colorset `.mtrl` (serialized, `RawUncompressed`) whose normal sampler path is `normalPath`, and (b) the normal `.tex` at `normalPath`. Model it on `sampleData()` already in this file and the mtrl builder in `test/upgrade/material.test.ts`. Use `FileStorageType.RawUncompressed` so no SqPack round-trip is needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/upgrade.test.ts -t "texture round"`
Expected: FAIL — index file absent (stub still a no-op).

- [ ] **Step 3: Write minimal implementation**

Replace the stub `textureRound`/wiring in `src/upgrade/upgrade.ts`. Update the imports and the round functions:

```typescript
// add to imports
import { upgradeRemainingTextures } from "./texture";
import { EUpgradeTextureUsage, type UpgradeInfo } from "./upgrade-info";

// first-wins dedup key, mirroring the C# dict keys:
//   index -> files.index (EndwalkerUpgrade.cs:970)
//   hair  -> files.normal (EndwalkerUpgrade.cs:1141)
//   gear  -> files.mask_old (EndwalkerUpgrade.cs:1003/1024)
function targetKey(info: UpgradeInfo): string {
  if (info.usage === EUpgradeTextureUsage.IndexMaps) return info.files.index!;
  if (info.usage === EUpgradeTextureUsage.HairMaps) return info.files.normal!;
  return info.files.mask_old!;
}
```

Delete the `textureRound` stub. Rewrite `upgradeModpack`:

```typescript
export function upgradeModpack(data: ModpackData): ModpackData {
  const out = cloneModpack(data);
  const gate = needsMdlFix(data);
  // Pass 1 (ModpackUpgrader.cs:88-120): model + material per option; collect
  // texture-upgrade targets into a single first-wins-deduped map.
  const targets = new Map<string, UpgradeInfo>();
  for (const group of out.groups) {
    for (const option of group.options) {
      modelRound(option, gate);
      for (const info of materialRound(option)) {
        const k = targetKey(info);
        if (!targets.has(k)) targets.set(k, info);
      }
    }
  }
  // Pass 2 (ModpackUpgrader.cs:124-144): apply the global targets to every option.
  for (const group of out.groups) {
    for (const option of group.options) {
      upgradeRemainingTextures(option, targets);
    }
  }
  partials();
  return out;
}
```

Keep the `partials()` stub (round 6). Remove the now-unused `UpgradeInfo` import only if no longer referenced (it is, via `targetKey`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade/upgrade.test.ts`
Expected: PASS (existing pipeline tests + the new e2e test).

- [ ] **Step 5: Commit**

```powershell
git add src/upgrade/upgrade.ts test/upgrade/upgrade.test.ts
git commit -m "feat(upgrade): two-pass texture pipeline wiring (ModpackUpgrader.cs:88-144)"
```

---

### Task 10: Corpus golden burndown (bless the ratchet)

**Files:**
- Modify (gitignored, local only): `test/corpus/.upgrade-baseline/`

**Interfaces:** none (harness-driven).

- [ ] **Step 1: Run the full suite to see current `.tex` deltas**

Run: `npm test`
Expected: the `upgrade` corpus checks report `.tex` diffs shrinking vs the recorded baseline for packs whose textures are now generated (pow2 sources). Packs whose diff is now a strict subset of baseline PASS; any pack whose generated `.tex` does NOT match the golden FAILS — investigate before blessing (a real bug or an NPOT/resize case that should have skipped).

- [ ] **Step 2: Inspect any failures**

For each failing pack, list the mismatching `.tex` and confirm the cause is a resize case (NPOT source or hair size mismatch → should have skipped, i.e. file absent → baselined missing-file diff) and NOT a wrong-bytes generation. If wrong bytes: STOP, fix the transform (do not bless over a real divergence).

- [ ] **Step 3: Re-bless the baseline once all diffs are intended**

Run:
```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```
Expected: baselines rewritten; the `.tex` diff count drops sharply from 701.

- [ ] **Step 4: Confirm green**

Run: `npm test`
Expected: all PASS against the refreshed baseline.

- [ ] **Step 5: Commit** (no tracked files change; record the burndown in the roadmap in Task 13). Skip the commit here — the baseline is gitignored.

---

### Task 11: Coverage assessment

**Files:**
- Create: `docs/superpowers/plans/2026-07-09-texture-round-coverage.md` (working notes; delete or fold into roadmap at Task 13)

**Interfaces:** none (analysis).

- [ ] **Step 1: Instrument the corpus run to tally usages + resize skips**

Add a temporary counter in `upgradeRemainingTextures` (or a test-only harness hook) that records, per generated/skipped target: usage, whether it generated or hit `TextureResizeUnsupported`, and the source dimensions. Run `npm test` (or a focused corpus script) and capture the tallies. Remove the instrumentation afterward (do not commit it).

- [ ] **Step 2: Record findings**

Write to the coverage notes: for each of the four usages — how many corpus targets exercised it, how many generated byte-exact, how many skipped as resize-unsupported (with the NPOT/mismatch dimensions). Explicitly note which usages have ZERO corpus coverage.

- [ ] **Step 3: Decide the resize follow-up**

Based on the skip tally: if **zero** resize skips, the round reaches byte-zero on `.tex` (minus intended gaps) with no resampler needed — record that. If **nonzero**, list the exact resize-triggering gamePaths + dimensions; these become the concrete inputs for the resampler + scoped divergence-rule follow-up (Task 13 decides plan vs BACKLOG).

- [ ] **Step 4: Flag thin usages for real-mod sourcing — collaborate with the maintainer**

Real corpus mods are preferred over synthetics (AGENTS.md "prefer a real golden"): they reuse the ConsoleTools oracle and exercise real-world variety — third-party encoders, odd/NPOT dimensions, unusual sampler + shader-key combinations, and channel content a hand-authored pack would never think to include. This is value synthetics structurally lack, so it is worth a real sourcing effort, not just a fallback.

Sourcing real mods is a **maintainer action** (the operator downloads mods into the gitignored `test/corpus/real/`), so **pause here and work with the operator**: from the Task 11 findings, write a short "wanted" list naming, per thin/zero-covered usage, the exact mod characteristics that would exercise it — e.g. a Dawntrail-eligible **hair** mod with normal+mask textures; a **CharacterGlass** gear mod (glass gear-mask path, 2 packs today); a character-**legacy** gear mod with a mask sampler; and (if Step 3 found resize cases) a mod with **NPOT or mismatched-size** hair/gear textures to exercise the eventual resampler. Present this list to the operator and give them the chance to supply real packs before deciding what must be synthesized. Record which gaps the operator can fill with real mods vs which fall to Task 12 synthetics.

- [ ] **Step 5: Commit the notes**

```powershell
git add docs/superpowers/plans/2026-07-09-texture-round-coverage.md
git commit -m "docs(plan): texture-round corpus coverage assessment + real-mod wanted list"
```

---

### Task 12: Close coverage gaps — real packs first, synthetics for the remainder

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-textures.mjs`
- (Built `.pmp` output is gitignored, regenerated by the script — like `build-synthetic-f1.mjs`.)
- (Any real packs the operator supplies land in the gitignored `test/corpus/real/` — not committed.)

**Interfaces:** adds coverage for under-exercised usages via real packs (preferred) and/or a synthetic pack under `test/corpus/synthetic/`, both flowing through the `/upgrade` golden harness.

- [ ] **Step 1: Real data first — collaborate with the operator**

Using the Task 11 Step 4 "wanted" list, **work with the operator to add real packs** to `test/corpus/real/` for the thin/zero-covered usages. For each real pack added, run `npm test`: it spawns a ConsoleTools golden and, having no baseline, must **fully match** (byte-exact) — real-world proof the transform is right. Record which usages are now covered by real data; only the usages the operator cannot source a real mod for proceed to synthesis below. If the operator wants to defer real sourcing, note the still-thin usages and continue with synthetics (real packs can be added later without code change — the harness picks them up).

- [ ] **Step 2: Identify the remaining gaps to synthesize**

For the usages NOT covered by a real pack in Step 1, author synthetics. Each synthetic must use **power-of-two, equal-size** source textures so it is byte-exact (no resize). Do NOT synthesize an NPOT/resize case here — that belongs to the resampler follow-up.

- [ ] **Step 3: Write the builder script**

Model on `scripts/generate-synthetics/build-synthetic-f1.mjs`. The script authors a minimal `.pmp` containing, per targeted usage, a source `.mtrl` (that the material round upgrades into the corresponding `UpgradeInfo`) plus its pow2 source texture(s):
- hair: a `SHPK_HAIR` mtrl with normal+mask samplers + two equal pow2 `.tex`.
- gear mask (legacy): a character-legacy colorset mtrl with a mask sampler + pow2 mask `.tex`.
- gear mask (new): a character-glass colorset mtrl with a mask sampler + pow2 mask `.tex`.

Cite the C# provenance for the constructed mtrl shapes in the script header (reuse the sampler/shader constants already in `src/upgrade/reference/`).

- [ ] **Step 4: Build the pack and run the harness**

Run:
```powershell
node scripts/generate-synthetics/build-synthetic-textures.mjs
npm test
```
Expected: the new synthetic pack spawns a ConsoleTools golden on first run, then the `upgrade` check compares. It has no baseline, so it must **fully match** (byte-exact) — the generated hair/gear `.tex` equal the golden.

- [ ] **Step 5: If it does not fully match, diagnose**

A mismatch is either a real transform bug (fix it) or an unexpected resize (the synthetic sizes are wrong — make them equal pow2). Do not baseline a synthetic; it must be byte-exact.

- [ ] **Step 6: Commit the builder**

```powershell
git add scripts/generate-synthetics/build-synthetic-textures.mjs
git commit -m "test(synthetic): pow2 hair + gear-mask packs for texture-round coverage"
```

---

### Task 13: Resize decision, roadmap + backlog update, final gate

**Files:**
- Modify: `docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md` (§8.1 status, §8.3 burndown)
- Modify: `BACKLOG.md`
- Delete: `docs/superpowers/plans/2026-07-09-texture-round.md` and `...-coverage.md` (plans are transient — AGENTS.md)

**Interfaces:** none.

- [ ] **Step 1: Resolve the resize follow-up**

If Task 11 found **zero** resize skips: note in the roadmap that the `.tex` baseline is byte-zero and the resampler is unneeded on the current corpus; add a BACKLOG entry ("resampler + scoped divergence rule — deferred, no corpus coverage; needed only if a future NPOT/mismatched pack appears", citing spec §4.4/§5). If **nonzero**: add a prioritized BACKLOG entry listing the resize-triggering gamePaths/dimensions and pointing at the ImageSharp Bicubic/NearestNeighbor port + the scoped per-pixel-threshold `DIVERGENCE_RULES` entry (spec §5) as its own spec→plan cycle.

- [ ] **Step 2: Update the roadmap burndown**

In §8.1 mark round 4 status (e.g. `.tex 701 → <new count>`); in §8.3 update the total non-matching diff count. Note the U4 backlog item is resolved (textureRound no longer a no-op).

- [ ] **Step 3: Update `BACKLOG.md`**

Remove the "Texture round (round 2)" Prioritized entry (done); update or resolve **U4** (fail-loud on pending texture upgrades — now moot). Add the resize follow-up entry from Step 1.

- [ ] **Step 4: Run the full end-of-task gate**

Run:
```powershell
npm run check
npm run typecheck
npm test
```
Expected: all green.

- [ ] **Step 5: Delete the transient plans and commit**

```powershell
git rm docs/superpowers/plans/2026-07-09-texture-round.md docs/superpowers/plans/2026-07-09-texture-round-coverage.md
git add docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md BACKLOG.md
git commit -m "docs: texture round shipped — roadmap burndown, backlog, resize follow-up"
```

---

## Self-Review

**Spec coverage:**
- §1 scope (four usages) → Tasks 2/3/4 (transforms), 5/6/7 (generators), 8 (dispatch). ✓
- §2 two-pass structure + first-wins dedup → Task 9. ✓
- §3 module decomposition (helpers.ts / texture.ts, reuse decode/encode) → Tasks 1-8. ✓
- §4 per-usage generation + banker's rounding + resize trap → Tasks 1-7. ✓
- §5 scoped divergence rule → Task 13 (gated on Task 11 findings; rule only if resize cases exist). ✓
- §6 golden-first + coverage assessment + real-mods-first-then-synthetics + unit tests → Tasks 10, 11 (incl. Step 4 real-mod "wanted" list, operator collaboration), 12 (real packs first, synthetics for the remainder), plus unit tests throughout. ✓
- §7 fail-loud boundaries (hair one-but-not-both throw; resize skip) → Task 8; investigations (gear key, UpgradeMaskTex resize) resolved in this plan's Reference table. ✓
- §8 success criteria → Task 13 gate. ✓

**Placeholder scan:** All code steps contain complete code. Task 9 Step 1 and Task 12 Step 2 describe builder helpers by construction rather than full literal source because they assemble existing, already-cited builders (`sampleData`, `characterColorsetMtrl`, `build-synthetic-f1.mjs`); the assertions and structure are concrete. No "TBD"/"add error handling"/"similar to Task N".

**Type consistency:** `TextureResizeUnsupported`, `createIndexFromNormal`, `upgradeMaskTex`, `updateEndwalkerHairTextures` (`{normal,mask}`), `upgradeRemainingTextures(option, targets)`, `targetKey(info)`, `bankersRound`, `modifyPixels`, `createIndexTexture`, `upgradeGearMask`, `createHairMaps` are named identically across their defining and consuming tasks. `UpgradeInfo.files` keys (`normal`/`index`/`mask`/`mask_old`/`mask_new`) match `src/upgrade/material.ts` and `EUpgradeTextureUsage`.
