# PMP Windows path-normalization (trailing dots/spaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `readPmp` resolve `Files` values whose path segments differ from the archive only by trailing dots/spaces (Windows filename normalization), so packs like `[Jaque] Romeo & Juliet` load and upgrade instead of throwing `pmp: missing file entry`.

**Architecture:** Generalize the PMP reader's archive-index key function from `toLowerCase()` to a `windowsPathKey()` that also strips trailing `.`/` ` from each `/`-separated segment, emulating the second facet of the NTFS `Path.Combine` reads TexTools relies on (`PMP.cs:1080`, guarded by nothing in `LoadPMP` `PMP.cs:124`). Truly-absent entries still throw. Everything downstream (`pmpPath`, the writer, the model) is untouched.

**Tech Stack:** TypeScript, Vitest, the custom `/upgrade` golden harness (ConsoleTools oracle), fflate (`zipSync`) for the synthetic builder.

## Global Constraints

- **Byte-parity is correctness.** Output must be byte-identical to ConsoleTools `/upgrade` except documented divergences; this change introduces none (it removes an erroneous load-time throw).
- **Provenance required.** The one behavioural addition (`windowsPathKey`) cites `PMP.cs:1080` / `PMP.cs:124` (the OS-level Path.Combine/File reads `LoadPMP` never guards) in a comment.
- **Normalization scope is exactly case-fold + trailing-dot/space per segment.** No other Win32 quirks (YAGNI); anything still unresolved must throw `pmp: missing file entry`.
- **Design spec:** `docs/superpowers/specs/2026-07-11-pmp-windows-path-normalization-design.md` is authoritative.
- **End-of-task ritual (required, all green):** `npm run check`, then `npm run typecheck`, then `npm test`.
- **Formatting is Biome's.** Do not hand-format; `npm run check` applies fixes. A lefthook pre-commit hook runs Biome + typecheck on every commit.
- **Commit boundaries:** committed → `src/container/pmp.ts`, `test/container/pmp-read.test.ts`, `scripts/generate-synthetics/build-synthetic-trailing-dot.mjs`, `BACKLOG.md`. Local-only / gitignored (never committed) → `test/corpus/**`, `.upgrade-baseline/**`, `local-notes/**`.

---

### Task 1: `windowsPathKey` resolution in `readPmp` + unit tests

**Files:**
- Modify: `src/container/pmp.ts` (add `windowsPathKey`; rewire the archive index build at lines ~64-65, the lookup at line ~34, and the `optionFromJson` param name)
- Test: `test/container/pmp-read.test.ts` (add a new `describe` block; keep the existing case + absent tests)

**Interfaces:**
- Consumes: `readZip` (already normalizes `\`→`/` in entry names — see `src/zip/zip.ts:9`), `writeZip`, `allFiles`, model types — all already imported by the current file/test.
- Produces: `windowsPathKey(path: string): string` — module-private helper in `pmp.ts` (not exported); no signature changes to `readPmp` / `optionFromJson`'s public shape.

- [ ] **Step 1: Write the failing tests**

Append this block to `test/container/pmp-read.test.ts` (the file already defines `const enc = new TextEncoder();` and imports `readPmp`, `allFiles`, `writeZip`):

```ts
describe("readPmp Windows path-normalization (trailing dots/spaces)", () => {
  // Windows strips trailing dots/spaces from each path segment; Penumbra keeps them in the
  // lowercased Files VALUE while the archive stores the stripped name. TexTools resolves this via
  // an NTFS Path.Combine read (PMP.cs:1080) after a LoadPMP that never checks existence (PMP.cs:124).
  function buildPmp(
    gamePath: string,
    displayEntry: string,
    filesValue: string,
    payload: Uint8Array,
  ): Uint8Array {
    const meta = {
      FileVersion: 3,
      Name: "Norm",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = { Version: 0, Files: {}, FileSwaps: {}, Manipulations: [] };
    const group = {
      Version: 0,
      Name: "Options",
      Description: "",
      Type: "Single",
      Priority: 0,
      DefaultSettings: 0,
      Options: [
        {
          Name: "On",
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
      ["group_001_options.json", enc.encode(JSON.stringify(group))],
      [displayEntry, payload],
    ]);
    return writeZip(entries);
  }

  it("resolves a trailing-dot Files value against a stripped zip entry", () => {
    const gamePath =
      "chara/equipment/e6069/material/v0007/mt_c0101e6069_glv_b.mtrl";
    // Archive stores the folder WITHOUT the trailing dot; value KEEPS it (Penumbra's lowercased form).
    const strippedEntry = `Optional/Rose acc/${gamePath}`;
    const filesValue = `optional\\rose acc.\\${gamePath.replace(/\//g, "\\")}`;
    const payload = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
    const data = readPmp(buildPmp(gamePath, strippedEntry, filesValue, payload));
    const f = allFiles(data).find((x) => x.gamePath === gamePath);
    expect(f).toBeDefined();
    expect(f!.data).toEqual(payload);
  });

  it("resolves a trailing-space Files value against a stripped zip entry", () => {
    const gamePath = "chara/equipment/e6069/model/c0201e6069_glv.mdl";
    const strippedEntry = `Optional/Rose acc/${gamePath}`;
    const filesValue = `optional\\rose acc \\${gamePath.replace(/\//g, "\\")}`;
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const data = readPmp(buildPmp(gamePath, strippedEntry, filesValue, payload));
    const f = allFiles(data).find((x) => x.gamePath === gamePath);
    expect(f).toBeDefined();
    expect(f!.data).toEqual(payload);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run test/container/pmp-read.test.ts -t "Windows path-normalization"`
Expected: FAIL — both cases throw `pmp: missing file entry …` (pre-fix, `zipPath.toLowerCase()` keeps the trailing `.`/` ` and misses the stripped entry).

- [ ] **Step 3: Add the `windowsPathKey` helper**

In `src/container/pmp.ts`, immediately after `const dec = new TextDecoder();` (line ~20), add:

```ts
// Emulates the subset of Win32 path normalization that TexTools' NTFS Path.Combine/File reads rely
// on (PMP.cs:1080), which LoadPMP never guards (PMP.cs:124): lowercase (case-insensitive filesystem)
// plus TrimEnd('.', ' ') on each path segment (Windows strips trailing dots/spaces from every name
// component). readZip already normalizes '\' -> '/', so segments split on '/'. Penumbra lowercases
// the Files value and can retain a trailing dot/space the archive/on-disk name drops; normalizing
// both sides the same way resolves them (see the PMP Windows path-normalization design spec).
function windowsPathKey(path: string): string {
  return path
    .toLowerCase()
    .split("/")
    .map((seg) => seg.replace(/[. ]+$/, ""))
    .join("/");
}
```

- [ ] **Step 4: Rewire the archive index build in `readPmp`**

In `src/container/pmp.ts`, replace the existing index-build block (currently lines ~60-65, the comment + `const filesLower` + the `for` loop) with:

```ts
  // windowsPathKey-keyed index of archive entries, so option Files values (which Penumbra lowercases
  // and may keep trailing dots/spaces on) resolve the way TexTools' NTFS reads do. On NTFS two
  // entries can't share a normalized name in one folder, so a key collision cannot occur for a pack
  // that unzips (matching the filesystem TexTools relies on); last-write-wins otherwise.
  const filesByKey = new Map<string, Uint8Array>();
  for (const [name, data] of entries) filesByKey.set(windowsPathKey(name), data);
```

Then update the two `optionFromJson(..., filesLower)` call sites in `readPmp` (the `"Default"` group's `optionFromJson(defaultMod, filesLower)` at line ~88 and `options: (g.Options ?? []).map((o) => optionFromJson(o, filesLower))` at line ~101) to pass `filesByKey` instead of `filesLower`.

- [ ] **Step 5: Rewire the lookup in `optionFromJson`**

In `src/container/pmp.ts`, change `optionFromJson`'s signature parameter name and its lookup. Replace the parameter `filesLower: Map<string, Uint8Array>,` with `filesByKey: Map<string, Uint8Array>,`, replace the resolution comment + lookup line (currently lines ~29-34) with:

```ts
      // Windows-filesystem-equivalent resolution. Penumbra lowercases the Files value and may keep a
      // trailing dot/space on a folder segment that the archive/NTFS name drops; TexTools reads
      // Path.Combine(unzipPath, file.Value) from the unzipped folder (PMP.cs:1080) after a LoadPMP
      // that never verifies existence (PMP.cs:124). Look up the windowsPathKey; pmpPath keeps the
      // manifest value verbatim so the writer/golden are unaffected.
      const data = filesByKey.get(windowsPathKey(zipPath));
```

Leave the `if (!data) throw new Error(...)` line and everything else in `optionFromJson` unchanged.

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `npx vitest run test/container/pmp-read.test.ts -t "Windows path-normalization"`
Expected: PASS (both cases).

- [ ] **Step 7: Run the whole `pmp-read` file to confirm no regression**

Run: `npx vitest run test/container/pmp-read.test.ts`
Expected: PASS — including the pre-existing `case-insensitive` block and `throws when no archive entry matches under any casing` (its `files/missing.mtrl` is absent under this normalization too, so it still throws).

- [ ] **Step 8: End-of-task ritual + commit**

Run: `npm run check` then `npm run typecheck` then `npm test`
Expected: all green.

```powershell
git add src/container/pmp.ts test/container/pmp-read.test.ts
git commit -m "fix(pmp): resolve Files entries under Windows trailing-dot/space normalization"
```

---

### Task 2: Committed synthetic golden builder

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-trailing-dot.mjs`
- Local artifact (gitignored, regenerated by the builder): `test/corpus/synthetic/trailing-dot.pmp`

**Interfaces:**
- Consumes: `fflate`'s `zipSync` (already a dependency — see `build-synthetic-case-mismatch.mjs`).
- Produces: a `test/corpus/synthetic/trailing-dot.pmp` the `/upgrade` harness discovers via `test/helpers/corpus-roots.ts` (`test/corpus/synthetic` is a corpus root).

- [ ] **Step 1: Write the builder**

Create `scripts/generate-synthetics/build-synthetic-trailing-dot.mjs`:

```js
// Builds test/corpus/synthetic/trailing-dot.pmp: a PMP whose option Files VALUE keeps a trailing
// dot on a folder segment (Penumbra's lowercased form) while the archived payload entry stores the
// Windows-stripped name. Pre-fix, readPmp misses it and throws `pmp: missing file entry`; TexTools
// resolves it via an NTFS Path.Combine read (PMP.cs:1080) after a LoadPMP with no existence check
// (PMP.cs:124). The single gamePath is one /upgrade ignores, so ConsoleTools no-ops and the golden
// harness compares our output against the input. Reproduces the Windows path-normalization fix (see
// docs/superpowers/specs/2026-07-11-pmp-windows-path-normalization-design.md). The .pmp is gitignored;
// regenerate locally with `node scripts/generate-synthetics/build-synthetic-trailing-dot.mjs`.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "test", "corpus", "synthetic");
const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 2));

// A gamePath /upgrade ignores, so ConsoleTools no-ops.
const dummyGamePath = "chara/dummy/trailing_dot_dummy.bin";
// Archived entry: the Windows-stripped folder name (no trailing dot), arbitrary display case.
const strippedZipPath = "Trailing Options/Rose acc/files/trailing_dot_dummy.bin";
// Files VALUE: Penumbra's lowercased form, retaining a trailing '.' on the folder segment + backslashes.
const filesValue = "trailing options\\rose acc.\\files\\trailing_dot_dummy.bin";
const dummy = new Uint8Array([0, 1, 2, 3]);

const meta = {
  FileVersion: 3,
  Name: "Trailing Dot Repro",
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
  Name: "Trailing Options",
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
  // group filename = group_001_<safeName("Trailing Options")> = the lowercased penumbra name, so our
  // writer reproduces it (mirrors build-synthetic-case-mismatch.mjs).
  "group_001_trailing options.json": enc(group),
  [strippedZipPath]: dummy,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "trailing-dot.pmp"), zipSync(members));
console.log("wrote", join(outDir, "trailing-dot.pmp"));
```

- [ ] **Step 2: Regenerate the synthetic pack**

Run: `node scripts/generate-synthetics/build-synthetic-trailing-dot.mjs`
Expected: prints `wrote …\test\corpus\synthetic\trailing-dot.pmp`.

- [ ] **Step 3: Run the full suite so the harness exercises it**

Run: `npm test`
Expected: green. The `upgrade` check discovers `trailing-dot.pmp`, spawns ConsoleTools `/upgrade` (which no-ops — the `.bin` gamePath is ignored), caches a `.noop` marker, and compares our post-fix output against the input by gamePath (dummy bytes round-trip identically). A brand-new synthetic has no baseline and must fully match; if it does not, stop and diagnose (it should match cleanly, exactly as `case-mismatch.pmp` does).

- [ ] **Step 4: Commit the builder**

```powershell
git add scripts/generate-synthetics/build-synthetic-trailing-dot.mjs
git commit -m "test(pmp): synthetic trailing-dot golden through the /upgrade harness"
```

(Only the builder is committed — `test/corpus/synthetic/trailing-dot.pmp` is gitignored and regenerated from it.)

---

### Task 3: Local real-corpus AB-test — bless Romeo (verification, no commit)

**Files:**
- Local artifact (gitignored): `test/corpus/real/[Jaque] Romeo & Juliet [feb 2023] - DT update.pmp`
- Local artifact (gitignored, written by the bless run): `test/corpus/.upgrade-baseline/**`

This task is a **local end-to-end verification**; it produces no commit (corpus + baseline are gitignored). It is the strong proof that our normalization *plus* the full upgrade transform matches TexTools on a real, non-noop pack (Romeo produces a 63 MB upgraded pack).

- [ ] **Step 1: Copy Romeo into the local real corpus**

```powershell
Copy-Item "C:\Users\user\Documents\XIVModOriginals\AestheticMods\AM Mods- Jaque\Jaque 2021-2024 ( Previous Years)\AM Jaque- 2023\February 2023\[Jaque] Romeo & Juliet [feb 2023] - DT update.pmp" "C:\dev\efokschaner\ffxiv-upgrade-modpack\test\corpus\real\"
```

- [ ] **Step 2: Confirm it now LOADS (the narrow claim of this change)**

Run: `npm test`
Expected outcome to interpret: the `upgrade` check for Romeo no longer throws `pmp: missing file entry` at load. It may report a byte-diff vs. the golden (Romeo has no baseline yet) — that is expected and handled in Step 3. A *load* throw here is a failure of Task 1; a *diff* is not.

- [ ] **Step 3: Bless Romeo's baseline**

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

Expected: the run generates the ConsoleTools golden (spawns `/upgrade` once, ~63 MB) and records Romeo's baseline under `test/corpus/.upgrade-baseline/`.

- [ ] **Step 4: Re-run to confirm Romeo passes against its blessed baseline**

Run: `npm test`
Expected: green.

- [ ] **Step 5: Inspect the blessed baseline and record findings**

Open the newly written baseline for Romeo under `test/corpus/.upgrade-baseline/`. If it is empty, the port matches TexTools byte-for-byte — note that. If it is non-empty, each diff is a **pre-existing latent porting gap** surfaced by newly being able to load Romeo, not a product of this fix (the normalization changes only *which bytes are loaded* — the same bytes TexTools loaded — not any transform). Confirm every diff maps to an existing `DIVERGENCE_RULES` entry or backlog item (e.g. T3/T4 texture/index gaps); if any diff cannot be explained that way, stop and investigate before proceeding — it would indicate a real bug rather than a latent gap. Write a one-line note of the outcome into this plan's task (or the commit message of Task 4) so the reviewer sees it.

---

### Task 4: Reclassify the backlog + fix the local classifier

**Files:**
- Modify: `BACKLOG.md` (rewrite the "PMP load-tolerance for genuinely-absent `Files` entries" item, lines ~56-73)
- Modify (local-only, gitignored, optional): `local-notes/classify-fails.ts`

**Interfaces:** none (documentation + a local script).

- [ ] **Step 1: Rewrite the backlog item**

In `BACKLOG.md`, replace the entire existing bullet that begins `- **PMP load-tolerance for genuinely-absent `Files` entries.**` (through its final `revisit if faithful load-tolerance is wanted…` line) with:

```markdown
- **PMP load-tolerance for genuinely-absent `Files` entries.** After the case-insensitive
  (`docs/superpowers/specs/2026-07-11-pmp-case-insensitive-file-resolution-design.md`) and Windows
  path-normalization (`docs/superpowers/specs/2026-07-11-pmp-windows-path-normalization-design.md`)
  resolution fixes, **5 packs still fail loud** with `pmp: missing file entry` because their `Files`
  value names a path absent from the archive under *any* Windows normalization (case-fold + trailing
  dot/space strip) — genuinely not packed, not a resolution bug. TexTools tolerates these at **load**:
  `LoadPMP` (`PMP.cs:124`) does no existence check, and only builds
  `FileStorageInformation.RealPath = Path.Combine(unzipPath, file.Value)` (`PMP.cs:1080`) — a path
  that simply doesn't exist on disk — deferring any failure to read/import time. All 5 `/upgrade` to a
  **noop** (the absent files are never read/needed), verified against ConsoleTools. Reproducing that
  means deferring our **eager** byte-read to first use and representing an absent entry without
  inventing bytes (then letting `/upgrade` surface it only if the file is actually needed), and
  reproducing the noop through the write/harness path. We keep failing loud for now. Re-derive the
  list with `local-notes/scan-failed-loads.ts` + `local-notes/classify-fails.ts` (the classifier now
  applies the same case-fold + trailing-dot/space normalization, so it no longer mislabels
  normalization cases — the earlier list wrongly included `[Jaque] Romeo & Juliet`, since fixed); as of
  2026-07-11 the 5 are: Skelomae Custom Skeleton v3.3.0 (`.pmp`, ×2 — Skeleton + Devkit; missing
  `files/files/common/arachne/*.sklb`), `Hoodie Megapack 3 - 2.0.2.pmp` (missing
  `chara/equipment/e6033/model/c0201e6033_top.mdl` + a `designs/default` `.tex`),
  `[Nyameru]Cute Loop.pmp` (missing `chara/cuteloop2.pap`), and `[Shy] Tactical Hoodie [DT].pmp`
  (missing `chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl`). Distinct from the
  resolution fixes; revisit if faithful load-tolerance is wanted (or a real pack needs one of these to
  upgrade).
```

- [ ] **Step 2: Fix the local classifier so it stops mislabeling (local-only)**

`local-notes/classify-fails.ts` is gitignored (not committed) but should be corrected so a future re-run classifies Romeo-style normalization cases correctly. Change its normalization from bare `toLowerCase()` to the same rule as `windowsPathKey`. Replace the `entryLower` set construction and the per-ref comparison so both sides run through:

```ts
// Windows-filesystem key: lowercase + TrimEnd('.', ' ') per path segment (matches
// src/container/pmp.ts windowsPathKey). Prevents mislabeling trailing-dot/space normalization
// cases (e.g. Romeo & Juliet) as genuinely-absent.
const winKey = (p: string) =>
  p
    .replace(/\\/g, "/")
    .toLowerCase()
    .split("/")
    .map((s) => s.replace(/[. ]+$/, ""))
    .join("/");
```

Then build the entry set with `entryNames.map(winKey)` and compare each ref with `if (!entryKeys.has(winKey(zr)))` (replacing the two `.toLowerCase()` uses at the current `entryLower` build and the `absent.push` check).

- [ ] **Step 3: (Optional) sanity-run the corrected classifier**

If `local-notes/failed-to-load-modpacks.md` is still present, run: `npx tsx local-notes/classify-fails.ts`
Expected: `have genuinely-absent refs: 5` (Romeo no longer counted). Skip if the note file is absent (it is regenerated by `scan-failed-loads.ts`).

- [ ] **Step 4: End-of-task ritual + commit the backlog change**

Run: `npm run check` then `npm run typecheck` then `npm test`
Expected: all green.

```powershell
git add BACKLOG.md
git commit -m "docs(backlog): narrow PMP absent-Files item to 5 packs; Romeo reclassified as fixed"
```

(`local-notes/classify-fails.ts` is gitignored and intentionally not part of this commit.)

---

## Final verification

- [ ] Run the full end-of-task ritual once more from a clean state: `npm run check`, `npm run typecheck`, `npm test` — all green.
- [ ] `git log --oneline -5` shows the three committed tasks (fix, synthetic builder, backlog) plus the earlier spec commit.
- [ ] Confirm no gitignored artifact was accidentally staged: `git status` shows a clean tree (no `test/corpus/**`, `local-notes/**`).
