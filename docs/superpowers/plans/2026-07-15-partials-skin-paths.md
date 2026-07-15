# Partials Slice 1 — `UpdateSkinPaths` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `ModpackUpgrader.UpdateSkinPaths` (round-6 partials, slice 1) so the upgrade pipeline aliases old Endwalker skin/body/tail diffuse texture paths to their Dawntrail names via the static `SkinRepathDict`.

**Architecture:** Two TS homes, honoring "split, don't blend": the static path table goes in a new data module `src/upgrade/skin-repath-dict.ts` (← `EndwalkerUpgrade.SkinRepathDict`), and the transform `updateSkinPaths` is added to `src/upgrade/upgrade.ts` (← `ModpackUpgrader.UpdateSkinPaths`), wired into the existing `partials()` seam so it runs per-option after the texture round. Pure file-pointer aliasing — no game-index read, no texture decode, no pixel math, so no `DIVERGENCE_RULES` entry is needed.

**Tech Stack:** TypeScript, Vitest, Biome. Spec: `docs/superpowers/specs/2026-07-15-partials-skin-paths-design.md`.

## Global Constraints

- **Byte-parity is correctness.** Output must match ConsoleTools `/upgrade` byte-for-byte except documented divergences. This slice adds no divergence (aliased file is byte-identical to its source at a new path).
- **Provenance required.** Every non-test module cites its C# source as `file · symbol · lines` in a header/comment.
- **Split, don't blend.** Do not merge logic from different C# files into one TS module — the data table and the transform live in separate homes (see Architecture).
- **Reproduce quirks faithfully.** Port the active dict entries verbatim; the inactive commented-out "Norms" block (`EndwalkerUpgrade.cs:2248-2280`) is intentionally omitted, noted in a comment.
- **No new dependencies.** This slice needs none.
- **Formatting is mechanical** — run `npm run check` (Biome); never hand-format.
- **End-of-task ritual (required):** `npm run check` → `npm run typecheck` → `npm test`, all green, before the task is complete.

## File Structure

- **Create** `src/upgrade/skin-repath-dict.ts` — the `SKIN_REPATH_DICT` data table (old path → new path). Sole responsibility: hold the ported static dict.
- **Create** `test/upgrade/skin-repath-dict.test.ts` — spot-checks the table's contents/shape.
- **Modify** `src/upgrade/upgrade.ts` — add exported `updateSkinPaths(option)` and change `partials()` to iterate options and call it; update the call site to `partials(out)`.
- **Create** `test/upgrade/skin-paths.test.ts` — unit + e2e tests for the transform.

---

### Task 1: `SKIN_REPATH_DICT` data table

**Files:**
- Create: `src/upgrade/skin-repath-dict.ts`
- Test: `test/upgrade/skin-repath-dict.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const SKIN_REPATH_DICT: ReadonlyMap<string, string>` — old EW texture game path → DT-renamed game path.

- [ ] **Step 1: Write the failing test**

Create `test/upgrade/skin-repath-dict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SKIN_REPATH_DICT } from "../../src/upgrade/skin-repath-dict";

describe("SKIN_REPATH_DICT", () => {
  it("holds exactly the 36 active EndwalkerUpgrade.SkinRepathDict entries", () => {
    expect(SKIN_REPATH_DICT.size).toBe(36);
  });

  it("maps a base-game body diffuse to its _base rename", () => {
    expect(
      SKIN_REPATH_DICT.get(
        "chara/human/c0201/obj/body/b0001/texture/--c0201b0001_d.tex",
      ),
    ).toBe("chara/human/c0201/obj/body/b0001/texture/c0201b0001_base.tex");
  });

  it("maps a Bibo diffuse", () => {
    expect(SKIN_REPATH_DICT.get("chara/bibo/midlander_d.tex")).toBe(
      "chara/bibo_mid_base.tex",
    );
  });

  it("maps a TBSE entry by stripping only the -- prefix", () => {
    expect(
      SKIN_REPATH_DICT.get(
        "chara/human/c0101/obj/body/b0001/texture/--c0101b0001_b_d.tex",
      ),
    ).toBe("chara/human/c0101/obj/body/b0001/texture/c0101b0001_b_d.tex");
  });

  it("maps an Au Ra tail diffuse", () => {
    expect(
      SKIN_REPATH_DICT.get(
        "chara/human/c1401/obj/tail/t0104/texture/--c1401t0104_etc_d.tex",
      ),
    ).toBe("chara/human/c1401/obj/tail/t0104/texture/c1401t0104_etc_base.tex");
  });

  it("does NOT port the inactive commented-out normal (_n) entries", () => {
    expect(
      SKIN_REPATH_DICT.has(
        "chara/human/c0201/obj/body/b0001/texture/--c0201b0001_n.tex",
      ),
    ).toBe(false);
    expect(SKIN_REPATH_DICT.has("chara/bibo/midlander_n.tex")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/skin-repath-dict.test.ts`
Expected: FAIL — cannot resolve module `../../src/upgrade/skin-repath-dict`.

- [ ] **Step 3: Write the data module**

Create `src/upgrade/skin-repath-dict.ts`:

```ts
/**
 * Port of EndwalkerUpgrade.SkinRepathDict · EndwalkerUpgrade.cs:2197-2246 (active entries only).
 *
 * Maps an old Endwalker skin/body/tail *diffuse* texture game path to its Dawntrail-renamed
 * path. Consumed only by `updateSkinPaths` (round-6 partials, ModpackUpgrader.cs:484), which
 * aliases a file present at the old path to the new path.
 *
 * The large commented-out "Norms" block that follows the active entries upstream
 * (EndwalkerUpgrade.cs:2248-2280) is inactive in C# and is intentionally NOT ported — do not
 * "restore" it. A `Map` (not a plain object) mirrors the C# Dictionary's ContainsKey/indexer
 * semantics and avoids prototype-key pitfalls.
 */
export const SKIN_REPATH_DICT: ReadonlyMap<string, string> = new Map([
  // Base Game
  [
    "chara/human/c0201/obj/body/b0001/texture/--c0201b0001_d.tex",
    "chara/human/c0201/obj/body/b0001/texture/c0201b0001_base.tex",
  ],
  [
    "chara/human/c0401/obj/body/b0001/texture/--c0401b0001_d.tex",
    "chara/human/c0401/obj/body/b0001/texture/c0401b0001_base.tex",
  ],
  [
    "chara/human/c1401/obj/body/b0001/texture/--c1401b0001_d.tex",
    "chara/human/c1401/obj/body/b0001/texture/c1401b0001_base.tex",
  ],
  [
    "chara/human/c1401/obj/body/b0101/texture/--c1401b0101_d.tex",
    "chara/human/c1401/obj/body/b0101/texture/c1401b0101_base.tex",
  ],
  [
    "chara/human/c1801/obj/body/b0001/texture/--c1801b0001_d.tex",
    "chara/human/c1801/obj/body/b0001/texture/c1801b0001_base.tex",
  ],
  [
    "chara/human/c0101/obj/body/b0001/texture/--c0101b0001_d.tex",
    "chara/human/c0101/obj/body/b0001/texture/c0101b0001_base.tex",
  ],
  [
    "chara/human/c0301/obj/body/b0001/texture/--c0301b0001_d.tex",
    "chara/human/c0301/obj/body/b0001/texture/c0301b0001_base.tex",
  ],
  [
    "chara/human/c1301/obj/body/b0001/texture/--c1301b0001_d.tex",
    "chara/human/c1301/obj/body/b0001/texture/c1301b0001_base.tex",
  ],
  [
    "chara/human/c1301/obj/body/b0101/texture/--c1301b0101_d.tex",
    "chara/human/c1301/obj/body/b0101/texture/c1301b0101_base.tex",
  ],
  [
    "chara/human/c1701/obj/body/b0001/texture/--c1701b0001_d.tex",
    "chara/human/c1701/obj/body/b0001/texture/c1701b0001_base.tex",
  ],
  // Bibo
  ["chara/bibo/midlander_d.tex", "chara/bibo_mid_base.tex"],
  ["chara/bibo/raen_d.tex", "chara/bibo_raen_base.tex"],
  ["chara/bibo/xaela_d.tex", "chara/bibo_xaela_base.tex"],
  ["chara/bibo/viera_d.tex", "chara/bibo_viera_base.tex"],
  ["chara/bibo/highlander_d.tex", "chara/bibo_high_base.tex"],
  // TBSE
  [
    "chara/human/c0101/obj/body/b0001/texture/--c0101b0001_b_d.tex",
    "chara/human/c0101/obj/body/b0001/texture/c0101b0001_b_d.tex",
  ],
  [
    "chara/human/c1301/obj/body/b0001/texture/--c1301b0001_b_d.tex",
    "chara/human/c1301/obj/body/b0001/texture/c1301b0001_b_d.tex",
  ],
  [
    "chara/human/c1301/obj/body/b0101/texture/--c1301b0101_b_d.tex",
    "chara/human/c1301/obj/body/b0101/texture/c1301b0101_b_d.tex",
  ],
  [
    "chara/human/c1701/obj/body/b0001/texture/--c1701b0001_b_d.tex",
    "chara/human/c1701/obj/body/b0001/texture/c1701b0001_b_d.tex",
  ],
  [
    "chara/human/c0301/obj/body/b0001/texture/--c0301b0001_b_d.tex",
    "chara/human/c0301/obj/body/b0001/texture/c0301b0001_b_d.tex",
  ],
  // Au Ra Tails
  [
    "chara/human/c1301/obj/tail/t0001/texture/--c1301t0001_etc_d.tex",
    "chara/human/c1301/obj/tail/t0001/texture/c1301t0001_etc_base.tex",
  ],
  [
    "chara/human/c1301/obj/tail/t0002/texture/--c1301t0002_etc_d.tex",
    "chara/human/c1301/obj/tail/t0002/texture/c1301t0002_etc_base.tex",
  ],
  [
    "chara/human/c1301/obj/tail/t0003/texture/--c1301t0003_etc_d.tex",
    "chara/human/c1301/obj/tail/t0003/texture/c1301t0003_etc_base.tex",
  ],
  [
    "chara/human/c1301/obj/tail/t0004/texture/--c1301t0004_etc_d.tex",
    "chara/human/c1301/obj/tail/t0004/texture/c1301t0004_etc_base.tex",
  ],
  [
    "chara/human/c1301/obj/tail/t0101/texture/--c1301t0101_etc_d.tex",
    "chara/human/c1301/obj/tail/t0101/texture/c1301t0101_etc_base.tex",
  ],
  [
    "chara/human/c1301/obj/tail/t0102/texture/--c1301t0102_etc_d.tex",
    "chara/human/c1301/obj/tail/t0102/texture/c1301t0102_etc_base.tex",
  ],
  [
    "chara/human/c1301/obj/tail/t0103/texture/--c1301t0103_etc_d.tex",
    "chara/human/c1301/obj/tail/t0103/texture/c1301t0103_etc_base.tex",
  ],
  [
    "chara/human/c1301/obj/tail/t0104/texture/--c1301t0104_etc_d.tex",
    "chara/human/c1301/obj/tail/t0104/texture/c1301t0104_etc_base.tex",
  ],
  [
    "chara/human/c1401/obj/tail/t0001/texture/--c1401t0001_etc_d.tex",
    "chara/human/c1401/obj/tail/t0001/texture/c1401t0001_etc_base.tex",
  ],
  [
    "chara/human/c1401/obj/tail/t0002/texture/--c1401t0002_etc_d.tex",
    "chara/human/c1401/obj/tail/t0002/texture/c1401t0002_etc_base.tex",
  ],
  [
    "chara/human/c1401/obj/tail/t0003/texture/--c1401t0003_etc_d.tex",
    "chara/human/c1401/obj/tail/t0003/texture/c1401t0003_etc_base.tex",
  ],
  [
    "chara/human/c1401/obj/tail/t0004/texture/--c1401t0004_etc_d.tex",
    "chara/human/c1401/obj/tail/t0004/texture/c1401t0004_etc_base.tex",
  ],
  [
    "chara/human/c1401/obj/tail/t0101/texture/--c1401t0101_etc_d.tex",
    "chara/human/c1401/obj/tail/t0101/texture/c1401t0101_etc_base.tex",
  ],
  [
    "chara/human/c1401/obj/tail/t0102/texture/--c1401t0102_etc_d.tex",
    "chara/human/c1401/obj/tail/t0102/texture/c1401t0102_etc_base.tex",
  ],
  [
    "chara/human/c1401/obj/tail/t0103/texture/--c1401t0103_etc_d.tex",
    "chara/human/c1401/obj/tail/t0103/texture/c1401t0103_etc_base.tex",
  ],
  [
    "chara/human/c1401/obj/tail/t0104/texture/--c1401t0104_etc_d.tex",
    "chara/human/c1401/obj/tail/t0104/texture/c1401t0104_etc_base.tex",
  ],
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upgrade/skin-repath-dict.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Format, then commit**

```bash
npm run check
git add src/upgrade/skin-repath-dict.ts test/upgrade/skin-repath-dict.test.ts
git commit -m "feat(upgrade): port EndwalkerUpgrade.SkinRepathDict table"
```

---

### Task 2: `updateSkinPaths` transform + `partials` wiring

**Files:**
- Modify: `src/upgrade/upgrade.ts` (add `updateSkinPaths`; change `partials` signature + body; update its call site)
- Test: `test/upgrade/skin-paths.test.ts`

**Interfaces:**
- Consumes: `SKIN_REPATH_DICT` from Task 1; `ModpackOption`/`ModpackData`/`ModpackFile` from `src/model/modpack`.
- Produces: `export function updateSkinPaths(option: ModpackOption): void` — mutates `option.files` in place, appending an aliased file for each matching entry. `partials(data: ModpackData): void` now runs it over every option.

- [ ] **Step 1: Write the failing test**

Create `test/upgrade/skin-paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { upgradeModpack } from "../../src/index";
import {
  FileStorageType,
  type ModpackData,
  type ModpackOption,
  ModpackFormat,
} from "../../src/model/modpack";
import { updateSkinPaths } from "../../src/upgrade/upgrade";

function option(files: ModpackOption["files"]): ModpackOption {
  return {
    name: "O",
    description: "",
    image: "",
    priority: 0,
    fileSwaps: {},
    manipulations: [],
    files,
  };
}

const OLD = "chara/bibo/midlander_d.tex";
const NEW = "chara/bibo_mid_base.tex";

describe("updateSkinPaths", () => {
  it("aliases a matching file to its DT path, sharing the same bytes and storage", () => {
    const data = new Uint8Array([9, 8, 7]);
    const o = option([
      { gamePath: OLD, data, storage: FileStorageType.RawUncompressed },
    ]);
    updateSkinPaths(o);
    expect(o.files.map((f) => f.gamePath)).toEqual([OLD, NEW]);
    const aliased = o.files.find((f) => f.gamePath === NEW)!;
    expect(aliased.storage).toBe(FileStorageType.RawUncompressed);
    // Pointer duplication: shares the same underlying buffer reference.
    expect(aliased.data).toBe(data);
  });

  it("does nothing when the target path is already present", () => {
    const o = option([
      {
        gamePath: OLD,
        data: new Uint8Array([1]),
        storage: FileStorageType.RawUncompressed,
      },
      {
        gamePath: NEW,
        data: new Uint8Array([2]),
        storage: FileStorageType.RawUncompressed,
      },
    ]);
    updateSkinPaths(o);
    expect(o.files.length).toBe(2);
    // Pre-existing target untouched (not overwritten by the alias).
    expect(Array.from(o.files.find((f) => f.gamePath === NEW)!.data!)).toEqual([
      2,
    ]);
  });

  it("adds one alias per matching key when several are present", () => {
    const o = option([
      {
        gamePath: OLD,
        data: new Uint8Array([1]),
        storage: FileStorageType.RawUncompressed,
      },
      {
        gamePath: "chara/bibo/raen_d.tex",
        data: new Uint8Array([2]),
        storage: FileStorageType.RawUncompressed,
      },
    ]);
    updateSkinPaths(o);
    expect(new Set(o.files.map((f) => f.gamePath))).toEqual(
      new Set([
        OLD,
        "chara/bibo/raen_d.tex",
        NEW,
        "chara/bibo_raen_base.tex",
      ]),
    );
  });

  it("leaves a non-matching file untouched", () => {
    const o = option([
      {
        gamePath: "chara/unrelated/foo.tex",
        data: new Uint8Array([1]),
        storage: FileStorageType.RawUncompressed,
      },
    ]);
    updateSkinPaths(o);
    expect(o.files.map((f) => f.gamePath)).toEqual(["chara/unrelated/foo.tex"]);
  });
});

function packWith(gamePath: string, data: Uint8Array): ModpackData {
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
        options: [option([{ gamePath, data, storage: FileStorageType.RawUncompressed }])],
      },
    ],
  };
}

describe("upgradeModpack partials (skin repath e2e)", () => {
  it("aliases a skin diffuse texture during the partials round", () => {
    const bytes = new Uint8Array([4, 2]);
    const out = upgradeModpack(packWith(OLD, bytes));
    const files = out.groups[0]!.options[0]!.files;
    expect(files.some((f) => f.gamePath === NEW)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upgrade/skin-paths.test.ts`
Expected: FAIL — `updateSkinPaths` is not exported from `src/upgrade/upgrade`.

- [ ] **Step 3: Add the transform and wire the seam**

In `src/upgrade/upgrade.ts`, add the import near the other `./` upgrade imports (top of file):

```ts
import { SKIN_REPATH_DICT } from "./skin-repath-dict";
```

Replace the existing stub:

```ts
/** Round 3: UpdateUnclaimedHairTextures / UpdateEyeMask / UpdateSkinPaths. */
function partials(): void {
  // round N: ported later
}
```

with:

```ts
/**
 * Round 6 partials, slice 1: UpdateSkinPaths (ModpackUpgrader.cs:484-500). For each file whose
 * game path is a key in SKIN_REPATH_DICT, add a byte-identical alias at the target path unless the
 * option already contains it — pure pointer duplication, no content change. Mutates option.files.
 *
 * C# iterates a snapshot (`clone`) of the option's files but checks the LIVE dict for the target,
 * so a target added earlier in this same pass is seen; we mirror that by snapshotting the source
 * list and checking the growing `option.files`. UpdateUnclaimedHairTextures / UpdateEyeMask
 * (the rest of the includePartials block, ModpackUpgrader.cs:158-182) remain unported — see
 * docs/backlog/2026-07-15-partials-unclaimed-hair.md and -eye-mask.md.
 */
export function updateSkinPaths(option: ModpackOption): void {
  const snapshot = [...option.files];
  for (const f of snapshot) {
    const target = SKIN_REPATH_DICT.get(f.gamePath);
    if (target === undefined) continue;
    if (option.files.some((x) => x.gamePath === target)) continue;
    // Duplicate the pointer: shares f.data, carries storage + any ttmp metadata.
    option.files.push({ ...f, gamePath: target });
  }
}

/**
 * Round 6 partials (ModpackUpgrader.cs:148-183, the includePartials block). Runs UpdateSkinPaths
 * over every option first (ForAllOptions, :158); the unclaimed-hair / eye-mask third round (:162-182)
 * is not yet ported.
 */
function partials(data: ModpackData): void {
  for (const group of data.groups) {
    for (const option of group.options) {
      updateSkinPaths(option);
    }
  }
}
```

Then update the call site in `upgradeModpack` from `partials();` to:

```ts
  partials(out);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/upgrade/skin-paths.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Format, then commit**

```bash
npm run check
git add src/upgrade/upgrade.ts test/upgrade/skin-paths.test.ts
git commit -m "feat(upgrade): port UpdateSkinPaths into the partials round"
```

---

### Task 3: Full gate + corpus baseline re-bless

Environment-dependent: the corpus (`test/corpus/real`) and ConsoleTools live only on the operator's machine. The re-bless step below is a no-op on a fresh clone (empty corpus) and must be run where both are present.

**Files:** none (verification + gitignored baseline updates only).

- [ ] **Step 1: Run the required gate**

Run: `npm run check` then `npm run typecheck` then `npm test`
Expected: all green. The new unit tests pass everywhere; corpus `upgrade` checks pass against existing baselines (a skin-repath pack may now produce an *extra* matched file — which is a baseline shrink, handled in Step 2, not a failure, since the ratchet passes while the diff stays a subset of the baseline).

- [ ] **Step 2: Re-bless baselines and confirm the skin diff shrank**

If a corpus body/skin pack exercised the new alias, its baseline should now record fewer diffs. Re-bless and inspect the git-status of the gitignored baseline dir:

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

Expected: baselines under `test/corpus/.upgrade-baseline/` either unchanged (no corpus pack hits skin repath) or **shrink** (a previously-diffing `_base.tex`/`_b_d.tex` alias now matches the golden). A baseline that *grows* means the alias diverged from the golden — investigate before proceeding. Note the observed outcome in the PR description.

- [ ] **Step 3: Final commit if baselines changed**

The baselines are gitignored, so there is nothing to commit for them. If Step 2 revealed a needed code change, fix it under Task 2's test discipline and re-run the gate.

---

### Task 4: Refile the backlog (retire the old partials item; file hair + eye)

Spec §7. Now that `UpdateSkinPaths` ships, the remaining round-6 work is two game-index-dependent transforms; split the old umbrella item into two focused, pickup-cold items.

**Files:**
- Delete: `docs/backlog/2026-07-08-partials-round.md`
- Create: `docs/backlog/2026-07-15-partials-unclaimed-hair.md`
- Create: `docs/backlog/2026-07-15-partials-eye-mask.md`
- Modify: `docs/BACKLOG.md` (replace the prioritized partials entry with two entries)

- [ ] **Step 1: Confirm nothing else cites the retired item**

Run: `git grep -n "2026-07-08-partials-round" -- src test scripts docs`
Expected: matches only in `docs/BACKLOG.md` (the index) — no code guard cites it. If a `src/` guard cites it, repoint that citation as part of this task.

- [ ] **Step 2: Create the unclaimed-hair item**

Create `docs/backlog/2026-07-15-partials-unclaimed-hair.md`:

```markdown
# Round 6 partials — `UpdateUnclaimedHairTextures` (+ hair accessory)

Filed: 2026-07-15 · Status: open · Priority: prioritized

`partials` (`src/upgrade/upgrade.ts`) ports UpdateSkinPaths only. `UpdateUnclaimedHairTextures`
(EndwalkerUpgrade.cs:1324-1519) and `UpdateUnclaimedHairAccessory` (:1522+) remain unported: the
hair/tail/ear texture-only heuristics that detect a hair texture included WITHOUT its material and
copy it to SE's new pathing.

Needs a **bundled canonical material table** extracted from a live Dawntrail install — per
hair/tail/ear/accessory material (`HairRegexes`/`TailRegexes`/`EarRegexes`/`AccessoryRegexes`,
:1293-1321): its `g_SamplerNormal` / `g_SamplerMask` Dx11 sampler paths, shaderpack (must be Hair),
and material flags — plus a `FileExists` path-set for the `matPath` existence gate (:1430). Reuses
the already-ported `updateEndwalkerHairTextures` pixel path (`src/upgrade/texture.ts`) and the
`_SampleHair` constant material (:56) for the tail backface + shader-constant special-case (:1504).

Orchestration glue also lands here: the `unusedTextures`/`contained` filter (ModpackUpgrader.cs:150-172)
that feeds this and the eye pass. No corpus coverage today; will need real hair mods and/or a
synthetic pack.

Reference: `reference/.../Mods/EndwalkerUpgrade.cs`, `.../ModpackUpgrader.cs:162-182`.
```

- [ ] **Step 3: Create the eye-mask item**

Create `docs/backlog/2026-07-15-partials-eye-mask.md`:

```markdown
# Round 6 partials — `UpdateEyeMask`

Filed: 2026-07-15 · Status: open · Priority: prioritized

`partials` (`src/upgrade/upgrade.ts`) ports UpdateSkinPaths only. `UpdateEyeMask`
(EndwalkerUpgrade.cs:2007-2079) remains unported: converts an Endwalker iris mask
(`--c{race}f{face}_iri_s.tex`, EyeMaskPathRegex :2005) to a Dawntrail diffuse.

Needs a **bundled iris table** extracted from a live Dawntrail install — the iris material
`chara/human/c{race}/obj/face/f{face}/material/mt_c{race}f{face}_iri_a.mtrl` (:2044) and its
`g_SamplerDiffuse` texture path (:2058-2059), i.e. a `(race, face) → diffuse path` map — plus the
`FileExists` gate (:2049). Also needs the pixel helpers `ConvertEyeMaskToDiffuse` (:1910),
`TextureHelpers.SwizzleRB` (:2066), and the DDS conversion round (:2069-2073) — confirm which are
already ported under `src/tex/`. Float-math parity may require a `DIVERGENCE_RULES` entry.

No corpus coverage today; will need real eye mods and/or a synthetic pack.

Reference: `reference/.../Mods/EndwalkerUpgrade.cs:1910-2079`, `.../ModpackUpgrader.cs:174-177`.
```

- [ ] **Step 4: Update the BACKLOG.md index**

Delete `docs/backlog/2026-07-08-partials-round.md`, then in `docs/BACKLOG.md` replace the prioritized item 1 (the old `[Partials round]` entry) with these two, keeping the existing highlight-preround entry after them and renumbering as needed:

```markdown
1. [Round 6 partials — UpdateUnclaimedHairTextures](backlog/2026-07-15-partials-unclaimed-hair.md)
   — the hair/tail/ear/accessory texture-only heuristics. Needs a bundled canonical-material table
   (normal/mask sampler paths, shaderpack, flags) + a FileExists path-set from a live DT install;
   reuses the ported `updateEndwalkerHairTextures` pixel path. No corpus coverage yet.
2. [Round 6 partials — UpdateEyeMask](backlog/2026-07-15-partials-eye-mask.md) — iris mask→diffuse.
   Needs a bundled iris `(race,face)→diffuse path` table + FileExists gate, plus the mask→diffuse
   pixel/DDS helpers. No corpus coverage yet.
```

- [ ] **Step 5: Verify links resolve, then commit**

Run: `git grep -n "2026-07-08-partials-round"`
Expected: no matches (the retired item and its index entry are gone).

```bash
git add -A docs/BACKLOG.md docs/backlog/
git commit -m "docs(backlog): split the round-6 partials item into hair + eye after shipping UpdateSkinPaths"
```

---

## Notes for the executor

- `updateSkinPaths` must be **exported** (the unit test imports it), matching how `resolveFile`/`requireBytes`/`restore` are already exported from `upgrade.ts`.
- Do not touch `partials()`'s position in `upgradeModpack` — it stays the final round, after `upgradeRemainingTextures`.
- No new npm dependencies. If Biome reformats the large `Map` literal, that is expected — commit the formatted result.
