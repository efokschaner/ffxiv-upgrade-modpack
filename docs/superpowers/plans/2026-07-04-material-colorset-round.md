# Material/Colorset Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Endwalker→Dawntrail **material** transform (round 1 of the
upgrade pipeline) so upgraded `.mtrl` files byte-match ConsoleTools `/upgrade`,
burning down the corpus baseline's 416 `.mtrl` mismatches.

**Architecture:** `upgradeModpack` gains a real per-option round structure. The
material round decodes each `chara/**.mtrl`, parses it with the existing mtrl
codec, applies the EW→DT transform (colorset 256→1024 remap, dye 2→4 remap, DX9
strip, index-sampler add, spec→mask compat, hair + glass branches), and re-stores
it. Texture *generation* is deferred to round 2 — this round only rewrites `.mtrl`
bytes and records `UpgradeInfo` targets. Reference values consumed from two
base-game mtrls (hair/glass shader params) are extracted once via ConsoleTools and
checked in as numeric constant tables.

**Tech Stack:** TypeScript, Vitest, existing `src/mtrl` + `src/sqpack` codecs,
`test/helpers/oracle.ts` (`extractGameFile`), the golden-harness ratchet.

## Global Constraints

- **Match ConsoleTools byte-for-byte.** Upgraded `.mtrl` files are NOT on the
  divergence allow-list; they must be byte-identical to the golden (harness spec
  §3). The corpus ratchet is the gate.
- **Immutable in/out.** `upgradeModpack` returns a new `ModpackData`; never mutate
  input arrays/objects (the skeleton's `cloneModpack` invariant, verified by
  `test/upgrade/upgrade.test.ts`).
- **Changed files keep the source storage form.** A rewritten mtrl from a
  `SqPackCompressed` (ttmp) source is re-encoded via `encodeSqPackFile(bytes,
  SqPackType.Standard)`; from a `RawUncompressed` (pmp) source it is stored raw.
  This keeps `writeModpack`'s single-storage-form invariant intact.
- **No game assets committed.** Reference tables are generated numeric `.ts`
  files carrying a one-line "regenerate via `scripts/<x>.ts`" comment only.
- **End-of-task ritual:** `npm run check` && `npm run typecheck` && `npm test`
  green before any task is considered done.
- **Faithful port:** every transform detail cites its C# origin
  (`reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/Mods/EndwalkerUpgrade.cs`,
  `.../Materials/DataContainers/ShaderHelpers.cs`). When our model and C# differ,
  match C#'s *output bytes*, proven by the ratchet.

---

## Task 1: Float→half helper

**Files:**
- Create: `src/util/half.ts`
- Test: `test/util/half.test.ts`

**Interfaces:**
- Produces: `floatToHalf(value: number): number` — IEEE-754 binary16 raw uint16,
  round-to-nearest-even. Used by later tasks for the colorset constant rows (all
  exactly-representable constants: 0, 0.5, 1, 2.5, 16, 0.8100586).

- [ ] **Step 1: Write the failing test**

```ts
// test/util/half.test.ts
import { describe, expect, it } from "vitest";
import { floatToHalf } from "../../src/util/half";

describe("floatToHalf", () => {
  it("encodes exact half values", () => {
    expect(floatToHalf(0)).toBe(0x0000);
    expect(floatToHalf(0.5)).toBe(0x3800);
    expect(floatToHalf(1)).toBe(0x3c00);
    expect(floatToHalf(2.5)).toBe(0x4100);
    expect(floatToHalf(16)).toBe(0x4c00);
    expect(floatToHalf(0.8100586)).toBe(0x3a7b);
    expect(floatToHalf(-1)).toBe(0xbc00);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/util/half.test.ts`
Expected: FAIL — cannot find module `../../src/util/half`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/util/half.ts
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** float32 -> IEEE-754 binary16 raw uint16 (round-to-nearest-even). */
export function floatToHalf(value: number): number {
  f32[0] = value;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  let exp = (x >>> 23) & 0xff;
  let mant = x & 0x007fffff;

  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x0200 : 0); // Inf/NaN
  exp = exp - 127 + 15;
  if (exp >= 0x1f) return sign | 0x7c00; // overflow -> Inf
  if (exp <= 0) {
    if (exp < -10) return sign; // underflow -> signed zero
    mant |= 0x00800000;
    const shift = 14 - exp;
    let half = mant >> shift;
    if ((mant >> (shift - 1)) & 1) half += 1; // round to nearest even
    return sign | half;
  }
  let half = sign | (exp << 10) | (mant >> 13);
  if (mant & 0x00001000) half += 1; // round to nearest even
  return half;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/util/half.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/util/half.ts test/util/half.test.ts
git commit -m "feat(util): add floatToHalf (binary16 encode) for colorset upgrade"
```

---

## Task 2: Shader-pack + sampler infrastructure

**Files:**
- Create: `src/mtrl/shader.ts`
- Test: `test/mtrl/mtrl-shader.test.ts`

**Interfaces:**
- Consumes: `XivMtrl` from `src/mtrl/types.ts`, `floatToHalf` from Task 1.
- Produces:
  - shpk name constants `SHPK_CHARACTER`, `SHPK_CHARACTER_LEGACY`,
    `SHPK_CHARACTER_GLASS`, `SHPK_HAIR`, `SHPK_SKIN`.
  - `ESamplerId` const object (raw CRC uint32s).
  - `enum XivTexType { Other, Diffuse, Normal, Specular, Mask, Index, ... }`.
  - `samplerIdToTexUsage(samplerId: number, mtrl: XivMtrl): XivTexType`.
  - `getDefaultColorsetRow(shpk: string): number[]` — 32 raw half uint16s.

Port from `ShaderHelpers.cs:432-524` (`SamplerIdToTexUsage`, `ESamplerId`) and
`EndwalkerUpgrade.cs:1229-1282` (`GetDefaultColorsetRow`).

- [ ] **Step 1: Write the failing test**

```ts
// test/mtrl/mtrl-shader.test.ts
import { describe, expect, it } from "vitest";
import { floatToHalf } from "../../src/util/half";
import {
  ESamplerId,
  getDefaultColorsetRow,
  SHPK_CHARACTER_GLASS,
  SHPK_CHARACTER_LEGACY,
  samplerIdToTexUsage,
  XivTexType,
} from "../../src/mtrl/shader";
import type { XivMtrl } from "../../src/mtrl/types";

function mtrl(shpk: string, keys: { keyId: number; value: number }[] = []): XivMtrl {
  return {
    signature: 0x00000301, shaderPackRaw: shpk, additionalData: new Uint8Array(4),
    textures: [], uvMapStrings: [], colorsetStrings: [], colorSetData: [],
    colorSetDyeData: new Uint8Array(0), shaderKeys: keys, shaderConstants: [],
    materialFlags: 0, materialFlags2: 0, mtrlPath: "",
  };
}

describe("samplerIdToTexUsage", () => {
  it("maps the character-material samplers", () => {
    const m = mtrl("character.shpk");
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerNormal, m)).toBe(XivTexType.Normal);
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerMask, m)).toBe(XivTexType.Mask);
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerIndex, m)).toBe(XivTexType.Index);
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerDiffuse, m)).toBe(XivTexType.Diffuse);
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerSpecular, m)).toBe(XivTexType.Specular);
  });

  it("treats a legacy mask-as-spec material's mask sampler as specular", () => {
    // ShaderHelpers.cs:435 — CharacterLegacy + key 0xB616DC5A==0x600EF9DF
    const m = mtrl(SHPK_CHARACTER_LEGACY, [{ keyId: 0xb616dc5a, value: 0x600ef9df }]);
    expect(samplerIdToTexUsage(ESamplerId.g_SamplerMask, m)).toBe(XivTexType.Specular);
  });
});

describe("getDefaultColorsetRow", () => {
  it("fills the shared base fields", () => {
    const row = getDefaultColorsetRow(SHPK_CHARACTER_LEGACY);
    expect(row.length).toBe(32);
    for (let i = 0; i < 8; i++) expect(row[i]).toBe(floatToHalf(1.0)); // diffuse+spec base
    expect(row[6 * 4 + 2]).toBe(floatToHalf(1.0)); // tile opacity
    expect(row[7 * 4 + 0]).toBe(floatToHalf(16.0));
    expect(row[7 * 4 + 3]).toBe(floatToHalf(16.0));
  });

  it("adds glass-only fields", () => {
    const row = getDefaultColorsetRow(SHPK_CHARACTER_GLASS);
    expect(row[3 * 4 + 2]).toBe(floatToHalf(2.5)); // fresnel term
    expect(row[4 * 4 + 0]).toBe(floatToHalf(0.5)); // roughness
    expect(row[6 * 4 + 3]).toBe(floatToHalf(5)); // submat unknown
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mtrl/mtrl-shader.test.ts`
Expected: FAIL — cannot find module `../../src/mtrl/shader`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/mtrl/shader.ts
import { floatToHalf } from "../util/half";
import type { XivMtrl } from "./types";

export const SHPK_CHARACTER = "character.shpk";
export const SHPK_CHARACTER_LEGACY = "characterlegacy.shpk";
export const SHPK_CHARACTER_GLASS = "characterglass.shpk";
export const SHPK_HAIR = "hair.shpk";
export const SHPK_SKIN = "skin.shpk";

// ShaderHelpers.cs:480-524 — raw sampler CRCs used by the character/hair transform.
export const ESamplerId = {
  g_SamplerNormal: 0x0c5ec1f1,
  g_SamplerNormalMap0: 0xaab4d9e9,
  g_SamplerNormalMap1: 0xddb3e97f,
  g_SamplerNormal2: 0x0261cdcb,
  g_SamplerTileNormal: 0x92f03e53,
  g_SamplerSpecular: 0x2b99e025,
  g_SamplerSpecularMap0: 0x1bbc2f12,
  g_SamplerSpecularMap1: 0x6cbb1f84,
  g_SamplerDiffuse: 0x115306be,
  g_SamplerColorMap0: 0x1e6fef9c,
  g_SamplerColorMap1: 0x6968df0a,
  g_SamplerMask: 0x8a4e82b6,
  g_SamplerWrinklesMask: 0xb3f13975,
  g_SamplerIndex: 0x565f8fd8,
} as const;

export enum XivTexType {
  Other = 0,
  Diffuse,
  Normal,
  Specular,
  Mask,
  Index,
}

// ShaderHelpers.cs:432-478 — the chara-relevant subset of SamplerIdToTexUsage.
export function samplerIdToTexUsage(samplerId: number, mtrl: XivMtrl): XivTexType {
  if (
    mtrl.shaderPackRaw === SHPK_CHARACTER_LEGACY &&
    mtrl.shaderKeys.some((k) => k.keyId === 0xb616dc5a && k.value === 0x600ef9df) &&
    samplerId === ESamplerId.g_SamplerMask
  ) {
    return XivTexType.Specular; // mask-as-spec compatibility material
  }
  switch (samplerId) {
    case ESamplerId.g_SamplerNormal:
    case ESamplerId.g_SamplerNormal2:
    case ESamplerId.g_SamplerNormalMap0:
    case ESamplerId.g_SamplerNormalMap1:
    case ESamplerId.g_SamplerTileNormal:
      return XivTexType.Normal;
    case ESamplerId.g_SamplerMask:
    case ESamplerId.g_SamplerWrinklesMask:
      return XivTexType.Mask;
    case ESamplerId.g_SamplerIndex:
      return XivTexType.Index;
    case ESamplerId.g_SamplerDiffuse:
    case ESamplerId.g_SamplerColorMap0:
    case ESamplerId.g_SamplerColorMap1:
      return XivTexType.Diffuse;
    case ESamplerId.g_SamplerSpecular:
    case ESamplerId.g_SamplerSpecularMap0:
    case ESamplerId.g_SamplerSpecularMap1:
      return XivTexType.Specular;
    default:
      return XivTexType.Other;
  }
}

// EndwalkerUpgrade.cs:1229-1282
export function getDefaultColorsetRow(shpk: string): number[] {
  const row = new Array<number>(32).fill(0);
  for (let i = 0; i < 8; i++) row[i] = floatToHalf(1.0);
  row[6 * 4 + 2] = floatToHalf(1.0); // tile opacity
  row[7 * 4 + 0] = floatToHalf(16.0);
  row[7 * 4 + 3] = floatToHalf(16.0);
  if (shpk === SHPK_CHARACTER_GLASS) {
    row[1 * 4 + 3] = floatToHalf(0);
    row[2 * 4 + 3] = floatToHalf(1);
    row[3 * 4 + 0] = floatToHalf(1);
    row[3 * 4 + 1] = floatToHalf(0);
    row[3 * 4 + 2] = floatToHalf(2.5);
    row[4 * 4 + 0] = floatToHalf(0.5);
    row[5 * 4 + 1] = floatToHalf(1);
    row[6 * 4 + 3] = floatToHalf(5);
  }
  return row;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mtrl/mtrl-shader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/mtrl/shader.ts test/mtrl/mtrl-shader.test.ts
git commit -m "feat(mtrl): add shader-pack/sampler usage helpers for EW->DT upgrade"
```

---

## Task 3: Colorset 256→1024 remap

**Files:**
- Create: `src/upgrade/upgrade-info.ts` (shared types, used from Task 5 on)
- Create: `src/upgrade/colorset-upgrade.ts`
- Test: `test/upgrade/colorset-upgrade.test.ts`

**Interfaces:**
- Consumes: `getDefaultColorsetRow`, shpk constants (Task 2); `floatToHalf` (Task 1).
- Produces:
  - `upgradeColorsetData(old: number[], shpk: string): number[]` — 256→1024 halves.
  - `upgradeDyeData(oldDye: Uint8Array, shpk: string): Uint8Array` — 32→128 bytes.
  - In `upgrade-info.ts`: `enum EUpgradeTextureUsage { IndexMaps, GearMaskLegacy,
    GearMaskNew, HairMaps }` and `interface UpgradeInfo { usage:
    EUpgradeTextureUsage; files: Record<string, string> }`.

Port the colorset loop `EndwalkerUpgrade.cs:797-873` and the dye loop `:877-906`.
Note: old→new value copies preserve the **raw half uint16** (C# copies `Half`
values); only the injected constants go through `floatToHalf`.

- [ ] **Step 1: Write the failing test**

```ts
// test/upgrade/colorset-upgrade.test.ts
import { describe, expect, it } from "vitest";
import { floatToHalf } from "../../src/util/half";
import { SHPK_CHARACTER_LEGACY } from "../../src/mtrl/shader";
import {
  upgradeColorsetData,
  upgradeDyeData,
} from "../../src/upgrade/colorset-upgrade";

describe("upgradeColorsetData", () => {
  it("expands 256 halves to 1024 and places row 0 diffuse", () => {
    const old = new Array<number>(256).fill(0);
    old[0] = floatToHalf(0.25); // diffuse R
    old[1] = floatToHalf(0.5); // diffuse G
    old[2] = floatToHalf(0.75); // diffuse B
    old[7] = floatToHalf(0.9); // legacy gloss -> new diffuse alpha (offset+3)
    const out = upgradeColorsetData(old, SHPK_CHARACTER_LEGACY);
    expect(out.length).toBe(1024);
    expect(out[0]).toBe(floatToHalf(0.25));
    expect(out[1]).toBe(floatToHalf(0.5));
    expect(out[2]).toBe(floatToHalf(0.75));
    expect(out[3]).toBe(floatToHalf(0.9)); // legacy spec-power/gloss swap
    // subsurface alpha default injected at row0 offset 26
    expect(out[26]).toBe(floatToHalf(1.0));
    // untouched extra rows carry the default template
    expect(out[16 * 32 + 7 * 4 + 0]).toBe(floatToHalf(16.0));
  });
});

describe("upgradeDyeData", () => {
  it("remaps a 5-bit template block to 32-bit with +1000 for non-legacy", () => {
    const old = new Uint8Array(32);
    // block 0: template 3, dyebits 0x1F  -> low16 = (3<<5)|0x1F = 0x7F
    old[0] = 0x7f;
    old[1] = 0x00;
    const legacy = upgradeDyeData(old, SHPK_CHARACTER_LEGACY);
    expect(legacy.length).toBe(128);
    const dvL = new DataView(legacy.buffer);
    expect(dvL.getUint32(0, true)).toBe((3 << 16) | 0x1f);
    const nonLegacy = upgradeDyeData(old, "characterglass.shpk");
    const dvN = new DataView(nonLegacy.buffer);
    expect(dvN.getUint32(0, true)).toBe((1003 << 16) | 0x1f);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/colorset-upgrade.test.ts`
Expected: FAIL — cannot find module `colorset-upgrade`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/upgrade/upgrade-info.ts
export enum EUpgradeTextureUsage {
  IndexMaps = "IndexMaps",
  GearMaskLegacy = "GearMaskLegacy",
  GearMaskNew = "GearMaskNew",
  HairMaps = "HairMaps",
}
export interface UpgradeInfo {
  usage: EUpgradeTextureUsage;
  files: Record<string, string>;
}
```

```ts
// src/upgrade/colorset-upgrade.ts
import {
  getDefaultColorsetRow,
  SHPK_CHARACTER_GLASS,
  SHPK_CHARACTER_LEGACY,
} from "../mtrl/shader";
import { floatToHalf } from "../util/half";

const HALF_ONE = floatToHalf(1.0);
const HALF_GLASS_SPEC = floatToHalf(0.8100586);

// EndwalkerUpgrade.cs:797-873. `old` is 256 raw half uint16s (16 rows x 16).
export function upgradeColorsetData(old: number[], shpk: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < 32; i++) out.push(...getDefaultColorsetRow(shpk));

  for (let i = 0; i < 16; i++) {
    let pixel = i * 16;
    let offset = i * 8 * 4;

    // Diffuse
    out[offset + 0] = old[pixel + 0]!;
    out[offset + 1] = old[pixel + 1]!;
    out[offset + 2] = old[pixel + 2]!;
    if (shpk === SHPK_CHARACTER_LEGACY) out[offset + 3] = old[pixel + 7]!;

    pixel += 4;
    offset += 4;

    // Specular
    if (shpk === SHPK_CHARACTER_GLASS) {
      out[offset + 0] = HALF_GLASS_SPEC;
      out[offset + 1] = HALF_GLASS_SPEC;
      out[offset + 2] = HALF_GLASS_SPEC;
    } else {
      out[offset + 0] = old[pixel + 0]!;
      out[offset + 1] = old[pixel + 1]!;
      out[offset + 2] = old[pixel + 2]!;
    }
    if (shpk === SHPK_CHARACTER_LEGACY) out[offset + 3] = old[pixel - 1]!;

    pixel += 4;
    offset += 4;

    // Emissive
    out[offset + 0] = old[pixel + 0]!;
    out[offset + 1] = old[pixel + 1]!;
    out[offset + 2] = old[pixel + 2]!;

    offset += 16; // skip 3 pixels + advance to the unknown/subsurface pixel

    out[offset + 1] = old[pixel + 3]!;
    out[offset + 2] = HALF_ONE; // subsurface material alpha

    pixel += 4;
    offset += 4;

    // Subsurface scaling
    out[offset + 0] = old[pixel + 0]!;
    out[offset + 1] = old[pixel + 1]!;
    out[offset + 2] = old[pixel + 2]!;
    out[offset + 3] = old[pixel + 3]!;
  }
  return out;
}

// EndwalkerUpgrade.cs:877-906. `oldDye` is 32 bytes (16 x uint16); output 128 (16 x uint32).
export function upgradeDyeData(oldDye: Uint8Array, shpk: string): Uint8Array {
  const out = new Uint8Array(128);
  const src = new DataView(oldDye.buffer, oldDye.byteOffset, oldDye.byteLength);
  const dst = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) {
    const oldBlock = src.getUint16(i * 2, true);
    const dyeBits = oldBlock & 0x1f;
    let template = oldBlock >>> 5;
    if (shpk !== SHPK_CHARACTER_LEGACY) template += 1000;
    dst.setUint32(i * 4, ((template << 16) | dyeBits) >>> 0, true);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade/colorset-upgrade.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/upgrade/upgrade-info.ts src/upgrade/colorset-upgrade.ts test/upgrade/colorset-upgrade.test.ts
git commit -m "feat(upgrade): colorset 256->1024 and dye 2->4 remaps"
```

---

## Task 4: Extract hair + glass shader params into checked-in tables

**Files:**
- Create: `scripts/extract-shader-params.ts`
- Create: `src/upgrade/reference/hair-shader-params.ts` (generated)
- Create: `src/upgrade/reference/glass-shader-params.ts` (generated)

**Interfaces:**
- Consumes: `parseMtrl` (`src/mtrl/mtrl.ts`), `extractGameFile`
  (`test/helpers/oracle.ts`), `decodeSqPackFile` (`src/sqpack/sqpack.ts`).
  `extractGameFile` writes a **SQPacked** file (Program.cs `/extract`); decode it
  before parsing.
- Produces (in each generated file):
  - hair: `export const HAIR_SHADER_CONSTANTS: { constantId: number; values:
    number[] }[]` and `export const HAIR_ADDITIONAL_DATA: number[]`.
  - glass: `export const GLASS_SHADER_KEYS: { keyId: number; value: number }[]`,
    `export const GLASS_SHADER_CONSTANTS: { constantId: number; values: number[]
    }[]`, `export const GLASS_ADDITIONAL_DATA: number[]`.

This task runs ConsoleTools against the local game install; it has no unit test —
its correctness is proven downstream by the corpus ratchet in Task 8.

- [ ] **Step 1: Write the extraction script**

```ts
// scripts/extract-shader-params.ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeSqPackFile } from "../src/sqpack/sqpack";
import { parseMtrl } from "../src/mtrl/mtrl";
import { extractGameFile } from "../test/helpers/oracle";

const HAIR = "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl";
const GLASS = "chara/equipment/e5001/material/v0001/mt_c0101e5001_met_b.mtrl";

function load(gamePath: string) {
  const dir = mkdtempSync(join(tmpdir(), "shparam-"));
  const dest = join(dir, "f.mtrl");
  extractGameFile(gamePath, dest);
  const raw = decodeSqPackFile(new Uint8Array(readFileSync(dest))).data;
  return parseMtrl(raw, gamePath);
}

const banner = "// GENERATED — regenerate via `npx tsx scripts/extract-shader-params.ts`. Do not edit by hand.\n";
const consts = (name: string, cs: { constantId: number; values: number[] }[]) =>
  `export const ${name}: { constantId: number; values: number[] }[] = ${JSON.stringify(
    cs.map((c) => ({ constantId: c.constantId, values: c.values })),
  )};\n`;

const hair = load(HAIR);
writeFileSync(
  "src/upgrade/reference/hair-shader-params.ts",
  banner +
    consts("HAIR_SHADER_CONSTANTS", hair.shaderConstants) +
    `export const HAIR_ADDITIONAL_DATA: number[] = ${JSON.stringify([...hair.additionalData])};\n`,
);

const glass = load(GLASS);
writeFileSync(
  "src/upgrade/reference/glass-shader-params.ts",
  banner +
    `export const GLASS_SHADER_KEYS: { keyId: number; value: number }[] = ${JSON.stringify(
      glass.shaderKeys.map((k) => ({ keyId: k.keyId, value: k.value })),
    )};\n` +
    consts("GLASS_SHADER_CONSTANTS", glass.shaderConstants) +
    `export const GLASS_ADDITIONAL_DATA: number[] = ${JSON.stringify([...glass.additionalData])};\n`,
);

console.log("wrote hair-shader-params.ts and glass-shader-params.ts");
```

- [ ] **Step 2: Run the script**

Run: `npx tsx scripts/extract-shader-params.ts`
Expected: prints `wrote hair-shader-params.ts and glass-shader-params.ts`; both
files created. (If `tsx` is unavailable, run via `npx vitest`-style loader or add
a `scripts` npm entry — check `package.json` for the project's TS-run convention.)

- [ ] **Step 3: Sanity-check the generated files**

Run: `npx biome format src/upgrade/reference/*.ts --write` then open both files.
Expected: `HAIR_SHADER_CONSTANTS` non-empty with plausible constant IDs;
`HAIR_ADDITIONAL_DATA` length 4; glass keys/constants non-empty.

- [ ] **Step 4: Commit**

```powershell
git add scripts/extract-shader-params.ts src/upgrade/reference/hair-shader-params.ts src/upgrade/reference/glass-shader-params.ts
git commit -m "feat(upgrade): extract hair/glass DT shader params as derived tables"
```

---

## Task 5: The per-material transform

**Files:**
- Create: `src/upgrade/material.ts`
- Test: `test/upgrade/material.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4; `XivMtrl`/`MtrlTexture`/`TextureSampler`
  from `src/mtrl/types.ts`.
- Produces:
  - `doesMtrlNeedDawntrailUpdate(mtrl: XivMtrl): boolean`.
  - `upgradeMaterial(mtrl: XivMtrl): UpgradeInfo[]` — **mutates** the passed
    `XivMtrl` in place (caller passes a freshly-parsed one) and returns the
    texture-upgrade targets. Handles colorset (character/legacy/skin/glass) and
    hair branches. No-op returns `[]`.

Port `DoesMtrlNeedDawntrailUpdate` (`:550`), `UpdateEndwalkerColorset`
(`:738-1072`, the `files != null` slices only — no texture creation), and
`UpdateEndwalkerHairMaterial` (`:1115-1173`, `files != null` slice).

**Dx11 path note:** C# uses `MtrlTexture.Dx11Path` (strips a leading `--` DX9
marker) when deriving `idPath` and when repointing samplers. Before Step 3, grep
the mtrl parser to see whether our `texturePath` already excludes `--`
(`git grep -n "\\-\\-" src/mtrl`). If the parser preserves `--`, add a local
`dx11Path(p: string): string { return p.replace("--", ""); }` and use it wherever
this port reads a texture path; if the parser already strips it, use `texturePath`
directly. Record which in a code comment.

- [ ] **Step 1: Write the failing test**

```ts
// test/upgrade/material.test.ts
import { describe, expect, it } from "vitest";
import { ESamplerId, SHPK_CHARACTER, SHPK_CHARACTER_LEGACY } from "../../src/mtrl/shader";
import type { MtrlTexture, XivMtrl } from "../../src/mtrl/types";
import {
  doesMtrlNeedDawntrailUpdate,
  upgradeMaterial,
} from "../../src/upgrade/material";
import { EUpgradeTextureUsage } from "../../src/upgrade/upgrade-info";

function tex(path: string, samplerId: number): MtrlTexture {
  return { texturePath: path, flags: 0, sampler: { samplerIdRaw: samplerId, samplerSettingsRaw: 0 } };
}
function characterColorsetMtrl(): XivMtrl {
  return {
    signature: 0x00000301, shaderPackRaw: SHPK_CHARACTER,
    additionalData: new Uint8Array(4),
    textures: [tex("chara/x/tex/foo_n.tex", ESamplerId.g_SamplerNormal)],
    uvMapStrings: [{ value: "", flags: 0 }], colorsetStrings: [],
    colorSetData: new Array<number>(256).fill(0),
    colorSetDyeData: new Uint8Array(0),
    shaderKeys: [], shaderConstants: [], materialFlags: 0, materialFlags2: 0,
    mtrlPath: "chara/x/mat/mt_foo.mtrl",
  };
}

describe("doesMtrlNeedDawntrailUpdate", () => {
  it("flags a 256-length colorset", () => {
    expect(doesMtrlNeedDawntrailUpdate(characterColorsetMtrl())).toBe(true);
  });
  it("leaves an already-1024 colorset alone", () => {
    const m = characterColorsetMtrl();
    m.colorSetData = new Array<number>(1024).fill(0);
    expect(doesMtrlNeedDawntrailUpdate(m)).toBe(false);
  });
});

describe("upgradeMaterial (colorset branch)", () => {
  it("switches character->legacy, expands colorset, adds an index sampler, records IndexMaps", () => {
    const m = characterColorsetMtrl();
    const infos = upgradeMaterial(m);
    expect(m.shaderPackRaw).toBe(SHPK_CHARACTER_LEGACY);
    expect(m.colorSetData.length).toBe(1024);
    expect(Array.from(m.additionalData)).toEqual([0x34, 0x05, 0, 0]);
    const idTex = m.textures.find((t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerIndex);
    expect(idTex?.texturePath).toBe("chara/x/tex/foo_id.tex");
    const idInfo = infos.find((i) => i.usage === EUpgradeTextureUsage.IndexMaps);
    expect(idInfo?.files).toEqual({ normal: "chara/x/tex/foo_n.tex", index: "chara/x/tex/foo_id.tex" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/material.test.ts`
Expected: FAIL — cannot find module `material`.

- [ ] **Step 3: Write the implementation**

Implement `src/upgrade/material.ts` porting the C# faithfully. Structure:

```ts
// src/upgrade/material.ts
import {
  ESamplerId, getDefaultColorsetRow, samplerIdToTexUsage,
  SHPK_CHARACTER, SHPK_CHARACTER_GLASS, SHPK_CHARACTER_LEGACY, SHPK_HAIR,
  XivTexType,
} from "../mtrl/shader";
import type { MtrlTexture, XivMtrl } from "../mtrl/types";
import { upgradeColorsetData, upgradeDyeData } from "./colorset-upgrade";
import { EUpgradeTextureUsage, type UpgradeInfo } from "./upgrade-info";
import { GLASS_ADDITIONAL_DATA, GLASS_SHADER_CONSTANTS, GLASS_SHADER_KEYS } from "./reference/glass-shader-params";
import { HAIR_ADDITIONAL_DATA, HAIR_SHADER_CONSTANTS } from "./reference/hair-shader-params";

const OLD_SHADER_CONSTANT_1 = 0x36080ad0;
const OLD_SHADER_CONSTANT_2 = 0x992869ab;

// EndwalkerUpgrade.cs:550
export function doesMtrlNeedDawntrailUpdate(mtrl: XivMtrl): boolean {
  if (mtrl.colorSetData.length === 256) return true;
  if (mtrl.shaderPackRaw === SHPK_HAIR) {
    return (
      mtrl.shaderConstants.some((c) => c.constantId === OLD_SHADER_CONSTANT_1) &&
      mtrl.shaderConstants.some((c) => c.constantId === OLD_SHADER_CONSTANT_2)
    );
  }
  return false;
}

export function upgradeMaterial(mtrl: XivMtrl): UpgradeInfo[] {
  if (!doesMtrlNeedDawntrailUpdate(mtrl)) return [];
  if (mtrl.colorSetData.length === 256) return upgradeColorsetMaterial(mtrl);
  if (mtrl.shaderPackRaw === SHPK_HAIR) return upgradeHairMaterial(mtrl);
  return [];
}
```

Then implement the two private branches. `upgradeColorsetMaterial` must, in this
order (matching `UpdateEndwalkerColorset`):
1. `character.shpk` → `characterlegacy.shpk` (`:747-751`).
2. For each texture, if `flags & 0x8000`, clear it and set path to its dx11 form
   (`:757-771`).
3. `mtrl.additionalData = Uint8Array [0x34,0x05,0,0]` (`:773`).
4. Glass only: overwrite `shaderKeys`/`shaderConstants`/`additionalData` from
   `GLASS_*`; clear material-flag bits `0x0004` and `0x0008` (`:774-788`).
5. `usesMaskAsSpec = shaderKeys.some(k => k.keyId===0xC8BD1DEF && (k.value===0xA02F4828 || k.value===0x198D11CD))` (`:909`).
6. `mtrl.colorSetData = upgradeColorsetData(old, shpk)` (`:797-876`).
7. If `colorSetDyeData.length > 0`: `mtrl.colorSetDyeData = upgradeDyeData(old, shpk)` (`:877-907`).
8. Compute `idPath` from the Normal-usage texture's (dx11) path: `_n.tex→_id.tex`,
   else `.tex→_id.tex` (`:912-921`). (idPath game-refinement `:923-936` is
   intentionally omitted; validated by Task 8's audit.)
9. Append an index `MtrlTexture` with `sampler = { samplerIdRaw:
   ESamplerId.g_SamplerIndex, samplerSettingsRaw: 0x000f8340 }`, `flags: 0`,
   `texturePath: idPath` (`:954-968`); push `IndexMaps` UpgradeInfo `{ normal, index }`.
   **Tiling copy (`:962-966`):** C# then overwrites the new sampler's U/V tiling
   modes from the normal sampler. Our model packs tiling *inside*
   `samplerSettingsRaw`, so to byte-match, transplant the normal sampler's tiling
   bits onto the `0x000f8340` base. Grep the serializer/parser for the tiling bit
   layout (`git grep -ni tiling src/mtrl`); if it exposes a get/set-tiling helper,
   use it, else mask the relevant bits across. If a normal sampler uses the default
   tiling, `0x000f8340` already matches and there is no diff — the ratchet (Task 7)
   confirms whether this matters, so keep the base value if the layout is unclear
   and let triage drive it.
10. Gear-mask UpgradeInfo: legacy → `GearMaskLegacy`, glass → `GearMaskNew` (only
    when `!usesMaskAsSpec`), keyed by the mask sampler's path, old==new
    (`:973-1027`).
11. Spec→mask compat (`:1028-1066`): if a `g_SamplerSpecular` texture and a
    `g_SamplerDiffuse` texture both exist, retype the specular sampler to
    `g_SamplerMask`, and set/insert shader keys `0xC8BD1DEF=0x198D11CD` and
    `0xB616DC5A=0x600EF9DF`.
12. Return the collected UpgradeInfos.

`upgradeHairMaterial` (`:1115-1173`, `files != null` slice): require a Normal and
a Mask sampler (else return `[]`); set `shaderConstants` from
`HAIR_SHADER_CONSTANTS` (mapped to `{constantId, values:[...]}`), `additionalData`
from `HAIR_ADDITIONAL_DATA`, but **preserve** the original alpha-threshold
constant `0x29AC0223`'s values into the new constant of the same id if both
exist; push a `HairMaps` UpgradeInfo `{ normal, mask }`; return it.

Write the full code faithfully. Keep helper `findByUsage(mtrl, XivTexType)` and
`findBySampler(mtrl, samplerId)` locals.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/upgrade/material.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `npm run check; npm run typecheck; npx vitest run test/upgrade test/mtrl test/util`
Expected: all green.

- [ ] **Step 6: Commit**

```powershell
git add src/upgrade/material.ts test/upgrade/material.test.ts
git commit -m "feat(upgrade): per-material EW->DT transform (colorset + hair branches)"
```

---

## Task 6: Wire the material round into the orchestration

**Files:**
- Modify: `src/upgrade/upgrade.ts`
- Modify: `src/index.ts` (export `EUpgradeTextureUsage`, `UpgradeInfo` if useful downstream — optional)
- Test: `test/upgrade/upgrade.test.ts` (extend)

**Interfaces:**
- Consumes: `upgradeMaterial` (Task 5); `parseMtrl`/`serializeMtrl`
  (`src/mtrl/mtrl.ts`); `decodeSqPackFile`/`encodeSqPackFile`/`SqPackType`
  (`src/sqpack/sqpack.ts`); `FileStorageType`, model types.
- Produces: `upgradeModpack(data)` now runs a real material round per option and
  still returns a fresh `ModpackData`. Model/texture/partial rounds remain no-ops.

- [ ] **Step 1: Write the failing test**

Add to `test/upgrade/upgrade.test.ts`: build a one-file ttmp-style `ModpackData`
whose single `chara/**.mtrl` is a real EW colorset material, run `upgradeModpack`,
and assert the output file's decompressed bytes parse to a 1024-length colorset
and `characterlegacy.shpk`. Source the input mtrl bytes from a corpus pack's inner
file, or (simpler) from `reference/.../Resources/DefaultTextures/default_material.mtrl`
if it is a 256-colorset material — inspect first with a scratch `parseMtrl`. If no
convenient fixture exists, assert instead that a **non-`chara` / non-mtrl** file is
passed through byte-identical and that a `chara/**.mtrl` needing no update (already
1024) is unchanged, plus keep the existing skeleton immutability tests. Prefer the
real-transform assertion when a fixture is available.

```ts
// sketch of the pass-through assertion (always valid)
it("passes non-material files through untouched", () => {
  const input = sampleData(); // gamePath "a/b.mtrl" is NOT under chara/, opaque bytes
  const out = upgradeModpack(input);
  expect(Array.from(out.groups[0]!.options[0]!.files[0]!.data)).toEqual([1, 2, 3]);
});
```

- [ ] **Step 2: Run test to verify it fails (or documents current behavior)**

Run: `npx vitest run test/upgrade/upgrade.test.ts`
Expected: the new real-transform test FAILS (material round not wired yet); the
pass-through test may already pass.

- [ ] **Step 3: Implement the material round**

Replace the identity body of `upgradeModpack` with a round structure. Keep
`cloneModpack` for the container copy, then run the material round per option:

```ts
import { parseMtrl, serializeMtrl } from "../mtrl/mtrl";
import { decodeSqPackFile, encodeSqPackFile, SqPackType } from "../sqpack/sqpack";
import { FileStorageType, type ModpackFile, type ModpackOption } from "../model/modpack";
import { upgradeMaterial } from "./material";
import type { UpgradeInfo } from "./upgrade-info";

function uncompressedBytes(f: ModpackFile): Uint8Array {
  return f.storage === FileStorageType.SqPackCompressed
    ? decodeSqPackFile(f.data).data
    : f.data;
}
function restore(f: ModpackFile, bytes: Uint8Array): ModpackFile {
  if (f.storage === FileStorageType.SqPackCompressed) {
    return { ...f, data: encodeSqPackFile(bytes, SqPackType.Standard) };
  }
  return { ...f, data: bytes };
}

const IS_CHARA_MTRL = /^chara\/.*\.mtrl$/;

// Round 1 (material half). Rewrites option.files in place on the CLONE; returns targets.
function materialRound(option: ModpackOption): UpgradeInfo[] {
  const infos: UpgradeInfo[] = [];
  option.files = option.files.map((f) => {
    if (!IS_CHARA_MTRL.test(f.gamePath)) return f;
    let mtrl;
    try {
      mtrl = parseMtrl(uncompressedBytes(f), f.gamePath);
    } catch {
      return f; // unparseable -> leave untouched (C# catch/continue)
    }
    const got = upgradeMaterial(mtrl);
    if (got.length === 0) return f; // no update needed
    infos.push(...got);
    return restore(f, serializeMtrl(mtrl));
  });
  return infos;
}
```

Then in `upgradeModpack`, after `const out = cloneModpack(data)`, iterate
`out.groups → options`, calling `materialRound(option)` and pushing every returned
`UpgradeInfo` into a flat `const upgradeTargets: UpgradeInfo[] = []`. (C#
dedupes these into a keyed dict for round 2 at `ModpackUpgrader.cs:100-106`; round
2 is a no-op here and the collection does not affect this round's output bytes, so
a flat array is sufficient — round 2 will define the keying when it lands.) Leave
`modelRound()`, `textureRound(upgradeTargets)`, `partials()` as named no-op
functions (empty bodies with a `// round N: ported later` comment) so the seam is
explicit. Return `out`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/upgrade/upgrade.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/upgrade/upgrade.ts src/index.ts test/upgrade/upgrade.test.ts
git commit -m "feat(upgrade): run the material round in upgradeModpack orchestration"
```

---

## Task 7: Corpus burndown + re-bless the baseline

**Files:**
- Modify: `test/corpus/.upgrade-baseline/*.json` (gitignored — re-blessed, not committed)

No new code. This task measures the transform against all 46 real packs and
records the new (smaller) baseline.

- [ ] **Step 1: Run the full suite (pre-bless) to see the burndown**

Run: `npm test`
Expected: the `upgrade golden:` checks now report far fewer `.mtrl` diffs.
Because the baseline still lists the old (larger) set, packs may fail with
"regressions" **only** if a formerly-mismatched `.mtrl` now matches AND some other
file regressed — but a pure improvement (fewer diffs, all a subset) passes. New
unexpected `.mtrl` mismatches (a transform bug) fail. Capture the console
`[upgrade] <pack>: N matched, M diffs` lines.

- [ ] **Step 2: Triage any regressions**

For every pack that FAILS with an `.mtrl` regression, the transform diverged from
ConsoleTools. Investigate: extract our upgraded mtrl and the golden's for that
`gamePath`, diff with `parseMtrl` field-by-field. Fix the port in `material.ts` /
`colorset-upgrade.ts` and re-run that pack:
`npx vitest run -t "<pack name>"`. Do NOT bless past a real regression — fix it.
Common suspects: Dx11 path handling (Task 5 note), texture ordering, spec→mask key
insertion order, glass constant source.

- [ ] **Step 3: Re-bless the baseline once all packs pass or only carry known-unimplemented (model/tex) diffs**

Run: `$env:UPDATE_UPGRADE_BASELINE="1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`
Expected: each pack's baseline rewritten to its current diff (now `.mtrl`-free
except any documented divergence). Console logs `[upgrade] blessed <pack>: ...`.

- [ ] **Step 4: Verify green post-bless**

Run: `npm test`
Expected: all `upgrade golden:` checks pass (actual ⊆ baseline). Record the total
`.mtrl` diff count now remaining (target: ~0).

- [ ] **Step 5: Commit (no baseline files — they are gitignored)**

```powershell
git add -A
git status   # confirm only tracked source changed, .upgrade-baseline is ignored
git commit -m "chore(upgrade): material round burns down the corpus .mtrl baseline" --allow-empty
```

---

## Task 8: idPath audit (decide if the game-refinement ever changes output)

**Files:**
- Create: `scripts/audit-idpath.ts`

Resolves spec §6: prove whether the omitted idPath base-game refinement
(`EndwalkerUpgrade.cs:923-936`) could ever change our output for real inputs.

- [ ] **Step 1: Write the audit script**

For every distinct `chara/**.mtrl` `gamePath` across the corpus inputs that also
exists as a base-game file, `extractGameFile` the base-game material, `parseMtrl`
it, find its Index-usage sampler path, and compare to our convention derivation
(`_n.tex→_id.tex` else `.tex→_id.tex`) applied to the base-game material's Normal
sampler path. Print any mismatch as `MISMATCH <gamePath>: convention=<a>
actual=<b>`.

```ts
// scripts/audit-idpath.ts — sketch
// 1. gather gamePaths: loadModpack each file in test/corpus/inputs, collect chara/**.mtrl paths
// 2. for each, try extractGameFile(path) into a temp; skip on non-zero exit (not a base-game file)
// 3. decode+parse; normal = tex where samplerIdToTexUsage==Normal; index = ...==Index
// 4. conv = normal.texturePath.includes("_n.tex") ? replace _n.tex->_id.tex : replace .tex->_id.tex
// 5. if index exists and index.texturePath !== conv -> print MISMATCH
```

- [ ] **Step 2: Run the audit**

Run: `npx tsx scripts/audit-idpath.ts`
Expected: a list (hopefully empty) of MISMATCH lines.

- [ ] **Step 3: Act on the result**

- **Zero mismatches:** the convention is provably exact for our corpus. Add a note
  to the spec §6 recording the audit result and move on — no bundle needed.
- **Mismatches present:** for each, the correct DT index path differs from
  convention. Add a generated `src/upgrade/reference/index-path-overrides.ts`
  (`Record<materialPath, indexPath>`) produced by the audit script, and have
  `upgradeColorsetMaterial` consult it before falling back to convention. Re-run
  Task 7 and re-bless.

- [ ] **Step 4: Commit**

```powershell
git add scripts/audit-idpath.ts
git commit -m "test(upgrade): audit idPath convention vs base-game index paths"
```

---

## Task 9 (conditional): RepathHairMashups + hair/ear/tail DT path table

**Entry criterion:** Task 7 left residual `.mtrl` mismatches on hair/ear/tail
materials whose diff is a *texture-path reference* difference (the mod's material
still points at old EW texture names). If Task 7 reached ~0 `.mtrl` diffs without
this, SKIP and note it in the spec.

**Files:**
- Create: `scripts/extract-hair-dt-paths.ts`
- Create: `src/upgrade/reference/hair-dt-paths.ts` (generated set)
- Create: `src/upgrade/mashup.ts` (`repathHairMashups`)
- Modify: `src/upgrade/upgrade.ts` (call the pre-pass before the material round)
- Test: `test/upgrade/mashup.test.ts`

- [ ] **Step 1: Generate the DT path set**

Script enumerates pre-DT hair/ear/tail roots via ConsoleTools `/list c{race}{h|z|t}{id}`
(run through `oracle.ts`'s `run`/a new `listRoot(rootId)` helper), collects every
`.tex` line, and emits `export const HAIR_DT_PATHS: ReadonlySet<string> = new
Set([...])`. Enumerate the race codes present in the base game and hair/ear/tail id
ranges; dedupe. (If per-root `/list` is too slow, read TexTools' game cache DB for
`chara/human/%/obj/{hair,zear,tail}/%/texture/%.tex` — same output set.)

Run: `npx tsx scripts/extract-hair-dt-paths.ts`
Expected: `hair-dt-paths.ts` with a non-trivial set.

- [ ] **Step 2: Write the failing test for `repathHairMashups`**

Test that a hair `XivMtrl` whose normal sampler points at a `_n.tex` path absent
from `HAIR_DT_PATHS`, while the `_norm.tex` variant is present, gets its normal
sampler repathed to `_norm.tex`; and that mask `_m→_mask|_mult` disambiguates to
whichever variant is in the set. Use a small injected path set for the unit test.

- [ ] **Step 3: Implement `repathHairMashups`**

Port `ModpackUpgrader.cs:379-482` (`RepathHairMashups`) against `HAIR_DT_PATHS`
membership instead of `rtx.FileExists`: for each option's hair/zear/tail `.mtrl`
(regexes `:381-383`), parse, if shader is Hair/Character and it has norm+mask,
apply the rename-and-check logic (`_n→_norm`, `_m→_mask|_mult`, `_s→_mask|_mult`,
`_d→_base`, each stripping `--`), reserialize and re-store. Make `injected` path
set a parameter defaulting to `HAIR_DT_PATHS` for testability.

- [ ] **Step 4: Wire the pre-pass, run corpus, re-bless**

Call `repathHairMashups` in `upgradeModpack` before the material round. Run
`npm test`, fix regressions, then re-bless (Task 7 Step 3).

- [ ] **Step 5: Commit**

```powershell
git add scripts/extract-hair-dt-paths.ts src/upgrade/reference/hair-dt-paths.ts src/upgrade/mashup.ts src/upgrade/upgrade.ts test/upgrade/mashup.test.ts
git commit -m "feat(upgrade): repath hair/ear/tail mashup materials via DT path table"
```

---

## Task 10: Coverage pass + corpus gap notes

**Files:**
- Create: `docs/superpowers/specs/2026-07-04-material-colorset-round-design.md`
  is updated with a short "coverage findings" addendum (or a scratch note if the
  team prefers) — record which transform branches are/aren't exercised by real packs.

- [ ] **Step 1: Run coverage over the new code**

Run: `npm run test:coverage`
Expected: `coverage/` written. Open the report for `src/upgrade/material.ts`,
`colorset-upgrade.ts`, `src/mtrl/shader.ts`.

- [ ] **Step 2: Identify under-exercised branches**

List branches with no corpus coverage — likely candidates: CharacterGlass, Skin
colorset, dyed colorsets (`colorSetDyeData.length > 0`), hair, spec→mask compat,
`usesMaskAsSpec`. For each, note whether the existing corpus hits it.

- [ ] **Step 3: Record findings and propose corpus additions**

Write the findings into the spec addendum: for each uncovered branch, name the
kind of real mod that would exercise it (e.g. "a dyeable gear mod with a glass
material"). Actually adding those mods is a follow-on (they must be real packs run
through the oracle); this task only produces the prioritized list.

- [ ] **Step 4: Commit**

```powershell
git add docs/superpowers/specs/2026-07-04-material-colorset-round-design.md
git commit -m "docs(upgrade): record material-round coverage findings + corpus gaps"
```

---

## Self-review notes

- **Spec coverage:** orchestration (Task 6), colorset/dye/dx9/index/spec-mask/hair
  /glass transform (Tasks 3,5), shader+sampler infra (Task 2), derived shader
  params (Task 4), hair/ear/tail path set + RepathHairMashups (Task 9, conditional
  per spec §3.1), idPath audit (Task 8 = spec §6), testing/ratchet (Task 7),
  coverage/corpus iteration (Task 10 = spec §7.3). Highlight/visibility stapling is
  spec §8 out-of-scope unless the corpus forces it (surfaces in Task 7 triage).
- **Storage form:** the global constraint + Task 6 `restore()` keep changed files
  in the source storage form, preserving `writeModpack`'s invariant.
- **No texture generation:** Tasks 3/5 record `UpgradeInfo` only; round 2 is a
  no-op stub (Task 6) — matches spec §2.
