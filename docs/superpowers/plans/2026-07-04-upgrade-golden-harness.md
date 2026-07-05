# Upgrade E2E Golden Harness + Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the end-to-end golden-upgrade test harness — an identity-skeleton upgrade pipeline plus a corpus check that diffs our output against cached ConsoleTools `/upgrade` goldens (exact-byte by default, documented divergence confirmations only), gated by a gitignored per-pack ratchet baseline.

**Architecture:** A pure `upgradeModpack(ModpackData): ModpackData` seam (skeleton returns a structural copy now; transform rounds fill it later). Test helpers add: a content-addressed golden cache mirroring `.oracle-cache`; a `gamePath`-keyed multiset diff engine (mirrors the shipped `compareInnerFilesByteIdentical`) with confirm-aware pairing; a divergence-confirmation registry; and a ratchet baseline stored under the gitignored corpus tree. A new `upgrade` corpus `CheckKind` wires it into the parallel runner.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest, Node built-ins only (`node:fs`, `node:path`, `node:crypto`, `node:os`). No new dependencies. ConsoleTools.exe is the oracle (already wrapped in `test/helpers/oracle.ts`).

## Global Constraints

- **No new dependencies.** Node built-ins only. If one were ever needed: pinned-exact, ≥ 7-day min release age (`--before=<date 7+ days ago>`).
- **No per-file license headers.** Licensing is in root `LICENSE`/`NOTICE`. A file porting C# may cite its upstream origin in a brief comment only.
- **`reference/` is off-limits** — read-only C# port source; never edit/lint/format it.
- **Formatting is mechanical** — Biome owns it. Run `npm run check` before committing; do not hand-format. The lefthook pre-commit hook runs Biome + `tsc` on every commit.
- **Strict TS:** `noUncheckedIndexedAccess` is on — indexed access yields `T | undefined`; use `!` / guards exactly as the existing code does.
- **Cache + baseline live under the wholly-gitignored `/test/corpus/`** tree — never committed, no `.gitignore` change.
- **End-of-task ritual (required):** `npm run check`, `npm run typecheck`, `npm test` all green before a task is done.

---

## File Structure

- `src/upgrade/upgrade.ts` (new) — `upgradeModpack` + `cloneModpack` skeleton (the transform seam).
- `src/index.ts` (modify) — export `upgradeModpack`.
- `test/upgrade/upgrade.test.ts` (new) — skeleton unit tests.
- `test/helpers/upgrade-compare.ts` (new) — `DivergenceRule` registry + `confirmDivergence`.
- `test/helpers/upgrade-diff.ts` (new) — `diffUpgrade` (gamePath multiset, confirm-aware).
- `test/helpers/upgrade-golden.ts` (new) — content-addressed `/upgrade` golden cache + `upgradeGoldenCached`.
- `test/helpers/upgrade-baseline.ts` (new) — ratchet load/save/compare.
- `test/upgrade-harness.test.ts` (new) — oracle-free unit tests for compare/diff/golden/baseline.
- `test/helpers/corpus-upgrade.ts` (new) — `registerUpgradeCheck` (the corpus integration).
- `test/helpers/corpus-units.ts` (modify) — add `"upgrade"` to `CheckKind` + enumerate it per pack.
- `test/helpers/corpus-register.ts` (modify) — dispatch `"upgrade"` → `registerUpgradeCheck`.
- `test/corpus-units.test.ts` (modify) — update unit-count + per-pack order assertions.
- `AGENTS.md` (modify) — document the bless workflow + divergence-confirmation contract.

---

## Task 1: Upgrade pipeline skeleton (the transform seam)

The single entry point every future transform round plugs into. Ships as a pure structural copy: returns a new `ModpackData` with fresh `groups`/`options`/`files` arrays and file objects (sharing the opaque `data: Uint8Array` refs, which no transform mutates in place). Named round stubs are intentionally omitted — Biome flags unused symbols — so the rounds are documented insertion points instead of dead functions.

**Files:**
- Create: `src/upgrade/upgrade.ts`
- Modify: `src/index.ts`
- Test: `test/upgrade/upgrade.test.ts`

**Interfaces:**
- Consumes: `ModpackData`, `ModpackFile`, `ModpackGroup`, `ModpackOption` from `../model/modpack`.
- Produces:
  - `cloneModpack(data: ModpackData): ModpackData` — deep-ish copy (new container arrays/objects; shared file `data` bytes).
  - `upgradeModpack(data: ModpackData): ModpackData` — currently `cloneModpack`; the transform seam.

- [ ] **Step 1: Write the failing test**

Create `test/upgrade/upgrade.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../../src/model/modpack";
import { upgradeModpack } from "../../src/index";

function sampleData(): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: false,
    meta: {
      name: "M",
      author: "A",
      version: "1",
      description: "",
      url: "",
      image: "",
      tags: ["t"],
      minimumFrameworkVersion: "1.0.0.0",
    },
    groups: [
      {
        name: "G",
        description: "",
        image: "",
        page: 0,
        priority: 0,
        selectionType: "Single",
        defaultSettings: 0,
        options: [
          {
            name: "O",
            description: "",
            image: "",
            priority: 0,
            fileSwaps: {},
            manipulations: [],
            files: [
              {
                gamePath: "a/b.mtrl",
                data: new Uint8Array([1, 2, 3]),
                storage: FileStorageType.SqPackCompressed,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("upgradeModpack (skeleton)", () => {
  it("returns content-equal data", () => {
    const input = sampleData();
    const out = upgradeModpack(input);
    expect(out.meta.name).toBe("M");
    expect(out.groups[0]!.options[0]!.files[0]!.gamePath).toBe("a/b.mtrl");
    expect(
      Array.from(out.groups[0]!.options[0]!.files[0]!.data),
    ).toEqual([1, 2, 3]);
  });

  it("does not mutate the input when the output is edited (fresh containers)", () => {
    const input = sampleData();
    const out = upgradeModpack(input);
    expect(out).not.toBe(input);
    expect(out.groups).not.toBe(input.groups);
    expect(out.groups[0]!.options[0]!.files).not.toBe(
      input.groups[0]!.options[0]!.files,
    );
    out.groups[0]!.options[0]!.files.push({
      gamePath: "x.tex",
      data: new Uint8Array(),
      storage: FileStorageType.RawUncompressed,
    });
    expect(input.groups[0]!.options[0]!.files.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/upgrade.test.ts`
Expected: FAIL — `upgradeModpack` is not exported from `../../src/index`.

- [ ] **Step 3: Write minimal implementation**

Create `src/upgrade/upgrade.ts`:

```ts
import type {
  ModpackData,
  ModpackFile,
  ModpackGroup,
  ModpackOption,
} from "../model/modpack";

// The Dawntrail upgrade pipeline. Ported incrementally from C#
// ModpackUpgrader.cs (orchestration) + EndwalkerUpgrade.cs (transforms). This
// skeleton is a structural copy; the transform rounds slot in here, in order:
//   1. materials + models (UpdateEndwalkerFiles): per-option mtrl/mdl EW->DT.
//   2. remaining textures (UpgradeRemainingTextures): normal+colorset -> index.
//   3. partials (UpdateUnclaimedHairTextures / UpdateEyeMask / UpdateSkinPaths).
// Each round rewrites option.files; keeping this a pure copy keeps the seam clean.

function cloneFile(f: ModpackFile): ModpackFile {
  // Shares the opaque `data` buffer; transforms replace whole ModpackFile
  // entries rather than mutating bytes in place.
  return { ...f };
}

function cloneOption(o: ModpackOption): ModpackOption {
  return {
    ...o,
    fileSwaps: { ...o.fileSwaps },
    manipulations: [...o.manipulations],
    files: o.files.map(cloneFile),
  };
}

function cloneGroup(g: ModpackGroup): ModpackGroup {
  return { ...g, options: g.options.map(cloneOption) };
}

/** Deep-ish copy: fresh container arrays/objects, shared opaque file bytes. */
export function cloneModpack(data: ModpackData): ModpackData {
  return {
    ...data,
    meta: { ...data.meta, tags: [...data.meta.tags] },
    groups: data.groups.map(cloneGroup),
  };
}

/** Upgrade a pre-Dawntrail modpack to Dawntrail. Skeleton: structural identity. */
export function upgradeModpack(data: ModpackData): ModpackData {
  return cloneModpack(data);
}
```

Add to `src/index.ts` (with the other re-exports, e.g. after the `./tex/tex` block):

```ts
export { cloneModpack, upgradeModpack } from "./upgrade/upgrade";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade/upgrade.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```powershell
npm run check
git add src/upgrade/upgrade.ts src/index.ts test/upgrade/upgrade.test.ts
git commit -m "feat(upgrade): pipeline skeleton (structural-identity transform seam)"
```

---

## Task 2: Divergence-confirmation registry

Where our output intentionally differs from TexTools, we confirm the divergence is exactly the intended one rather than tolerating any difference. This is the registry + lookup. It starts **empty** (the skeleton generates nothing) and grows with the transform rounds.

**Files:**
- Create: `test/helpers/upgrade-compare.ts`
- Test: `test/upgrade-harness.test.ts` (create in this task)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface DivergenceRule { reason: string; predicate: (gamePath: string) => boolean; confirm: (ours: Uint8Array, golden: Uint8Array) => boolean; }`
  - `const DIVERGENCE_RULES: DivergenceRule[]` — the live registry (empty for now).
  - `confirmDivergence(gamePath: string, ours: Uint8Array, golden: Uint8Array, rules?: DivergenceRule[]): boolean` — true iff some matching rule's `confirm` holds. `rules` defaults to `DIVERGENCE_RULES` (overridable for tests).

- [ ] **Step 1: Write the failing test**

Create `test/upgrade-harness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  confirmDivergence,
  DIVERGENCE_RULES,
  type DivergenceRule,
} from "./helpers/upgrade-compare";

describe("confirmDivergence", () => {
  it("returns false with the empty live registry", () => {
    expect(DIVERGENCE_RULES).toEqual([]);
    expect(
      confirmDivergence("a/b_id.tex", new Uint8Array([1]), new Uint8Array([2])),
    ).toBe(false);
  });

  it("confirms only when a matching rule's confirm holds", () => {
    const rules: DivergenceRule[] = [
      {
        reason: "test: same length is the intended difference",
        predicate: (p) => p.endsWith("_id.tex"),
        confirm: (o, g) => o.length === g.length,
      },
    ];
    // predicate matches AND confirm holds -> accepted divergence
    expect(
      confirmDivergence("x/y_id.tex", new Uint8Array([1, 2]), new Uint8Array([3, 4]), rules),
    ).toBe(true);
    // predicate matches but confirm fails (unexpected divergence) -> not accepted
    expect(
      confirmDivergence("x/y_id.tex", new Uint8Array([1, 2]), new Uint8Array([3]), rules),
    ).toBe(false);
    // predicate does not match -> not accepted
    expect(
      confirmDivergence("x/y_n.tex", new Uint8Array([1, 2]), new Uint8Array([3, 4]), rules),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade-harness.test.ts`
Expected: FAIL — cannot import from `./helpers/upgrade-compare`.

- [ ] **Step 3: Write minimal implementation**

Create `test/helpers/upgrade-compare.ts`:

```ts
// Registry of INTENTIONAL divergences from TexTools' /upgrade output. Each rule is a
// targeted CONFIRMATION that the divergence on a matching file is exactly the one we
// meant to introduce (e.g. our BCn encoder differs, so compressed blocks differ but the
// tex header/dims and decoded pixels agree within our documented precision loss). It is
// NOT a blanket tolerance: `confirm` must be tight enough that any OTHER difference still
// fails. Files matched by no rule must be byte-identical to the golden. Starts empty; the
// transform sub-projects add rules with cited reasons as generated files land.
export interface DivergenceRule {
  reason: string;
  predicate: (gamePath: string) => boolean;
  confirm: (ours: Uint8Array, golden: Uint8Array) => boolean;
}

export const DIVERGENCE_RULES: DivergenceRule[] = [];

/** True iff some rule matches `gamePath` and confirms the ours/golden divergence is intended. */
export function confirmDivergence(
  gamePath: string,
  ours: Uint8Array,
  golden: Uint8Array,
  rules: DivergenceRule[] = DIVERGENCE_RULES,
): boolean {
  for (const r of rules) {
    if (r.predicate(gamePath) && r.confirm(ours, golden)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade-harness.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```powershell
npm run check
git add test/helpers/upgrade-compare.ts test/upgrade-harness.test.ts
git commit -m "feat(upgrade): divergence-confirmation registry (empty, confirm-not-tolerate)"
```

---

## Task 3: Diff engine (gamePath multiset, confirm-aware)

Reduce both packs to `gamePath → uncompressed-payload multiset` (decode sqpack for ttmp storage, raw for pmp), then per path pair ours↔golden: exact byte-equal first, then `confirmDivergence` on the remainder, then report the leftover as mismatch/added/removed. Keying by `gamePath` (not option structure) mirrors the shipped `compareInnerFilesByteIdentical` and is robust to `/upgrade`'s container normalization.

**Files:**
- Create: `test/helpers/upgrade-diff.ts`
- Test: `test/upgrade-harness.test.ts` (append)

**Interfaces:**
- Consumes: `allFiles`, `FileStorageType`, `ModpackData`, `ModpackFile` from `../../src/model/modpack`; `decodeSqPackFile` from `../../src/sqpack/sqpack`; `bytesEqual` from `./compare`.
- Produces:
  - `type DiffStatus = "added" | "removed" | "mismatch"`.
  - `interface FileDiff { gamePath: string; index: number; status: DiffStatus; detail?: string }`.
  - `interface PackDiff { pack: string; matched: number; files: FileDiff[] }`.
  - `diffUpgrade(pack: string, ours: ModpackData, golden: ModpackData, confirmDivergence: (gamePath: string, ours: Uint8Array, golden: Uint8Array) => boolean): PackDiff` — `files` holds only non-matched entries; `matched` counts exact + confirmed pairs.

- [ ] **Step 1: Write the failing test**

Append to `test/upgrade-harness.test.ts`:

```ts
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../src/model/modpack";
import { encodeSqPackFile, SqPackType } from "../src/sqpack/sqpack";
import { diffUpgrade } from "./helpers/upgrade-diff";

// Build a one-option pack from gamePath -> uncompressed bytes (RawUncompressed storage).
function rawPack(files: Record<string, Uint8Array>): ModpackData {
  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: {
      name: "",
      author: "",
      version: "",
      description: "",
      url: "",
      image: "",
      tags: [],
      minimumFrameworkVersion: "1.0.0.0",
    },
    groups: [
      {
        name: "G",
        description: "",
        image: "",
        page: 0,
        priority: 0,
        selectionType: "Single",
        defaultSettings: 0,
        options: [
          {
            name: "O",
            description: "",
            image: "",
            priority: 0,
            fileSwaps: {},
            manipulations: [],
            files: Object.entries(files).map(([gamePath, data]) => ({
              gamePath,
              data,
              storage: FileStorageType.RawUncompressed,
            })),
          },
        ],
      },
    ],
  };
}

const never = () => false;

describe("diffUpgrade", () => {
  it("reports all-matched for identical packs", () => {
    const a = rawPack({ "f.mtrl": new Uint8Array([1, 2, 3]) });
    const b = rawPack({ "f.mtrl": new Uint8Array([1, 2, 3]) });
    const d = diffUpgrade("p", a, b, never);
    expect(d.matched).toBe(1);
    expect(d.files).toEqual([]);
  });

  it("classifies mismatch, added, and removed", () => {
    const ours = rawPack({
      "same.mtrl": new Uint8Array([1]),
      "changed.mtrl": new Uint8Array([2]),
      "ours-only.tex": new Uint8Array([9]),
    });
    const golden = rawPack({
      "same.mtrl": new Uint8Array([1]),
      "changed.mtrl": new Uint8Array([2, 2]),
      "golden-only.tex": new Uint8Array([8]),
    });
    const d = diffUpgrade("p", ours, golden, never);
    expect(d.matched).toBe(1); // same.mtrl
    const byPath = Object.fromEntries(d.files.map((f) => [f.gamePath, f.status]));
    expect(byPath["changed.mtrl"]).toBe("mismatch");
    expect(byPath["golden-only.tex"]).toBe("added");
    expect(byPath["ours-only.tex"]).toBe("removed");
  });

  it("counts a confirmed divergence as matched, not a mismatch", () => {
    const ours = rawPack({ "g_id.tex": new Uint8Array([1, 1]) });
    const golden = rawPack({ "g_id.tex": new Uint8Array([2, 2]) });
    const confirm = (p: string, o: Uint8Array, g: Uint8Array) =>
      p.endsWith("_id.tex") && o.length === g.length;
    const d = diffUpgrade("p", ours, golden, confirm);
    expect(d.matched).toBe(1);
    expect(d.files).toEqual([]);
  });

  it("decodes SqPackCompressed storage before comparing", () => {
    const raw = new Uint8Array([7, 7, 7, 7]);
    const entry = encodeSqPackFile(raw, SqPackType.Standard);
    const ours = rawPack({}); // start empty, then inject a compressed file
    ours.groups[0]!.options[0]!.files.push({
      gamePath: "c.mtrl",
      data: entry,
      storage: FileStorageType.SqPackCompressed,
    });
    const golden = rawPack({ "c.mtrl": raw }); // same content, uncompressed
    const d = diffUpgrade("p", ours, golden, never);
    expect(d.matched).toBe(1);
    expect(d.files).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade-harness.test.ts`
Expected: FAIL — cannot import from `./helpers/upgrade-diff`.

- [ ] **Step 3: Write minimal implementation**

Create `test/helpers/upgrade-diff.ts`:

```ts
import {
  allFiles,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
} from "../../src/model/modpack";
import { decodeSqPackFile } from "../../src/sqpack/sqpack";
import { bytesEqual } from "./compare";

export type DiffStatus = "added" | "removed" | "mismatch";
export interface FileDiff {
  gamePath: string;
  index: number; // position within this path's sorted diff list — a stable id for the ratchet
  status: DiffStatus;
  detail?: string;
}
export interface PackDiff {
  pack: string;
  matched: number; // exact + confirmed-divergence pairs (not listed individually)
  files: FileDiff[]; // ONLY non-matched entries
}

function uncompressed(f: ModpackFile): Uint8Array {
  return f.storage === FileStorageType.SqPackCompressed
    ? decodeSqPackFile(f.data).data
    : f.data;
}

function byGamePath(d: ModpackData): Map<string, Uint8Array[]> {
  const m = new Map<string, Uint8Array[]>();
  for (const f of allFiles(d)) {
    const list = m.get(f.gamePath) ?? [];
    list.push(uncompressed(f));
    m.set(f.gamePath, list);
  }
  return m;
}

function lex(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/** Diff our upgraded pack against the golden, keyed by gamePath payload multiset. */
export function diffUpgrade(
  pack: string,
  ours: ModpackData,
  golden: ModpackData,
  confirmDivergence: (
    gamePath: string,
    ours: Uint8Array,
    golden: Uint8Array,
  ) => boolean,
): PackDiff {
  const om = byGamePath(ours);
  const gm = byGamePath(golden);
  const paths = [...new Set([...om.keys(), ...gm.keys()])].sort();
  const files: FileDiff[] = [];
  let matched = 0;

  for (const gp of paths) {
    const oList = om.get(gp) ?? [];
    const gRemaining = (gm.get(gp) ?? []).slice();

    // 1. exact byte-equal pairs
    const oRemaining: Uint8Array[] = [];
    for (const o of oList) {
      const i = gRemaining.findIndex((g) => bytesEqual(o, g));
      if (i >= 0) {
        gRemaining.splice(i, 1);
        matched++;
      } else {
        oRemaining.push(o);
      }
    }

    // 2. confirmed-divergence pairs on the remainder
    const oFinal: Uint8Array[] = [];
    for (const o of oRemaining) {
      const i = gRemaining.findIndex((g) => confirmDivergence(gp, o, g));
      if (i >= 0) {
        gRemaining.splice(i, 1);
        matched++;
      } else {
        oFinal.push(o);
      }
    }

    // 3. leftovers, sorted for stable indices
    oFinal.sort(lex);
    gRemaining.sort(lex);
    const n = Math.min(oFinal.length, gRemaining.length);
    let index = 0;
    for (let i = 0; i < n; i++) {
      files.push({
        gamePath: gp,
        index: index++,
        status: "mismatch",
        detail: `${oFinal[i]!.length} vs ${gRemaining[i]!.length} bytes`,
      });
    }
    for (let i = n; i < gRemaining.length; i++) {
      files.push({
        gamePath: gp,
        index: index++,
        status: "added",
        detail: `${gRemaining[i]!.length} bytes`,
      });
    }
    for (let i = n; i < oFinal.length; i++) {
      files.push({
        gamePath: gp,
        index: index++,
        status: "removed",
        detail: `${oFinal[i]!.length} bytes`,
      });
    }
  }

  return { pack, matched, files };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade-harness.test.ts`
Expected: PASS (all `confirmDivergence` + `diffUpgrade` tests).

- [ ] **Step 5: Commit**

```powershell
npm run check
git add test/helpers/upgrade-diff.ts test/upgrade-harness.test.ts
git commit -m "feat(upgrade): gamePath-multiset diff engine with confirm-aware pairing"
```

---

## Task 4: Golden cache (`/upgrade` output, content-addressed)

Mirror the `.oracle-cache` pattern: content-addressed by `sha256(inputPackBytes)`, atomic writes, gitignored. Stores golden pack bytes as `<key>.bin` (reusing `oracleCacheGet`/`oracleCachePut`) and a zero-byte `<key>.noop` marker for the no-op case (`/upgrade` writes nothing when there are no changes). Oracle spawn + availability are injectable for unit testing.

**Files:**
- Create: `test/helpers/upgrade-golden.ts`
- Test: `test/upgrade-harness.test.ts` (append)

**Interfaces:**
- Consumes: `oracleKey`, `oracleCacheGet`, `oracleCachePut`, `oracleAvailable`, `upgrade` from `./oracle`; `loadModpack`, `ModpackData` from `../../src/index`.
- Produces:
  - `type GoldenResult = { kind: "pack"; data: ModpackData } | { kind: "noop" }`.
  - `upgradeGoldenCached(name: string, bytes: Uint8Array, opts?: { dir?: string; available?: boolean; produce?: (name: string, bytes: Uint8Array) => Uint8Array | null }): GoldenResult | null` — cached golden (or no-op verdict), or `null` when uncached AND no oracle. `produce` returns golden bytes, or `null` to signal a no-op.
  - `DEFAULT_UPGRADE_CACHE: string`.

- [ ] **Step 1: Write the failing test**

Append to `test/upgrade-harness.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTtmp2 } from "../src/container/ttmp2";
import { upgradeGoldenCached } from "./helpers/upgrade-golden";

describe("upgradeGoldenCached", () => {
  it("returns null on a miss when no oracle is available", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    expect(
      upgradeGoldenCached("m.ttmp2", new Uint8Array([1, 2, 3]), {
        dir,
        available: false,
      }),
    ).toBeNull();
  });

  it("produces once on miss, then serves the parsed pack from cache", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([5, 5, 5]);
    // A real ttmp2 blob to hand back as the "golden".
    const golden = writeTtmp2(rawPackTtmp2());
    let calls = 0;
    const produce = () => {
      calls++;
      return golden;
    };

    const first = upgradeGoldenCached("m.ttmp2", input, {
      dir,
      available: true,
      produce,
    });
    expect(first?.kind).toBe("pack");
    expect(calls).toBe(1);

    const second = upgradeGoldenCached("m.ttmp2", input, {
      dir,
      available: true,
      produce,
    });
    expect(second?.kind).toBe("pack");
    expect(calls).toBe(1); // served from cache, producer not re-run
  });

  it("caches a no-op (producer returns null) and serves it as noop", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([7, 7]);
    let calls = 0;
    const produce = () => {
      calls++;
      return null;
    };
    expect(
      upgradeGoldenCached("m.ttmp2", input, { dir, available: true, produce })
        ?.kind,
    ).toBe("noop");
    expect(
      upgradeGoldenCached("m.ttmp2", input, { dir, available: true, produce })
        ?.kind,
    ).toBe("noop");
    expect(calls).toBe(1);
  });
});

// A minimal valid ttmp2 for the cache test's "golden".
function rawPackTtmp2(): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: true,
    meta: {
      name: "g",
      author: "",
      version: "",
      description: "",
      url: "",
      image: "",
      tags: [],
      minimumFrameworkVersion: "1.0.0.0",
    },
    groups: [
      {
        name: "Default",
        description: "",
        image: "",
        page: 0,
        priority: 0,
        selectionType: "Single",
        defaultSettings: 0,
        options: [
          {
            name: "Default",
            description: "",
            image: "",
            priority: 0,
            fileSwaps: {},
            manipulations: [],
            files: [
              {
                gamePath: "a/b.mtrl",
                data: new Uint8Array([1, 2, 3, 4]),
                storage: FileStorageType.SqPackCompressed,
              },
            ],
          },
        ],
      },
    ],
  };
}
```

Note: add `import type { ModpackData } from "../src/model/modpack";` to the file's imports if not already present (the earlier tasks import `ModpackData` from `../src/model/modpack` — reuse that import).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade-harness.test.ts`
Expected: FAIL — cannot import from `./helpers/upgrade-golden`.

- [ ] **Step 3: Write minimal implementation**

Create `test/helpers/upgrade-golden.ts`:

```ts
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadModpack, type ModpackData } from "../../src/index";
import {
  oracleAvailable,
  oracleCacheGet,
  oracleCachePut,
  oracleKey,
  upgrade,
} from "./oracle";

/** Content-addressed cache of ConsoleTools /upgrade outputs. Under the gitignored
 * test/corpus/ tree (see .gitignore) so it is never committed. Keyed by sha256(input pack). */
export const DEFAULT_UPGRADE_CACHE = join(
  __dirname,
  "..",
  "corpus",
  ".upgrade-cache",
);

export type GoldenResult =
  | { kind: "pack"; data: ModpackData }
  | { kind: "noop" };

/** Golden container extension implied by the source name (format preserved: pmp->pmp, else ttmp2). */
function goldenExt(name: string): "pmp" | "ttmp2" {
  return name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
}

/** Marker file recording that /upgrade produced no output (a no-op upgrade). */
function noopMarker(key: string, dir: string): string {
  return join(dir, `${key}.noop`);
}

let UPGRADE_TMP: string | null = null;
function upgradeTmpDir(): string {
  if (UPGRADE_TMP === null) UPGRADE_TMP = mkdtempSync(join(tmpdir(), "upgrade-"));
  return UPGRADE_TMP;
}

/** Run ConsoleTools /upgrade on in-memory bytes; returns golden bytes, or null on a no-op
 * (ConsoleTools writes NO output file when there are no changes — ModpackUpgrader.cs:212). */
function upgradeViaConsoleTools(name: string, bytes: Uint8Array): Uint8Array | null {
  const dir = upgradeTmpDir();
  const lower = name.toLowerCase();
  const srcExt = lower.endsWith(".pmp")
    ? "pmp"
    : lower.endsWith(".ttmp")
      ? "ttmp"
      : "ttmp2";
  const src = join(dir, `in.${srcExt}`);
  const dest = join(dir, `out.${goldenExt(name)}`);
  writeFileSync(src, bytes);
  rmSync(dest, { force: true }); // a no-op leaves NO file — surface that as null, not a stale read
  upgrade(src, dest);
  return existsSync(dest) ? new Uint8Array(readFileSync(dest)) : null;
}

/**
 * Cached /upgrade golden for `bytes`, spawning ConsoleTools at most once per distinct input.
 * Returns { kind: "pack" } (golden parsed) or { kind: "noop" } (upgrade changed nothing), or
 * null only when uncached AND no oracle is available (caller fails per policy).
 */
export function upgradeGoldenCached(
  name: string,
  bytes: Uint8Array,
  opts: {
    dir?: string;
    available?: boolean;
    produce?: (name: string, bytes: Uint8Array) => Uint8Array | null;
  } = {},
): GoldenResult | null {
  const dir = opts.dir ?? DEFAULT_UPGRADE_CACHE;
  const key = oracleKey(bytes);

  if (existsSync(noopMarker(key, dir))) return { kind: "noop" };
  const hit = oracleCacheGet(key, dir);
  if (hit !== null) {
    return { kind: "pack", data: loadModpack(`golden.${goldenExt(name)}`, hit) };
  }

  const available = opts.available ?? oracleAvailable();
  if (!available) return null;

  const produce = opts.produce ?? upgradeViaConsoleTools;
  const out = produce(name, bytes);
  if (out === null) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(noopMarker(key, dir), new Uint8Array(0));
    return { kind: "noop" };
  }
  oracleCachePut(key, out, dir);
  return { kind: "pack", data: loadModpack(`golden.${goldenExt(name)}`, out) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade-harness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
npm run check
git add test/helpers/upgrade-golden.ts test/upgrade-harness.test.ts
git commit -m "feat(upgrade): content-addressed /upgrade golden cache with no-op marker"
```

---

## Task 5: Baseline ratchet

Per-pack expected-diff snapshot, gitignored under the corpus tree, content-addressed by input hash. A missing entry means an empty baseline (a new pack is expected to fully match). `compareToBaseline` passes when the actual diff set ⊆ baseline (keyed on `gamePath#index:status`, ignoring the cosmetic `detail`), and reports regressions otherwise.

**Files:**
- Create: `test/helpers/upgrade-baseline.ts`
- Test: `test/upgrade-harness.test.ts` (append)

**Interfaces:**
- Consumes: `FileDiff` from `./upgrade-diff`.
- Produces:
  - `DEFAULT_UPGRADE_BASELINE: string`.
  - `loadBaseline(key: string, dir?: string): FileDiff[] | null` — parsed entries, or `null` if no file.
  - `saveBaseline(key: string, files: FileDiff[], dir?: string): void`.
  - `compareToBaseline(actual: FileDiff[], baseline: FileDiff[]): { ok: boolean; regressions: FileDiff[] }`.

- [ ] **Step 1: Write the failing test**

Append to `test/upgrade-harness.test.ts`:

```ts
import {
  compareToBaseline,
  loadBaseline,
  saveBaseline,
} from "./helpers/upgrade-baseline";
import type { FileDiff } from "./helpers/upgrade-diff";

describe("baseline ratchet", () => {
  const diff = (
    gamePath: string,
    index: number,
    status: FileDiff["status"],
  ): FileDiff => ({ gamePath, index, status });

  it("save then load round-trips entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "ub-"));
    expect(loadBaseline("k", dir)).toBeNull();
    const entries = [diff("a.mtrl", 0, "mismatch")];
    saveBaseline("k", entries, dir);
    expect(loadBaseline("k", dir)).toEqual(entries);
  });

  it("passes when actual is a subset of baseline", () => {
    const baseline = [diff("a", 0, "mismatch"), diff("b", 0, "added")];
    const actual = [diff("a", 0, "mismatch")];
    expect(compareToBaseline(actual, baseline).ok).toBe(true);
  });

  it("flags a regression not present in the baseline", () => {
    const baseline = [diff("a", 0, "mismatch")];
    const actual = [diff("a", 0, "mismatch"), diff("c", 0, "removed")];
    const { ok, regressions } = compareToBaseline(actual, baseline);
    expect(ok).toBe(false);
    expect(regressions).toEqual([diff("c", 0, "removed")]);
  });

  it("treats a status change on the same file as a regression", () => {
    const baseline = [diff("a", 0, "added")];
    const actual = [diff("a", 0, "mismatch")];
    expect(compareToBaseline(actual, baseline).ok).toBe(false);
  });

  it("empty baseline: any diff is a regression", () => {
    expect(compareToBaseline([diff("a", 0, "mismatch")], []).ok).toBe(false);
    expect(compareToBaseline([], []).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade-harness.test.ts`
Expected: FAIL — cannot import from `./helpers/upgrade-baseline`.

- [ ] **Step 3: Write minimal implementation**

Create `test/helpers/upgrade-baseline.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FileDiff } from "./upgrade-diff";

/** Per-pack ratchet baseline. Under the gitignored test/corpus/ tree (it describes packs that
 * live only there), content-addressed by sha256(input pack) so it self-invalidates on change. */
export const DEFAULT_UPGRADE_BASELINE = join(
  __dirname,
  "..",
  "corpus",
  ".upgrade-baseline",
);

function baselinePath(key: string, dir: string): string {
  return join(dir, `${key}.json`);
}

/** Identity for ratchet membership — the cosmetic `detail` (byte lengths) is deliberately excluded. */
function idOf(f: FileDiff): string {
  return `${f.gamePath}#${f.index}:${f.status}`;
}

export function loadBaseline(
  key: string,
  dir: string = DEFAULT_UPGRADE_BASELINE,
): FileDiff[] | null {
  const p = baselinePath(key, dir);
  return existsSync(p)
    ? (JSON.parse(readFileSync(p, "utf8")) as FileDiff[])
    : null;
}

export function saveBaseline(
  key: string,
  files: FileDiff[],
  dir: string = DEFAULT_UPGRADE_BASELINE,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(baselinePath(key, dir), JSON.stringify(files, null, 2));
}

/** PASS when actual ⊆ baseline (by identity). Extra baseline entries are fine (we improved). */
export function compareToBaseline(
  actual: FileDiff[],
  baseline: FileDiff[],
): { ok: boolean; regressions: FileDiff[] } {
  const allowed = new Set(baseline.map(idOf));
  const regressions = actual.filter((f) => !allowed.has(idOf(f)));
  return { ok: regressions.length === 0, regressions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade-harness.test.ts`
Expected: PASS (all harness unit tests).

- [ ] **Step 5: Commit**

```powershell
npm run check
git add test/helpers/upgrade-baseline.ts test/upgrade-harness.test.ts
git commit -m "feat(upgrade): gitignored per-pack ratchet baseline"
```

---

## Task 6: Corpus integration — the `upgrade` check

Wire the pieces into one corpus check per pack, and register it in the parallel runner's enumeration. This is the integration deliverable: on real packs, with the oracle, it generates + caches goldens and ratchets against a gitignored baseline.

**Files:**
- Create: `test/helpers/corpus-upgrade.ts`
- Modify: `test/helpers/corpus-units.ts`
- Modify: `test/helpers/corpus-register.ts`
- Modify: `test/corpus-units.test.ts`

**Interfaces:**
- Consumes: `loadModpack`, `upgradeModpack` from `../../src/index`; `upgradeGoldenCached` (Task 4); `diffUpgrade` (Task 3); `confirmDivergence` (Task 2); `loadBaseline`/`saveBaseline`/`compareToBaseline` (Task 5); `oracleKey` from `./oracle`.
- Produces: `registerUpgradeCheck(pack: string): void`; `CheckKind` gains `"upgrade"`.

- [ ] **Step 1: Write `registerUpgradeCheck`**

Create `test/helpers/corpus-upgrade.ts`:

```ts
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModpack, upgradeModpack } from "../../src/index";
import { oracleKey } from "./oracle";
import {
  compareToBaseline,
  loadBaseline,
  saveBaseline,
} from "./upgrade-baseline";
import { confirmDivergence } from "./upgrade-compare";
import { diffUpgrade } from "./upgrade-diff";
import { upgradeGoldenCached } from "./upgrade-golden";

// Set UPDATE_UPGRADE_BASELINE=1 to (re-)record each pack's baseline to its current actual diff.
const BLESS = process.env.UPDATE_UPGRADE_BASELINE === "1";

// End-to-end golden check: our upgrade pipeline vs the cached ConsoleTools /upgrade output,
// diffed per gamePath on decompressed content, exact-byte except for confirmed intentional
// divergences, ratcheted against a gitignored per-pack baseline (see the harness design spec).
export function registerUpgradeCheck(pack: string): void {
  const name = basename(pack);
  describe(`upgrade golden: ${name}`, () => {
    it("matches ConsoleTools /upgrade within the ratchet baseline", () => {
      const bytes = new Uint8Array(readFileSync(pack));
      const ours = upgradeModpack(loadModpack(name, bytes));

      const golden = upgradeGoldenCached(name, bytes);
      if (golden === null) {
        throw new Error(
          `No /upgrade golden for ${name}: uncached and no oracle (TexTools) available. ` +
            `Run with ConsoleTools installed to populate test/corpus/.upgrade-cache.`,
        );
      }
      // A no-op upgrade writes no golden; the correct reference is the original input,
      // so this still exercises our whole load->upgrade->reduce pipeline end to end.
      const reference =
        golden.kind === "noop" ? loadModpack(name, bytes) : golden.data;

      const diff = diffUpgrade(name, ours, reference, confirmDivergence);
      const key = oracleKey(bytes);

      if (BLESS) {
        saveBaseline(key, diff.files);
        console.log(
          `[upgrade] blessed ${name}: ${diff.matched} matched, ${diff.files.length} recorded`,
        );
        return;
      }

      const baseline = loadBaseline(key) ?? [];
      const { ok, regressions } = compareToBaseline(diff.files, baseline);
      console.log(
        `[upgrade] ${name}: ${diff.matched} matched, ${diff.files.length} diffs, ` +
          `${regressions.length} regressions (baseline ${baseline.length})`,
      );
      if (!ok) {
        expect.fail(
          `upgrade regressions in ${name}: ` +
            regressions
              .map((r) => `${r.gamePath}#${r.index}:${r.status}`)
              .join(", "),
        );
      }
    }, 1_200_000);
  });
}
```

- [ ] **Step 2: Enumerate the new check**

In `test/helpers/corpus-units.ts`, change the `CheckKind` union:

```ts
export type CheckKind = "sqpack" | "golden" | "mtrl" | "pmp" | "tex" | "mdl";
```

to:

```ts
export type CheckKind =
  | "sqpack"
  | "golden"
  | "mtrl"
  | "pmp"
  | "tex"
  | "mdl"
  | "upgrade";
```

And in `enumerateUnits()`, add the `upgrade` unit per pack (after `mdl`, before the `.pmp`-only `pmp`). Change:

```ts
    units.push({ pack, check: "mdl" });
    if (pack.toLowerCase().endsWith(".pmp")) units.push({ pack, check: "pmp" });
```

to:

```ts
    units.push({ pack, check: "mdl" });
    units.push({ pack, check: "upgrade" });
    if (pack.toLowerCase().endsWith(".pmp")) units.push({ pack, check: "pmp" });
```

Also update the doc comment above `enumerateUnits` that lists the fixed order to include `upgrade`:

```ts
 * the fixed check order [sqpack, golden, mtrl, tex, mdl, upgrade, (pmp if .pmp)]. sqpack is ONE
```

- [ ] **Step 3: Dispatch the new check**

In `test/helpers/corpus-register.ts`, add the import and the DISPATCH entry:

```ts
import { registerUpgradeCheck } from "./corpus-upgrade";
```

```ts
const DISPATCH: Record<CheckKind, (pack: string) => void> = {
  sqpack: registerSqpackChecks,
  golden: registerGoldenCheck,
  mtrl: registerMtrlChecks,
  pmp: registerPmpManifestChecks,
  tex: registerTexChecks,
  mdl: registerMdlChecks,
  upgrade: registerUpgradeCheck,
};
```

- [ ] **Step 4: Update the enumeration assertions**

In `test/corpus-units.test.ts`, update the count (5 → 6 per pack) and both order arrays.

Change:

```ts
    expect(units.length).toBe(packs.length * 5 + pmpCount);
```

to:

```ts
    expect(units.length).toBe(packs.length * 6 + pmpCount);
```

Change the test title:

```ts
  it("emits sqpack+golden+mtrl+tex+mdl for every pack, plus pmp for .pmp packs", () => {
```

to:

```ts
  it("emits sqpack+golden+mtrl+tex+mdl+upgrade for every pack, plus pmp for .pmp packs", () => {
```

Change both `expected` arrays:

```ts
      const expected = pack.toLowerCase().endsWith(".pmp")
        ? ["sqpack", "golden", "mtrl", "tex", "mdl", "pmp"]
        : ["sqpack", "golden", "mtrl", "tex", "mdl"];
```

to:

```ts
      const expected = pack.toLowerCase().endsWith(".pmp")
        ? ["sqpack", "golden", "mtrl", "tex", "mdl", "upgrade", "pmp"]
        : ["sqpack", "golden", "mtrl", "tex", "mdl", "upgrade"];
```

- [ ] **Step 5: Typecheck + fast tests**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx vitest run test/corpus-units.test.ts test/upgrade-harness.test.ts test/upgrade/upgrade.test.ts`
Expected: PASS (enumeration reflects 6 checks/pack; harness + skeleton units green).

- [ ] **Step 6: Cold run — populate goldens and record the initial baseline**

The identity skeleton diverges from every non-no-op golden, so first bless the baselines (this also populates `.upgrade-cache` by spawning ConsoleTools per pack — slow, once):

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

Expected: PASS. Confirm both artifacts populated:

```powershell
(Get-ChildItem test\corpus\.upgrade-cache -File | Measure-Object).Count
(Get-ChildItem test\corpus\.upgrade-baseline -File | Measure-Object).Count
```

Expected: `.upgrade-baseline` has one `<key>.json` per pack; `.upgrade-cache` has one `<key>.bin` or `<key>.noop` per distinct pack.

- [ ] **Step 7: Warm run — confirm green and cached**

```powershell
npm test
```

Expected: PASS — the `upgrade` checks read cached goldens (no ConsoleTools spawns) and every actual diff equals its blessed baseline (zero regressions). This is the green gate the ratchet guarantees while transforms are still unwritten.

- [ ] **Step 8: Commit (code only — cache + baseline are gitignored)**

```powershell
npm run check
git add test/helpers/corpus-upgrade.ts test/helpers/corpus-units.ts test/helpers/corpus-register.ts test/corpus-units.test.ts
git commit -m "feat(upgrade): wire E2E golden-upgrade check into the corpus runner"
```

---

## Task 7: Document the harness (bless workflow + divergence contract)

Record the operator-facing workflow so the next session (human or agent) knows how to bless baselines and how divergences are handled.

**Files:**
- Modify: `AGENTS.md`

**Interfaces:** none.

- [ ] **Step 1: Add a harness section to AGENTS.md**

In `AGENTS.md`, after the "Coverage" paragraph under "End-of-task ritual", add:

```markdown
## Upgrade golden harness

`npm test` includes an end-to-end `upgrade` check per corpus pack: it runs our
`upgradeModpack` pipeline and diffs the result against a cached ConsoleTools
`/upgrade` golden (per `gamePath`, on decompressed content).

- **Goldens are cached** content-addressed under `test/corpus/.upgrade-cache/`
  (gitignored). First run spawns ConsoleTools per pack; later runs read the cache.
  A no-op upgrade caches a `<key>.noop` marker (ConsoleTools writes no file when
  nothing changes) and the pack is then compared against its own input.
- **Ratchet baseline** lives in `test/corpus/.upgrade-baseline/` (gitignored — it
  describes packs that only exist locally). A pack passes while its actual diff is
  a subset of its baseline; a regression (or a new pack that does not fully match)
  fails. Record/refresh baselines with the bless step:

      $env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE

  A newly added corpus mod has no baseline and is expected to fully match; if it
  does not, either it is a real bug, or the difference is an intended divergence.
- **Intended divergences from TexTools** are never ignored: add a rule to
  `DIVERGENCE_RULES` (`test/helpers/upgrade-compare.ts`) that *confirms* the
  divergence is exactly the one we meant (e.g. same tex shape, pixels within our
  documented encoder precision), with a cited reason. Files matched by no rule
  must be byte-identical to the golden.
```

- [ ] **Step 2: Verify + commit**

Run: `npm run check`
Expected: Biome passes (formats the markdown if needed).

```powershell
git add AGENTS.md
git commit -m "docs(upgrade): document golden-harness bless workflow + divergence contract"
```

---

## Self-Review

**Spec coverage:**
- §4.1 pipeline seam → Task 1 (`upgradeModpack`/`cloneModpack` skeleton + export). The spec's "four named no-op passes" is realized as documented insertion points rather than dead functions (Biome flags unused symbols); the structural-copy behavior it specified is implemented and tested. ✓
- §4.2 golden cache (content-addressed, `.noop` sentinel, format-preserving, fail-on-unavailable) → Task 4. ✓
- §4.3 diff engine (gamePath multiset, decompressed, confirm-aware pairing, noop→input reference) → Task 3 + Task 6 (noop reference). ✓
- §4.4 divergence confirmations (registry, tight `confirm`, empty to start) → Task 2. ✓
- §4.5 baseline ratchet (gitignored, content-addressed, empty=expected-match, subset-pass, bless) → Task 5 + Task 6 (bless run). ✓
- §4.6 corpus wiring (`CheckKind`, enumerate, dispatch, joins `npm test`) → Task 6. ✓
- §6 harness self-tests (cache, diff, comparator, baseline) → Tasks 2–5 unit tests in `test/upgrade-harness.test.ts`; skeleton test in Task 1. ✓
- §8 file plan → matches the File Structure section above. ✓
- Documentation of the bless workflow (operator-facing) → Task 7. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — every code and command step is concrete. ✓

**Type consistency:** `FileDiff`/`PackDiff`/`DiffStatus` defined in Task 3 and consumed unchanged in Tasks 5–6; `GoldenResult` from Task 4 consumed in Task 6; `confirmDivergence(gamePath, ours, golden, rules?)` signature (Task 2) matches the 3-arg call sites in Task 3's engine and Task 6; `oracleKey`/`oracleCacheGet`/`oracleCachePut`/`oracleAvailable`/`upgrade` are all existing exports of `test/helpers/oracle.ts` (verified). `CheckKind` union + `DISPATCH` record + `enumerateUnits` order + `corpus-units.test.ts` assertions all updated together in Task 6. ✓
