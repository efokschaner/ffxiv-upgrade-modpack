# Modpack-Serialization / Manifest Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/upgrade` golden harness exercise our real writers and verify archive
structure + manifest content (not just game-file payloads), then fix audit finding F1 TDD-first.

**Architecture:** The upgrade check serializes `ours` through `writeModpack`, un-archives both
sides with `readZip`, and adds two comparison dimensions — STRUCTURE (manifest member-name set)
and MANIFEST (semantic deep-equal of parsed JSON, with a cited `.mpl` offset normalization) —
alongside the unchanged payload byte-diff. New diffs ratchet through the existing baseline via a
new `FileDiff.kind`. The corpus is split into `real/` + `synthetic/` sisters. F1 is reproduced by
a synthetic PMP that fails first, then fixed by porting `MakePMPPathSafe`.

**Tech Stack:** TypeScript, Vitest, fflate (zip), Node fs. Ports from vendored C#
(xivModdingFramework / TexTools) under `reference/`.

**Spec:** `docs/superpowers/specs/2026-07-08-modpack-serialization-parity-design.md`

## Global Constraints

- **Byte-parity is correctness.** Output must match ConsoleTools `/upgrade` except for documented
  divergences. Reproduce quirks faithfully; never "fix" C# behaviour except where the spec says so.
- **Provenance required.** Every non-scaffolding function cites its C# origin as
  `file · symbol · lines`, resolving in `reference/`.
- **Fail loud.** Unported paths `throw`; no silent best-effort.
- **Formatting is mechanical.** Run `npm run check` (Biome); never hand-format.
- **No per-file license headers.** Licensing lives in `LICENSE`/`NOTICE` only.
- **End-of-task gate (required, all green):** `npm run check`, `npm run typecheck`, `npm test`.
- **Windows environment.** Use PowerShell syntax for commands. Goldens are Windows-generated.

---

### Task 1: Split corpus into `real/` + `synthetic/` sister directories

Pure refactor: rename `test/corpus/inputs/` → `test/corpus/real/`, add `test/corpus/synthetic/`,
and enumerate packs from **both** roots through one shared helper. No behaviour change beyond the
extra root.

**Files:**
- Create: `test/helpers/corpus-roots.ts`
- Modify: `test/helpers/oracle.ts:19,103-107`
- Modify: `test/helpers/corpus-units.ts:24,26-32`
- Modify: `test/helpers/corpus-models.ts:7` (and its message strings)
- Modify: `.gitignore`
- Modify: `AGENTS.md` (corpus path references)

**Interfaces:**
- Produces: `corpusPacks(): string[]` — absolute paths of every `.ttmp2|.ttmp|.pmp` under
  `test/corpus/real/` and `test/corpus/synthetic/`, sorted deterministically (real then synthetic
  by full path).

- [ ] **Step 1: Rename the corpus directory on disk (preserve local contents)**

Run:
```powershell
if (Test-Path test/corpus/inputs) { Rename-Item test/corpus/inputs real }
New-Item -ItemType Directory -Force test/corpus/synthetic | Out-Null
```
Expected: `test/corpus/real/` now holds the former inputs; `test/corpus/synthetic/` exists (empty).

- [ ] **Step 2: Create the shared enumeration helper**

Create `test/helpers/corpus-roots.ts`:
```typescript
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Single source of truth for corpus discovery. Depends ONLY on node:fs/node:path (no vitest), so
// both the Node-API runner (corpus-units.ts) and the vitest helpers (oracle.ts) can import it.
// Real mods (test/corpus/real) and authored synthetic packs (test/corpus/synthetic) flow through
// the IDENTICAL pipeline; both roots are gitignored (see .gitignore). See the parity design spec.
const CORPUS_ROOTS = [
  join(__dirname, "..", "corpus", "real"),
  join(__dirname, "..", "corpus", "synthetic"),
];

const PACK_RE = /\.(ttmp2?|pmp)$/i;

/** Every corpus pack (real then synthetic), sorted within each root for a deterministic order. */
export function corpusPacks(): string[] {
  const out: string[] = [];
  for (const root of CORPUS_ROOTS) {
    if (!existsSync(root)) continue;
    for (const f of readdirSync(root).filter((n) => PACK_RE.test(n)).sort()) {
      out.push(join(root, f));
    }
  }
  return out;
}
```

- [ ] **Step 3: Point `oracle.ts` and `corpus-units.ts` at the shared helper**

In `test/helpers/oracle.ts`: delete the `CORPUS_INPUTS` constant (line 19) and replace the body of
`corpusInputs()` (lines 103-107) with:
```typescript
import { corpusPacks } from "./corpus-roots";
// ...
export function corpusInputs(): string[] {
  return corpusPacks();
}
```
Update the `assertCorpusPresent` message (lines ~112-123) to say `test/corpus/real` instead of
`test/corpus/inputs`.

In `test/helpers/corpus-units.ts`: delete `CORPUS_INPUTS` (line 24) and replace `sortedPacks()`
(lines 26-32) with a call to `corpusPacks()`:
```typescript
import { corpusPacks } from "./corpus-roots";
// ...
export function enumerateUnits(): Unit[] {
  const units: Unit[] = [];
  for (const pack of corpusPacks()) {
    // ...unchanged unit-push block...
  }
  return units;
}
```
Remove the now-unused `existsSync`/`readdirSync`/`join` imports if nothing else uses them.

- [ ] **Step 4: Update `corpus-models.ts` path + messages**

In `test/helpers/corpus-models.ts`, change `const INPUTS = "test/corpus/inputs";` (line 7) to
`const INPUTS = "test/corpus/real";` and update the two message strings (lines ~16, ~42) from
`test/corpus/inputs` to `test/corpus/real`.

- [ ] **Step 5: Update `.gitignore` and `AGENTS.md`**

In `.gitignore`, replace the `test/corpus/inputs/` ignore rule with both roots:
```
test/corpus/real/
test/corpus/synthetic/
```
(Leave `.upgrade-cache`, `.upgrade-baseline`, `.oracle-cache`, `golden-upgrade` rules as-is.)

In `AGENTS.md`, update the three `test/corpus/inputs/` references (in *Upgrade golden harness* and
*Glossary*) to `test/corpus/real/`, and add one sentence: "Authored synthetic packs live in the
sister `test/corpus/synthetic/` (also gitignored) and run the identical pipeline."

- [ ] **Step 6: Run the full gate to confirm no regression**

Run:
```powershell
npm run check; npm run typecheck; npm test
```
Expected: all green; corpus tests discover the same packs from `test/corpus/real/` (the log line
`[upgrade] <pack>: ...` still appears per pack).

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "test(corpus): split corpus into real/ + synthetic/ sisters"
```

---

### Task 2: Add `FileDiff.kind` and ratchet it

Introduce the diff-kind discriminator so manifest/structure diffs ride the existing baseline
machinery. Backward-compatible: existing payload baselines (no `kind`) still match.

**Files:**
- Modify: `test/helpers/upgrade-diff.ts:10-16` (FileDiff), and every `files.push({...})` to add `kind`
- Modify: `test/helpers/upgrade-baseline.ts:29-31` (`idOf`)
- Test: `test/helpers/upgrade-baseline.test.ts` (create)

**Interfaces:**
- Produces: `FileDiff.kind: DiffKind` where `type DiffKind = "payload" | "manifest" | "structure"`.
- Produces: `idOf(f)` = `` `${f.kind ?? "payload"}|${f.gamePath}#${f.index}:${f.status}` ``.

- [ ] **Step 1: Write the failing test for `idOf` backward-compat + kind separation**

Create `test/helpers/upgrade-baseline.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import type { FileDiff } from "./upgrade-diff";
import { compareToBaseline } from "./upgrade-baseline";

describe("ratchet idOf / compareToBaseline", () => {
  it("treats a kind-less baseline entry as a payload entry (backward compat)", () => {
    const legacy = [{ gamePath: "a.tex", index: 0, status: "mismatch" }] as unknown as FileDiff[];
    const actual: FileDiff[] = [
      { kind: "payload", gamePath: "a.tex", index: 0, status: "mismatch" },
    ];
    expect(compareToBaseline(actual, legacy).ok).toBe(true);
  });

  it("does NOT let a payload baseline entry excuse a manifest regression at the same path", () => {
    const baseline: FileDiff[] = [
      { kind: "payload", gamePath: "meta.json", index: 0, status: "mismatch" },
    ];
    const actual: FileDiff[] = [
      { kind: "manifest", gamePath: "meta.json", index: 0, status: "mismatch" },
    ];
    expect(compareToBaseline(actual, baseline).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/helpers/upgrade-baseline.test.ts`
Expected: FAIL — `kind` is not a property of `FileDiff` yet (type error) / second assertion fails.

- [ ] **Step 3: Add `kind` to `FileDiff` and tag payload diffs**

In `test/helpers/upgrade-diff.ts`, add the type and field:
```typescript
export type DiffStatus = "added" | "removed" | "mismatch";
export type DiffKind = "payload" | "manifest" | "structure";
export interface FileDiff {
  kind: DiffKind;
  gamePath: string; // for manifest/structure diffs this holds the archive member name
  index: number;
  status: DiffStatus;
  detail?: string;
}
```
Add `kind: "payload",` to each of the three `files.push({ ... })` calls in `diffUpgrade`
(the `mismatch`, `added`, and `removed` branches).

- [ ] **Step 4: Update `idOf` to include kind with a payload default**

In `test/helpers/upgrade-baseline.ts`, replace `idOf`:
```typescript
// Ratchet identity. `kind` defaults to "payload" so pre-kind baselines (payload-only) still match.
function idOf(f: FileDiff): string {
  return `${f.kind ?? "payload"}|${f.gamePath}#${f.index}:${f.status}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/helpers/upgrade-baseline.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```powershell
git add test/helpers/upgrade-diff.ts test/helpers/upgrade-baseline.ts test/helpers/upgrade-baseline.test.ts
git commit -m "test(ratchet): add FileDiff.kind discriminator for manifest/structure diffs"
```

---

### Task 3: Archive comparison module (STRUCTURE + MANIFEST)

Pure diff logic, unit-tested with hand-built archives — **no corpus or ConsoleTools needed**.

**Files:**
- Create: `test/helpers/upgrade-archive-diff.ts`
- Test: `test/helpers/upgrade-archive-diff.test.ts`

**Interfaces:**
- Consumes: `readZip` from `src/zip/zip`; `FileDiff` / `DiffKind` from `./upgrade-diff`.
- Produces: `diffArchives(ours: Uint8Array, golden: Uint8Array): FileDiff[]` — manifest/structure
  diffs only (payload diffs remain `diffUpgrade`'s job).

- [ ] **Step 1: Write failing tests**

Create `test/helpers/upgrade-archive-diff.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { writeZip } from "../../src/zip/zip";
import { diffArchives } from "./upgrade-archive-diff";

const enc = new TextEncoder();
function pmp(members: Record<string, unknown | Uint8Array>): Uint8Array {
  const m = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(members)) {
    m.set(k, v instanceof Uint8Array ? v : enc.encode(JSON.stringify(v)));
  }
  return writeZip(m, { store: true });
}

const META = { FileVersion: 3, Name: "X" };
const DEF = { Files: {}, FileSwaps: {}, Manipulations: [] };

describe("diffArchives", () => {
  it("returns no diffs when manifests are semantically equal despite formatting", () => {
    const a = pmp({ "meta.json": META, "default_mod.json": DEF });
    // same data, different key order + whitespace
    const b = new Map<string, Uint8Array>([
      ["meta.json", enc.encode('{\n  "Name":"X",\n  "FileVersion":3\n}')],
      ["default_mod.json", enc.encode(JSON.stringify(DEF))],
    ]);
    expect(diffArchives(a, writeZip(b, { store: true }))).toEqual([]);
  });

  it("flags a structure diff when a group_*.json name differs (F1 class)", () => {
    const g = { Name: "G", Type: "Single", Options: [] };
    const ours = pmp({ "meta.json": META, "default_mod.json": DEF, "group_001_G.json": g });
    const golden = pmp({ "meta.json": META, "default_mod.json": DEF, "group_001_g.json": g });
    const diffs = diffArchives(ours, golden);
    expect(diffs).toContainEqual(
      { kind: "structure", gamePath: "group_001_G.json", index: 0, status: "removed", detail: undefined },
    );
    expect(diffs).toContainEqual(
      { kind: "structure", gamePath: "group_001_g.json", index: 0, status: "added", detail: undefined },
    );
  });

  it("flags a manifest content mismatch (wrong option assignment / metadata)", () => {
    const ours = pmp({ "meta.json": { ...META, Name: "WRONG" }, "default_mod.json": DEF });
    const golden = pmp({ "meta.json": META, "default_mod.json": DEF });
    expect(diffArchives(ours, golden)).toContainEqual(
      { kind: "manifest", gamePath: "meta.json", index: 0, status: "mismatch", detail: undefined },
    );
  });

  it("normalizes ModOffset/ModSize out of the TTMPL.mpl before comparing", () => {
    const mplOurs = { TTMPVersion: "2.1s", SimpleModsList: [
      { FullPath: "a.tex", ModOffset: 0, ModSize: 100 }] };
    const mplGolden = { TTMPVersion: "2.1s", SimpleModsList: [
      { FullPath: "a.tex", ModOffset: 4096, ModSize: 128 }] };
    const ours = pmp({ "TTMPL.mpl": mplOurs, "TTMPD.mpd": new Uint8Array([1, 2, 3]) });
    const golden = pmp({ "TTMPL.mpl": mplGolden, "TTMPD.mpd": new Uint8Array([9]) });
    expect(diffArchives(ours, golden)).toEqual([]); // offsets/sizes AND the .mpd blob are ignored here
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/helpers/upgrade-archive-diff.test.ts`
Expected: FAIL — `diffArchives` does not exist.

- [ ] **Step 3: Implement the module**

Create `test/helpers/upgrade-archive-diff.ts`:
```typescript
import { readZip } from "../../src/zip/zip";
import type { FileDiff } from "./upgrade-diff";

const dec = new TextDecoder();

// A manifest member is a JSON document we compare semantically; everything else (game-file
// payloads, the TTMP .mpd blob) is compared by the payload byte-diff (diffUpgrade), not here.
function isManifest(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === "meta.json" ||
    n === "default_mod.json" ||
    /^group_\d+.*\.json$/.test(n) ||
    n.endsWith(".mpl")
  );
}

function manifestNames(members: Map<string, Uint8Array>): string[] {
  return [...members.keys()].filter(isManifest);
}

/** Strip blob-layout artifacts before deep-equal. ModOffset/ModSize in a TTMPL.mpl are byproducts
 * of .mpd packing (our buildBlob dedup vs .NET's layout, src/container/ttmp2.ts:121); the bytes
 * they address are validated by the payload diff. See parity design spec §3. */
function normalize(name: string, json: unknown): unknown {
  if (!name.toLowerCase().endsWith(".mpl")) return json;
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === "ModOffset" || k === "ModSize") continue;
        out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  return strip(json);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
    return ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

function parse(name: string, bytes: Uint8Array): unknown {
  return normalize(name, JSON.parse(dec.decode(bytes)));
}

/** STRUCTURE (manifest member-name set) + MANIFEST (semantic deep-equal) diffs between two
 * un-archived modpacks. Payload content is diffed separately by diffUpgrade. Orientation matches
 * diffUpgrade: golden-only member => "added"; ours-only => "removed"; shared+unequal => "mismatch".
 * See docs/superpowers/specs/2026-07-08-modpack-serialization-parity-design.md §3. */
export function diffArchives(ours: Uint8Array, golden: Uint8Array): FileDiff[] {
  const om = readZip(ours);
  const gm = readZip(golden);
  const oNames = new Set(manifestNames(om));
  const gNames = new Set(manifestNames(gm));
  const diffs: FileDiff[] = [];

  for (const name of [...new Set([...oNames, ...gNames])].sort()) {
    const inO = oNames.has(name);
    const inG = gNames.has(name);
    if (inO && !inG) {
      diffs.push({ kind: "structure", gamePath: name, index: 0, status: "removed", detail: undefined });
    } else if (!inO && inG) {
      diffs.push({ kind: "structure", gamePath: name, index: 0, status: "added", detail: undefined });
    } else if (!deepEqual(parse(name, om.get(name)!), parse(name, gm.get(name)!))) {
      diffs.push({ kind: "manifest", gamePath: name, index: 0, status: "mismatch", detail: undefined });
    }
  }
  return diffs;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/helpers/upgrade-archive-diff.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```powershell
git add test/helpers/upgrade-archive-diff.ts test/helpers/upgrade-archive-diff.test.ts
git commit -m "test(harness): diffArchives — STRUCTURE + MANIFEST comparison"
```

---

### Task 4: Wire `diffArchives` into the upgrade check

Serialize `ours` through the real writer, surface the raw golden archive bytes, and fold archive
diffs into the ratcheted diff list.

**Files:**
- Modify: `test/helpers/upgrade-golden.ts:29-31,93-98,110-111` (surface raw bytes)
- Modify: `test/helpers/corpus-upgrade.ts:26-40` (serialize + combine)

**Interfaces:**
- Consumes: `diffArchives` (Task 3); `writeModpack` from `src/index`; `GoldenResult` (extended).
- Produces: `GoldenResult` pack variant now carries `bytes: Uint8Array` (the raw golden archive).

- [ ] **Step 1: Surface the raw golden bytes from `upgradeGoldenCached`**

In `test/helpers/upgrade-golden.ts`, extend the result type (line 29-31):
```typescript
export type GoldenResult =
  | { kind: "pack"; data: ModpackData; bytes: Uint8Array }
  | { kind: "noop" };
```
At the cache-hit return (lines ~93-98):
```typescript
  if (hit !== null) {
    return { kind: "pack", data: loadModpack(`golden.${goldenExt(name)}`, hit), bytes: hit };
  }
```
At the produce return (lines ~110-111):
```typescript
  oracleCachePut(key, out, dir);
  return { kind: "pack", data: loadModpack(`golden.${goldenExt(name)}`, out), bytes: out };
```

- [ ] **Step 2: Serialize `ours` and combine archive diffs in the upgrade check**

In `test/helpers/corpus-upgrade.ts`, update imports and the check body. Add imports:
```typescript
import { loadModpack, upgradeModpack, writeModpack } from "../../src/index";
import { diffArchives } from "./upgrade-archive-diff";
```
Replace the block from `const ours = ...` through the `diffUpgrade(...)` assignment (lines ~26-40):
```typescript
      const oursModel = upgradeModpack(loadModpack(name, bytes));
      const golden = upgradeGoldenCached(name, bytes);
      if (golden === null) {
        throw new Error(
          `No /upgrade golden for ${name}: uncached and no oracle (TexTools) available. ` +
            `Run with ConsoleTools installed to populate test/corpus/.upgrade-cache.`,
        );
      }
      // A no-op upgrade writes no golden; the correct reference is the original input, so this
      // still exercises our whole load->upgrade->reduce->serialize pipeline end to end.
      const reference =
        golden.kind === "noop" ? loadModpack(name, bytes) : golden.data;
      const goldenBytes = golden.kind === "noop" ? bytes : golden.bytes;

      // Exercise the real writer on the oracle path (audit blind spot #5), then compare archive
      // STRUCTURE + MANIFEST alongside the unchanged payload diff. See the parity design spec.
      const target = name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
      const oursArchive = writeModpack(oursModel, target);

      const payload = diffUpgrade(name, oursModel, reference, confirmDivergence);
      const archive = diffArchives(oursArchive, goldenBytes);
      const diff = { ...payload, files: [...payload.files, ...archive] };
```
The remaining lines (`const key = ...`, BLESS, baseline compare, logging) are unchanged — they
already operate on `diff.files`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors from the `GoldenResult.bytes` addition or `target` union).

- [ ] **Step 4: Run the upgrade suite against the real corpus (expect NEW diffs, not crashes)**

Run: `npx vitest run test/harness.test.ts` (or the full `npm test`).
Expected: The upgrade checks now surface manifest/structure diffs (some real packs may fail the
ratchet because the baseline predates this dimension). That is EXPECTED — Task 7 blesses the new
baseline. Confirm the failures are `manifest:`/`structure:` regressions, not exceptions.

- [ ] **Step 5: Commit**

```powershell
git add test/helpers/upgrade-golden.ts test/helpers/corpus-upgrade.ts
git commit -m "test(harness): serialize ours through writers; compare archive structure + manifest"
```

---

### Task 5: Synthetic F1 PMP that fails first (RED)

Author a minimal wizard PMP whose group name forces the `safeName` divergence. This proves the new
STRUCTURE check bites BEFORE the fix.

**Files:**
- Create: `test/corpus/synthetic/f1-safename.pmp` (gitignored, built by the script below)
- Create: `scripts/build-synthetic-f1.mjs` (one-off fixture builder, committed)

**Interfaces:**
- Consumes: `writeZip` from `src/zip/zip` (via a tiny inline zip, to avoid TS build coupling).

- [ ] **Step 1: Write the fixture-builder script**

Create `scripts/build-synthetic-f1.mjs`:
```javascript
// Builds test/corpus/synthetic/f1-safename.pmp: a wizard PMP whose group Name has spaces + capitals,
// so TexTools' MakePMPPathSafe emits "group_001_weareable ears options.json" while the pre-fix TS
// safeName emits "group_001_Weareable_Ears_Options.json". Reproduces audit finding F1 (see the
// parity design spec §6). The .pmp is gitignored; regenerate locally with `node scripts/build-synthetic-f1.mjs`.
import { zipSync } from "fflate";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "test", "corpus", "synthetic");
const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 2));

// One already-Dawntrail-safe dummy file at a gamePath /upgrade ignores, so ConsoleTools no-ops.
const dummyGamePath = "chara/dummy/f1_dummy.bin";
const dummyZipPath = "files/f1_dummy.bin";
const dummy = new Uint8Array([0, 1, 2, 3]);

const meta = { FileVersion: 3, Name: "F1 SafeName Repro", Author: "synthetic",
  Description: "", Version: "1.0.0", Website: "", ModTags: [] };
const defaultMod = { Name: "", Description: "", Files: {}, FileSwaps: {}, Manipulations: [] };
const group = {
  Version: 0, Name: "Weareable Ears Options", Description: "", Image: "",
  Page: 0, Priority: 0, Type: "Single", DefaultSettings: 0,
  Options: [{ Name: "On", Description: "", Image: "",
    Files: { [dummyGamePath]: dummyZipPath.replace(/\//g, "\\") },
    FileSwaps: {}, Manipulations: [] }],
};

const members = {
  "meta.json": enc(meta),
  "default_mod.json": enc(defaultMod),
  // NOTE: authored with the CORRECT penumbra name (lowercase, spaces kept) so the pre-fix writer diverges.
  "group_001_weareable ears options.json": enc(group),
  [dummyZipPath]: dummy,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "f1-safename.pmp"), zipSync(members));
console.log("wrote", join(outDir, "f1-safename.pmp"));
```

- [ ] **Step 2: Build the fixture**

Run:
```powershell
node scripts/build-synthetic-f1.mjs
```
Expected: `wrote .../test/corpus/synthetic/f1-safename.pmp`.

- [ ] **Step 3: Run the upgrade check for this pack; confirm RED on STRUCTURE**

Run (populates the golden via ConsoleTools on first run, then compares):
```powershell
npm test
```
Expected: the `upgrade golden: f1-safename.pmp` check FAILS with a `structure` regression naming
`group_001_Weareable_Ears_Options.json` (removed) and `group_001_weareable ears options.json`
(added). If instead ConsoleTools errors and the golden is null, replace `dummy` with a real
already-Dawntrail file copied from `test/corpus/real/` (any `.tex`/`.mtrl` at a modern path) so
`/upgrade` no-ops, then rebuild and re-run.

- [ ] **Step 4: Commit the builder (the .pmp is gitignored)**

```powershell
git add scripts/build-synthetic-f1.mjs
git commit -m "test(synthetic): F1 safeName repro PMP builder (fails first)"
```

---

### Task 6: Port `MakePMPPathSafe` — fix F1 (GREEN)

Replace the whitelist `safeName` with a faithful port of the C#, turning the synthetic pack green.

**Files:**
- Modify: `src/container/pmp.ts:110-112` (`safeName`)
- Test: `test/container/pmp-safename.test.ts` (create)

**Interfaces:**
- Produces: `safeName(name: string): string` — Penumbra-safe group filename component.

- [ ] **Step 1: Write failing unit tests (fixtures hand-derived from the C#)**

Create `test/container/pmp-safename.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { safeName } from "../../src/container/pmp";

// Fixtures derived by reading PMP.MakePMPPathSafe (PMP.cs:1316) -> IOUtil.MakePathSafe
// (IOUtil.cs:738): NFKC-normalize, replace only Path.GetInvalidFileNameChars() (Windows set) with
// '_', lowercase the rest, Trim(). "." -> "_", ".." -> "__". Cannot run TexTools per-unit, so these
// are reasoned from the C# (AGENTS.md synthetic-test rule).
describe("safeName (port of PMP.MakePMPPathSafe)", () => {
  it("keeps spaces and lowercases (the F1 case)", () => {
    expect(safeName("Weareable Ears Options")).toBe("weareable ears options");
  });
  it("replaces only OS-invalid chars with underscore", () => {
    expect(safeName("a/b:c*d")).toBe("a_b_c_d");
  });
  it("special-cases . and ..", () => {
    expect(safeName(".")).toBe("_");
    expect(safeName("..")).toBe("__");
  });
  it("trims outer whitespace but keeps inner", () => {
    expect(safeName("  Trim Me  ")).toBe("trim me");
  });
  it("NFKC-normalizes before sanitizing", () => {
    expect(safeName("Ａ")).toBe("a"); // fullwidth A -> "A" -> lowercase "a"
  });
  it("does not fall back to _ for empty input (C# has no fallback)", () => {
    expect(safeName("")).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/container/pmp-safename.test.ts`
Expected: FAIL — current `safeName` uppercases/underscores spaces and returns `_` for empty.

- [ ] **Step 3: Port the C#**

In `src/container/pmp.ts`, replace `safeName` (lines 110-112):
```typescript
// Port of PMP.MakePMPPathSafe (PMP.cs:1316-1326) -> IOUtil.MakePathSafe (IOUtil.cs:738-759).
// QUIRK: Path.GetInvalidFileNameChars() is platform-dependent; goldens are generated on Windows,
// so we reproduce the WINDOWS set — control chars 0x00-0x1F plus these nine. (Unix would be just
// \0 and /.) Replace invalid chars with '_' (_PMPSafeNameReplacement, PMP.cs:47), lowercase the
// rest (makeLowercase=true), then Trim(). "." -> "_", ".." -> "__" (PMP.cs:1319-1323).
const WINDOWS_INVALID_FILENAME_CHARS = new Set<number>([
  0x22, 0x3c, 0x3e, 0x7c, 0x3a, 0x2a, 0x3f, 0x5c, 0x2f, // " < > | : * ? \ /
]);
function isInvalidFileNameChar(code: number): boolean {
  return code <= 0x1f || WINDOWS_INVALID_FILENAME_CHARS.has(code);
}
function makePathSafe(name: string): string {
  // IOUtil.MakePathSafe iterates UTF-16 chars; match that (not code points) for fidelity.
  let out = "";
  for (let i = 0; i < name.length; i++) {
    out += isInvalidFileNameChar(name.charCodeAt(i)) ? "_" : name[i]!.toLowerCase();
  }
  return out.trim();
}
function safeName(s: string): string {
  if (s === ".") return "_";
  if (s === "..") return "__";
  return makePathSafe(s.normalize("NFKC"));
}
```
Export `safeName` so the unit test can import it: add `export` to its declaration (or re-export
from the module). If keeping it module-private is preferred, instead export it via a test-only
barrel; simplest is `export function safeName(...)`.

- [ ] **Step 4: Run unit tests to verify pass**

Run: `npx vitest run test/container/pmp-safename.test.ts`
Expected: PASS (all six cases).

- [ ] **Step 5: Run the synthetic F1 pack; confirm GREEN**

Run: `npm test`
Expected: `upgrade golden: f1-safename.pmp` now PASSES (no `structure` regression) — the writer
emits `group_001_weareable ears options.json`, matching the golden.

- [ ] **Step 6: Commit**

```powershell
git add src/container/pmp.ts test/container/pmp-safename.test.ts
git commit -m "fix(pmp): port MakePMPPathSafe so PMP group filenames match TexTools (F1)"
```

---

### Task 7: Bless the real-corpus manifest/structure baseline + final gate

Record today's newly-exposed manifest/structure diffs so the blind spot is visible and
regression-proof; F1 and other fixes burn them down later.

**Files:**
- Modify: `test/corpus/.upgrade-baseline/*.json` (gitignored — regenerated, not reviewed)

- [ ] **Step 1: Inspect what the new dimension surfaces (do not bless blind)**

Run: `npm test 2>&1 | Select-String "upgrade|regression"`
Expected: a list of `manifest:`/`structure:` regressions across real packs. Skim them — each should
be a plausible manifest/structure divergence (e.g. `raw` passthrough vs TexTools re-serialization),
NOT an exception or an obviously wrong comparison. If any look like harness bugs, fix before blessing.

- [ ] **Step 2: Bless the baseline**

Run:
```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```
Expected: `[upgrade] blessed <pack>: ... recorded` per pack; the f1-safename pack records **0**
manifest/structure diffs (it is fixed).

- [ ] **Step 3: Run the full gate green**

Run:
```powershell
npm run check; npm run typecheck; npm test
```
Expected: all green — the ratchet now passes because actual ⊆ freshly-blessed baseline.

- [ ] **Step 4: Commit any non-gitignored changes; delete this plan**

Baselines are gitignored, so nothing to commit there. Per AGENTS.md, delete the plan once the work
is merged:
```powershell
git rm docs/superpowers/plans/2026-07-08-modpack-serialization-parity.md
git commit -m "docs(plan): remove completed serialization-parity plan"
```
(Do this only at the very end, after the branch is ready to merge.)

---

## Self-Review

**Spec coverage:**
- §1 blind spots #1/#2 → Task 3 STRUCTURE + Task 4 wiring. ✓
- §1 #3/#4 → Task 3 MANIFEST deep-equal + Task 4. ✓
- §1 #5 (writers on oracle path) → Task 4 `writeModpack(oursModel, target)`. ✓
- §2 semantic JSON → Task 3 `deepEqual`. ✓
- §3 `.mpl` ModOffset/ModSize normalization → Task 3 `normalize` + test. ✓
- §3 PMP Files-value conditional normalization → deferred (spec §8 open item); surfaces in Task 7
  inspection, not pre-committed. ✓ (intentional)
- §4 `kind` ratchet → Task 2. ✓
- §5 real/synthetic restructuring → Task 1. ✓
- §6 F1 TDD (fail first → port MakePMPPathSafe → green) → Tasks 5, 6. ✓
- §6 Windows GetInvalidFileNameChars quirk → Task 6 Step 3 (exact set + cited quirk). ✓
- §7 bless + gate → Task 7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the one deferred item (PMP
Files-value normalization) is an explicit spec-tracked open question handled by inspection, not a
hidden gap.

**Type consistency:** `FileDiff.kind: DiffKind` (Task 2) used consistently in Task 3
(`diffArchives` returns `FileDiff[]` with `kind`). `GoldenResult.bytes` (Task 4 Step 1) consumed in
Task 4 Step 2 (`golden.bytes`). `safeName` signature stable across Tasks 5-6. `corpusPacks()`
(Task 1) consumed by both `oracle.ts` and `corpus-units.ts`. `writeModpack(data, "pmp"|"ttmp2")`
matches `src/index.ts:59`. ✓
