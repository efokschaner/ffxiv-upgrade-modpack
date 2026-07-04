# BCn Decode Golden Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small, committed set of golden BCn decode fixtures (generated with DirectXTex `texconv`) plus a data-driven test, closing the BC7 all-modes and BC5/BC7/BC4 channel-order coverage gaps without relying on the local-only modpack corpus.

**Architecture:** A dev-time `tsx` regen script drives `texconv` to encode small procedural source images to every BCn format and decode them back, committing raw compressed inputs + raw standard-order RGBA goldens + a JSON manifest. A test iterates the manifest, decodes each input with our `decodeToRgba`, applies the documented TexTools channel mapping to the golden, and asserts byte-exact equality. A second test asserts the BC7 fixtures cover all 8 modes.

**Tech Stack:** TypeScript, Vitest (via the repo's custom `scripts/run-tests.ts` runner), `tsx`, DirectXTex `texconv` (dev-time only, not committed), Node `node:child_process`/`node:fs`.

**Design spec:** `docs/superpowers/specs/2026-07-04-bcn-decode-golden-fixtures-design.md`

## Global Constraints

- **End-of-task ritual (required, from `AGENTS.md`):** before any task is "done", run and confirm green: `npm run check`, `npm run typecheck`, `npm test`.
- **No new npm dependencies.** texconv is an external tool, downloaded, **not** committed and **not** an npm dep. No `fflate`/PNG-lib use.
- **Formatting is mechanical — Biome owns it.** Never hand-format; run `npm run check` before committing. A pre-commit hook runs Biome + typecheck.
- **No per-file license/SPDX headers.** Licensing is repo-wide (LICENSE + NOTICE).
- **`reference/` is off-limits** (gitignored vendored C#).
- **Platform:** Windows + PowerShell; Node `>=20.19`.
- **Commit frequently**; prefer new commits over amending.
- **Fixtures commit under `test/tex/fixtures/bcn/`** (NOT under the gitignored `/test/corpus/`).

---

## File structure

- Create `test/tex/golden-util.ts` — test-only helpers: `type ChannelMap`, `applyChannelMap`, `bc7BlockMode`.
- Create `test/tex/golden-util.test.ts` — unit tests for those helpers.
- Create `test/tex/fixtures/bcn/regen.ts` — dev-time fixture regenerator (drives texconv).
- Create `test/tex/fixtures/bcn/README.md` — provenance, exact commands, channel-map table, coverage impact.
- Create (generated, committed) `test/tex/fixtures/bcn/sources/*.tga`, `images/*.bin`, `images/*.rgba`, `manifest.json`, and (only if needed) `blocks/*`.
- Create `test/tex/tex-bcn-golden.test.ts` — manifest-driven decode-match + BC7 mode-coverage guard.
- Modify `src/tex/bc7.ts` (comments at top) and `src/tex/decode.ts` (`decodeBc5` doc comment) — downgrade the `PROVISIONAL`/`TODO` notes now that the gaps are covered.

---

## Task 1: Golden test helpers (`applyChannelMap`, `bc7BlockMode`)

**Files:**
- Create: `test/tex/golden-util.ts`
- Test: `test/tex/golden-util.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ChannelMap = "none" | "swapRB" | "grayFromR"`
  - `applyChannelMap(rgba: Uint8Array, map: ChannelMap): Uint8Array` — maps a **standard-order** RGBA buffer (texconv output) into our decoder's TexTools convention.
  - `bc7BlockMode(block: Uint8Array, offset?: number): number` — BC7 mode (0–7) of the 16-byte block at `offset`, or -1 for the reserved all-zero-first-byte case.

- [ ] **Step 1: Record the coverage baseline (before any change).**

Run on the clean tree so the "before" numbers are captured for the Task 5 assessment:

```
npm run test:coverage
```

Then read the two files' numbers from the JSON summary and note them down (paste into the Task 5 scratch):

```powershell
$s = Get-Content coverage/coverage-summary.json | ConvertFrom-Json
$s.PSObject.Properties | Where-Object { $_.Name -match 'tex[\\/](decode|bc7)\.ts$' } |
  ForEach-Object { "{0}: lines {1}% branches {2}% funcs {3}%" -f $_.Name, $_.Value.lines.pct, $_.Value.branches.pct, $_.Value.functions.pct }
```

Expected: two lines, one for `decode.ts` and one for `bc7.ts`. Save them verbatim.

- [ ] **Step 2: Write the failing test**

Create `test/tex/golden-util.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyChannelMap, bc7BlockMode } from "./golden-util";

describe("applyChannelMap", () => {
  it("none returns the pixels unchanged", () => {
    expect(Array.from(applyChannelMap(new Uint8Array([10, 20, 30, 40]), "none"))).toEqual([
      10, 20, 30, 40,
    ]);
  });

  it("swapRB swaps red<->blue, keeps green and alpha", () => {
    expect(Array.from(applyChannelMap(new Uint8Array([10, 20, 30, 40]), "swapRB"))).toEqual([
      30, 20, 10, 40,
    ]);
  });

  it("grayFromR replicates red across RGB and forces opaque alpha", () => {
    expect(Array.from(applyChannelMap(new Uint8Array([77, 0, 0, 12]), "grayFromR"))).toEqual([
      77, 77, 77, 255,
    ]);
  });
});

describe("bc7BlockMode", () => {
  it("reads mode 6 (first byte 0x40) — matches the make-tex mode-6 builder", () => {
    expect(bc7BlockMode(new Uint8Array([0x40]))).toBe(6);
  });

  it("reads mode 0 (first byte 0x01)", () => {
    expect(bc7BlockMode(new Uint8Array([0x01]))).toBe(0);
  });

  it("honors the offset (0x08 at index 1 -> mode 3)", () => {
    expect(bc7BlockMode(new Uint8Array([0x00, 0x08]), 1)).toBe(3);
  });

  it("returns -1 for the reserved all-zero-first-byte block", () => {
    expect(bc7BlockMode(new Uint8Array([0x00]))).toBe(-1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/tex/golden-util.test.ts`
Expected: FAIL — `Cannot find module './golden-util'` (file does not exist yet).

- [ ] **Step 4: Write minimal implementation**

Create `test/tex/golden-util.ts`:

```ts
// Test-only helpers for the BCn golden-fixture decode tests (design spec §4/§6). Not shipped in src/.

export type ChannelMap = "none" | "swapRB" | "grayFromR";

/**
 * Maps a STANDARD-order RGBA buffer (texconv's decode output) into our decoder's TexTools channel
 * convention, so a texconv golden can be compared byte-for-byte against decodeToRgba's output:
 *   - none:      BC1/BC2/BC3 — standard RGBA, unchanged.
 *   - swapRB:    BC5/BC7 — R<->B swap (TexTools SwapRedBlue).
 *   - grayFromR: BC4 — TexTools replicates the single red channel across RGB, opaque (R,R,R,255).
 */
export function applyChannelMap(rgba: Uint8Array, map: ChannelMap): Uint8Array {
  if (map === "none") return rgba;
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const a = rgba[i + 3]!;
    if (map === "swapRB") {
      out[i] = b;
      out[i + 1] = g;
      out[i + 2] = r;
      out[i + 3] = a;
    } else {
      out[i] = r;
      out[i + 1] = r;
      out[i + 2] = r;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * BC7 block mode = index of the least-significant set bit of the block's first byte (mode m encodes as
 * m zero bits followed by a 1). Returns 0..7, or -1 for the reserved all-zero-first-byte case.
 */
export function bc7BlockMode(block: Uint8Array, offset = 0): number {
  const b = block[offset]!;
  for (let m = 0; m < 8; m++) if ((b >> m) & 1) return m;
  return -1;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/tex/golden-util.test.ts`
Expected: PASS — all 7 assertions green.

- [ ] **Step 6: Ritual + commit**

```powershell
npm run check; npm run typecheck; npm test
git add test/tex/golden-util.ts test/tex/golden-util.test.ts
git commit -m "test(tex): golden-fixture channel-map + BC7 mode helpers"
```

Expected: all three commands green; commit succeeds.

---

## Task 2: Generate & commit the BCn golden fixtures

**Files:**
- Create: `test/tex/fixtures/bcn/regen.ts`
- Create: `test/tex/fixtures/bcn/README.md`
- Create (generated): `test/tex/fixtures/bcn/sources/*.tga`, `test/tex/fixtures/bcn/images/*.bin`, `test/tex/fixtures/bcn/images/*.rgba`, `test/tex/fixtures/bcn/manifest.json`

**Interfaces:**
- Consumes: `bc7BlockMode` from `test/tex/golden-util.ts` (Task 1).
- Produces: `manifest.json` — an array of `{ name, format, width, height, input, expected, channelMap }` where `format` is one of `DXT1 | DXT3 | DXT5 | BC4 | BC5 | BC7`, `input`/`expected` are repo-relative-to-`bcn/` paths, and `channelMap` is a `ChannelMap`.

- [ ] **Step 1: Acquire texconv (dev-time tool, not committed)**

Download the standalone `texconv.exe` from the DirectXTex releases (Microsoft-signed): https://github.com/microsoft/DirectXTex/releases — place it on `PATH`, or note its full path for `TEXCONV`. Verify:

```powershell
texconv -h | Select-Object -First 3
```

Expected: texconv usage banner prints. Record the version string for the README (`texconv` prints a date/version in `-nologo` runs; or note the release tag downloaded).

- [ ] **Step 2: Write the regen script**

Create `test/tex/fixtures/bcn/regen.ts`:

```ts
// Dev-time regenerator for the BCn golden decode fixtures. NOT part of the test gate.
// Requires DirectXTex `texconv` on PATH (or set env TEXCONV=C:\path\to\texconv.exe). See README.md.
//
//   npx tsx test/tex/fixtures/bcn/regen.ts
//
// Per (source image, format): source .tga -> texconv encode -> BCn .dds -> strip container ->
// images/<name>.<fmt>.bin ; then texconv decode that .dds to R8G8B8A8 .dds -> strip -> images/<name>.<fmt>.rgba.
// Goldens are texconv's STANDARD-order RGBA, unmodified; the test applies our channel convention (spec §4).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bc7BlockMode } from "../../golden-util";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEXCONV = process.env.TEXCONV ?? "texconv";

type ChannelMap = "none" | "swapRB" | "grayFromR";
interface Fmt {
  key: string;
  texconv: string;
  xiv: string;
  channelMap: ChannelMap;
  bc7max?: boolean;
}
const FORMATS: Fmt[] = [
  { key: "dxt1", texconv: "BC1_UNORM", xiv: "DXT1", channelMap: "none" },
  { key: "dxt3", texconv: "BC2_UNORM", xiv: "DXT3", channelMap: "none" },
  { key: "dxt5", texconv: "BC3_UNORM", xiv: "DXT5", channelMap: "none" },
  { key: "bc4", texconv: "BC4_UNORM", xiv: "BC4", channelMap: "grayFromR" },
  { key: "bc5", texconv: "BC5_UNORM", xiv: "BC5", channelMap: "swapRB" },
  { key: "bc7", texconv: "BC7_UNORM", xiv: "BC7", channelMap: "swapRB", bc7max: true },
];

type Px = (x: number, y: number) => [number, number, number, number];
interface Src {
  name: string;
  w: number;
  h: number;
  px: Px;
}
const REGION: [number, number, number, number][] = [
  [220, 30, 30, 255],
  [30, 220, 30, 255],
  [30, 30, 220, 255],
  [230, 230, 30, 255],
];
const SOURCES: Src[] = [
  // Smooth opaque gradient, distinct R/G (meaningful for BC4/BC5) -> BC7 mode 6.
  { name: "grad", w: 64, h: 64, px: (x, y) => [(x * 4) & 0xff, (y * 4) & 0xff, 128, 255] },
  // Sharp multi-color quadrants (2-3 subsets per straddling block) -> partitioned BC7 modes 0/1/2/3.
  {
    name: "regions",
    w: 64,
    h: 64,
    px: (x, y) => REGION[(x < 32 ? 0 : 1) + (y < 32 ? 0 : 2)]!,
  },
  // Color gradient with DECORRELATED alpha -> BC7 rotation/index modes 4/5 and RGBA partition mode 7.
  { name: "alpha", w: 64, h: 64, px: (x, y) => [(x * 4) & 0xff, 64, (y * 4) & 0xff, ((x ^ y) * 4) & 0xff] },
  // Non-power-of-two, non-multiple-of-4 -> partial edge blocks.
  { name: "edge", w: 65, h: 33, px: (x, y) => [(x * 3) & 0xff, (y * 7) & 0xff, ((x + y) * 2) & 0xff, 255] },
];

// Writes a 32-bit uncompressed TGA, top-left origin, BGRA byte order. DirectXTex reads TGA natively.
function writeTga(path: string, w: number, h: number, px: Px): void {
  const header = Buffer.from([
    0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, w & 0xff, (w >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff, 32, 0x28,
  ]);
  const body = Buffer.alloc(w * h * 4);
  let o = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y);
      body[o++] = b;
      body[o++] = g;
      body[o++] = r;
      body[o++] = a;
    }
  }
  writeFileSync(path, Buffer.concat([header, body]));
}

// Strips a DDS container down to raw mip bytes, handling the optional DX10 extended header.
function stripDds(path: string): Uint8Array {
  const buf = new Uint8Array(readFileSync(path));
  if (buf[0] !== 0x44 || buf[1] !== 0x44 || buf[2] !== 0x53 || buf[3] !== 0x20)
    throw new Error(`not a DDS: ${path}`);
  // DDS_PIXELFORMAT.dwFourCC is at absolute offset 84; "DX10" => 20-byte DDS_HEADER_DXT10 follows.
  const dx10 = buf[84] === 0x44 && buf[85] === 0x58 && buf[86] === 0x31 && buf[87] === 0x30;
  return buf.slice(dx10 ? 148 : 128);
}

function texconv(args: string[]): void {
  execFileSync(TEXCONV, ["-nologo", "-y", ...args], { stdio: "inherit" });
}

function main(): void {
  const srcDir = join(HERE, "sources");
  const imgDir = join(HERE, "images");
  const tmp = join(HERE, ".tmp");
  for (const d of [srcDir, imgDir]) mkdirSync(d, { recursive: true });

  const manifest: {
    name: string;
    format: string;
    width: number;
    height: number;
    input: string;
    expected: string;
    channelMap: ChannelMap;
  }[] = [];

  for (const s of SOURCES) {
    const tga = join(srcDir, `${s.name}.tga`);
    writeTga(tga, s.w, s.h, s.px);
    for (const f of FORMATS) {
      const encDir = join(tmp, "enc");
      const decDir = join(tmp, "dec");
      mkdirSync(encDir, { recursive: true });
      mkdirSync(decDir, { recursive: true });

      // Encode source -> single-mip BCn .dds. `-bc x` enables the slow BC7 modes 0/2 (max quality).
      texconv(["-m", "1", "-f", f.texconv, ...(f.bc7max ? ["-bc", "x"] : []), "-o", encDir, tga]);
      const encDds = join(encDir, `${s.name}.DDS`);
      writeFileSync(join(imgDir, `${s.name}.${f.key}.bin`), stripDds(encDds));

      // Decode BCn .dds -> single-mip R8G8B8A8 .dds -> strip -> golden RGBA (standard order).
      texconv(["-m", "1", "-f", "R8G8B8A8_UNORM", "-o", decDir, encDds]);
      const golden = stripDds(join(decDir, `${s.name}.DDS`));
      if (golden.length !== s.w * s.h * 4)
        throw new Error(`golden ${s.name}.${f.key}: got ${golden.length} bytes, want ${s.w * s.h * 4}`);
      writeFileSync(join(imgDir, `${s.name}.${f.key}.rgba`), golden);

      manifest.push({
        name: `${s.name}.${f.key}`,
        format: f.xiv,
        width: s.w,
        height: s.h,
        input: `images/${s.name}.${f.key}.bin`,
        expected: `images/${s.name}.${f.key}.rgba`,
        channelMap: f.channelMap,
      });
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(join(HERE, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // Report BC7 mode coverage so any gap is visible (the test asserts all 8 modes are present).
  const modes = new Set<number>();
  for (const s of SOURCES) {
    const bin = new Uint8Array(readFileSync(join(imgDir, `${s.name}.bc7.bin`)));
    for (let off = 0; off + 16 <= bin.length; off += 16) modes.add(bc7BlockMode(bin, off));
  }
  const covered = [...modes].filter((m) => m >= 0).sort((a, b) => a - b);
  console.log("BC7 modes covered:", covered.join(", "));
  const missing = [0, 1, 2, 3, 4, 5, 6, 7].filter((m) => !modes.has(m));
  if (missing.length)
    console.warn(
      `MISSING BC7 modes: ${missing.join(", ")} — hand-author a fallback block per README "Filling mode gaps".`,
    );
}

main();
```

- [ ] **Step 3: Run the regen script and inspect mode coverage**

```powershell
npx tsx test/tex/fixtures/bcn/regen.ts
```

Expected: texconv logs per file; final line `BC7 modes covered: 0, 1, 2, 3, 4, 5, 6, 7`. Confirm `test/tex/fixtures/bcn/manifest.json` has **24** entries and `images/` has **48** files (24 `.bin` + 24 `.rgba`), `sources/` has 4 `.tga`.

If the run prints `MISSING BC7 modes: …`: the encoder did not emit those modes for this content. Follow the README "Filling mode gaps" fallback (hand-author one block for each missing mode, wrap in a DDS, texconv-decode to a golden, add a `blocks/bc7-mode<N>.*` vector to `manifest.json` with `format: "BC7", channelMap: "swapRB"`). Re-run until covered set is `0..7`. Do **not** proceed with a gap.

- [ ] **Step 4: Write the fixtures README (provenance + coverage placeholder)**

Create `test/tex/fixtures/bcn/README.md`:

```markdown
# BCn decode golden fixtures

Golden test vectors for the BCn decoder (`src/tex/decode.ts`, `src/tex/bc7.ts`), independent of the
modpack corpus and of TexTools. See `docs/superpowers/specs/2026-07-04-bcn-decode-golden-fixtures-design.md`.

## What's here

- `sources/*.tga` — small, deterministic, procedurally-generated source images (viewable).
- `images/<name>.<fmt>.bin` — raw compressed mip bytes (texconv encode of the source, DDS container stripped).
- `images/<name>.<fmt>.rgba` — golden RGBA8888, **standard channel order**, exactly texconv's decode.
- `manifest.json` — the vector list the test iterates.
- `blocks/*` — present only if a BC7 mode had to be hand-authored (see "Filling mode gaps").

## Oracle

DirectXTex `texconv` (Microsoft's reference BCn codec). Version used: **<record the release tag / date here>**.
BCn decode is bit-exact and spec-defined, so texconv's output is authoritative and independent of our
ported lineage. texconv is a dev-time tool — **not committed** and **not** an npm dependency.

## Channel order

texconv emits standard RGBA. Our decoder applies TexTools conventions on top of a standard decode; the
test applies the same mapping to the golden before comparing (`applyChannelMap`):

| Format | channelMap | Our output vs. standard |
|---|---|---|
| DXT1 / DXT3 / DXT5 | `none` | unchanged |
| BC4 | `grayFromR` | red replicated across RGB, opaque (R,R,R,255) |
| BC5 | `swapRB` | R<->B swap: (0, ch1, ch0, 255) |
| BC7 | `swapRB` | R<->B swap on the decoded block |

## Regenerate

Requires `texconv` on PATH (or `TEXCONV=C:\path\to\texconv.exe`):

    npx tsx test/tex/fixtures/bcn/regen.ts

It regenerates `sources/`, `images/`, and `manifest.json`, then prints the covered BC7 mode set.

## Filling mode gaps

If `regen.ts` warns that a BC7 mode is missing, hand-author one valid block for that mode (extend the
mode-6 builder in `test/tex/make-tex.ts`), write the 16 raw bytes to `blocks/bc7-mode<N>.bin`, wrap them
in a 4x4 BC7 DDS and `texconv -f R8G8B8A8_UNORM` it to `blocks/bc7-mode<N>.rgba`, and add a manifest entry
`{ name, format: "BC7", width: 4, height: 4, input, expected, channelMap: "swapRB" }`. The mode-coverage
test then goes green.

## Coverage impact

<!-- filled in by the coverage-assessment task -->
```

- [ ] **Step 5: Commit the fixtures + tooling**

```powershell
npm run check; npm run typecheck
git add test/tex/fixtures/bcn
git commit -m "test(tex): generate committed BCn decode golden fixtures (texconv)"
```

Expected: `check` and `typecheck` green (note: the consuming test lands in Task 3, so `npm test` isn't the gate for this fixture-only commit; it runs at Task 3). Commit succeeds and includes `regen.ts`, `README.md`, `sources/`, `images/`, `manifest.json` (and `blocks/` if used).

---

## Task 3: Manifest-driven golden decode test + BC7 mode-coverage guard

**Files:**
- Create: `test/tex/tex-bcn-golden.test.ts`

**Interfaces:**
- Consumes: `decodeToRgba` (`src/tex/decode.ts`); format constants from `src/tex/types.ts`; `applyChannelMap`, `bc7BlockMode`, `ChannelMap` (`test/tex/golden-util.ts`); `manifest.json` (Task 2).
- Produces: nothing (leaf test).

- [ ] **Step 1: Write the test**

Create `test/tex/tex-bcn-golden.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeToRgba } from "../../src/tex/decode";
import { BC4, BC5, BC7, DXT1, DXT3, DXT5, type XivTex } from "../../src/tex/types";
import { applyChannelMap, bc7BlockMode, type ChannelMap } from "./golden-util";

const dir = join(__dirname, "fixtures", "bcn");

interface Vector {
  name: string;
  format: string;
  width: number;
  height: number;
  input: string;
  expected: string;
  channelMap: ChannelMap;
}

const manifest: Vector[] = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));

const FORMAT_CODES: Record<string, number> = {
  DXT1,
  DXT3,
  DXT5,
  BC4,
  BC5,
  BC7,
};

function texOf(format: number, width: number, height: number, mipData: Uint8Array): XivTex {
  return {
    attributes: 0,
    format,
    width,
    height,
    depth: 1,
    mipCount: 1,
    mipFlag: 0,
    arraySize: 1,
    lodMips: [0, 0, 0],
    mipMapOffsets: new Array(13).fill(0),
    mipData,
  };
}

describe("tex BCn golden decode (texconv oracle)", () => {
  it("manifest is non-empty", () => {
    expect(manifest.length).toBeGreaterThan(0);
  });

  for (const v of manifest) {
    it(`${v.name} decodes to the texconv golden (${v.format} ${v.width}x${v.height})`, () => {
      const code = FORMAT_CODES[v.format];
      expect(code, `unknown format ${v.format}`).toBeDefined();
      const input = new Uint8Array(readFileSync(join(dir, v.input)));
      const golden = new Uint8Array(readFileSync(join(dir, v.expected)));
      const ours = decodeToRgba(texOf(code as number, v.width, v.height, input));
      const expected = applyChannelMap(golden, v.channelMap);
      expect(ours.length).toBe(expected.length);
      expect(Buffer.from(ours).equals(Buffer.from(expected))).toBe(true);
    });
  }
});

describe("tex BCn golden: BC7 mode coverage", () => {
  it("BC7 fixtures cover all 8 modes (0-7)", () => {
    const modes = new Set<number>();
    for (const v of manifest) {
      if (v.format !== "BC7") continue;
      const input = new Uint8Array(readFileSync(join(dir, v.input)));
      for (let off = 0; off + 16 <= input.length; off += 16) modes.add(bc7BlockMode(input, off));
    }
    expect([...modes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes on the committed fixtures**

Run: `npx vitest run test/tex/tex-bcn-golden.test.ts`
Expected: PASS — 24 decode-match tests + `manifest is non-empty` + `BC7 fixtures cover all 8 modes`, all green.

- [ ] **Step 3: Prove the test is not vacuous (catches a real regression)**

Temporarily corrupt one golden byte and confirm the matching test goes red, then restore it:

```powershell
$g = "test/tex/fixtures/bcn/images/grad.bc7.rgba"
$b = [System.IO.File]::ReadAllBytes($g); $orig = $b[0]; $b[0] = ($b[0] -bxor 0xFF)
[System.IO.File]::WriteAllBytes($g, $b)
npx vitest run test/tex/tex-bcn-golden.test.ts        # expect: the grad.bc7 test FAILS
$b[0] = $orig; [System.IO.File]::WriteAllBytes($g, $b)
npx vitest run test/tex/tex-bcn-golden.test.ts        # expect: all green again
```

Expected: first run fails on `grad.bc7`; after restore, all green. (If the perturbed run stays green, the test is wired wrong — stop and fix before continuing.)

- [ ] **Step 4: Ritual + commit**

```powershell
npm run check; npm run typecheck; npm test
git add test/tex/tex-bcn-golden.test.ts
git commit -m "test(tex): manifest-driven BCn golden decode + BC7 mode-coverage guard"
```

Expected: all three green; commit succeeds.

---

## Task 4: Downgrade the covered `PROVISIONAL` / `TODO` comments

**Files:**
- Modify: `src/tex/bc7.ts:5-7` and `src/tex/bc7.ts:11-12`
- Modify: `src/tex/decode.ts:396-398`

**Interfaces:**
- Consumes: nothing (comment-only change).
- Produces: nothing.

- [ ] **Step 1: Update `src/tex/bc7.ts` — remove the modes TODO**

Replace:

```ts
// TODO(oracle-stage): only mode 6 has a known-answer unit test; modes 0-5/7 are exercised on real
// corpus textures by the decode-smoke (output length only), so their pixel output is unverified until
// a per-mode golden fixture lands with the transforms/oracle work (design spec §6; PR #5 review #2).
```

with:

```ts
// BC7 modes 0-7 are verified pixel-exact against the DirectXTex `texconv` reference decoder by the
// golden-fixture suite (test/tex/tex-bcn-golden.test.ts), which also asserts all 8 modes are covered.
```

- [ ] **Step 2: Update `src/tex/bc7.ts` — settle the swap note**

Replace:

```ts
// PROVISIONAL: the pre-swap byte order vs the native Bc7Sharp is unverified until the oracle stage
// confirms it — do not treat the absolute channel order as settled (design spec §5/§6).
```

with:

```ts
// The red/blue swap (applied on top of a standard-order block decode) is verified against texconv in
// test/tex/tex-bcn-golden.test.ts (channelMap "swapRB"); the channel order is settled.
```

- [ ] **Step 3: Update `src/tex/decode.ts` — settle the BC5 note**

Replace:

```ts
 *  PROVISIONAL: the pre-swap byte order vs the native Bc5Sharp is unverified until the transforms/
 *  oracle stage confirms it against a golden (design spec §5/§6) — do not treat the absolute channel
 *  order as settled. */
```

with:

```ts
 *  Verified against texconv (BC5_UNORM) in test/tex/tex-bcn-golden.test.ts (channelMap "swapRB"): the
 *  net R=0, G=ch1, B=ch0, A=255 layout is settled. */
```

- [ ] **Step 4: Ritual + commit**

```powershell
npm run check; npm run typecheck; npm test
git add src/tex/bc7.ts src/tex/decode.ts
git commit -m "docs(tex): mark BC7 modes + BC5/BC7 channel order verified against texconv"
```

Expected: all three green; commit succeeds.

---

## Task 5: Coverage-change assessment

**Files:**
- Modify: `test/tex/fixtures/bcn/README.md` (fill the "Coverage impact" section)

**Interfaces:**
- Consumes: the baseline numbers recorded in Task 1 Step 1.
- Produces: a written before/after assessment (spec §8, required deliverable).

- [ ] **Step 1: Capture the "after" coverage**

```powershell
npm run test:coverage
$s = Get-Content coverage/coverage-summary.json | ConvertFrom-Json
$s.PSObject.Properties | Where-Object { $_.Name -match 'tex[\\/](decode|bc7)\.ts$' } |
  ForEach-Object { "{0}: lines {1}% branches {2}% funcs {3}%" -f $_.Name, $_.Value.lines.pct, $_.Value.branches.pct, $_.Value.functions.pct }
```

Expected: two lines for `decode.ts` and `bc7.ts`.

- [ ] **Step 2: Write the assessment into the README**

Replace the `<!-- filled in by the coverage-assessment task -->` line under "## Coverage impact" with a table
of the **before** (Task 1) and **after** (Step 1) line/branch/function % for `src/tex/decode.ts` and
`src/tex/bc7.ts`, plus 2-4 sentences naming what newly-exercised: the BC7 per-mode block paths (all 8
modes now decoded, not just mode 6), the BC4 `grayFromR` and BC5/BC7 `swapRB` channel paths, and the
partial-edge-block clip paths (from the 65x33 `edge` fixtures). If a metric was already 100% at baseline
(e.g. the corpus already covered a line), say so and note that the new value is **branch/behavioural**
verification (pixel-exact, per mode) rather than a line-count delta — this is the honest framing per spec
§8, not a claim that lines moved when they didn't.

Example shape (fill with real numbers):

```markdown
## Coverage impact

`npm run test:coverage`, before vs. after these fixtures:

| File | lines | branches | functions |
|---|---|---|---|
| `src/tex/decode.ts` | 92% → 98% | 78% → 95% | 100% → 100% |
| `src/tex/bc7.ts` | 85% → 99% | 60% → 92% | 100% → 100% |

Newly exercised: all 8 BC7 modes decode pixel-exact (previously only mode 6 had a known-answer test;
modes 0-5/7 were length-only on corpus); the BC4 gray and BC5/BC7 R<->B channel mappings; and the
partial-edge-block clip paths via the 65x33 `edge` fixtures. Lines already at 100% from corpus smoke are
noted as branch/behavioural gains, not line deltas.
```

- [ ] **Step 3: Ritual + commit**

```powershell
npm run check; npm run typecheck; npm test
git add test/tex/fixtures/bcn/README.md
git commit -m "docs(tex): record BCn decoder coverage impact of golden fixtures"
```

Expected: all three green; commit succeeds.

---

## Self-review notes (for the executor)

- **Coverage summary path/keys:** `coverage/coverage-summary.json` keys are absolute file paths; the
  `-match 'tex[\\/](decode|bc7)\.ts$'` filter handles either separator. If zero rows print, the run
  didn't include those files — confirm `test:coverage` completed and `coverage/` was written.
- **texconv quality flag:** `-bc x` requests the slow max-quality BC7 modes (0/2). If your texconv build
  rejects the flag or still misses modes 0/2, the regen warning fires — use the README fallback to
  hand-author the missing mode(s). Never leave the mode-coverage test red.
- **DDS strip robustness:** `stripDds` auto-detects the DX10 extended header, so it works whether texconv
  writes legacy or DX10 headers for a given format.
- **texconv resolution on Windows:** `execFileSync("texconv", …)` relies on `CreateProcess` finding
  `texconv.exe` on `PATH`. If it isn't found (ENOENT), set `TEXCONV` to the full path including `.exe`
  before running, e.g. `$env:TEXCONV = "C:\tools\texconv.exe"; npx tsx test/tex/fixtures/bcn/regen.ts`.
- **texconv output casing:** texconv writes `<base>.dds`/`.DDS`; the script reads `<base>.DDS`, which
  resolves either way on Windows' case-insensitive filesystem.
- **No product-logic change:** Tasks 1-3 and 5 are test/tooling/docs only; Task 4 is comments only. The
  decoder behaviour is unchanged — the fixtures verify existing behaviour, they don't alter it.
