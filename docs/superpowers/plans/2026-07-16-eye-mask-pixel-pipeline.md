# Eye-Mask Pixel Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `EndwalkerUpgrade.ConvertEyeMaskToDiffuse` + the `UpdateEyeMask` tail so a loose Endwalker iris mask converts to a Dawntrail diffuse, removing the fail-loud throw, landed with a real ConsoleTools `/upgrade` golden.

**Architecture:** Hand-port ImageSharp 2.1.11's Bicubic/NearestNeighbor resamplers, BoxBlur, and Porter-Duff `SrcOver`/`SrcAtop` compositing into a new pure-TS `src/tex/imagesharp/` subsystem; add trivial per-texel helpers to `src/tex/helpers.ts`; bundle the two base-game eye textures (decoded RGBA, sourced from TexTools' own `.tga` decode) as generated constants; orchestrate in `src/upgrade/eye-mask.ts`. Prove parity with a synthetic eye-mask golden under a path-scoped `DIVERGENCE_RULES` tolerance, and verify the shared resampler against the real Misty/Eliza hair-resize baselines.

**Tech Stack:** TypeScript (ESM), Vitest, Biome, `fflate`; ConsoleTools + a live FFXIV install (both present on the dev machine) for extraction and golden generation.

**Spec:** `docs/superpowers/specs/2026-07-16-eye-mask-pixel-pipeline-design.md`. Read it first.

## Global Constraints

- **Byte-parity is the bar.** Output must match the ConsoleTools `/upgrade` golden except for `DIVERGENCE_RULES`-confirmed pixel tolerance. "Our tests pass" is not the bar.
- **Every business-logic line cites its C# / ImageSharp source** as `file · symbol · lines` in a header/comment. ImageSharp ports cite `SixLabors.ImageSharp v2.1.11 · <File>.cs · <method>`. No per-file license headers (licensing lives in `LICENSE`/`NOTICE`).
- **Browser target:** pure TS only. No native modules, no new runtime deps (`fflate` is the only allowed dep; it is already present).
- **Formatting is mechanical:** run `npm run check` (Biome) — never hand-format.
- **Supply chain:** no new deps in this plan. (If one were ever needed: pinned-exact, ≥7-day min release age.)
- **End-of-task gate (required before "done"):** `npm run check`, `npm run typecheck`, `npm test` all green.
- **Reference paths:** the vendored C# lives under `reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/…`; citations use the `reference/.../` ellipsis form.
- **ImageSharp precision:** all resize/blur/composite math is float (ImageSharp uses float32 `Vector4`; we use JS float64). Byte-parity vs the golden is therefore not expected; a documented per-pixel tolerance is.

---

## File Structure

**New:**
- `src/tex/imagesharp/resample.ts` — `resizeBicubic`, `resizeNearestNeighbor` (ImageSharp resize).
- `src/tex/imagesharp/blur.ts` — `boxBlur` (ImageSharp BoxBlur).
- `src/tex/imagesharp/compose.ts` — `drawImageSrcOver`, `drawImageSrcAtop` (ImageSharp DrawImage).
- `src/util/base64.ts` — `base64ToBytes` (decode base64 → `Uint8Array`, browser+node).
- `src/upgrade/reference/eye-base-textures.ts` — **generated** decoded-RGBA constants for `eye01_base`/`eye01_mask`.
- `scripts/generate-synthetics/build-synthetic-eye-mask.ts` — synthetic eye-mask `.pmp` builder.
- Tests: `test/tex/imagesharp/resample.test.ts`, `test/tex/imagesharp/blur.test.ts`, `test/tex/imagesharp/compose.test.ts`, `test/util/base64.test.ts`.

**Modified:**
- `src/tex/helpers.ts` — add `expandChannel`, `maskImage`, `swizzleRB`.
- `src/upgrade/eye-mask.ts` — add `convertEyeMaskToDiffuse` + the `UpdateEyeMask` tail; remove the throw.
- `src/upgrade/texture.ts` — replace the two `TextureResizeUnsupported` throws in `updateEndwalkerHairTextures` with `resizeBicubic`.
- `scripts/extract-eye-materials.ts` — also emit `eye-base-textures.ts` via `/extract` `.tga`.
- `scripts/generate-synthetics/build-all.ts` — import the new builder.
- `test/helpers/upgrade-compare.ts` — add a path-scoped eye-diffuse `DIVERGENCE_RULES` rule.
- `test/upgrade/eye-mask.test.ts` — flip the throw-path assertion to conversion.
- `test/tex/tex-helpers.test.ts` — add helper unit tests (or a colocated file if that's the pattern).
- `README.md`, `NOTICE` — ImageSharp provenance/attribution.
- `docs/BACKLOG.md` + backlog item files — delete `2026-07-15-partials-eye-mask.md`, narrow the T3 item.

---

## Task 1: Per-texel helpers (`expandChannel`, `maskImage`, `swizzleRB`)

**Files:**
- Modify: `src/tex/helpers.ts` (append; port from `TextureHelpers.cs`)
- Test: `test/tex/tex-helpers.test.ts` (append)

**Interfaces:**
- Produces:
  - `expandChannel(data: Uint8Array, channel: number, width: number, height: number, includeAlpha?: boolean): void` — mutates in place.
  - `maskImage(base: Uint8Array, mask: Uint8Array, width: number, height: number): void` — mutates `base`; throws on size mismatch.
  - `swizzleRB(data: Uint8Array, width: number, height: number): void` — mutates in place.

- [ ] **Step 1: Write failing tests**

Append to `test/tex/tex-helpers.test.ts`:
```ts
import { expandChannel, maskImage, swizzleRB } from "../../src/tex/helpers";

describe("expandChannel (TextureHelpers.cs:191)", () => {
  it("copies one channel across RGB, leaving alpha, by default", () => {
    // one 1x1 pixel R=10 G=20 B=30 A=40; expand channel 0 (red)
    const px = new Uint8Array([10, 20, 30, 40]);
    expandChannel(px, 0, 1, 1);
    expect([...px]).toEqual([10, 10, 10, 40]);
  });
  it("includes alpha when includeAlpha=true", () => {
    const px = new Uint8Array([10, 20, 30, 40]);
    expandChannel(px, 2, 1, 1, true); // expand blue across RGBA
    expect([...px]).toEqual([30, 30, 30, 30]);
  });
});

describe("maskImage (TextureHelpers.cs:88)", () => {
  it("copies the mask's alpha into the base's alpha, leaving RGB", () => {
    const base = new Uint8Array([1, 2, 3, 4]);
    const mask = new Uint8Array([9, 9, 9, 250]);
    maskImage(base, mask, 1, 1);
    expect([...base]).toEqual([1, 2, 3, 250]);
  });
  it("throws when sizes disagree (InvalidDataException, :90-95)", () => {
    expect(() => maskImage(new Uint8Array(4), new Uint8Array(8), 1, 1)).toThrow();
  });
});

describe("swizzleRB (TextureHelpers.cs:172)", () => {
  it("swaps bytes 0 and 2 per texel", () => {
    const px = new Uint8Array([10, 20, 30, 40]);
    swizzleRB(px, 1, 1);
    expect([...px]).toEqual([30, 20, 10, 40]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/tex/tex-helpers.test.ts`
Expected: FAIL (`expandChannel`/`maskImage`/`swizzleRB` not exported).

- [ ] **Step 3: Implement**

Append to `src/tex/helpers.ts` (use the existing `modifyPixels` helper already in that file):
```ts
/** Port of TextureHelpers.ExpandChannel (TextureHelpers.cs:191): greyscales `channel` across the
 *  first 3 (or 4, if includeAlpha) channels of every texel, in place. */
export function expandChannel(
  data: Uint8Array,
  channel: number,
  width: number,
  height: number,
  includeAlpha = false,
): void {
  const max = includeAlpha ? 4 : 3;
  modifyPixels(data, width, height, (o) => {
    const v = data[o + channel]!;
    for (let z = 0; z < max; z++) data[o + z] = v;
  });
}

/** Port of TextureHelpers.MaskImage (TextureHelpers.cs:88): copies the mask's alpha into base's
 *  alpha. Reproduces the size-mismatch InvalidDataException (:90-95). */
export function maskImage(
  base: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
): void {
  const expected = width * height * 4;
  if (base.length !== expected || mask.length !== expected) {
    throw new Error("tex: maskImage — images were not the expected size (TextureHelpers.cs:90)");
  }
  modifyPixels(base, width, height, (o) => {
    base[o + 3] = mask[o + 3]!;
  });
}

/** Port of TextureHelpers.SwizzleRB (TextureHelpers.cs:172): swap R/B (bytes 0 and 2) per texel. */
export function swizzleRB(data: Uint8Array, width: number, height: number): void {
  modifyPixels(data, width, height, (o) => {
    const r = data[o]!;
    data[o] = data[o + 2]!;
    data[o + 2] = r;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/tex/tex-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: `npm run check` then commit**
```powershell
npm run check
git add src/tex/helpers.ts test/tex/tex-helpers.test.ts
git commit -m "feat(tex): add expandChannel/maskImage/swizzleRB per-texel helpers"
```

---

## Task 2: ImageSharp resamplers (Bicubic + NearestNeighbor)

**Files:**
- Create: `src/tex/imagesharp/resample.ts`
- Test: `test/tex/imagesharp/resample.test.ts`

**Interfaces:**
- Produces:
  - `resizeBicubic(rgba: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number): Uint8Array`
  - `resizeNearestNeighbor(rgba: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number): Uint8Array`
  - Both return a fresh `dstW*dstH*4` array; a same-size request returns a copy.

**Algorithm (ImageSharp v2.1.11 — port faithfully; cite in the header):**
- **Bicubic weight** (`BicubicResampler.cs · GetValue`, radius 2, a=−0.5), even function of `x≥0`:
  `x≤1: 1.5x³−2.5x²+1`; `1<x<2: −0.5x³+2.5x²−4x+2`; `x≥2: 0`.
- **Kernel map** (`ResizeKernelMap.cs · BuildKernel`), per output index `i` on one axis (srcLen→dstLen):
  `ratio = srcLen/dstLen`; `scale = max(ratio, 1)`; `radius = ceil(scale*2)`; `center = (i+0.5)*ratio − 0.5`; `left = max(0, ceil(center − radius))`; `right = min(srcLen−1, floor(center + radius))`; weight at source `j`: `W((j − center)/scale)`; **normalize** all weights by their sum (edge windows truncate then renormalize). Use an epsilon-tolerant ceil/floor (ImageSharp's `TolerantMath`: `ceil(v)=Math.ceil(v-1e-8)`, `floor(v)=Math.floor(v+1e-8)`) — port and cite it.
- **Separable:** horizontal pass (build X kernel map, produce a `dstW × srcH` intermediate) then vertical pass (build Y kernel map, produce `dstW × dstH`). No premultiply (`PremultiplyAlpha=false`). Convolve each channel independently as `Σ wₖ·pixelₖ`; write back clamped to `[0,255]` and rounded. **Rounding:** ImageSharp converts float→byte via `Rgba32.FromScaledVector4`, i.e. `round(clamp(v,0,1)*255)` with round-half-away-from-zero; match with `Math.round` on the 0..255 value after clamping (document this as the byte-conversion seam to reconcile against the corpus golden in Task 8, which is the authoritative bicubic check).
- **NearestNeighbor** (`ResizeProcessor.ApplyNNResizeFrameTransform`): `factor = srcDim/dstDim` (float); `srcX = trunc(x*factorX)`, `srcY = trunc(y*factorY)`; copy the 4 bytes. No blending.

- [ ] **Step 1: Write failing tests** (invariants + exact NN; bicubic byte-fidelity is proven by the corpus golden in Task 8)

`test/tex/imagesharp/resample.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resizeBicubic, resizeNearestNeighbor } from "../../../src/tex/imagesharp/resample";

function solid(w: number, h: number, c: [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set(c, i * 4);
  return out;
}

describe("resizeNearestNeighbor", () => {
  it("2x2 -> 4x4 replicates each source pixel into a 2x2 block (trunc mapping)", () => {
    // pixels: (0,0)=A (1,0)=B (0,1)=C (1,1)=D, distinct reds
    const src = new Uint8Array([
      10, 0, 0, 255,  20, 0, 0, 255,
      30, 0, 0, 255,  40, 0, 0, 255,
    ]);
    const out = resizeNearestNeighbor(src, 2, 2, 4, 4);
    const red = (x: number, y: number) => out[(y * 4 + x) * 4]!;
    // factor=0.5; srcX=trunc(x*0.5): x=0,1->0 ; x=2,3->1. Same for y.
    expect([red(0, 0), red(1, 0), red(2, 0), red(3, 0)]).toEqual([10, 10, 20, 20]);
    expect([red(0, 3), red(1, 3), red(2, 3), red(3, 3)]).toEqual([30, 30, 40, 40]);
  });
  it("same-size request returns an equal copy (not the same reference)", () => {
    const src = solid(2, 2, [1, 2, 3, 4]);
    const out = resizeNearestNeighbor(src, 2, 2, 2, 2);
    expect([...out]).toEqual([...src]);
    expect(out).not.toBe(src);
  });
});

describe("resizeBicubic", () => {
  it("preserves a solid color on upscale (kernel weights sum to 1)", () => {
    const src = solid(4, 4, [123, 45, 67, 200]);
    const out = resizeBicubic(src, 4, 4, 9, 9);
    for (let i = 0; i < 9 * 9; i++) {
      expect([...out.slice(i * 4, i * 4 + 4)]).toEqual([123, 45, 67, 200]);
    }
  });
  it("preserves a solid color on downscale", () => {
    const src = solid(8, 8, [10, 20, 30, 40]);
    const out = resizeBicubic(src, 8, 8, 3, 3);
    for (let i = 0; i < 3 * 3; i++) {
      expect([...out.slice(i * 4, i * 4 + 4)]).toEqual([10, 20, 30, 40]);
    }
  });
  it("same-size request returns an equal copy", () => {
    const src = solid(3, 3, [5, 6, 7, 8]);
    const out = resizeBicubic(src, 3, 3, 3, 3);
    expect([...out]).toEqual([...src]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run test/tex/imagesharp/resample.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `resample.ts`** porting the algorithm above. Header comment must cite `SixLabors.ImageSharp v2.1.11 · BicubicResampler.cs/ResizeKernelMap.cs/ResizeProcessor.cs · GetValue/BuildKernel`. Structure: a `buildKernelMap(srcLen, dstLen)` returning per-output `{start, weights:number[]}`; a `resizeAxis` that applies a kernel map along one axis into a Float64 or number buffer; `resizeBicubic` = X then Y; `resizeNearestNeighbor` = the integer-map path. Keep intermediate values in JS numbers (float64); clamp+round to bytes only at the final write of each pass (match ImageSharp, which converts to the pixel type between passes — i.e. round to byte after the horizontal pass and again after the vertical pass).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/tex/imagesharp/resample.test.ts` → PASS.

- [ ] **Step 5: `npm run check` then commit**
```powershell
npm run check
git add src/tex/imagesharp/resample.ts test/tex/imagesharp/resample.test.ts
git commit -m "feat(tex): port ImageSharp Bicubic + NearestNeighbor resamplers"
```

**NOTE for reviewer:** whether ImageSharp rounds byte output between the two passes vs only at the end, and half-up vs half-even, is the one seam not pinned by these invariant tests. Task 8 (Misty/Eliza real ImageSharp golden) is the authoritative check; if it shows a systematic small delta, reconcile the inter-pass rounding here.

---

## Task 3: ImageSharp BoxBlur

**Files:**
- Create: `src/tex/imagesharp/blur.ts`
- Test: `test/tex/imagesharp/blur.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `boxBlur(rgba: Uint8Array, width: number, height: number, radius: number): Uint8Array` — returns a fresh array; `radius<=0` returns a copy unchanged.

**Algorithm (ImageSharp v2.1.11 — `BoxBlurProcessor`, `Convolution2PassProcessor`, `KernelSamplingMap`):**
- 1-D kernel length `2*radius+1`, every weight `1/(2*radius+1)`.
- **2-pass separable:** horizontal then vertical.
- **Premultiplied:** before convolving, premultiply RGB by alpha (all in 0..1 float); after both passes, un-premultiply. `premul: r*=a,g*=a,b*=a`; `unpremul: if a>0 r/=a,g/=a,b/=a`.
- **Border: clamp** sample coordinates to `[0, dim-1]` (replicate edge).
- Convert to byte at the end via `round(clamp(v,0,1)*255)`.

- [ ] **Step 1: Write failing test**

`test/tex/imagesharp/blur.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { boxBlur } from "../../../src/tex/imagesharp/blur";

describe("boxBlur", () => {
  it("radius 0 is identity (copy)", () => {
    const src = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
    const out = boxBlur(src, 2, 1, 0);
    expect([...out]).toEqual([...src]);
    expect(out).not.toBe(src);
  });
  it("preserves a solid opaque color (uniform kernel, edge-clamp)", () => {
    const w = 5, h = 5;
    const src = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) src.set([80, 90, 100, 255], i * 4);
    const out = boxBlur(src, w, h, 2);
    for (let i = 0; i < w * h; i++) {
      expect([...out.slice(i * 4, i * 4 + 4)]).toEqual([80, 90, 100, 255]);
    }
  });
  it("blurs a 1-D opaque step toward its neighbors (radius 1, fully opaque so premultiply is a no-op)", () => {
    // 3x1 opaque: black, white, black. radius 1, edge-clamp.
    const src = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    const out = boxBlur(src, 3, 1, 1);
    // center = mean(0,255,0)=85 ; left = mean(clamp)= (0+0+255)/3=85 ; right=(255+0+0)/3=85
    expect(out[0]).toBe(85); // left pixel R (clamped self + self + center)
    expect(out[4]).toBe(85); // center pixel R
    expect(out[8]).toBe(85); // right pixel R
  });
});
```

- [ ] **Step 2: Run to verify fail** → `npx vitest run test/tex/imagesharp/blur.test.ts` FAIL.

- [ ] **Step 3: Implement `blur.ts`** per the algorithm. Cite `SixLabors.ImageSharp v2.1.11 · BoxBlurProcessor.cs/Convolution2PassProcessor.cs/KernelSamplingMap.cs`. Work in a Float64Array of premultiplied RGBA (0..1), horizontal pass into a temp, vertical pass, un-premultiply, write bytes.

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: `npm run check` then commit**
```powershell
npm run check
git add src/tex/imagesharp/blur.ts test/tex/imagesharp/blur.test.ts
git commit -m "feat(tex): port ImageSharp BoxBlur (2-pass separable, premultiplied, edge-clamp)"
```

---

## Task 4: ImageSharp DrawImage compositing (`SrcOver`, `SrcAtop`)

**Files:**
- Create: `src/tex/imagesharp/compose.ts`
- Test: `test/tex/imagesharp/compose.test.ts`

**Interfaces:**
- Produces:
  - `drawImageSrcOver(dst, dstW, dstH, src, srcW, srcH, offsetX, offsetY, opacity): void` — mutates `dst`; blends `src` over `dst` at `(offsetX, offsetY)` on the overlap region, Normal color blend + SrcOver alpha.
  - `drawImageSrcAtop(dst, src, width, height, opacity): void` — mutates `dst`; full-canvas (equal dims), Normal + SrcAtop.

**Algorithm (ImageSharp v2.1.11 — `PorterDuffFunctions`; straight-alpha `Vector4` in 0..1, ε-guarded divisor):**
Let `d`,`s` be RGBA in 0..1; `s.a *= opacity` first; `eps = 1e-7` (`Constants.Epsilon`).
- **SrcOver** (`Over`): `blendW=d.a*s.a; dstW=d.a-blendW; srcW=s.a-blendW; alpha=dstW+s.a;`
  `rgb = (d.rgb*dstW + s.rgb*srcW + s.rgb*blendW)/max(alpha,eps); a=alpha`.
- **SrcAtop** (`Atop`): `blendW=d.a*s.a; dstW=d.a-blendW; alpha=d.a;`
  `rgb = (d.rgb*dstW + s.rgb*blendW)/max(alpha,eps); a=alpha`.
- Convert bytes ↔ float as `/255` and `round(clamp(v,0,1)*255)`.

- [ ] **Step 1: Write failing test**

`test/tex/imagesharp/compose.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { drawImageSrcAtop, drawImageSrcOver } from "../../../src/tex/imagesharp/compose";

describe("drawImageSrcOver", () => {
  it("opaque source fully replaces the destination over the overlap", () => {
    const dst = new Uint8Array([0, 0, 0, 255]);
    const src = new Uint8Array([10, 20, 30, 255]);
    drawImageSrcOver(dst, 1, 1, src, 1, 1, 0, 0, 1);
    expect([...dst]).toEqual([10, 20, 30, 255]);
  });
  it("fully transparent source leaves the destination unchanged", () => {
    const dst = new Uint8Array([10, 20, 30, 255]);
    const src = new Uint8Array([99, 99, 99, 0]);
    drawImageSrcOver(dst, 1, 1, src, 1, 1, 0, 0, 1);
    expect([...dst]).toEqual([10, 20, 30, 255]);
  });
  it("respects the offset (source only touches the addressed pixel)", () => {
    const dst = new Uint8Array(2 * 1 * 4); // two black transparent pixels
    const src = new Uint8Array([50, 60, 70, 255]);
    drawImageSrcOver(dst, 2, 1, src, 1, 1, 1, 0, 1); // draw at x=1
    expect([...dst.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...dst.slice(4, 8)]).toEqual([50, 60, 70, 255]);
  });
});

describe("drawImageSrcAtop", () => {
  it("keeps the backdrop alpha; opaque backdrop takes the source color", () => {
    const dst = new Uint8Array([0, 0, 0, 255]);
    const src = new Uint8Array([10, 20, 30, 255]);
    drawImageSrcAtop(dst, src, 1, 1, 1);
    expect([...dst]).toEqual([10, 20, 30, 255]);
  });
  it("transparent backdrop stays transparent regardless of source", () => {
    const dst = new Uint8Array([0, 0, 0, 0]);
    const src = new Uint8Array([10, 20, 30, 255]);
    drawImageSrcAtop(dst, src, 1, 1, 1);
    expect(dst[3]).toBe(0); // alpha = backdrop alpha = 0
  });
});
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement `compose.ts`** per the formulas. Cite `SixLabors.ImageSharp v2.1.11 · PorterDuffFunctions.cs · Over/Atop/Normal`.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: `npm run check` then commit**
```powershell
npm run check
git add src/tex/imagesharp/compose.ts test/tex/imagesharp/compose.test.ts
git commit -m "feat(tex): port ImageSharp DrawImage SrcOver/SrcAtop compositing"
```

---

## Task 5: `base64ToBytes` util + bundled base eye textures (generated)

**Files:**
- Create: `src/util/base64.ts`, `test/util/base64.test.ts`
- Modify: `scripts/extract-eye-materials.ts` (emit `eye-base-textures.ts`)
- Create (generated, committed): `src/upgrade/reference/eye-base-textures.ts`

**Interfaces:**
- Produces: `base64ToBytes(b64: string): Uint8Array`.
- Produces (generated): `EYE01_BASE`, `EYE01_MASK` of type `{ width: number; height: number; rgba: Uint8Array }`.

- [ ] **Step 1: base64 test**

`test/util/base64.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { base64ToBytes } from "../../src/util/base64";

describe("base64ToBytes", () => {
  it("decodes bytes round-tripped through Buffer", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 65, 66]);
    const b64 = Buffer.from(bytes).toString("base64");
    expect([...base64ToBytes(b64)]).toEqual([...bytes]);
  });
  it("decodes an empty string to an empty array", () => {
    expect(base64ToBytes("").length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement `src/util/base64.ts`** (browser+node; `atob` is global in both Node ≥16 and the browser):
```ts
/** Decode a base64 string to bytes. Uses the platform `atob` (global in Node >=16 and browsers),
 *  so it works in the Vite browser bundle and in tests without a Node-only Buffer dependency. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
```

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Extend `scripts/extract-eye-materials.ts`** to also extract the two base textures via `/extract` to `.tga`, parse the TGA (18-byte header; 32bpp BGRA; bottom-left origin ⇒ flip rows to top-down; swap BGRA→RGBA), and write `src/upgrade/reference/eye-base-textures.ts` embedding each as base64. Add near the existing extraction (reuse the `dir`/`extractGameFile` machinery). Sketch:
```ts
// EndwalkerUpgrade.cs:1928-1932 — base-game eye textures ConvertEyeMaskToDiffuse reads.
function extractTgaRgba(gamePath: string): { width: number; height: number; rgba: Uint8Array } {
  const dest = join(dir, "e.tga");
  extractGameFile(gamePath, dest); // ConsoleTools /extract -> TexTools' own decode
  const tga = new Uint8Array(readFileSync(dest));
  const width = tga[12]! | (tga[13]! << 8);
  const height = tga[14]! | (tga[15]! << 8);
  const px = tga.subarray(18); // uncompressed 32bpp, bottom-left origin, BGRA
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const s = (height - 1 - y) * width * 4;
    const d = y * width * 4;
    for (let x = 0; x < width; x++) {
      rgba[d + x * 4] = px[s + x * 4 + 2]!;     // R<-B
      rgba[d + x * 4 + 1] = px[s + x * 4 + 1]!; // G
      rgba[d + x * 4 + 2] = px[s + x * 4]!;     // B<-R
      rgba[d + x * 4 + 3] = px[s + x * 4 + 3]!; // A
    }
  }
  return { width, height, rgba };
}
// after the iris table is written:
const base = extractTgaRgba("chara/common/texture/eye/eye01_base.tex");
const mask = extractTgaRgba("chara/common/texture/eye/eye01_mask.tex");
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
writeFileSync(
  "src/upgrade/reference/eye-base-textures.ts",
  `// GENERATED — regenerate via \`npx tsx scripts/extract-eye-materials.ts\`. Do not edit by hand.\n` +
    `// Base-game eye textures ConvertEyeMaskToDiffuse reads (EndwalkerUpgrade.cs:1928-1932), decoded\n` +
    `// RGBA. Sourced from TexTools' own decode via ConsoleTools /extract .tga (GetRawPixels-exact),\n` +
    `// so no reliance on our BC decoder. See the eye-mask pixel-pipeline spec §5.6.\n` +
    `import { base64ToBytes } from "../../util/base64";\n\n` +
    `export interface EyeBaseTexture { width: number; height: number; rgba: Uint8Array; }\n` +
    `export const EYE01_BASE: EyeBaseTexture = { width: ${base.width}, height: ${base.height}, rgba: base64ToBytes(${JSON.stringify(b64(base.rgba))}) };\n` +
    `export const EYE01_MASK: EyeBaseTexture = { width: ${mask.width}, height: ${mask.height}, rgba: base64ToBytes(${JSON.stringify(b64(mask.rgba))}) };\n`,
);
```

- [ ] **Step 6: Run the extractor** (dev machine has game + ConsoleTools):

Run: `npx tsx scripts/extract-eye-materials.ts`
Expected: writes `src/upgrade/reference/eye-materials.ts` (unchanged) and `src/upgrade/reference/eye-base-textures.ts` (new; both textures 128×128).

- [ ] **Step 7: Sanity-check the generated file** parses and the arrays are 128*128*4 = 65536 bytes:

Run: `npx tsx -e "import('./src/upgrade/reference/eye-base-textures.ts').then(m=>console.log(m.EYE01_BASE.width, m.EYE01_BASE.rgba.length, m.EYE01_MASK.rgba.length))"`
Expected: `128 65536 65536`.

- [ ] **Step 8: `npm run check` then commit**
```powershell
npm run check
git add src/util/base64.ts test/util/base64.test.ts scripts/extract-eye-materials.ts src/upgrade/reference/eye-base-textures.ts
git commit -m "feat(upgrade): bundle base eye textures (TexTools .tga decode) + base64 util"
```

---

## Task 6: `convertEyeMaskToDiffuse` + `UpdateEyeMask` tail (remove the throw)

**Files:**
- Modify: `src/upgrade/eye-mask.ts`
- Modify: `test/upgrade/eye-mask.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; Task 2 `resizeBicubic`/`resizeNearestNeighbor`; Task 3 `boxBlur`; Task 4 `drawImageSrcOver`/`drawImageSrcAtop`; Task 5 `EYE01_BASE`/`EYE01_MASK`; `decodeToRgba`/`encodeUncompressedTex` (`../tex/tex`); `writeGeneratedTex` (`./texture`).
- Produces: `convertEyeMaskToDiffuse(maskRgba: Uint8Array, ow: number, oh: number): { rgba: Uint8Array; width: number; height: number }`; `updateEyeMask` now writes the diffuse instead of throwing.

**Port (`ConvertEyeMaskToDiffuse` :1910-2003 exact order):**
`ratio=0.442; w=ow*4; h=oh*4; irisW=trunc(w*ratio); irisH=trunc(h*ratio)`. `expandChannel(mask,0,ow,oh)`; `resizedMask=resizeBicubic(mask,ow,oh,irisW,irisH)`. Frame = `EYE01_MASK` (clone its rgba); `expandChannel(frame,2,128,128,true)`; `frame=resizeNearestNeighbor(frame,128,128,w,h)`; `frame=boxBlur(frame,w,h,trunc(w/128))`. Blank `w*h*4`; `drawImageSrcOver(blank,w,h,resizedMask,irisW,irisH, (w>>1)-(irisW>>1), (h>>1)-(irisH>>1), 1)`. `maskImage(blank,frame,w,h)`. Diffuse = `resizeBicubic(EYE01_BASE.rgba,128,128,w,h)`; `drawImageSrcAtop(diffuse,blank,w,h,1)`; return `{rgba:diffuse,width:w,height:h}`.

**Tail (`UpdateEyeMask` :2056-2077):** after the iris `table.has(irisPath)` gate, replace the throw with: read `diffusePath = table.get(irisPath)!.diffusePath` (guard `undefined` → throw a clear error citing `:2059`, the deferred NRE case per `eye-materials-types.ts`); `maskRgba = decodeToRgba(parseTex(resolved.bytes))`; `updated = convertEyeMaskToDiffuse(maskRgba, tex.width, tex.height)`; `swizzleRB(updated.rgba, updated.width, updated.height)`; `texBytes = encodeUncompressedTex(updated.rgba, updated.width, updated.height, {mips:true})`; `writeGeneratedTex(option, diffusePath, texBytes, file)`. (`file` = the mask `ModpackFile` already fetched — the storage-form reference.) Keep the pre-parse (`parseTex`) as the fail-loud truncated-header seam; capture its returned tex for `.width/.height`.

- [ ] **Step 1: Update `eye-mask.test.ts`** — flip the two throw assertions to conversion:
```ts
// (replace) it("throws the documented gap when the mask clears every guard ...")
it("converts the mask to a diffuse when it clears every guard (iris exists)", () => {
  const o = opt({ [MASK]: buildMinimalTex() });
  // stub table entry points diffuse at a known path; a valid A8R8G8B8 mask decodes+converts.
  const t: EyeMaterialTable = new Map([[IRIS_MAT, { diffusePath: "chara/common/texture/eye/eyeX_base.tex" }]]);
  updateEyeMask(o, MASK, t);
  expect(o.files.has("chara/common/texture/eye/eyeX_base.tex")).toBe(true);
});
// (replace) the upgradeModpack "throws the documented gap ..." case similarly:
it("writes a converted diffuse for an unclaimed iri_s.tex whose iris material exists", () => {
  const out = upgradeModpack(pack({ [realMask]: buildMinimalTex() }));
  const diffuse = EYE_MATERIALS.get(
    `chara/human/c${rc[1]}/obj/face/f${rc[2]}/material/mt_c${rc[1]}f${rc[2]}_iri_a.mtrl`,
  )!.diffusePath!;
  const wrote = out.groups.some((g) => g.options.some((o) => o.files.has(diffuse)));
  expect(wrote).toBe(true);
});
```
Keep every skip-path test (regex miss, iris absent, race round-trip) and the two "throws before the iris gate" malformed/byte-less tests unchanged — they must still throw (the parse seam is preserved). `buildMinimalTex()` must be a valid decodable A8R8G8B8 tex; if it is too small for the pipeline (e.g. 0 dims), adjust the helper or use an explicit small tex here (e.g. 8×8) so `convertEyeMaskToDiffuse` runs.

- [ ] **Step 2: Run to verify fail** → `npx vitest run test/upgrade/eye-mask.test.ts` FAIL (still throws `/unported/`).

- [ ] **Step 3: Implement** `convertEyeMaskToDiffuse` and the tail in `src/upgrade/eye-mask.ts`; delete the `/unported/` throw and its comment; update the module header (remove "throws at pixel conversion", cite `ConvertEyeMaskToDiffuse :1910-2003`).

- [ ] **Step 4: Run to verify pass** → `npx vitest run test/upgrade/eye-mask.test.ts` PASS.

- [ ] **Step 5: Full unit suite (no corpus needed yet)**

Run: `npx vitest run test/tex test/upgrade/eye-mask.test.ts test/util`
Expected: PASS.

- [ ] **Step 6: `npm run check`, `npm run typecheck`, then commit**
```powershell
npm run check; npm run typecheck
git add src/upgrade/eye-mask.ts test/upgrade/eye-mask.test.ts
git commit -m "feat(upgrade): port ConvertEyeMaskToDiffuse + UpdateEyeMask tail; remove throw"
```

---

## Task 7: Synthetic eye-mask golden + DIVERGENCE_RULES tolerance

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-eye-mask.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`
- Modify: `test/helpers/upgrade-compare.ts`

**Interfaces:**
- Consumes: `writePmp`/`singleOptionGroup`/`syntheticMeta`/`EMPTY_DEFAULT_MOD` (`./pmp-builder`); `EYE_MATERIALS`; `buildCanonicalTexHeader`/`A8R8G8B8` (`../../src/tex/...`).

- [ ] **Step 1: Write the builder** `build-synthetic-eye-mask.ts` — an in-table `(race,face)` with a 64×64 A8R8G8B8 mask carrying a red gradient (so Mask.Red is non-trivial; output is 256×256, exercising base Bicubic upscale + NN + BoxBlur(radius 2)):
```ts
// Builds test/corpus/synthetic/eye-mask.pmp: one loose --c{race}f{face}_iri_s.tex for a (race,face)
// present in EYE_MATERIALS, so round-6 UpdateEyeMask converts it to the iris diffuse
// (EndwalkerUpgrade.cs ConvertEyeMaskToDiffuse). 64x64 -> 256x256 output. See the pixel-pipeline spec.
import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";
import { EYE_MATERIALS } from "../../src/upgrade/reference/eye-materials";
import { EMPTY_DEFAULT_MOD, singleOptionGroup, syntheticMeta, writePmp } from "./pmp-builder";

const iris = [...EYE_MATERIALS.keys()][0]!; // e.g. .../mt_c0101f0001_iri_a.mtrl
const m = /c([0-9]{4}).*?f([0-9]{4})/.exec(iris)!;
const race = m[1]!, face = m[2]!;
const maskGamePath = `chara/human/c${race}/obj/face/f${face}/texture/--c${race}f${face}_iri_s.tex`;

const W = 64, H = 64;
const header = buildCanonicalTexHeader(A8R8G8B8, W, H, 1);
const pixels = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    pixels[o] = (x * 4) & 0xff;     // R gradient (the only channel the conversion uses)
    pixels[o + 1] = (y * 4) & 0xff; // G/B/A arbitrary
    pixels[o + 2] = 128;
    pixels[o + 3] = 255;
  }
const maskTex = concatBytes([header, pixels]);
const zipPath = "files\\mask_iri_s.tex";

writePmp("eye-mask.pmp", {
  meta: syntheticMeta("Eye Mask Diffuse Conversion"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_loose eye mask.json": singleOptionGroup("Loose Eye Mask", { [maskGamePath]: zipPath }),
  },
  files: { [zipPath.replace(/\\/g, "/")]: maskTex },
});
```

- [ ] **Step 2: Register in `build-all.ts`** — add `import "./build-synthetic-eye-mask";`.

- [ ] **Step 3: Build the pack**

Run: `npm run synthetics`
Expected: logs `wrote …/test/corpus/synthetic/eye-mask.pmp`.

- [ ] **Step 4: Generate + measure the golden** (dev machine has ConsoleTools). Write a scratch measurement script to `scratchpad` that: loads the pack, runs `upgradeModpack`, fetches the golden via `upgradeGoldenCached`, decodes both the diffuse `.tex` (ours vs golden) and reports per-byte max delta + count over threshold. This determines the tolerance:
```ts
// scratchpad/measure-eye.ts (run: npx tsx scratchpad/measure-eye.ts)
import { readFileSync } from "node:fs";
import { loadModpack, upgradeModpack, writeModpack } from "./src/index";
import { upgradeGoldenCached } from "./test/helpers/upgrade-golden";
// load test/corpus/synthetic/eye-mask.pmp, upgrade, get golden, extract the eye-diffuse .tex from
// each archive by gamePath, and print max |ours[i]-golden[i]| over the post-header bytes.
```
Run: `npx tsx scratchpad/measure-eye.ts`
Expected: prints the diffuse gamePath (a `chara/common/texture/eye/…_base.tex`), identical header+length, and a small max per-pixel delta. **Record the observed max delta** — it sets the tolerance below.

- [ ] **Step 5: Add the eye-diffuse DIVERGENCE_RULES rule** to `test/helpers/upgrade-compare.ts`, path-scoped so it does not loosen the global `.tex` ±1 rule. Use the measured max delta (call it `T`) with a small safety margin, and justify it:
```ts
// Eye-mask round-6 diffuse (EndwalkerUpgrade.cs ConvertEyeMaskToDiffuse): a multi-stage ImageSharp
// float pipeline (Bicubic/NN resize, BoxBlur, SrcOver/SrcAtop) that we port in float64 vs C#'s
// float32, so the A8R8G8B8 diffuse differs by up to +/-T per pixel while header/dims/length match.
// Path-scoped to the base-game eye diffuse destination so it never loosens other .tex comparisons.
{
  reason:
    "Round-6 eye-mask diffuse (ConvertEyeMaskToDiffuse) — float64-vs-float32 ImageSharp pipeline; " +
    "A8R8G8B8 header/dims/length identical, every post-header pixel within +/-" + /*T*/ 0 + ".",
  predicate: (gamePath) =>
    gamePath.startsWith("chara/common/texture/eye/") && gamePath.endsWith("_base.tex"),
  confirm: (ours, golden) => {
    if (ours.length !== golden.length || ours.length < 80) return false;
    for (let i = 0; i < 80; i++) if (ours[i] !== golden[i]) return false;
    for (let i = 80; i < golden.length; i++)
      if (Math.abs(ours[i]! - golden[i]!) > /*T*/ 0) return false;
    return true;
  },
},
```
Replace both `/*T*/ 0` with the measured tolerance. If `T` is unexpectedly large (double digits), stop and investigate a real bug (inter-pass rounding, swizzle, dims) before widening — a loose tolerance hides bugs.

- [ ] **Step 6: Run the eye pack's golden check** and confirm it fully matches (no baseline diffs):

Run: `npx vitest run test/corpus` (or the corpus-upgrade entry) — filter to the eye pack if the runner supports it.
Expected: `upgrade golden: eye-mask.pmp … matched, 0 diffs, 0 regressions`. If the eye diffuse still shows as a diff, the rule predicate/tolerance is wrong — fix until it confirms.

- [ ] **Step 7: Remove the scratch script; `npm run check`; commit**
```powershell
Remove-Item scratchpad/measure-eye.ts -ErrorAction SilentlyContinue
npm run check
git add scripts/generate-synthetics/build-synthetic-eye-mask.ts scripts/generate-synthetics/build-all.ts test/helpers/upgrade-compare.ts
git commit -m "test(upgrade): synthetic eye-mask golden + path-scoped diffuse tolerance"
```

---

## Task 8: Wire the resampler into the hair resize skips (Misty/Eliza); re-bless baselines

**Files:**
- Modify: `src/upgrade/texture.ts` (`updateEndwalkerHairTextures`)

**Interfaces:**
- Consumes: `resizeBicubic` (Task 2).

**Port target:** `updateEndwalkerHairTextures` currently throws `TextureResizeUnsupported` at (a) NPOT (`:1195` pow2 pre-step) and (b) size mismatch (`:1205` `ResizeImages` to common max, Bicubic). Replace with real resizes. Confirm each filter against the C# before wiring: `:1195` pow2 pre-step and `:1205` `ResizeImages` both use **Bicubic** (`TextureHelpers.ResizeImage` default `nearestNeighbor=false`). So: after decoding, if NPOT, `resizeBicubic` each to `roundToPow2` dims; then resize both to `maxW/maxH` via `resizeBicubic` (skip when already equal — `ResizeImage` early-returns when dims match, `TextureHelpers.cs:368`). Then `createHairMaps` on the common-size buffers.

- [ ] **Step 1: Confirm the C# filters** — read `reference/.../Mods/EndwalkerUpgrade.cs:1195,1205` and `TextureHelpers.ResizeImages`/`ResizeImage` to verify Bicubic + the equal-dims early return. Note findings in the code comment.

- [ ] **Step 2: Implement** in `updateEndwalkerHairTextures`: replace the NPOT throw with `roundToPowerOfTwo`+`resizeBicubic`, and the size-mismatch throw with resizing both to `maxW=max(nW,mW)`, `maxH=max(nH,mH)` via `resizeBicubic` (guarding the equal-dims no-op). Keep `createHairMaps` and the two `encodeUncompressedTex(...,{mips:true})` writes. Update the header/comments to cite the now-ported resize and drop "documented gap". Keep `TextureResizeUnsupported` exported/defined only if `createIndexFromNormal`/`upgradeMaskTex` still throw it (they still do — leave those NPOT throws; only the hair path is wired here, per plan scope). Use a local `nextPow2` (or reuse `resizeToPowerOfTwo`'s logic — but that throws; here we actually resize, so compute pow2 dims and call `resizeBicubic`).

- [ ] **Step 3: Rebuild synthetics if needed** (no change) and run the affected corpus packs to see the new (smaller) diffs:

Run: `npx vitest run test/corpus` (Misty/Eliza live in `test/corpus/real`, gitignored — present on the dev machine).
Expected: Misty/Eliza no longer TextureResizeUnsupported-skip; their hair `.tex` now diff by a small margin (or are confirmed by the existing global `.tex` ±1 rule). **If the residual diff exceeds ±1**, it lands as a baseline entry (the float resampler gap); confirm the deltas are small/non-structural via a scratch measurement (max per-pixel delta on one hair `.tex`), then proceed to bless.

- [ ] **Step 4: Re-bless the ratchet baselines** (records the new, smaller residual as the ratchet):
```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```
Expected: Misty/Eliza baselines shrink dramatically (whole-texture skip → few-LSB residual or fully confirmed). Inspect the `[upgrade] … blessed` logs to confirm the diff counts dropped.

- [ ] **Step 5: Verify green without bless**

Run: `npm test`
Expected: all green; no regressions.

- [ ] **Step 6: `npm run check`; commit** (baselines are gitignored, so only source is staged)
```powershell
npm run check
git add src/upgrade/texture.ts
git commit -m "feat(upgrade): wire Bicubic resampler into hair resize (Misty/Eliza), removing skips"
```

---

## Task 9: Provenance, licensing, and backlog cleanup

**Files:**
- Modify: `README.md` (provenance section), `NOTICE`, `docs/BACKLOG.md`
- Delete: `docs/backlog/2026-07-15-partials-eye-mask.md`
- Modify: `docs/backlog/2026-07-10-imagesharp-resampler.md` (narrow to remaining call-site wiring)

- [ ] **Step 1: README provenance** — add ImageSharp `v2.1.11` (Apache-2.0) to the "Upstream provenance" section, analogous to the `bc7enc_rdo` "BC7 codec reference" row, noting it is a NuGet dep of xivModdingFramework (`xivModdingFramework.csproj:37`), not vendored under `reference/`, read from the `SixLabors/ImageSharp` GitHub tag `v2.1.11`, and that `src/tex/imagesharp/` ports its resamplers/blur/compositing.

- [ ] **Step 2: NOTICE** — add a sub-entry mirroring the `bc7enc_rdo` block:
```
----------------------------------------------------------------------

src/tex/imagesharp/ contains image resampling, blur, and compositing
ported from SixLabors.ImageSharp (v2.1.11):

  Copyright (c) Six Labors.
  Licensed under the Apache License, Version 2.0.

Apache-2.0 is one-way compatible with GPL-3.0-or-later, so the combined
work remains under GPL-3.0-or-later.
```

- [ ] **Step 3: Backlog — close the eye item.** Grep for references first, then delete:

Run: `git grep -n "2026-07-15-partials-eye-mask.md"`
Expected refs: the `docs/BACKLOG.md` index entry, and possibly a citation in `src/upgrade/eye-mask.ts` (the old throw — already removed in Task 6; confirm none remain). Remove the index entry (item #1 under Prioritized) and delete `docs/backlog/2026-07-15-partials-eye-mask.md`. Ensure no dangling code citation remains (`git grep` returns only doc hits).

- [ ] **Step 4: Backlog — narrow T3.** Edit `docs/backlog/2026-07-10-imagesharp-resampler.md` to record that the resampler itself is now ported (`src/tex/imagesharp/resample.ts`) and verified against Misty/Eliza; only the remaining call-site wiring stays open — T2's `FixOldTexData` NPOT resize and the `createIndexFromNormal`/`upgradeMaskTex` NPOT paths (which still throw `TextureResizeUnsupported`). Update the `docs/BACKLOG.md` T3 index line to match.

- [ ] **Step 5: `npm run check`; commit**
```powershell
npm run check
git add README.md NOTICE docs/BACKLOG.md docs/backlog/2026-07-10-imagesharp-resampler.md
git rm docs/backlog/2026-07-15-partials-eye-mask.md
git commit -m "docs: ImageSharp provenance/attribution; close eye-mask backlog item, narrow T3"
```

---

## Task 10: Full gate + PR

- [ ] **Step 1: End-of-task gate**

Run: `npm run check`
Run: `npm run typecheck`
Run: `npm test`
Expected: all three green; the eye-mask golden matches; Misty/Eliza baselines improved; no regressions.

- [ ] **Step 2: Delete this plan before the PR** (repo discipline: plans live in branch history, not on the PR/main):
```powershell
git rm docs/superpowers/plans/2026-07-16-eye-mask-pixel-pipeline.md
git commit -m "chore: remove completed eye-mask pixel-pipeline plan before PR"
```

- [ ] **Step 3: Push branch and open the PR** (see the executing session for branch name), targeting `main`, summarizing: the ported pixel pipeline, the new golden + tolerance, the resampler verification against Misty/Eliza, and the ImageSharp provenance. Note the durable spec stays; the plan does not.

---

## Self-Review

**Spec coverage:**
- §2 hand-port decision → Tasks 2–4 (the ImageSharp ports).
- §3 C# pipeline order → Task 6 (`convertEyeMaskToDiffuse` reproduces the exact step order).
- §4 module decomposition → Tasks 1–6 file map matches the spec table.
- §5.1–5.5 algorithms → Tasks 2 (bicubic/NN), 3 (blur), 4 (compose), 1 (helpers).
- §5.6 base textures → Task 5 (TGA-sourced, base64-embedded constants).
- §6 swizzle seam → Task 6 tail (swizzleRB before encode) + Task 7 golden (the empirical arbiter).
- §7.1 eye golden + tolerance → Task 7.
- §7.2 resampler-vs-real-corpus → Task 8.
- §7.3 unit tests → Tasks 1–4, 6.
- §8 provenance/NOTICE → Task 9.
- §9 gate → Task 10.

**Placeholder scan:** the only deferred values are the DIVERGENCE_RULES tolerance `T` (Task 7, blessed empirically — an authorized bless step, not a placeholder) and the branch name (set at execution). No vague "handle errors"/"add tests" steps; every test step has real code.

**Type consistency:** `resizeBicubic`/`resizeNearestNeighbor(rgba,srcW,srcH,dstW,dstH)`, `boxBlur(rgba,w,h,radius)`, `drawImageSrcOver(dst,dstW,dstH,src,srcW,srcH,x,y,opacity)`, `drawImageSrcAtop(dst,src,w,h,opacity)`, `convertEyeMaskToDiffuse(maskRgba,ow,oh)→{rgba,width,height}`, `EyeBaseTexture{width,height,rgba}`, `base64ToBytes(b64)→Uint8Array` — used consistently across Tasks 2–6.
