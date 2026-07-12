# PMP case-insensitive Files resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `readPmp` resolve a PMP option's `Files` entries case-insensitively so the 41 real Penumbra packs that currently throw `pmp: missing file entry` load, matching TexTools.

**Architecture:** Penumbra lowercases the `Files` JSON *values* while the archive preserves the option-folder display case. TexTools resolves these by reading `Path.Combine(unzipPath, file.Value)` from the unzipped folder on case-insensitive NTFS (`PMP.cs:1080`), after a `LoadPMP` that never checks file existence at load (`PMP.cs:124`). We reproduce that by building a lowercase-keyed index of archive entries once in `readPmp` and looking each `Files` value up against it; `pmpPath` stays the manifest value, so the writer and golden are unaffected. We still throw when nothing matches under any casing (the 6 genuinely-absent packs stay fail-loud — see the spec §6 / `BACKLOG.md`).

**Tech Stack:** TypeScript, Vitest, fflate (zip), the existing `/upgrade` golden harness (ConsoleTools oracle).

**Spec:** `docs/superpowers/specs/2026-07-11-pmp-case-insensitive-file-resolution-design.md`

## Global Constraints

- **Byte-parity is correctness.** Output must be byte-identical to ConsoleTools `/upgrade` per gamePath, except documented `DIVERGENCE_RULES` entries. This change introduces **no** new divergence (it removes an erroneous throw).
- **Provenance required.** Every business-logic change cites its C# source as `file · symbol · lines` in a comment. Here: `PMP.cs:1080` (`Path.Combine(unzipPath, file.Value)`) and `PMP.cs:124` (`LoadPMP`, no load-time existence check).
- **No per-file license/SPDX headers.**
- **Formatting is Biome's.** Never hand-format; run `npm run check`.
- **End-of-task ritual (required, all green before done):** `npm run check` → `npm run typecheck` → `npm test`.
- **Corpus is gitignored.** `test/corpus/real/`, `test/corpus/synthetic/*.pmp`, `.upgrade-cache/`, `.upgrade-baseline/` are local-only — a corpus pack you add is **never committed**; only source, tests, and the builder script are.
- **Bless command:** `$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`

---

### Task 1: Case-insensitive `Files` resolution in `readPmp` (+ unit tests)

**Files:**
- Modify: `src/container/pmp.ts` (`optionFromJson` ~22-51, `readPmp` ~53-112)
- Test: `test/container/pmp-read.test.ts`

**Interfaces:**
- Consumes: `readZip(bytes): Map<string, Uint8Array>` (`src/zip/zip.ts`), `allFiles(data)` (`src/model/modpack.ts`), `writeZip(entries)` (`src/zip/zip.ts`).
- Produces: unchanged public signature `readPmp(bytes: Uint8Array): ModpackData`. Internal: `optionFromJson(o, filesLower)` now takes a **lowercase-keyed** index `Map<string, Uint8Array>` instead of the raw entries map. `ModpackOption.files[i].pmpPath` remains the normalized (forward-slash) `Files` value verbatim — NOT rewritten to the archive's display case.

- [ ] **Step 1: Write the failing tests**

Append to `test/container/pmp-read.test.ts`. Add `writeZip` and `allFiles` to the existing imports (the file already imports from `../../src/model/modpack` and `../helpers/make-packs`; add the two named imports and a `TextEncoder`).

```ts
import { describe, expect, it } from "vitest";
import { readPmp } from "../../src/container/pmp";
import {
  allFiles,
  FileStorageType,
  ModpackFormat,
} from "../../src/model/modpack";
import { writeZip } from "../../src/zip/zip";
import { makePmpZip } from "../helpers/make-packs";

const enc = new TextEncoder();

// ... keep the existing describe("readPmp", ...) block unchanged ...

describe("readPmp case-insensitive Files resolution", () => {
  // Penumbra lowercases the Files VALUE; the archive keeps the option-folder DISPLAY case.
  // TexTools resolves this via a case-insensitive NTFS read (PMP.cs:1080); we must too.
  it("resolves a lowercased Files value against a display-case zip entry", () => {
    const gamePath =
      "chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl";
    const displayEntry = `Holographic Options/Dyeable Holo/${gamePath}`;
    const filesValue = displayEntry.toLowerCase().replace(/\//g, "\\");
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

    const meta = {
      FileVersion: 3,
      Name: "Case",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = {
      Version: 0,
      Files: {},
      FileSwaps: {},
      Manipulations: [],
    };
    const group = {
      Version: 0,
      Name: "Holographic Options",
      Description: "",
      Type: "Single",
      Priority: 0,
      DefaultSettings: 0,
      Options: [
        {
          Name: "Dyeable Holo",
          Description: "",
          Image: "",
          Files: { [gamePath]: filesValue },
          FileSwaps: {},
          Manipulations: [],
        },
      ],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
      ["group_001_holographic options.json", enc.encode(JSON.stringify(group))],
      [displayEntry, payload],
    ]);

    const data = readPmp(writeZip(entries));
    const f = allFiles(data).find((x) => x.gamePath === gamePath);
    expect(f).toBeDefined();
    expect(f!.storage).toBe(FileStorageType.RawUncompressed);
    expect(f!.data).toEqual(payload);
    expect(data.sourceFormat).toBe(ModpackFormat.Pmp);
  });

  it("throws when no archive entry matches under any casing", () => {
    const gamePath =
      "chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl";
    const meta = {
      FileVersion: 3,
      Name: "Absent",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    // Files references files/missing.mtrl, which is present under NO casing.
    const defaultMod = {
      Version: 0,
      Files: { [gamePath]: "files\\missing.mtrl" },
      FileSwaps: {},
      Manipulations: [],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
    ]);

    expect(() => readPmp(writeZip(entries))).toThrow(
      /missing file entry files\/missing\.mtrl/,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/container/pmp-read.test.ts`
Expected: the "resolves a lowercased Files value" test FAILS with `pmp: missing file entry holographic options/dyeable holo/...` (the pre-fix case-sensitive lookup). The "throws when no archive entry" test may already PASS — that's fine; it pins the preserved behavior.

- [ ] **Step 3: Implement the fix in `src/container/pmp.ts`**

Change `optionFromJson` to take a lowercase-keyed index and look up case-insensitively:

```ts
function optionFromJson(
  o: PmpOptionJson,
  filesLower: Map<string, Uint8Array>,
): ModpackOption {
  const modFiles = Object.entries(o.Files ?? {}).map(
    ([gamePath, zipPathRaw]) => {
      const zipPath = zipPathRaw.replace(/\\/g, "/");
      // Case-insensitive resolution. Penumbra lowercases the Files value while the archive
      // preserves the option-folder display case; TexTools reads Path.Combine(unzipPath,
      // file.Value) from the unzipped folder on case-insensitive NTFS (PMP.cs:1080), after a
      // LoadPMP that never verifies existence at load (PMP.cs:124). Look up the lowercased key;
      // pmpPath keeps the manifest value verbatim so the writer/golden are unaffected.
      const data = filesLower.get(zipPath.toLowerCase());
      if (!data) throw new Error(`pmp: missing file entry ${zipPath}`);
      return {
        gamePath,
        data,
        storage: FileStorageType.RawUncompressed,
        pmpPath: zipPath,
      };
    },
  );
  return {
    name: o.Name ?? "",
    description: o.Description ?? "",
    image: o.Image ?? "",
    priority: o.Priority ?? 0,
    files: modFiles,
    fileSwaps: o.FileSwaps ?? {},
    manipulations: o.Manipulations ?? [],
    raw: o,
  };
}
```

In `readPmp`, build the index once (after `const entries = readZip(bytes);`) and pass it to both `optionFromJson` call sites:

```ts
export function readPmp(bytes: Uint8Array): ModpackData {
  const entries = readZip(bytes);
  // Lowercase-keyed index of archive entries, so option Files values (which Penumbra lowercases)
  // resolve regardless of the entry's stored casing. On NTFS two entries can't differ only by
  // case, so a lowercased-key collision cannot occur for a pack that unzips (matching the
  // filesystem TexTools relies on).
  const filesLower = new Map<string, Uint8Array>();
  for (const [name, data] of entries) filesLower.set(name.toLowerCase(), data);

  const metaBytes = entries.get("meta.json");
  if (!metaBytes) throw new Error("pmp: missing meta.json");
  const defaultBytes = entries.get("default_mod.json");
  if (!defaultBytes) throw new Error("pmp: missing default_mod.json");
  const meta = JSON.parse(dec.decode(metaBytes)) as PmpMetaJson;
  const defaultMod = JSON.parse(dec.decode(defaultBytes)) as PmpOptionJson;

  const groupNames = [...entries.keys()]
    .filter((k) => /^group_\d+.*\.json$/i.test(k))
    .sort();

  const groups: ModpackGroup[] = [];
  groups.push({
    name: "Default",
    description: "",
    image: "",
    page: 0,
    priority: 0,
    selectionType: "Single",
    defaultSettings: 0,
    options: [optionFromJson(defaultMod, filesLower)],
  });

  for (const name of groupNames) {
    const g = JSON.parse(dec.decode(entries.get(name)!)) as PmpGroupJson;
    groups.push({
      name: g.Name,
      description: g.Description ?? "",
      image: g.Image ?? "",
      page: g.Page ?? 0,
      priority: g.Priority ?? 0,
      selectionType: g.Type,
      defaultSettings: g.DefaultSettings ?? 0,
      options: (g.Options ?? []).map((o) => optionFromJson(o, filesLower)),
      raw: g,
    });
  }

  // ... rest of readPmp (the returned ModpackData) unchanged ...
```

Leave everything below the group loop (the `return { sourceFormat: ... }` block) exactly as-is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/container/pmp-read.test.ts`
Expected: PASS (both new tests + the pre-existing "reads meta, default mod, and groups with raw files").

- [ ] **Step 5: Full gate**

Run: `npm run check` then `npm run typecheck`
Expected: both clean (Biome may reformat the new test — that's expected; re-stage after).

- [ ] **Step 6: Commit**

```powershell
git add src/container/pmp.ts test/container/pmp-read.test.ts
git commit -m @'
fix(pmp): resolve option Files entries case-insensitively

Penumbra lowercases Files values while the archive keeps the option-folder
display case; readPmp did an exact-case lookup and threw pmp: missing file
entry on 41 real packs. TexTools resolves these via Path.Combine on
case-insensitive NTFS (PMP.cs:1080) after an existence-check-free LoadPMP
(PMP.cs:124). Build a lowercase-keyed archive index in readPmp; pmpPath keeps
the manifest value so writer/golden are unaffected. Still throws when nothing
matches under any casing (the genuinely-absent packs stay fail-loud).
'@
```

---

### Task 2: Committed synthetic-golden builder (case-mismatch PMP)

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-case-mismatch.mjs`
- (Generates, gitignored: `test/corpus/synthetic/case-mismatch.pmp`)

**Interfaces:**
- Consumes: `fflate` `zipSync` (already a dependency). Mirrors `scripts/generate-synthetics/build-synthetic-f1.mjs`.
- Produces: a `test/corpus/synthetic/case-mismatch.pmp` that the auto-discovering corpus harness (`test/helpers/corpus-units.ts` scans `test/corpus/synthetic/`) registers an `upgrade` golden check for. ConsoleTools `/upgrade` no-ops on it (its only gamePath is one `/upgrade` ignores), so it's compared against its own input.

- [ ] **Step 1: Write the builder**

Create `scripts/generate-synthetics/build-synthetic-case-mismatch.mjs`:

```js
// Builds test/corpus/synthetic/case-mismatch.pmp: a PMP whose option Files VALUE is lowercased
// (as Penumbra writes it) while the archived payload entry preserves the option-folder DISPLAY
// case. Pre-fix, readPmp's exact-case lookup throws `pmp: missing file entry`; TexTools loads it
// via a case-insensitive NTFS read (PMP.cs:1080). The single gamePath is one /upgrade ignores, so
// ConsoleTools no-ops and the golden harness compares our output against the input. Reproduces the
// case-sensitivity fix (see docs/superpowers/specs/2026-07-11-pmp-case-insensitive-file-resolution-design.md).
// The .pmp is gitignored; regenerate locally with
// `node scripts/generate-synthetics/build-synthetic-case-mismatch.mjs`.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "test", "corpus", "synthetic");
const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 2));

// A gamePath /upgrade ignores, so ConsoleTools no-ops.
const dummyGamePath = "chara/dummy/case_dummy.bin";
// Zip entry keeps DISPLAY case; the Files VALUE is lowercased + backslashed (Penumbra's form).
const displayZipPath = "Case Options/On/files/case_dummy.bin";
const filesValue = displayZipPath.toLowerCase().replace(/\//g, "\\");
const dummy = new Uint8Array([0, 1, 2, 3]);

const meta = {
  FileVersion: 3,
  Name: "Case Mismatch Repro",
  Author: "synthetic",
  Description: "",
  Version: "1.0.0",
  Website: "",
  ModTags: [],
};
const defaultMod = {
  Name: "",
  Description: "",
  Files: {},
  FileSwaps: {},
  Manipulations: [],
};
const group = {
  Version: 0,
  Name: "Case Options",
  Description: "",
  Image: "",
  Page: 0,
  Priority: 0,
  Type: "Single",
  DefaultSettings: 0,
  Options: [
    {
      Name: "On",
      Description: "",
      Image: "",
      Files: { [dummyGamePath]: filesValue },
      FileSwaps: {},
      Manipulations: [],
    },
  ],
};

const members = {
  "meta.json": enc(meta),
  "default_mod.json": enc(defaultMod),
  // group filename = group_001_<safeName("Case Options")> = the lowercased penumbra name, so our
  // writer reproduces it (mirrors build-synthetic-f1.mjs).
  "group_001_case options.json": enc(group),
  [displayZipPath]: dummy,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "case-mismatch.pmp"), zipSync(members));
console.log("wrote", join(outDir, "case-mismatch.pmp"));
```

- [ ] **Step 2: Generate the pack**

Run: `node scripts/generate-synthetics/build-synthetic-case-mismatch.mjs`
Expected: `wrote …\test\corpus\synthetic\case-mismatch.pmp`

- [ ] **Step 3: Run the golden check for it (populates the ConsoleTools cache)**

Run: `npx vitest run -t "case-mismatch.pmp"`
Expected: PASS — `[upgrade] case-mismatch.pmp: N matched, 0 diffs, 0 regressions (baseline 0)`. (First run spawns ConsoleTools once to build the no-op golden; it caches a `<key>.noop` marker.) If ConsoleTools is not installed, the check throws "No /upgrade golden" — install it or run on the oracle machine; the builder itself is still correct and committable.

- [ ] **Step 4: Investigate any diff (should be none)**

If Step 3 reports diffs > 0: the pack is a no-op, so `reference` is the input and any diff is a genuine round-trip gap. Inspect the reported `gamePath#index:status`. A `structure`/`manifest` diff on `group_001_*.json` means `safeName("Case Options")` ≠ the builder's filename — reconcile the two (the builder's group filename must equal `group_001_${safeName(name)}`). Do NOT bless a synthetic pack you authored to fully match; fix the cause so `diffs = 0`.

- [ ] **Step 5: Commit the builder**

```powershell
git add scripts/generate-synthetics/build-synthetic-case-mismatch.mjs
git commit -m @'
test(pmp): synthetic case-mismatch golden through the /upgrade harness

Committed builder emitting a gitignored case-mismatch.pmp (lowercased Files
value vs display-case payload entry) that flows through the /upgrade golden
harness, AB-testing that ConsoleTools tolerates the case-mismatch and our
post-fix pipeline matches. Mirrors build-synthetic-f1.mjs.
'@
```

---

### Task 3: Local real-corpus pack, final gate, and cleanup

This task produces **no committed artifact** (the corpus pack, golden cache, and baseline are all gitignored). Its deliverable is the fix proven end-to-end against a real Penumbra pack plus a clean full-suite gate.

**Files:**
- Copy (local, gitignored): `test/corpus/real/Groove 001.pmp`
- Delete (throwaway local probes): `local-notes/inspect-fail.ts`, `local-notes/probe-ttmp-match.ts`
- Keep: `local-notes/scan-failed-loads.ts`, `local-notes/classify-fails.ts` (both cited in `BACKLOG.md`).

- [ ] **Step 1: Copy Groove 001 into the local real corpus**

```powershell
Copy-Item "C:\Users\user\Downloads\Ela's Dances\Groove 001.pmp" "C:\dev\efokschaner\ffxiv-upgrade-modpack\test\corpus\real\Groove 001.pmp"
```

- [ ] **Step 2: Run its golden check**

Run: `npx vitest run -t "Groove 001.pmp"`
Expected: PASS with 0 diffs. Pre-fix this pack could not even load (`pmp: missing file entry ear physics/off/...`); post-fix it loads, `/upgrade` no-ops (animation-only), and our output matches the input. First run spawns ConsoleTools once to cache the `.noop` marker.

- [ ] **Step 3: If (and only if) it reports non-zero diffs, triage then bless**

A real pack may carry a known-shaped manifest diff. Inspect the `gamePath#index:status` lines. If they are genuine port bugs, stop and fix (a found divergence is a coverage gap). If they are the known TTMP/PMP manifest-parity surface (`TTMPL.mpl`/`group_*.json`), record the baseline:

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npx vitest run -t "Groove 001.pmp"; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

Then re-run Step 2 and confirm `0 regressions`.

- [ ] **Step 4: Delete the throwaway local probes**

```powershell
Remove-Item "C:\dev\efokschaner\ffxiv-upgrade-modpack\local-notes\inspect-fail.ts","C:\dev\efokschaner\ffxiv-upgrade-modpack\local-notes\probe-ttmp-match.ts"
```

(These are gitignored, so there is nothing to commit. `scan-failed-loads.ts` and `classify-fails.ts` stay — `BACKLOG.md` cites them.)

- [ ] **Step 5: Full end-of-task gate**

Run: `npm run check`
Run: `npm run typecheck`
Run: `npm test`
Expected: all green — including the new `upgrade golden: case-mismatch.pmp` and `upgrade golden: Groove 001.pmp` checks, and the `readPmp` unit tests. This is the primary gate; do not consider the task complete until all three pass.

- [ ] **Step 6: Push**

```powershell
git push origin main
```

Expected: the Task 1 and Task 2 commits (fix + tests + builder) land on `origin/main`. (Nothing from Task 3 is committed — it is local verification only.)

---

## Self-Review

**Spec coverage:**
- §3 fix (case-insensitive index, `pmpPath` unchanged, fail-loud preserved) → Task 1 ✓
- §4.1 `pmp-read` unit test (resolve + still-throws) → Task 1 Step 1 ✓
- §4.2 committed synthetic-golden builder → Task 2 ✓
- §4.3 Groove 001 into local real corpus → Task 3 ✓
- §4 "no non-no-op pack added" → honored (no such task) ✓
- §5 no new `DIVERGENCE_RULES` → nothing added ✓
- §6 the 6 absent packs → already recorded in `BACKLOG.md` (commit `06579d9`); no task needed ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has expected output. ✓

**Type consistency:** `optionFromJson(o, filesLower)` takes `Map<string, Uint8Array>` at its definition and both call sites (default + group loop); `pmpPath` set to `zipPath` (normalized value) in the returned file; test uses `readPmp`/`writeZip`/`allFiles` with their real signatures. ✓
