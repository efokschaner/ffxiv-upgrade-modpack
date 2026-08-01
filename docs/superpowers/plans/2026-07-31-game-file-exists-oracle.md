# Complete `FileExists` Oracle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the namespace-scoped `hairTextureExists` oracle with a complete, assumption-free
`fileExists` over the whole chara (040000) game index, and route every `FileExists` question our port
executes through it.

**Architecture:** A committed generator (`scripts/extract-chara-index.ts`) reads the installed game's
`040000.win32.index` and emits three base64 payloads into a generated module; a small runtime
(`src/upgrade/reference/file-exists.ts`) ports `ModTransaction.FileExists` → `IsFFXIVInternalPath` →
`GetDataFileFromPath` → `GetRawDataOffsetIndex1` and answers by binary search over `Uint32Array`
views. Five call sites move onto it.

**Tech Stack:** TypeScript (ESM), vitest via a custom parallel runner, Biome, `tsx` for scripts.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-31-game-file-exists-oracle-design.md`. Read it before
  Task 1. Every decision below traces to it.
- **Provenance:** every non-test line cites its C# source as `file · symbol · lines`. Verify each
  citation against `reference/` — do not port from memory.
- **Formatting is mechanical.** Biome owns it: run `npm run check`, never hand-format.
- **`reference/` is read-only.** Never edit, lint, or format it.
- **End-of-task ritual:** `npm run check`, `npm run typecheck`, `npm test` — all green before a task
  is complete. **Task 1 is the single, deliberate exception** (see its note).
- **Never bless a baseline to make a failure go away.** `UPDATE_UPGRADE_BASELINE` is not used
  anywhere in this plan. A diff that appears is investigated, not recorded.
- **Game install path** (used by every extractor here, already a constant in the existing scripts):
  `C:\Program Files (x86)\Steam\steamapps\common\FINAL FANTASY XIV Online\game\sqpack\ffxiv`
- **Branch:** `feat/complete-file-exists-oracle` (already created off `main`).
- **Measured facts this plan relies on** (re-verified 2026-07-31 against the live index; do not
  re-derive them, but the extractor asserts them):
  - 040000 index1 data segment: offset 2048, size 5,329,152 → **333,072** entries, **82,369** folders.
  - **0** entries have a zero raw offset; **0** duplicate `(folderHash, fileHash)` pairs.
  - index1 synonym segment is **256 bytes** = the ending sentinel only, i.e. no real synonyms.

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/extract-chara-index.ts` (create) | Generator. Reads the 040000 index1 data segment, asserts the invariants above, emits the generated module. Replaces `scripts/extract-hair-texture-index.ts` (delete). |
| `src/upgrade/reference/chara-index.ts` (generated) | The three base64 payloads. Replaces `hair-texture-index.ts` (delete). |
| `src/upgrade/reference/file-exists.ts` (create) | `fileExists` + `computeHash`. Replaces `hair-texture-exists.ts` (delete). |
| `test/upgrade/file-exists.test.ts` (create) | Unit tests for the oracle. Replaces `hair-texture-exists.test.ts` (delete). |
| `scripts/generate-synthetics/build-synthetic-mashup-hair-outofns.ts` (create) | The out-of-namespace repro pack. |
| `src/upgrade/repath-hair-mashups.ts` (modify) | 9 call sites → `fileExists`. |
| `src/upgrade/material.ts` (modify) | Index-path steal gates A and B → `fileExists`. |
| `src/upgrade/reference/index-path-resolver.ts` (modify) | Delete `idTexExists` and its decoded set. |
| `scripts/extract-index-table.ts` (modify) | Stop emitting `ID_TEX_PACKED`. |
| `src/upgrade/unclaimed-hair.ts`, `src/upgrade/eye-mask.ts` (modify) | Split existence gate from content lookup; throw on disagreement. |

---

### Task 1: The out-of-namespace repro pack (RED)

Build the synthetic modpack that proves the bug, and watch it fail against a real ConsoleTools golden.

> **This is the one task that ends with a RED suite, by design.** The pack is a new corpus member with
> no ratchet baseline, so the harness requires it to match the golden exactly — and it will not, because
> the bug is still present. Task 2 turns it green. Do **not** add a baseline entry, do **not** set
> `UPDATE_UPGRADE_BASELINE`, and do **not** "fix" it here. Capture the failure text in your report; it
> is the evidence that the test would have caught the bug.

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-mashup-hair-outofns.ts`
- Modify: `scripts/generate-synthetics/build-all.ts:27` (append the import)

**Interfaces:**
- Consumes: `writePmp`, `syntheticMeta`, `singleOptionGroup`, `EMPTY_DEFAULT_MOD` from
  `./pmp-builder`; `SAMPLE_HAIR_MTRL_BASE64` from `../../src/upgrade/reference/hair-materials`;
  `parseMtrl` / `serializeMtrl` from `../../src/mtrl/mtrl`; `ESamplerId` from `../../src/mtrl/shader`.
- Produces: `test/corpus/synthetic/mashup-hair-outofns.pmp` (gitignored; regenerated by
  `npm run synthetics`).

- [ ] **Step 1: Read the sibling builder**

Read `scripts/generate-synthetics/build-synthetic-mashup-hair.ts` in full. The new builder is
deliberately its near-twin — same canonical material, same group shape — differing only in where the
normal sampler points. Read `scripts/generate-synthetics/pmp-builder.ts` too; its JSON key order and
member insertion order are load-bearing and must not be reordered.

- [ ] **Step 2: Write the builder**

Create `scripts/generate-synthetics/build-synthetic-mashup-hair-outofns.ts`:

```ts
// Builds test/corpus/synthetic/mashup-hair-outofns.pmp: the sibling of mashup-hair.pmp for the
// OUT-OF-NAMESPACE case. Same canonical DT hair material, but its g_SamplerNormal points at a FACE
// texture — outside the hair/zear/tail texture namespace the old bundled oracle covered — whose old
// `_n` form is absent from the game and whose `_norm` form exists. RepathHairMashups
// (ModpackUpgrader.cs:414-421) therefore renames it, and an oracle scoped to hair textures alone
// silently does not. AB-tests that rename against ConsoleTools. See
// docs/superpowers/specs/2026-07-31-game-file-exists-oracle-design.md §7.
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

// Verified against the live 040000 index (2026-07-31): the `_n` form is absent, the `_norm` form
// exists — one of 47 such face-texture pairs. Neither is under the hair/zear/tail texture folders.
const OUT_OF_NAMESPACE_NORMAL =
  "chara/human/c0101/obj/face/f0001/texture/c0101f0001_fac_n.tex";
// A path that DOES exist, so the mask branch (ModpackUpgrader.cs:423-453) is inert and this pack
// exercises the normal branch alone.
const EXISTING_MASK =
  "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_norm.tex";

const m = parseMtrl(
  new Uint8Array(Buffer.from(SAMPLE_HAIR_MTRL_BASE64, "base64")),
  MTRL_GAME_PATH,
);
const norm = m.textures.find(
  (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerNormal,
)!;
const mask = m.textures.find(
  (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerMask,
)!;
// Clear the DX9/DX11 dual-provision flag (0x8000) on both so Dx11Path === TexturePath and the paths
// below are asked of the oracle verbatim, with no `--` inserted.
norm.texturePath = OUT_OF_NAMESPACE_NORMAL;
norm.flags &= ~0x8000;
mask.texturePath = EXISTING_MASK;
mask.flags &= ~0x8000;
const mtrlBytes = serializeMtrl(m);

const ZIP_PATH = "files\\mt_c0801h0115_hir_a.mtrl";

writePmp("mashup-hair-outofns.pmp", {
  meta: syntheticMeta("Mashup Hair Repath Out Of Namespace"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_mashup hair outofns.json": singleOptionGroup(
      "Mashup Hair OutOfNs",
      { [MTRL_GAME_PATH]: ZIP_PATH },
    ),
  },
  files: { [ZIP_PATH.replace(/\\/g, "/")]: mtrlBytes },
});
```

- [ ] **Step 3: Register it in the build-all barrel**

Append to `scripts/generate-synthetics/build-all.ts` (after the existing
`import "./build-synthetic-npot-guards";` line):

```ts
import "./build-synthetic-mashup-hair-outofns";
```

- [ ] **Step 4: Build the pack**

Run: `npm run synthetics`
Expected: among the output lines, `wrote …\test\corpus\synthetic\mashup-hair-outofns.pmp`.
Then confirm the file exists:

```powershell
Get-ChildItem test\corpus\synthetic\mashup-hair-outofns.pmp
```

- [ ] **Step 5: Run the suite and confirm it FAILS on this pack**

Run: `npm test`
Expected: FAIL. The failing assertion is the `upgrade` check for `mashup-hair-outofns.pmp` —
"matches ConsoleTools /upgrade within the ratchet baseline" — reporting a `payload` difference on
`chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl`: the golden's normal
sampler reads `…/c0101f0001_fac_norm.tex` and ours still reads `…/c0101f0001_fac_n.tex`.

First run spawns ConsoleTools for this pack, which can take a couple of minutes; the suite's own
timeout accommodates it.

**Paste the exact failure text into your task report** — it is the evidence the test would have
caught the bug, and Task 2's reviewer checks that the same test goes green.

If instead the pack **passes**, stop and report: either ConsoleTools declined to write a golden (a
no-op — check for a `.noop` marker under `test/corpus/.upgrade-cache/`), or the chosen face-texture
pair does not behave as measured. Do not proceed; the plan's premise needs re-checking.

- [ ] **Step 6: Format and typecheck**

Run: `npm run check` then `npm run typecheck`
Expected: both clean. (`npm test` stays red — that is this task's deliverable.)

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-synthetics/build-synthetic-mashup-hair-outofns.ts scripts/generate-synthetics/build-all.ts
git commit -m "test(corpus): synthetic repro for the out-of-namespace hair oracle gap"
```

---

### Task 2: The complete oracle

Replace the namespace-scoped table and its lookup with the complete chara index, and move
`RepathHairMashups` onto it. This turns Task 1's failure green.

**Files:**
- Create: `scripts/extract-chara-index.ts`
- Create (by running the generator): `src/upgrade/reference/chara-index.ts`
- Create: `src/upgrade/reference/file-exists.ts`
- Create: `test/upgrade/file-exists.test.ts`
- Delete: `scripts/extract-hair-texture-index.ts`, `src/upgrade/reference/hair-texture-index.ts`,
  `src/upgrade/reference/hair-texture-exists.ts`, `test/upgrade/hair-texture-exists.test.ts`
- Modify: `src/upgrade/repath-hair-mashups.ts` (import + 9 call sites)
- Modify: `test/upgrade/repath-hair-mashups.test.ts` (5 `vi.doMock` / `vi.doUnmock` pairs)
- Modify: `src/upgrade/reference/index-path-resolver.ts:3` (comment reference only)

**Interfaces:**
- Produces:
  - `computeHash(path: string): number` — exported from `src/upgrade/reference/file-exists.ts`.
  - `fileExists(path: string): boolean` — same module. Returns `false` for a non-FFXIV path,
    **throws** for a valid FFXIV path outside `chara/`.
  - `CHARA_INDEX_FOLDERS`, `CHARA_INDEX_COUNTS`, `CHARA_INDEX_FILES` — `string` (base64) exports of
    `src/upgrade/reference/chara-index.ts`.
- Consumes: `base64ToBytes` from `src/util/base64.ts`.

- [ ] **Step 1: Write the failing unit test**

Create `test/upgrade/file-exists.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeHash, fileExists } from "../../src/upgrade/reference/file-exists";

describe("fileExists", () => {
  // In the old bundled namespace (hair/zear/tail textures): c0101 h0001, a real DT hair.
  const hairDt = "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_norm.tex";
  const hairOld = "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
  // OUTSIDE it: a face texture. Measured against the live 040000 index (2026-07-31) — the pair the
  // synthetic repro pack is built from.
  const faceDt = "chara/human/c0101/obj/face/f0001/texture/c0101f0001_fac_norm.tex";
  const faceOld = "chara/human/c0101/obj/face/f0001/texture/c0101f0001_fac_n.tex";

  it("returns true for an existing DT hair texture", () => {
    expect(fileExists(hairDt)).toBe(true);
  });
  it("returns false for the removed old-suffix hair texture", () => {
    expect(fileExists(hairOld)).toBe(false);
  });
  it("answers out-of-namespace paths from the real index, not a hard false", () => {
    expect(fileExists(faceDt)).toBe(true);
    expect(fileExists(faceOld)).toBe(false);
  });
  it("covers chara/common, which the old namespace-scoped table could not", () => {
    expect(fileExists("chara/common/texture/catchlight_1.tex")).toBe(true);
    expect(fileExists("chara/common/texture/dummy.tex")).toBe(false);
  });

  // ModTransaction.FileExists' pre-checks (ModTransaction.cs:1127-1134).
  it("returns false for a blank path (IsNullOrWhiteSpace)", () => {
    expect(fileExists("")).toBe(false);
    expect(fileExists("   ")).toBe(false);
  });
  it("returns false for a path with characters _InvalidRegex rejects", () => {
    // IOUtil.cs:550 — [^a-z0-9./\-_{}], so any uppercase character disqualifies the path.
    expect(fileExists(hairDt.toUpperCase())).toBe(false);
    expect(fileExists("chara/human/c0101/obj/hair/h0001/texture/a b.tex")).toBe(false);
  });
  it("returns false for a path under no XivDataFile folder key", () => {
    expect(fileExists("mymod/textures/foo.tex")).toBe(false);
  });

  // Only 040000 is bundled; a real FFXIV path in another category is an honest gap, not a false.
  it("throws for a valid FFXIV path outside the chara category", () => {
    expect(() => fileExists("bgcommon/hou/indoor/general/0000/texture/foo.tex")).toThrow(
      /only the chara \(040000\) category is bundled/,
    );
  });

  it("computeHash matches HashGenerator (init -1, no final XOR, lowercased)", () => {
    // Same primitive as scripts/lib/game-index.ts; a stable known value guards regressions.
    expect(computeHash("")).toBe(0xffffffff);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/upgrade/file-exists.test.ts`
Expected: FAIL — cannot resolve `../../src/upgrade/reference/file-exists`.

- [ ] **Step 3: Write the generator**

Create `scripts/extract-chara-index.ts`:

```ts
// Generates src/upgrade/reference/chara-index.ts. Regenerate on a machine with FFXIV installed:
// `npx tsx scripts/extract-chara-index.ts`.
//
// Bundles the COMPLETE 040000 (chara) index1 file set — every (folderHash, fileHash) pair in the
// data segment — as the runtime FileExists oracle (IndexFile.cs · GetRawDataOffsetIndex1 · 546-576).
// Deliberately unfiltered: the queried domain is a mod's sampler paths, which can name any chara
// file, so scoping the table by folder or file type would make a miss mean "outside our slice"
// rather than "absent in-game". See
// docs/superpowers/specs/2026-07-31-game-file-exists-oracle-design.md §3 and §5.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SQPACK =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online\\game\\sqpack\\ffxiv";

const buf = readFileSync(join(SQPACK, "040000.win32.index"));
// Data-segment offset/size at file offset 1032/1036 (IndexFile.cs · ReadIndex1Data · 172-199).
const segOffset = buf.readInt32LE(1032);
const segSize = buf.readInt32LE(1036);

// The synonym (collision) segment, read at 1108/1112 — the header walk is SqPackHeader(1024) +
// headerSize + version, then ReadIndex1Data, then a 64-byte hash skip, then dataFileCount
// (IndexFile.cs · ReadIndexFile · 134-169 · ReadSynTable · 248-278). GetRawDataOffsetIndex1 consults
// Index1Synonyms as well as the base table, and this extractor reads only the base table — so assert
// the segment holds nothing but the always-present ending sentinel (IndexFile.cs:1370-1379,
// SynonymTableEntry.Size = 256). If a future patch introduces a real index1 synonym, fail loud here
// rather than silently bundling an incomplete set.
const synSize = buf.readInt32LE(1112);
if (synSize !== 256) {
  throw new Error(
    `extract-chara-index: index1 synonym segment is ${synSize} bytes (${synSize / 256} entries); ` +
      `the port assumes the ending sentinel alone. Port the synonym table before regenerating.`,
  );
}

const byFolder = new Map<number, number[]>();
let total = 0;
for (let p = segOffset; p < segOffset + segSize; p += 16) {
  const fileHash = buf.readUInt32LE(p) >>> 0; // FileIndexEntry: fileNameHash @ +0
  const folderHash = buf.readUInt32LE(p + 4) >>> 0; // folderPathHash @ +4
  const rawOffset = buf.readUInt32LE(p + 8) >>> 0; // fileOffset @ +8
  // FileExists is `offset != 0` (ModTransaction.cs:1135-1136), so a zero-offset entry is absent.
  if (rawOffset === 0) continue;
  let files = byFolder.get(folderHash);
  if (!files) byFolder.set(folderHash, (files = []));
  files.push(fileHash);
  total++;
}
if (total === 0) {
  throw new Error("extract-chara-index: no entries — wrong index path?");
}

/** LEB128, matching the runtime decoder in src/upgrade/reference/file-exists.ts. */
function varint(n: number, out: number[]): void {
  let v = n;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

const folders = [...byFolder.keys()].sort((a, b) => a - b);
const foldersBuf = Buffer.alloc(folders.length * 4);
folders.forEach((f, i) => foldersBuf.writeUInt32LE(f >>> 0, i * 4));

const counts: number[] = [];
const filesBuf = Buffer.alloc(total * 4);
let fp = 0;
for (const folder of folders) {
  const files = byFolder.get(folder)!.sort((a, b) => a - b);
  // The runtime binary-searches this slice, which requires strictly ascending keys.
  if (new Set(files).size !== files.length) {
    throw new Error(
      `extract-chara-index: duplicate (folderHash, fileHash) pair under folder ${folder}`,
    );
  }
  varint(files.length, counts);
  for (const fileHash of files) {
    filesBuf.writeUInt32LE(fileHash >>> 0, fp);
    fp += 4;
  }
}

writeFileSync(
  "src/upgrade/reference/chara-index.ts",
  `// GENERATED — regenerate via \`npx tsx scripts/extract-chara-index.ts\`. Do not edit by hand.\n` +
    `// The COMPLETE 040000 (chara) index1 file set — the runtime FileExists oracle (see\n` +
    `// file-exists.ts). Grouped by folder so 82k folder hashes are stored once rather than per file:\n` +
    `// CHARA_INDEX_FOLDERS is u32 LE folder hashes ascending, CHARA_INDEX_COUNTS is one LEB128 file\n` +
    `// count per folder in that order, and CHARA_INDEX_FILES is u32 LE file hashes grouped by folder\n` +
    `// in that same order, ascending within each group.\n` +
    `export const CHARA_INDEX_FOLDERS = ${JSON.stringify(foldersBuf.toString("base64"))};\n` +
    `export const CHARA_INDEX_COUNTS = ${JSON.stringify(Buffer.from(counts).toString("base64"))};\n` +
    `export const CHARA_INDEX_FILES = ${JSON.stringify(filesBuf.toString("base64"))};\n`,
);
console.log(`wrote ${total} entries across ${folders.length} folders`);
```

- [ ] **Step 4: Run the generator**

Run: `npx tsx scripts/extract-chara-index.ts`
Expected: `wrote 333072 entries across 82369 folders`.

If the counts differ from those figures, that is fine and expected after a game patch — but say so in
your report, because it means the bundled data moved and Step 10's corpus run needs extra scrutiny.
If it **throws** on the synonym assertion, stop and report: the port needs the synonym table first.

- [ ] **Step 5: Write the oracle**

Create `src/upgrade/reference/file-exists.ts`:

```ts
// Runtime FileExists oracle over the complete bundled chara (040000) index. Ports
// ModTransaction.FileExists (ModTransaction.cs:1125-1137) and the chain it calls:
// IOUtil.IsFFXIVInternalPath (IOUtil.cs:551-570), IOUtil.GetDataFileFromPath (IOUtil.cs:312-329),
// IndexFile.GetRawDataOffsetIndex1 (IndexFile.cs:546-576), and HashGenerator.ComputeCRC
// (HashGenerator.cs:154-205). The bundled set (chara-index.ts) is the COMPLETE chara category, so a
// miss means the file is genuinely absent in-game — not that it fell outside a bundled slice.
//
// Two deliberate non-ports, both safe here:
//   - GetRawDataOffset (IndexFile.cs:516-526) also reads index2 and returns 0 unless the two offsets
//     agree. That is a corrupted-index guard: on a vanilla install the two views are consistent by
//     construction, and a false positive against these full 64-bit (folder, file) keys needs a 2^-64
//     collision, so index2 would add 0.76 MB of payload for no reachable behaviour.
//   - GetRawDataOffsetIndex1's synonym-table half (:562-573). 040000's index1 synonym segment holds
//     only the always-present ending sentinel, i.e. no real synonyms; scripts/extract-chara-index.ts
//     asserts this at generation time and fails loud if a patch ever changes it.
import { base64ToBytes } from "../../util/base64";
import {
  CHARA_INDEX_COUNTS,
  CHARA_INDEX_FILES,
  CHARA_INDEX_FOLDERS,
} from "./chara-index";

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
    // Index is always 0-255 (masked with & 0xff) so this indexed access cannot be undefined.
    crc = CRC_TABLE[(crc ^ s.charCodeAt(i)) & 0xff]! ^ (crc >>> 8);
  }
  return crc >>> 0;
}

/** IOUtil.cs:550 — note it is case-sensitive, so any uppercase character disqualifies a path. */
const INVALID_RE = /[^a-z0-9./\-_{}]/;

// XivDataFile folder keys (XivDataFile.cs:35-91). The 30 expansion keys ("bg/ex1/01_", "cut/ex3/",
// "music/ex2/", ...) are all extensions of these 11, so for IsFFXIVInternalPath's prefix test this
// list is complete. The full list only matters to GetDataFileFromPath's choice of index — and no key
// extends "chara/", the one category we bundle, so that choice collapses to a single prefix test.
const FOLDER_KEYS = [
  "common/",
  "bgcommon/",
  "bg/",
  "cut/",
  "chara/",
  "shader/",
  "ui/",
  "sound/",
  "vfx/",
  "exd/",
  "music/",
];
const CHARA_KEY = "chara/";

function u32View(b64: string): Uint32Array {
  const bytes = base64ToBytes(b64);
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

const FOLDERS = u32View(CHARA_INDEX_FOLDERS);
const FILES = u32View(CHARA_INDEX_FILES);

/** Per-folder start offsets into FILES: STARTS[i] .. STARTS[i + 1] is folder i's file-hash slice.
 *  Decoded once from the LEB128 counts written by scripts/extract-chara-index.ts. */
const STARTS = (() => {
  const counts = base64ToBytes(CHARA_INDEX_COUNTS);
  const starts = new Uint32Array(FOLDERS.length + 1);
  let p = 0;
  let acc = 0;
  for (let i = 0; i < FOLDERS.length; i++) {
    starts[i] = acc;
    let shift = 1;
    let value = 0;
    for (;;) {
      const b = counts[p++]!;
      value += (b & 0x7f) * shift;
      if ((b & 0x80) === 0) break;
      shift *= 128;
    }
    acc += value;
  }
  starts[FOLDERS.length] = acc;
  return starts;
})();

/** Index of `value` in the ascending `arr[lo, hi)`, or -1. */
function search(arr: Uint32Array, lo: number, hi: number, value: number): number {
  let l = lo;
  let h = hi;
  while (l < h) {
    const mid = (l + h) >>> 1;
    const x = arr[mid]!;
    if (x === value) return mid;
    if (x < value) l = mid + 1;
    else h = mid;
  }
  return -1;
}

/** True iff `path` exists in the base game, reproducing rtx.FileExists. Throws for a valid FFXIV
 *  path outside the chara category — only 040000 is bundled, and answering `false` there would be an
 *  unjustified miss rather than a faithful one. */
export function fileExists(path: string): boolean {
  if (path.trim().length === 0) return false; // IsNullOrWhiteSpace (ModTransaction.cs:1127)
  if (INVALID_RE.test(path)) return false; // _InvalidRegex (IOUtil.cs:556)
  if (!path.startsWith(CHARA_KEY)) {
    if (FOLDER_KEYS.some((key) => path.startsWith(key))) {
      throw new Error(
        `upgrade: FileExists asked about "${path}", but only the chara (040000) category is ` +
          `bundled. Bundling another category is unported — see ` +
          `docs/superpowers/specs/2026-07-31-game-file-exists-oracle-design.md §3.`,
      );
    }
    return false; // not an FFXIV internal path (IOUtil.cs:561-569)
  }
  const slash = path.lastIndexOf("/");
  const folder = search(
    FOLDERS,
    0,
    FOLDERS.length,
    computeHash(path.slice(0, slash)),
  );
  if (folder < 0) return false;
  return (
    search(
      FILES,
      STARTS[folder]!,
      STARTS[folder + 1]!,
      computeHash(path.slice(slash + 1)),
    ) >= 0
  );
}
```

- [ ] **Step 6: Run the unit test to confirm it passes**

Run: `npx vitest run test/upgrade/file-exists.test.ts`
Expected: PASS, all 9 tests.

- [ ] **Step 7: Move `repath-hair-mashups.ts` onto the new oracle**

In `src/upgrade/repath-hair-mashups.ts`:
- change the import on line 11 to
  `import { fileExists } from "./reference/file-exists";`
- rename all **9** `hairTextureExists(` calls to `fileExists(` (lines 53, 57, 66, 70, 86, 90 — six
  call expressions, one of which sits inside the `tryMask` closure used four times)
- update the two prose mentions: line 5 (`rtx.FileExists -> the bundled hairTextureExists oracle`) and
  the comment at lines 83-85 (`our bundled oracle (hairTextureExists) is base-game only either way`) —
  say `fileExists` in both.

Verify none remain:

```powershell
Select-String -Path src\upgrade\repath-hair-mashups.ts -Pattern "hairTextureExists"
```
Expected: no output.

- [ ] **Step 8: Update the test mocks**

In `test/upgrade/repath-hair-mashups.test.ts` there are **5** `vi.doMock` blocks and 5 matching
`vi.doUnmock` calls (around lines 240, 266, 290, 314, 338 and 260, 284, 308, 332, 364). In each,
change the module specifier `"../../src/upgrade/reference/hair-texture-exists"` to
`"../../src/upgrade/reference/file-exists"` and the mocked export name `hairTextureExists:` to
`fileExists:`. Leave the `computeHash: () => 0` stub and every predicate body unchanged. Also update
the comment at line 24 (`in the bundled hairTextureExists oracle`).

- [ ] **Step 9: Delete the superseded files and fix the stale comment**

```powershell
git rm scripts/extract-hair-texture-index.ts src/upgrade/reference/hair-texture-index.ts src/upgrade/reference/hair-texture-exists.ts test/upgrade/hair-texture-exists.test.ts
```

Then in `src/upgrade/reference/index-path-resolver.ts` line 3, change
`CRC32 duplicated from hair-texture-exists.ts` to `CRC32 duplicated from file-exists.ts`.

Confirm nothing else references the removed modules:

```powershell
Select-String -Path src,test,scripts -Include *.ts -Recurse -Pattern "hair-texture-(exists|index)|hairTextureExists"
```
Expected: no output. (`docs/` still references them; Task 6 handles documentation.)

- [ ] **Step 10: Run the full gate**

Run: `npm run check`, then `npm run typecheck`, then `npm test`.
Expected: all green — including `mashup-hair-outofns.pmp`, whose `upgrade` check failed in Task 1 and
must now pass with no baseline entry.

If any **other** corpus pack newly fails, do not bless it. Report which pack and which key moved. The
two expected causes are named in the spec §8: a table regenerated from a newer game patch than the
cached golden, or the now-case-sensitive `_InvalidRegex` rejecting an uppercase sampler path.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(upgrade): complete chara FileExists oracle, replacing the hair-scoped table"
```

---

### Task 3: Route the index-path steal's gates through `fileExists`

`EndwalkerUpgrade.cs:926` is two `FileExists` calls. Gate B is answered today by a second, separately
enumerated table; gate A is fused into the resolver's table membership. Both move onto the oracle.

**Files:**
- Modify: `src/upgrade/material.ts:23-24, 138-146`
- Modify: `src/upgrade/reference/index-path-resolver.ts:7, 48-56, 81-88`
- Modify: `scripts/extract-index-table.ts` (stop emitting `ID_TEX_PACKED`)
- Modify: `src/upgrade/reference/index-table.ts` (drop the now-unused generated export)

**Interfaces:**
- Consumes: `fileExists` from `./reference/file-exists` (Task 2).
- Produces: `idTexExists` no longer exists; `resolveStolenIndexPath(materialPath: string): string |
  undefined` is unchanged.

- [ ] **Step 1: Read the C# both gates come from**

Read `reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/Mods/EndwalkerUpgrade.cs`
lines 918-940. Confirm for yourself that gate A is `rtx.FileExists(mtrl.MTRLPath, true)` and gate B is
`!await rtx.FileExists(idPath)`, joined by `&&`.

- [ ] **Step 2: Rewrite the gates in `material.ts`**

Replace lines 138-146 of `src/upgrade/material.ts` (the block from the
`// EndwalkerUpgrade.cs:923-936. Gate A …` comment through the closing `}` of the `if`) with:

```ts
  // EndwalkerUpgrade.cs:923-936. Gate A (`rtx.FileExists(mtrl.MTRLPath, true)` — the mod is
  // overwriting a base-game material) and gate B (`!rtx.FileExists(idPath)` — the convention index
  // path is not itself a base-game file) are both the game-index oracle. When both hold, steal the
  // base material's own index-sampler path. `resolveStolenIndexPath` answers only the remaining
  // question — WHICH path — from the bundled base-material table; a miss there means the material
  // exists but binds no index sampler, which is the C#'s `idSamp == null` skip (:930-935).
  if (fileExists(mtrl.mtrlPath) && !fileExists(idPath)) {
    const stolen = resolveStolenIndexPath(mtrl.mtrlPath);
    if (stolen !== undefined) {
      idPath = stolen;
    }
  }
```

Then fix the imports at lines 23-24: drop `idTexExists`, keep `resolveStolenIndexPath`, and add
`import { fileExists } from "./reference/file-exists";` in the correct sorted position (Biome's
`npm run check` will place it — write it and let the tool sort).

- [ ] **Step 3: Delete `idTexExists` from the resolver**

In `src/upgrade/reference/index-path-resolver.ts`:
- line 7: drop `ID_TEX_PACKED` from the import, keeping `INDEX_EXCEPTIONS` and `INDEX_PACKED`
- delete the whole `ID_TEX_ENTRIES` IIFE (lines 48-56)
- delete the whole `idTexExists` function and its doc comment (lines 81-88)

- [ ] **Step 4: Stop the generator emitting the table**

In `scripts/extract-index-table.ts`, remove the `ID_TEX_PACKED` production:
- line 261: delete the `const idTexPaths = new Set<string>();` declaration
- line 359: delete the `idTexPaths.add(idx.texturePath);` statement
- line 364: drop ` idTexPaths=${idTexPaths.size}` from the counts log
- lines 568-582: delete the `packHashPairs` helper and its comment
- line 585: delete the `const idTexPacked = packHashPairs([...idTexPaths]);` line
- lines 620-621 and 626: delete the two `ID_TEX_PACKED` header-comment lines and the
  `export const ID_TEX_PACKED = …` emission line
- update line 3's summary (`Builds two in-memory collections (\`pairs\`, \`idTexPaths\`)`) to name
  `pairs` alone

- [ ] **Step 5: Drop the generated export**

`src/upgrade/reference/index-table.ts` is a generated file, but regenerating it is a multi-minute
game-data walk that would also fold in any post-patch drift unrelated to this change. Instead make the
one deletion by hand, exactly matching what the updated generator now emits: remove the
`export const ID_TEX_PACKED = "…";` line and the two header-comment lines describing it. Say in your
commit message that the generator was updated in the same commit, so the file still matches its
generator.

- [ ] **Step 6: Confirm the symbol is gone everywhere**

```powershell
Select-String -Path src,test,scripts -Include *.ts -Recurse -Pattern "ID_TEX_PACKED|idTexExists|idTexPaths"
```
Expected: no output.

- [ ] **Step 7: Run the full gate**

Run: `npm run check`, then `npm run typecheck`, then `npm test`.
Expected: all green.

This is the one conversion in the plan that **can legitimately move output bytes**: if the old
`ID_TEX_PACKED` omitted any real `_id.tex`, gate B flips and a different index path gets stolen. If a
corpus pack's `payload` diff changes, that is signal, not noise — report the pack, the gamePath, and
the before/after index sampler path, and do **not** bless it.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(upgrade): index-path steal gates read the complete FileExists oracle"
```

---

### Task 4: Regenerate the hair and eye material tables

Task 5's fail-loud only makes sense against current tables. Do the data refresh on its own, so a
reviewer can see any byte movement it causes in isolation from the logic change.

**Files:**
- Modify (by running generators): `src/upgrade/reference/hair-materials.ts`,
  `src/upgrade/reference/eye-materials.ts`, `src/upgrade/reference/eye-base-textures.ts`

- [ ] **Step 1: Record the current state**

```powershell
git log -1 --format=%h; (Get-Content src\upgrade\reference\hair-materials.ts | Measure-Object -Line).Lines; (Get-Content src\upgrade\reference\eye-materials.ts | Measure-Object -Line).Lines
```

Note the numbers in your report so the diff below can be described.

- [ ] **Step 2: Regenerate**

Run: `npx tsx scripts/extract-hair-materials.ts`
Run: `npx tsx scripts/extract-eye-materials.ts`

Read each script's header first — if either takes arguments or needs a flag, follow its own
instructions rather than the bare invocation above.

- [ ] **Step 3: Inspect the diff**

```powershell
git diff --stat
```

Report what moved. Three outcomes, all fine, but say which: no change at all (the tables were already
current); entries added (the game patched since the last extraction); or an existing entry's *bytes*
changed (a base-game material itself changed — the case most likely to move our output).

- [ ] **Step 4: Run the full gate**

Run: `npm run check`, then `npm run typecheck`, then `npm test`.
Expected: all green.

If a corpus pack moves here, it means a bundled canonical material changed under a cached golden.
Report it. Per spec §8 the remedy is to purge that pack's `.upgrade-cache` entries and let ConsoleTools
re-run against the current game — not to bless the baseline.

- [ ] **Step 5: Commit**

If Step 3 showed no change, skip the commit and say so in your report. Otherwise:

```bash
git add src/upgrade/reference/hair-materials.ts src/upgrade/reference/eye-materials.ts src/upgrade/reference/eye-base-textures.ts
git commit -m "chore(reference): regenerate hair/eye material tables from the current install"
```

---

### Task 5: Split the hair and eye existence gates from their content lookups

`HAIR_MATERIALS.get()` / `EYE_MATERIALS.has()` currently answer two different C# questions at once:
`rtx.FileExists(matPath)` and the material read that follows it. Split them, and make disagreement
loud instead of silent.

**Files:**
- Modify: `src/upgrade/unclaimed-hair.ts:157-158` and `:281-282`
- Modify: `src/upgrade/eye-mask.ts:196-203`
- Test: `test/upgrade/file-exists.test.ts` is unchanged; the new behaviour is covered by the corpus and
  by the unit tests below in `test/upgrade/unclaimed-hair.test.ts` and `test/upgrade/eye-mask.test.ts`
  if those files already exist — check first with
  `Get-ChildItem test\upgrade\ -Filter "*hair*","*eye*"`.

**Interfaces:**
- Consumes: `fileExists` from `./reference/file-exists` (Task 2).

- [ ] **Step 1: Read the two C# sites**

Read `EndwalkerUpgrade.cs:1426-1440` and `:1611-1627` and `:2044-2060`. Confirm the shape is
`FileExists(path)` → `continue`/`return`, then a read of that same material.

- [ ] **Step 2: Split the hair-texture gate**

In `src/upgrade/unclaimed-hair.ts`, replace lines 157-158:

```ts
      const entry = table.get(matPath);
      if (!entry) continue; // FileExists false (spec §3.1, EndwalkerUpgrade.cs:1430-1434)
```

with:

```ts
      // EndwalkerUpgrade.cs:1430-1434 — `!rtx.FileExists(matPath, true)` -> continue. The bundled
      // table answers the SEPARATE question the C# asks next (GetXivMtrl of that material), so a
      // table miss on a material the game index says exists is a gap in the table, not a skip the
      // C# performs — fail loud rather than silently dropping the option's textures.
      if (!fileExists(matPath)) continue;
      const entry = table.get(matPath);
      if (!entry) {
        throw new Error(
          `upgrade: hair-materials table is missing ${matPath}, which the game index says exists. ` +
            `Regenerate it with \`npx tsx scripts/extract-hair-materials.ts\`.`,
        );
      }
```

- [ ] **Step 3: Split the accessory gate**

In the same file, replace lines 281-282:

```ts
    const entry = table.get(matPath);
    if (!entry) continue; // FileExists false (EndwalkerUpgrade.cs:1615-1619)
```

with:

```ts
    // EndwalkerUpgrade.cs:1615-1619 — same split as updateUnclaimedHairTextures above: the index
    // answers existence, the table answers content, and a disagreement is a table gap.
    if (!fileExists(matPath)) continue;
    const entry = table.get(matPath);
    if (!entry) {
      throw new Error(
        `upgrade: hair-materials table is missing ${matPath}, which the game index says exists. ` +
          `Regenerate it with \`npx tsx scripts/extract-hair-materials.ts\`.`,
      );
    }
```

Add `import { fileExists } from "./reference/file-exists";` to the imports.

- [ ] **Step 4: Split the eye gate**

In `src/upgrade/eye-mask.ts`, replace lines 196-197:

```ts
  // :2049 — FileExists false ("// Hmmm...", :2051) -> return.
  if (!table.has(irisPath)) return;
```

with:

```ts
  // :2049 — FileExists false ("// Hmmm...", :2051) -> return. Existence comes from the game index;
  // the bundled table answers the separate question the C# asks next (:2056-2059, reading the iris
  // material's g_SamplerDiffuse path), so a table miss on a material the index says exists is a gap
  // in the table rather than the C#'s early return.
  if (!fileExists(irisPath)) return;
  const entry = table.get(irisPath);
  if (entry === undefined) {
    throw new Error(
      `upgrade: eye-materials table is missing ${irisPath}, which the game index says exists. ` +
        `Regenerate it with \`npx tsx scripts/extract-eye-materials.ts\`.`,
    );
  }
```

Then change line 203 from `const diffusePath = table.get(irisPath)!.diffusePath;` to
`const diffusePath = entry.diffusePath;`, and add the `fileExists` import.

- [ ] **Step 5: Run the full gate**

Run: `npm run check`, then `npm run typecheck`, then `npm test`.
Expected: all green.

A new throw firing here means a real table gap. Report the exact material path — do not widen the
gate to silence it, and do not skip Task 4's regeneration to avoid it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(upgrade): split hair/eye existence gates from their content lookups"
```

---

### Task 6: Documentation and backlog burn-down

**Files:**
- Delete: `docs/backlog/2026-07-20-hair-texture-exists-namespace-scope.md`
- Modify: `docs/BACKLOG.md`, `docs/backlog/2026-07-20-index-extractor-tooling-nits.md`,
  `docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md`,
  `docs/superpowers/specs/2026-07-18-repath-hair-mashups-design.md`,
  `docs/superpowers/specs/2026-07-20-index-path-resolution-design.md`
- Delete: `docs/superpowers/plans/2026-07-31-game-file-exists-oracle.md` (this file — see Step 6)

- [ ] **Step 1: Find every dangling reference**

`docs/BACKLOG.md` requires this before deleting an item file:

```powershell
Select-String -Path docs,src,test,scripts -Include *.ts,*.md -Recurse -Pattern "hair-texture-exists-namespace-scope|hair-texture-exists|hair-texture-index|extract-hair-texture-index|hairTextureExists|ID_TEX_PACKED"
```

Work through every hit. The known ones:
- `docs/BACKLOG.md:109-115` — prioritized item 1.
- `docs/backlog/2026-07-20-index-extractor-tooling-nits.md:20` — cites
  `scripts/extract-hair-texture-index.ts:16-55` as one of three copies of the `RACES` grid. That copy
  is now deleted, so the nit is down to two copies; correct the sentence rather than deleting the item.
- `docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md:380, 392-393, 481-484` —
  describes the oracle as namespace-scoped with an open follow-up.
- `docs/superpowers/specs/2026-07-18-repath-hair-mashups-design.md:58, 81, 107, 151-176` — §3.2/§3.4
  describe the namespace-scoped table and its extractor.
- `docs/superpowers/specs/2026-07-20-index-path-resolution-design.md:97, 138, 228` — mentions
  `hair-texture-index.ts`, the shared `RACES` grid, and the sibling item this change closes; §3.3 also
  documents `ID_TEX_PACKED`, now retired.

- [ ] **Step 2: Update each doc**

Restate the descriptions for what shipped: a complete, unfiltered 040000 table; `fileExists` as the
single oracle; five call sites on it; `ID_TEX_PACKED` retired. Link the new spec
(`docs/superpowers/specs/2026-07-31-game-file-exists-oracle-design.md`) from the roadmap design's §8
and from the two specs above. Do not rewrite history in those specs — add a dated update line in the
style each file already uses.

- [ ] **Step 3: Delete the backlog item**

```powershell
git rm docs/backlog/2026-07-20-hair-texture-exists-namespace-scope.md
```

- [ ] **Step 4: Burn it down in the index**

In `docs/BACKLOG.md`, remove the item-1 entry, renumber the prioritized list (former 2-7 become 1-6),
and add a `**2026-07-31:**` note to the dated pass-note paragraph in the style of the existing ones,
recording: the item shipped; the oracle is now complete over chara; `idTexExists`/`ID_TEX_PACKED`
retired onto it; the hair/eye tables' existence gates split and now fail loud. Note that item 2 (the
diagnostics channel) becomes item 1.

- [ ] **Step 5: Run the full gate**

Run: `npm run check`, then `npm run typecheck`, then `npm test`.
Expected: all green.

- [ ] **Step 6: Delete this plan**

AGENTS.md: a plan is committed when written, then deleted on the branch before the PR, so the PR under
review carries only the durable spec and the shipped work.

```powershell
git rm docs/superpowers/plans/2026-07-31-game-file-exists-oracle.md
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: burn down the hair-texture-exists namespace item"
```

---

## Self-Review

**Spec coverage.** §3 decision 1 (complete table) → Task 2 Steps 3-4. §3 decision 2 (throw outside
chara) → Task 2 Step 5 plus its unit test in Step 1. §4 steps 1-5 and both non-ports → Task 2 Step 5.
§5 format → Task 2 Steps 3, 5. §6 conversion table: row 1 → Task 2 Step 7; rows 2-3 → Task 3; rows
4-5 → Tasks 4-5. §7 synthetic → Task 1; §7 unit tests → Task 2 Step 1. §8 risks → the report-don't-
bless instructions in Task 2 Step 10, Task 3 Step 7, Task 4 Step 4, Task 5 Step 5. §9 docs → Task 6.

**Placeholders.** None: every code step carries the literal content, and every "update this doc" step
names the file and line range plus what the new text must say.

**Type consistency.** `fileExists(path: string): boolean` and `computeHash(path: string): number` are
defined in Task 2 and consumed under those exact names in Tasks 2, 3 and 5. `CHARA_INDEX_FOLDERS` /
`CHARA_INDEX_COUNTS` / `CHARA_INDEX_FILES` are emitted by the Task 2 Step 3 generator and imported
under the same names in Step 5, and the LEB128 written by the generator's `varint` matches the
decoder in `STARTS`. `resolveStolenIndexPath` keeps its existing signature.
