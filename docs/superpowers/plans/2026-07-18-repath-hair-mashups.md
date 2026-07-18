# RepathHairMashups Pre-Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `ModpackUpgrader.RepathHairMashups` (`ModpackUpgrader.cs:379-482`) — the material-only "mashup hair" half of the `ResolveHighlightOptionsAndMashupHair` pre-round — replacing the fail-loud throw in `src/upgrade/resolve-highlight.ts`, so texture-only hair/`zear`/`tail` mods that reference pre-Dawntrail texture suffixes get retargeted to their Dawntrail names.

**Architecture:** A tiny bundled existence oracle (`hairTextureExists`) over the hair/`zear`/`tail` texture namespace reproduces `rtx.FileExists`' CRC32 index semantics offline; the logic module rewrites each Hair/Character material's normal/mask/diffuse sampler suffixes when the old texture is gone and the renamed one exists. Coverage is a synthetic `.pmp` through the `/upgrade` golden harness plus oracle-controlled unit tests.

**Tech Stack:** TypeScript (ESM), Vitest (via the custom `scripts/run-tests.ts` runner), `tsx` for scripts, the vendored xivModdingFramework C# as the spec, ConsoleTools as the golden oracle.

## Global Constraints

- **Byte-parity is correctness.** Output must be byte-identical to ConsoleTools `/upgrade`, except documented `DIVERGENCE_RULES` entries. Match TexTools, not intuition.
- **Every business-logic line cites its C# provenance** (`file · symbol · lines`) in a header/comment. Verify each citation against `reference/` before writing.
- **Split, don't blend.** New logic lives in its own module citing its own C# symbol; reuse existing ported helpers rather than duplicating.
- **Fail loud.** No silent divergence; unported structure → throw.
- **Formatting is Biome's.** Never hand-format; run `npm run check`.
- **No per-file license headers.** Provenance comments only.
- **Generated reference tables** carry a `// GENERATED` header and are produced by a committed `scripts/extract-*.ts`, regenerable on a game machine.
- **End-of-task gate (required, all green):** `npm run check`, `npm run typecheck`, `npm test`.
- **Reference paths** are under `reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/…`; the `ModpackUpgrader.cs` here is `reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/Mods/ModpackUpgrader.cs`.
- **This machine has the game install** (`C:\Program Files (x86)\Steam\steamapps\common\FINAL FANTASY XIV Online\game\sqpack\ffxiv`) **and ConsoleTools** (`C:\Program Files\FFXIV TexTools\FFXIV_TexTools\ConsoleTools.exe`), so extraction and goldens run here.

---

## File Structure

- **Create** `scripts/extract-hair-texture-index.ts` — generator: reads the `040000` index, enumerates hair/`zear`/`tail` texture folders, emits the packed `(folderHash,fileHash)` set. Extraction-only (game machine).
- **Create** `src/upgrade/reference/hair-texture-index.ts` — `// GENERATED` data: `export const HAIR_TEX_INDEX_PACKED: string` (base64 of LE uint32 pairs).
- **Create** `src/upgrade/reference/hair-texture-exists.ts` — hand-written runtime: `computeHash` (ported `HashGenerator`) + `hairTextureExists(path)` membership check.
- **Create** `src/upgrade/repath-hair-mashups.ts` — the logic port of `RepathHairMashups`.
- **Modify** `src/upgrade/resolve-highlight.ts:98-107` — replace the material-only-mashup throw with a `repathHairMashups(data)` call.
- **Create** `test/upgrade/hair-texture-exists.test.ts` — oracle unit tests.
- **Create** `test/upgrade/repath-hair-mashups.test.ts` — logic unit tests.
- **Create** `scripts/generate-synthetics/build-synthetic-mashup-hair.ts` — synthetic pack builder.
- **Modify** `scripts/generate-synthetics/build-all.ts` — register the new builder.
- **Modify** `docs/BACKLOG.md` + **delete** `docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md` — close the item (final task).

Reference (read before coding): the spec `docs/superpowers/specs/2026-07-18-repath-hair-mashups-design.md`; the analog builder `scripts/generate-synthetics/build-synthetic-unclaimed-hair.ts`; the analog test `test/upgrade/resolve-highlight.test.ts`; the index reader `scripts/lib/game-index.ts`.

---

## Task 1: Existence oracle (data + runtime lookup)

**Files:**
- Create: `scripts/extract-hair-texture-index.ts`
- Create: `src/upgrade/reference/hair-texture-index.ts` (generated output)
- Create: `src/upgrade/reference/hair-texture-exists.ts`
- Test: `test/upgrade/hair-texture-exists.test.ts`

**Interfaces:**
- Produces: `hairTextureExists(path: string): boolean` and `computeHash(path: string): number` from `src/upgrade/reference/hair-texture-exists.ts`; `HAIR_TEX_INDEX_PACKED: string` from the generated module.
- Consumes: `base64ToBytes` from `src/util/base64.ts`; the index reader helpers in `scripts/lib/game-index.ts` (`computeHash` re-used in the *script* only).

- [ ] **Step 1: Write the extraction script**

Create `scripts/extract-hair-texture-index.ts`:

```ts
// Generates src/upgrade/reference/hair-texture-index.ts. Regenerate on a machine with FFXIV
// installed: `npx tsx scripts/extract-hair-texture-index.ts`.
//
// Bundles the (folderHash:fileHash) pairs for every file under the hair/zear/tail TEXTURE folders
// that exist in the 040000 index — the runtime FileExists oracle RepathHairMashups needs
// (ModpackUpgrader.cs:379-482 · rtx.FileExists). Namespace-scoped: ~3.4k entries. See
// docs/superpowers/specs/2026-07-18-repath-hair-mashups-design.md §3.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeHash } from "./lib/game-index";

const SQPACK =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online\\game\\sqpack\\ffxiv";

// Full IDRaceDictionary race grid (Character.cs:530-571), identical to extract-hair-materials.ts.
const RACES = [
  "0101","0104","0201","0204","0301","0304","0401","0404","0501","0504",
  "0601","0604","0701","0704","0801","0804","0901","0904","1001","1004",
  "1101","1104","1201","1204","1301","1304","1401","1404","1501","1504",
  "1601","1604","1701","1704","1801","1804","9104","9204",
];
const ID_MAX = 500; // _SCAN_LIMIT (Character.cs:335)
const d4 = (n: number) => n.toString().padStart(4, "0");

// The three texture folders RepathHairMashups' sampler paths live under.
function textureFolders(r: string, i: string): string[] {
  return [
    `chara/human/c${r}/obj/hair/h${i}/texture`,
    `chara/human/c${r}/obj/zear/z${i}/texture`,
    `chara/human/c${r}/obj/tail/t${i}/texture`,
  ];
}

const candidateFolderHashes = new Set<number>();
for (const r of RACES)
  for (let i = 1; i <= ID_MAX; i++)
    for (const f of textureFolders(r, d4(i))) candidateFolderHashes.add(computeHash(f));

// Scan the 040000 index1 segment (offsets from IndexFile.cs:137-174, as scripts/lib/game-index.ts).
const buf = readFileSync(join(SQPACK, "040000.win32.index"));
const segOffset = buf.readInt32LE(1032);
const segSize = buf.readInt32LE(1036);
const pairs: [number, number][] = [];
for (let p = segOffset; p < segOffset + segSize; p += 16) {
  const fileHash = buf.readUInt32LE(p + 0) >>> 0;
  const folderHash = buf.readUInt32LE(p + 4) >>> 0;
  if (candidateFolderHashes.has(folderHash)) pairs.push([folderHash, fileHash]);
}
if (pairs.length === 0) throw new Error("extract-hair-texture-index: no entries — wrong index path?");

// Sort for a stable diff; pack as LE uint32 pairs -> base64.
pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const out = Buffer.alloc(pairs.length * 8);
pairs.forEach(([f, x], i) => {
  out.writeUInt32LE(f >>> 0, i * 8);
  out.writeUInt32LE(x >>> 0, i * 8 + 4);
});
writeFileSync(
  "src/upgrade/reference/hair-texture-index.ts",
  `// GENERATED — regenerate via \`npx tsx scripts/extract-hair-texture-index.ts\`. Do not edit by hand.\n` +
    `// (folderHash,fileHash) pairs (LE uint32, base64) for every file under the hair/zear/tail\n` +
    `// TEXTURE folders that exist in the 040000 index. The runtime FileExists oracle for\n` +
    `// RepathHairMashups (ModpackUpgrader.cs:379-482). See hair-texture-exists.ts.\n` +
    `export const HAIR_TEX_INDEX_PACKED = ${JSON.stringify(out.toString("base64"))};\n`,
);
console.log(`wrote ${pairs.length} texture entries`);
```

- [ ] **Step 2: Run the generator (produces the committed table)**

Run: `npx tsx scripts/extract-hair-texture-index.ts`
Expected: `wrote 3378 texture entries` (count may shift with game patch; must be > 3000). Creates `src/upgrade/reference/hair-texture-index.ts`.

- [ ] **Step 3: Write the failing oracle unit test**

Create `test/upgrade/hair-texture-exists.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeHash, hairTextureExists } from "../../src/upgrade/reference/hair-texture-exists";

describe("hairTextureExists", () => {
  // c0101 h0001 hair (a real DT hair from hair-materials.ts): the DT-suffix texture exists,
  // the old-suffix one does not (measured: old suffixes were removed in Dawntrail).
  const dt = "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_norm.tex";
  const old = "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";

  it("returns true for an existing DT texture path", () => {
    expect(hairTextureExists(dt)).toBe(true);
  });
  it("returns false for the removed old-suffix path", () => {
    expect(hairTextureExists(old)).toBe(false);
  });
  it("returns false for an out-of-namespace path", () => {
    expect(hairTextureExists("chara/common/texture/dummy.tex")).toBe(false);
  });
  it("computeHash matches HashGenerator (init -1, no final XOR, lowercased)", () => {
    // Same primitive as scripts/lib/game-index.ts; a stable known value guards regressions.
    expect(computeHash("")).toBe(0xffffffff);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run test/upgrade/hair-texture-exists.test.ts`
Expected: FAIL — cannot resolve `../../src/upgrade/reference/hair-texture-exists`.

- [ ] **Step 5: Write the runtime lookup module**

Create `src/upgrade/reference/hair-texture-exists.ts`:

```ts
// Runtime FileExists oracle for the hair/zear/tail texture namespace, used by RepathHairMashups
// (src/upgrade/repath-hair-mashups.ts). Ports HashGenerator.ComputeCRC (HashGenerator.cs:154-205)
// and IndexFile.FileExists' hash membership check (IndexFile.cs:516-621) over the bundled,
// namespace-scoped set (hair-texture-index.ts). A miss == the file is absent in-game.
import { base64ToBytes } from "../../util/base64";
import { HAIR_TEX_INDEX_PACKED } from "./hair-texture-index";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC32 of the lowercased path bytes (init -1, no final XOR), matching HashGenerator.ComputeCRC. */
export function computeHash(path: string): number {
  let crc = 0xffffffff;
  const s = path.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    crc = CRC_TABLE[(crc ^ s.charCodeAt(i)) & 0xff]! ^ (crc >>> 8);
  }
  return crc >>> 0;
}

const ENTRIES = (() => {
  const bin = base64ToBytes(HAIR_TEX_INDEX_PACKED);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const set = new Set<string>();
  for (let p = 0; p + 8 <= bin.byteLength; p += 8) {
    set.add(`${dv.getUint32(p, true)}:${dv.getUint32(p + 4, true)}`);
  }
  return set;
})();

/** True iff `path` (folder + "/" + file) is in the bundled hair/zear/tail texture index. Reproduces
 *  rtx.FileExists for the paths RepathHairMashups tests; out-of-namespace paths are a faithful miss. */
export function hairTextureExists(path: string): boolean {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return false;
  const fh = computeHash(path.slice(0, slash));
  const xh = computeHash(path.slice(slash + 1));
  return ENTRIES.has(`${fh}:${xh}`);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/upgrade/hair-texture-exists.test.ts`
Expected: PASS (4 tests). If the `dt` path returns false, the game patch renamed it — pick another real hair entry from `src/upgrade/reference/hair-materials.ts` and update the test.

- [ ] **Step 7: Commit**

```powershell
git add scripts/extract-hair-texture-index.ts src/upgrade/reference/hair-texture-index.ts src/upgrade/reference/hair-texture-exists.ts test/upgrade/hair-texture-exists.test.ts
git commit -m "feat(upgrade): bundled FileExists oracle for hair/zear/tail textures"
```

---

## Task 2: `repathHairMashups` logic + wiring

**Files:**
- Create: `src/upgrade/repath-hair-mashups.ts`
- Modify: `src/upgrade/resolve-highlight.ts` (replace throw at the material-only-mashup branch)
- Test: `test/upgrade/repath-hair-mashups.test.ts`

**Interfaces:**
- Consumes: `hairTextureExists` (Task 1); `resolveFile`/`requireBytes` from `src/upgrade/upgrade.ts`; `parseMtrl`, `serializeMtrl` from `src/mtrl/mtrl`; `dx11Path` from `src/mtrl/dx11-path`; `ESamplerId`, `SHPK_HAIR`, `SHPK_CHARACTER` from `src/mtrl/shader`; `findSamplerUnguarded` from `src/upgrade/resolve-highlight`; `writeGeneratedMtrl` from `src/upgrade/texture`; `ModpackData`, `ModpackOption` from `src/model/modpack`.
- Produces: `repathHairMashups(data: ModpackData): void`.

**Before coding — verify these transcription facts against the C# (spec §4, §6):**
1. `RepathHairMashups` reads `GetUncompressedFile(files[m])` + `GetXivMtrl` with **no try/catch** (unlike the highlight half) — so a decode/parse failure must **throw**. Use `requireBytes` (the non-swallowing reader), **not** `resolveFile`.
2. Shader gate is `Hair || Character` (`:401`) — **not** `CharacterLegacy`. Compare `mtrl.shaderPackRaw` against `SHPK_HAIR`/`SHPK_CHARACTER`.
3. The write at `:466-479` is **unconditional** — every regex-matching, shader-gated, norm+mask-non-null material is re-serialized and written back, even when no suffix changed. Do not add an `if (changed)` guard.
4. The diffuse check uses the **1-arg** `FileExists` (`:455`); the norm/mask use the 2-arg `forceOriginal:true` form. Both map to `hairTextureExists` (our oracle is base-game only); note the transcription in a comment.

- [ ] **Step 1: Write the failing logic test**

Create `test/upgrade/repath-hair-mashups.test.ts`. This builds a one-option pack whose sole file is a Hair material for a real DT `(race,id)` with **old-suffix** sampler paths, runs `repathHairMashups`, and asserts the samplers were retargeted to their DT names:

```ts
import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackOption,
} from "../../src/model/modpack";
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";
import { ESamplerId } from "../../src/mtrl/shader";
import { SAMPLE_HAIR_MTRL_BASE64 } from "../../src/upgrade/reference/hair-materials";
import { repathHairMashups } from "../../src/upgrade/repath-hair-mashups";

const SAMPLE_BYTES = new Uint8Array(Buffer.from(SAMPLE_HAIR_MTRL_BASE64, "base64"));
const MTRL_PATH =
  "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl";

function samplerPath(bytes: Uint8Array, id: number): string {
  const m = parseMtrl(bytes, MTRL_PATH);
  return m.textures.find((t) => t.sampler?.samplerIdRaw === id)!.texturePath;
}

/** Build a Hair material whose norm/mask samplers use OLD suffixes derived from the DT canonical. */
function oldSuffixMtrl(): { bytes: Uint8Array; dtNorm: string; dtMask: string } {
  const m = parseMtrl(SAMPLE_BYTES, MTRL_PATH);
  const norm = m.textures.find((t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerNormal)!;
  const mask = m.textures.find((t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerMask)!;
  const dtNorm = norm.texturePath;
  const dtMask = mask.texturePath;
  norm.texturePath = dtNorm.replaceAll("_norm.tex", "_n.tex");
  norm.flags &= ~0x8000; // clear DX9 flag so dx11Path == texturePath (no "--" splicing)
  mask.texturePath = dtMask.replaceAll("_mask.tex", "_m.tex").replaceAll("_mult.tex", "_m.tex");
  mask.flags &= ~0x8000;
  return { bytes: serializeMtrl(m), dtNorm, dtMask };
}

function pack(files: Array<[string, ModpackFile]>): ModpackData {
  const option: ModpackOption = {
    name: "On",
    description: "",
    files: new Map(files),
    fileSwaps: {},
    manipulations: [],
  };
  return {
    format: ModpackFormat.Pmp,
    name: "mashup",
    author: "",
    description: "",
    version: "",
    groups: [{ name: "g", description: "", type: "Single", options: [option] }],
  } as unknown as ModpackData;
}

describe("repathHairMashups", () => {
  it("retargets old-suffix norm/mask to their existing DT names", () => {
    const { bytes, dtNorm, dtMask } = oldSuffixMtrl();
    const data = pack([[MTRL_PATH, { data: bytes, storage: FileStorageType.RawUncompressed }]]);

    repathHairMashups(data);

    const out = data.groups[0]!.options[0]!.files.get(MTRL_PATH)!.data!;
    expect(samplerPath(out, ESamplerId.g_SamplerNormal)).toBe(dtNorm);
    expect(samplerPath(out, ESamplerId.g_SamplerMask)).toBe(dtMask);
  });

  it("leaves an already-DT-form material's paths unchanged (no double-repath)", () => {
    const dtBytes = SAMPLE_BYTES; // canonical: samplers already _norm/_mask, which exist
    const before = samplerPath(dtBytes, ESamplerId.g_SamplerNormal);
    const data = pack([[MTRL_PATH, { data: dtBytes, storage: FileStorageType.RawUncompressed }]]);

    repathHairMashups(data);

    const out = data.groups[0]!.options[0]!.files.get(MTRL_PATH)!.data!;
    expect(samplerPath(out, ESamplerId.g_SamplerNormal)).toBe(before);
  });
});
```

> Note: the exact `ModpackData`/`ModpackGroup`/`ModpackOption` field names — confirm against `src/model/modpack.ts` and mirror `test/upgrade/resolve-highlight.test.ts`'s fixture builders (it constructs the same shapes). Adjust the `pack()` literal to the real types; the `as unknown as ModpackData` escape hatch is a last resort only if a helper isn't exported.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/repath-hair-mashups.test.ts`
Expected: FAIL — cannot resolve `../../src/upgrade/repath-hair-mashups`.

- [ ] **Step 3: Write the logic module**

Create `src/upgrade/repath-hair-mashups.ts`:

```ts
// Port of ModpackUpgrader.RepathHairMashups (ModpackUpgrader.cs:379-482): the material-only
// "mashup hair" half of the ResolveHighlightOptionsAndMashupHair pre-round. For each option's
// hair/zear/tail .mtrl, retargets a Hair/Character material's normal/mask/diffuse sampler suffix to
// its Dawntrail name when the old texture is gone from the game and the renamed one exists
// (rtx.FileExists -> the bundled hairTextureExists oracle). Called from resolve-highlight.ts in
// place of the deferred fail-loud throw.
import type { ModpackData, ModpackOption } from "../model/modpack";
import { dx11Path } from "../mtrl/dx11-path";
import { parseMtrl, serializeMtrl } from "../mtrl/mtrl";
import { ESamplerId, SHPK_CHARACTER, SHPK_HAIR } from "../mtrl/shader";
import { hairTextureExists } from "./reference/hair-texture-exists";
import { findSamplerUnguarded } from "./resolve-highlight";
import { writeGeneratedMtrl } from "./texture";
import { requireBytes } from "./upgrade";

// The three material regexes RepathHairMashups runs, in order (:381-383).
const MTRL_REGEXES = [
  /chara\/human\/c[0-9]{4}\/obj\/hair.*\.mtrl/,
  /chara\/human\/c[0-9]{4}\/obj\/zear.*\.mtrl/,
  /chara\/human\/c[0-9]{4}\/obj\/tail.*\.mtrl/,
];

export function repathHairMashups(data: ModpackData): void {
  for (const regex of MTRL_REGEXES) repathOne(data, regex);
}

function repathOne(data: ModpackData, regex: RegExp): void {
  for (const group of data.groups) {
    for (const option of group.options) {
      // Snapshot: C# copies o.Files then writes back into the live dict (:392, :479).
      for (const [m, ref] of [...option.files]) {
        if (!regex.test(m)) continue;

        // No try/catch in C# here (unlike the highlight half): a decode/parse failure throws.
        const mtrl = parseMtrl(requireBytes(ref, m).bytes, m);

        // Shader gate: Hair OR Character (NOT CharacterLegacy) (:401).
        if (mtrl.shaderPackRaw !== SHPK_HAIR && mtrl.shaderPackRaw !== SHPK_CHARACTER) continue;

        // Unguarded x.Sampler.SamplerId (:406-408) — findSamplerUnguarded throws on a null sampler,
        // which propagates here (no catch), matching the C# NRE.
        const norm = findSamplerUnguarded(mtrl, ESamplerId.g_SamplerNormal);
        const mask = findSamplerUnguarded(mtrl, ESamplerId.g_SamplerMask);
        const diff = findSamplerUnguarded(mtrl, ESamplerId.g_SamplerDiffuse);
        if (!norm || !mask) continue; // (:410)

        // Normal: _n -> _norm, strip "--", gated on old-absent + new-present (:414-421).
        const nPath = dx11Path(norm);
        if (!hairTextureExists(nPath)) {
          if (hairTextureExists(nPath.replaceAll("_n.tex", "_norm.tex").replaceAll("--", ""))) {
            norm.texturePath = norm.texturePath.replaceAll("_n.tex", "_norm.tex").replaceAll("--", "");
          }
        }

        // Mask: first match of _m->_mask, _m->_mult, _s->_mask, _s->_mult wins (:423-453).
        const mPath = dx11Path(mask);
        if (!hairTextureExists(mPath)) {
          let found = false;
          const tryMask = (from: string, to: string): void => {
            const cand = mPath.replaceAll(from, to).replaceAll("--", "");
            if (hairTextureExists(cand) && !found) {
              mask.texturePath = mask.texturePath.replaceAll(from, to).replaceAll("--", "");
              found = true;
            }
          };
          tryMask("_m.tex", "_mask.tex");
          tryMask("_m.tex", "_mult.tex");
          tryMask("_s.tex", "_mask.tex");
          tryMask("_s.tex", "_mult.tex");
        }

        // Diffuse: _d -> _base (:455-463). NB C# uses the 1-arg FileExists here; same oracle for us.
        if (diff && !hairTextureExists(dx11Path(diff))) {
          if (hairTextureExists(dx11Path(diff).replaceAll("_d.tex", "_base.tex").replaceAll("--", ""))) {
            diff.texturePath = diff.texturePath.replaceAll("_d.tex", "_base.tex").replaceAll("--", "");
          }
        }

        // Unconditional re-serialize + write-back (:466-479), storage-mirrored to the source file.
        writeGeneratedMtrl(option as ModpackOption, m, serializeMtrl(mtrl), ref);
      }
    }
  }
}
```

> Note: `tryMask` evaluates `hairTextureExists(cand)` before `!found` — equivalent to C#'s `FileExists(newPath) && !found` (existence is side-effect-free), and the `!found` gate on the rewrite preserves first-match-wins.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade/repath-hair-mashups.test.ts`
Expected: PASS (2 tests). If `oldSuffixMtrl` produced a mask whose DT suffix is neither `_mask` nor `_mult`, inspect the real sampler suffix (`console.log` it) and adjust the old-suffix mapping.

- [ ] **Step 5: Wire into resolve-highlight (replace the throw)**

In `src/upgrade/resolve-highlight.ts`, replace the material-only-mashup throw (currently at the `badOptions.length === 0 && containers.size === 0` branch, ~lines 98-107) with a call. Change the top-of-file deferral comment and add the import.

Replace:

```ts
    if (containers.size === 0) {
      // Material-only Mashup hair (:348-353) -> RepathHairMashups. DEFERRED: needs the live DT
      // game index (rtx.FileExists). Fail loud.
      throw new Error(
        "resolve-highlight: material-only mashup hair (RepathHairMashups) is unported — it needs " +
          "the live Dawntrail game index; see " +
          "docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md",
      );
    }
    return; // (:354)
```

with:

```ts
    if (containers.size === 0) {
      repathHairMashups(data); // Material-only Mashup hair (:348-353) -> RepathHairMashups.
      return;
    }
    return; // (:354)
```

Add the import near the top:

```ts
import { repathHairMashups } from "./repath-hair-mashups";
```

And update the file header's deferral note (lines 4-6) to state the `RepathHairMashups` half is now ported here via `repath-hair-mashups.ts`, dropping the backlog-item pointer.

> Circular-import check: `repath-hair-mashups.ts` imports `findSamplerUnguarded` from `resolve-highlight.ts`, and `resolve-highlight.ts` now imports `repathHairMashups`. ES modules tolerate this cycle because both are used at call time, not module-eval time. If the runner errors on the cycle, move `findSamplerUnguarded` into a small shared `src/mtrl/find-sampler.ts` and import it from both. Verify by running the suite in Step 7.

- [ ] **Step 6: Add oracle-controlled edge tests (vitest mock)**

Real game data can't isolate the `_m→_mask`-before-`_mult` tie-break or the `_s`/diffuse variants, so mock the oracle for these. Append to `test/upgrade/repath-hair-mashups.test.ts`:

```ts
import { vi } from "vitest";

// A separate describe block that controls hairTextureExists precisely.
describe("repathHairMashups — oracle-controlled branches", () => {
  it("prefers _m->_mask over _m->_mult when both DT targets exist", async () => {
    vi.resetModules();
    // Only _mask (never _mult) reports as existing; the old _m path does NOT exist.
    vi.doMock("../../src/upgrade/reference/hair-texture-exists", () => ({
      hairTextureExists: (p: string) => p.includes("_mask.tex") || p.includes("_norm.tex"),
      computeHash: () => 0,
    }));
    const { repathHairMashups: fn } = await import("../../src/upgrade/repath-hair-mashups");
    // ...build a material whose mask sampler is _m.tex, run fn, assert it became _mask.tex...
    vi.doUnmock("../../src/upgrade/reference/hair-texture-exists");
  });
});
```

Flesh out the mocked cases: (a) tie-break picks `_mask` when both exist; (b) `_s.tex` mask → `_mask`/`_mult`; (c) diffuse `_d.tex` → `_base.tex` on a `Character`-shader material. Reuse the `oldSuffixMtrl`/`pack` helpers (parametrize `oldSuffixMtrl` to accept the sampler suffixes and shader).

Run: `npx vitest run test/upgrade/repath-hair-mashups.test.ts`
Expected: PASS. If `vi.doMock` + dynamic import does not intercept under the custom runner, fall back to a documented transcription note in the module and cover only what the real oracle reaches; do not ship an untested `if`.

- [ ] **Step 7: Full gate + commit**

Run: `npm run check`; then `npm run typecheck`; then `npm test`.
Expected: all green (the previously-throwing mashup path now runs; corpus `upgrade` checks unaffected — no corpus mod reaches this branch).

```powershell
git add src/upgrade/repath-hair-mashups.ts src/upgrade/resolve-highlight.ts test/upgrade/repath-hair-mashups.test.ts
git commit -m "feat(upgrade): port RepathHairMashups, replacing the mashup-hair throw"
```

---

## Task 3: Synthetic golden coverage

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-mashup-hair.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`

**Interfaces:**
- Consumes: `writePmp`, `syntheticMeta`, `singleOptionGroup`, `EMPTY_DEFAULT_MOD` from `scripts/generate-synthetics/pmp-builder.ts`; `parseMtrl`, `serializeMtrl` from `src/mtrl/mtrl`; `ESamplerId` from `src/mtrl/shader`; `SAMPLE_HAIR_MTRL_BASE64` from `src/upgrade/reference/hair-materials`.
- Produces: `test/corpus/synthetic/mashup-hair.pmp` (gitignored, regenerated).

- [ ] **Step 1: Write the synthetic builder**

Create `scripts/generate-synthetics/build-synthetic-mashup-hair.ts`:

```ts
// Builds test/corpus/synthetic/mashup-hair.pmp: a wizard PMP with one Single-select group, one
// option "On", whose SOLE file is a Hair-shader .mtrl for a real DT (race,id) with OLD-suffix
// (_n/_m) sampler texture paths and NO textures. The pre-round's highlight half finds a hair
// material but no split options and no option holding the textures (badOptions==0 && containers==0)
// -> RepathHairMashups fires, retargeting the samplers to their DT names. AB-tests
// ModpackUpgrader.cs:379-482 against ConsoleTools. See
// docs/superpowers/specs/2026-07-18-repath-hair-mashups-design.md §5.
//
// The .pmp is gitignored; regenerate with `npm run synthetics`.
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";
import { ESamplerId } from "../../src/mtrl/shader";
import { SAMPLE_HAIR_MTRL_BASE64 } from "../../src/upgrade/reference/hair-materials";
import {
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

const MTRL_GAME_PATH =
  "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl";

// Take the bundled canonical _SampleHair (c0801 h0115, real DT hair), rewrite its norm/mask samplers
// back to pre-DT suffixes so RepathHairMashups has something to fix.
const m = parseMtrl(
  new Uint8Array(Buffer.from(SAMPLE_HAIR_MTRL_BASE64, "base64")),
  MTRL_GAME_PATH,
);
const norm = m.textures.find((t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerNormal)!;
const mask = m.textures.find((t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerMask)!;
norm.texturePath = norm.texturePath.replaceAll("_norm.tex", "_n.tex");
norm.flags &= ~0x8000;
mask.texturePath = mask.texturePath.replaceAll("_mask.tex", "_m.tex").replaceAll("_mult.tex", "_m.tex");
mask.flags &= ~0x8000;
const mtrlBytes = serializeMtrl(m);

const ZIP_PATH = "files\\mt_c0801h0115_hir_a.mtrl";

writePmp("mashup-hair.pmp", {
  meta: syntheticMeta("Mashup Hair Repath"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_mashup hair.json": singleOptionGroup("Mashup Hair", {
      [MTRL_GAME_PATH]: ZIP_PATH,
    }),
  },
  files: { [ZIP_PATH.replace(/\\/g, "/")]: mtrlBytes },
});
```

> Confirm against `scripts/generate-synthetics/build-synthetic-unclaimed-hair.ts` that `singleOptionGroup(name, { gamePath: zipPath })` and the `files: { zipPathForwardSlashed: bytes }` mapping match the current `pmp-builder.ts` signatures; mirror them exactly.

- [ ] **Step 2: Register the builder**

In `scripts/generate-synthetics/build-all.ts`, add after the `build-synthetic-highlight` import:

```ts
import "./build-synthetic-mashup-hair";
```

- [ ] **Step 3: Build the synthetic**

Run: `npx tsx scripts/generate-synthetics/build-synthetic-mashup-hair.ts`
Expected: writes `test/corpus/synthetic/mashup-hair.pmp` (no error). Confirm the file exists: `Test-Path test/corpus/synthetic/mashup-hair.pmp`.

- [ ] **Step 4: Run the upgrade harness to produce + diff the golden**

Run: `npm test` (spawns ConsoleTools `/upgrade` for the new pack, caches the golden, diffs).
Expected: the `upgrade` check for `mashup-hair.pmp` **fully matches** the golden (a new pack has no baseline and must match byte-for-byte). Then confirm the golden actually exercised the repath, not a no-op:

```powershell
Get-ChildItem test\corpus\.upgrade-cache | Where-Object Name -notlike "*.noop"
```

A `.noop` marker for this pack means ConsoleTools changed nothing → the synthetic did **not** reach RepathHairMashups. If so, diagnose (wrong shader, sampler already DT-form, or the `(race,id)` texture doesn't exist) and adjust the builder until the golden shows the material rewritten, then re-run.

- [ ] **Step 5: If it matches, no baseline needed; if a documented divergence appears, add a rule**

A full match needs no baseline entry. If the only diff is an intended, explainable divergence (e.g. the known writer image/orphan-member gaps), add a cited `DIVERGENCE_RULES` entry in `test/helpers/upgrade-compare.ts` rather than a baseline — but a mashup-hair `.mtrl` should be byte-exact; treat any material-payload diff as a real bug first.

- [ ] **Step 6: Coverage sweep**

Run: `npm run test:coverage`
Expected: `repath-hair-mashups.ts` and `hair-texture-exists.ts` show as reached. Any unreached line must be a fail-loud guard; if a real branch is uncovered, add a unit test (Task 2 Step 6 style).

- [ ] **Step 7: Commit**

```powershell
git add scripts/generate-synthetics/build-synthetic-mashup-hair.ts scripts/generate-synthetics/build-all.ts
git commit -m "test(upgrade): synthetic mashup-hair pack through the /upgrade golden harness"
```

---

## Task 4 (optional): Expected-failure coverage for the parse-miss throw

Only do this if authoring it is cheap (spec §5 "if warranted"). The parse/resolve-miss seam (Task 2 fact 1) is a throw with no C# try/catch; confirm we match TexTools *erroring*, not just that we throw.

**Files:**
- Create (maybe): `scripts/generate-synthetics/build-synthetic-mashup-hair-malformed.ts` under the `upgrade-error` corpus root
- Modify: `scripts/generate-synthetics/build-all.ts`

- [ ] **Step 1: Probe whether ConsoleTools throws at the same seam**

Author a mashup-hair pack whose hair `.mtrl` is truncated/corrupt, build it, and run it through the expected-failure `/upgrade` capability (the `upgrade-error` root; see `docs/backlog/2026-07-11-expected-failure-golden.md` and how `build-synthetic-*` packs targeting that root are wired). If ConsoleTools' Trace shows a `HandleUpgrade` error, lock it as an expected failure.

- [ ] **Step 2: If ConsoleTools does NOT throw at that seam, pin our throw with a unit test instead**

Add a unit test asserting `repathHairMashups` throws on a mashup-hair option whose `.mtrl` bytes are unparseable, and add a one-line comment in the module noting a golden couldn't reach it (ConsoleTools rejects the pack earlier/differently). Commit whichever path applies.

```powershell
git add -A
git commit -m "test(upgrade): pin the RepathHairMashups parse-miss failure seam"
```

---

## Task 5: Close the backlog item + final gate

**Files:**
- Delete: `docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md`
- Modify: `docs/BACKLOG.md` (remove entry #1, renumber the prioritized list)
- Modify: `docs/superpowers/specs/2026-07-17-resolve-highlight-preround-design.md` (deferral note now shipped)

- [ ] **Step 1: Grep for dangling references to the item before deleting**

Run: `Select-String -Path src\**\*.ts,test\**\*.ts,scripts\**\*.ts,docs\**\*.md -Pattern "2026-07-15-resolve-highlight-mashup-hair-preround" -List`
Expected: hits are (a) `resolve-highlight.ts` header/throw comment — already updated in Task 2 Step 5; (b) `docs/BACKLOG.md` entry #1; (c) the shipped-preround spec's deferral note; (d) this plan. Update/remove each real citation so no pointer dangles.

- [ ] **Step 2: Delete the item file and its index entry**

Delete `docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md`. In `docs/BACKLOG.md`, remove the prioritized entry #1 and renumber the remaining prioritized items (2→1, 3→2, …). Update the shipped-preround spec's deferral note to say the `RepathHairMashups` half shipped 2026-07-18 (this spec).

- [ ] **Step 3: Final end-of-task gate**

Run: `npm run check`; then `npm run typecheck`; then `npm test`.
Expected: all green.

- [ ] **Step 4: Commit**

```powershell
git add docs/BACKLOG.md docs/superpowers/specs/2026-07-17-resolve-highlight-preround-design.md
git rm docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md
git commit -m "docs: close RepathHairMashups backlog item"
```

- [ ] **Step 5: Pre-PR housekeeping (not a code task)**

Delete this plan file (`docs/superpowers/plans/2026-07-18-repath-hair-mashups.md`) on the branch before opening the PR, per `AGENTS.md` (plans are transient; commit-then-delete keeps them in history but off the PR/main line). The design spec stays.

---

## Self-Review

**Spec coverage:**
- §1 (why/how much data) → Task 1 (namespace-scoped oracle).
- §3.1–3.3 (oracle shape, hash membership, out-of-namespace→false) → Task 1 Steps 1,5 + tests.
- §3.4 (extraction) → Task 1 Steps 1–2.
- §4.1–4.5 (logic port: shader gate, samplers, norm/mask/diffuse rewrites, unconditional write, no-transaction adaptation) → Task 2 Step 3 + facts 1–4.
- §4.1 wiring (replace throw) → Task 2 Step 5.
- §5 (synthetic golden + unit tests) → Task 3 + Task 2 Steps 1,6.
- §5 expected-failure → Task 4.
- §6 fidelity notes (`--` handling, shader gate, 1-arg diffuse) → Task 2 facts 2,4 + module comments.
- §7 work order (B→A→C→gate→close) → Tasks 1→2→3→5.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". The two "Note"/"confirm" callouts point at real files to mirror (existing types/builders), not deferred work; the mocked-edge fleshing in Task 2 Step 6 is bounded with a concrete fallback. Acceptable.

**Type consistency:** `hairTextureExists(path: string): boolean`, `computeHash(path: string): number`, `repathHairMashups(data: ModpackData): void`, `writeGeneratedMtrl(option, gamePath, bytes, reference)`, `requireBytes(f, gamePath): {bytes}`, `findSamplerUnguarded(mtrl, samplerId): MtrlTexture | undefined`, `dx11Path(tex): string`, `SHPK_HAIR`/`SHPK_CHARACTER` strings, `ESamplerId.g_Sampler{Normal,Mask,Diffuse}` — all match the signatures read from source during planning.
```
