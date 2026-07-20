# IMC Reference Table Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace our Set-only IMC base-seed table with one derived from a faithful port of the symbols ConsoleTools actually executes, covering equipment, accessory, weapon, monster and demihuman, so a weapon/monster `.meta` can no longer silently pass through un-grown.

**Architecture:** A new extraction-only module `scripts/lib/imc-entries.ts` ports `GetRawImcFilePath` + `GetImcEntryPaths` + `GetEntries`. `scripts/extract-meta-reference.ts` drives it over all five `Imc.UsesImc` primary types from `item_sets.db`, keying the generated table on the lowercased root path and recording confirmed-absent `.imc` files as `[]`. `src/meta/reconstruct.ts` looks up by `gamePath` and throws on a miss; `src/meta/root.ts` gains demihuman and loses its placeholder-slot hack. Two synthetic TTMP2 packs give the new behaviour a ConsoleTools golden.

**Tech Stack:** TypeScript, Node 22+ (`node:sqlite` behind `--experimental-sqlite`), tsx, Biome, the repo's custom parallel test runner, ConsoleTools.exe as the oracle.

**Spec:** `docs/superpowers/specs/2026-07-19-imc-reference-table-unification-design.md` — read it first. Section references below (§2.2, §3.2, …) point at it.

## Global Constraints

- **Every line of business logic cites TexTools provenance** as `file · symbol · lines` in a header or comment. Verify each citation by reading `reference/` — do not port from memory or from this plan's quoted C# alone.
- **`reference/` is read-only.** Never edit, lint or format it.
- **Formatting is mechanical.** Biome owns it; run `npm run check`. Never hand-format.
- **Generated tables are Biome-excluded** (`biome.jsonc`) — `src/meta/reference/est-table.ts` and `src/meta/reference/imc-table.ts`.
- **Fail loud, never silently diverge.** A structure the port does not reproduce faithfully must throw.
- **No corpus byte may move.** Every ratchet baseline under `test/corpus/.upgrade-baseline/`, `test/corpus/.resave-baseline/` and `test/corpus/.roundtrip-baseline/` must be unchanged at the end. Do **not** re-bless to make a failure go away — a moved byte is a finding, and it must be explained before anything else proceeds.
- **End-of-task ritual:** `npm run check`, `npm run typecheck`, `npm test` — all green.
- Regenerating the table needs a game install + ConsoleTools and takes ~15 minutes. It is a one-time step in Task 2.

---

### Task 1: Port the IMC entry reader

**Files:**
- Create: `scripts/lib/imc-entries.ts`
- Test: `test/scripts/imc-entries.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface ImcRootInfo { primaryType: "equipment" | "accessory" | "weapon" | "monster" | "demihuman"; primaryId: number; secondaryType: string | null; secondaryId: number | null; slot: string | null; }`
  - `export function rawImcFilePath(root: ImcRootInfo): string`
  - `export function imcEntryOffsets(header: { subsetCount: number; identifier: number }, slot: string | null): number[]`
  - `export function readImcEntries(data: Uint8Array, slot: string | null): number[][]`
  - `export const IMC_TYPE_UNKNOWN = 0`, `IMC_TYPE_NONSET = 1`, `IMC_TYPE_SET = 31`

This module is extraction tooling, not shipped port code — same status as `scripts/lib/game-index.ts`. Say so in its header.

- [ ] **Step 1: Write the failing tests**

Create `test/scripts/imc-entries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  IMC_TYPE_NONSET,
  IMC_TYPE_SET,
  imcEntryOffsets,
  rawImcFilePath,
  readImcEntries,
} from "../../scripts/lib/imc-entries";

/** Builds a well-formed .imc: 4-byte header then (1 + subsetCount) subsets of
 *  `slotsPerSubset` 6-byte entries. Entry bytes are [s, i, 0, 0, 0, 0] so every
 *  entry is identifiable by (subset, slotIndex). */
function buildImc(
  identifier: number,
  subsetCount: number,
  slotsPerSubset: number,
): Uint8Array {
  const total = 4 + 6 * slotsPerSubset * (1 + subsetCount);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setInt16(0, subsetCount, true);
  view.setInt16(2, identifier, true);
  let o = 4;
  for (let s = 0; s <= subsetCount; s++) {
    for (let i = 0; i < slotsPerSubset; i++) {
      out[o] = s;
      out[o + 1] = i;
      o += 6;
    }
  }
  return out;
}

describe("rawImcFilePath (XivDependencyRoot.cs · GetRawImcFilePath · 1093-1126)", () => {
  it("resolves a weapon from its secondary type/id", () => {
    expect(
      rawImcFilePath({
        primaryType: "weapon",
        primaryId: 2021,
        secondaryType: "body",
        secondaryId: 1,
        slot: null,
      }),
    ).toBe("chara/weapon/w2021/obj/body/b0001/b0001.imc");
  });

  it("resolves a demihuman from its secondary type/id", () => {
    expect(
      rawImcFilePath({
        primaryType: "demihuman",
        primaryId: 1001,
        secondaryType: "equipment",
        secondaryId: 1,
        slot: "top",
      }),
    ).toBe("chara/demihuman/d1001/obj/equipment/e0001/e0001.imc");
  });

  it("resolves equipment from its primary type/id (SecondaryType == null)", () => {
    expect(
      rawImcFilePath({
        primaryType: "equipment",
        primaryId: 6137,
        secondaryType: null,
        secondaryId: null,
        slot: "top",
      }),
    ).toBe("chara/equipment/e6137/e6137.imc");
  });

  // Imc.ImcSharingWeaponTypes (Imc.cs:53-59) + XivItemType.cs:184-250 GetWeaponType.
  // An offhand weapon reads the MAINHAND's .imc: PrimaryId -= 50.
  it("redirects an ImcSharing offhand weapon to PrimaryId - 50", () => {
    expect(
      rawImcFilePath({
        primaryType: "weapon",
        primaryId: 3060, // 3050 < id <= 3100 -> TwinfangsOff
        secondaryType: "body",
        secondaryId: 1,
        slot: null,
      }),
    ).toBe("chara/weapon/w3010/obj/body/b0001/b0001.imc");
  });

  it("does not redirect a mainhand weapon in an adjacent range", () => {
    expect(
      rawImcFilePath({
        primaryType: "weapon",
        primaryId: 3010, // 3000 < id <= 3050 -> Twinfangs (mainhand)
        secondaryType: "body",
        secondaryId: 1,
        slot: null,
      }),
    ).toBe("chara/weapon/w3010/obj/body/b0001/b0001.imc");
  });
});

describe("imcEntryOffsets (XivDependencyRoot.cs · GetImcEntryPaths · 1184-1199)", () => {
  it("strides by 6 for NonSet with no slot", () => {
    expect(
      imcEntryOffsets({ subsetCount: 1, identifier: IMC_TYPE_NONSET }, null),
    ).toEqual([4, 10]);
  });

  it("strides by 30 for Set and offsets by the slot column", () => {
    // SlotOffsetDictionary top == 1, so subOffset == 6 (Imc.cs:547-559).
    expect(
      imcEntryOffsets({ subsetCount: 2, identifier: IMC_TYPE_SET }, "top"),
    ).toEqual([10, 40, 70]);
  });

  it("treats an unknown slot as offset 0 (the ContainsKey guard at :1188)", () => {
    expect(
      imcEntryOffsets({ subsetCount: 0, identifier: IMC_TYPE_SET }, "zzz"),
    ).toEqual([4]);
  });
});

describe("readImcEntries (Imc.cs · GetEntries · 189-238)", () => {
  it("reads default + every subset for a NonSet file", () => {
    const entries = readImcEntries(buildImc(IMC_TYPE_NONSET, 1, 1), null);
    expect(entries).toEqual([
      [0, 0, 0, 0, 0, 0],
      [1, 0, 0, 0, 0, 0],
    ]);
  });

  it("reads the slot's column across default + every subset for a Set file", () => {
    const entries = readImcEntries(buildImc(IMC_TYPE_SET, 2, 5), "glv");
    // glv == column 2; subsets 0..2.
    expect(entries).toEqual([
      [0, 2, 0, 0, 0, 0],
      [1, 2, 0, 0, 0, 0],
      [2, 2, 0, 0, 0, 0],
    ]);
  });

  // Spec §3.4.2: the EOF guard's margin is exactly zero on a well-formed file,
  // for the highest slot column and both identifiers. Nothing may be dropped.
  it("drops nothing at the exact EOF boundary (highest slot column)", () => {
    const entries = readImcEntries(buildImc(IMC_TYPE_SET, 3, 5), "sho");
    expect(entries).toHaveLength(4);
    expect(entries[3]).toEqual([3, 4, 0, 0, 0, 0]);
  });

  // The guard (Imc.cs:217 `if (offset > imcByteData.Length - entrySize) continue;`)
  // fires only on a malformed/truncated file, and yields a SHORT list, not a throw.
  it("drops entries that would run past the end of a truncated file", () => {
    const full = buildImc(IMC_TYPE_NONSET, 3, 1); // 4 + 6*4 == 28 bytes
    const truncated = full.slice(0, 22); // loses the last entry
    expect(readImcEntries(truncated, null)).toHaveLength(3);
  });

  // XivDependencyRoot.cs:1179-1182: ImcType.Unknown returns no entry paths at all.
  it("returns no entries for ImcType.Unknown", () => {
    expect(readImcEntries(buildImc(0, 2, 5), "top")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/scripts/imc-entries.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/lib/imc-entries'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/imc-entries.ts`. Before writing, **read** `reference/.../Variants/FileTypes/Imc.cs` lines 40-59, 189-238 and 547-559, `reference/.../Cache/XivDependencyRoot.cs` lines 1093-1202, and `reference/.../Items/Enums/XivItemType.cs` lines 184-250, and confirm every citation below against what you read.

```ts
// IMC entry reader — extraction tooling only (NOT shipped port code), same status as
// scripts/lib/game-index.ts.
//
// Ports the three symbols ConsoleTools actually executes to build a .meta's IMC base seed
// (ItemMetadata.cs · GetMetadata · 233-247 -> GetImcEntryPaths -> GetEntries):
//   - XivDependencyRoot.cs · GetRawImcFilePath · 1093-1126
//   - XivDependencyRoot.cs · GetImcEntryPaths  · 1133-1202
//   - Imc.cs             · GetEntries          · 189-238
//
// NOT a port of Imc.GetFullImcInfo (Imc.cs:351-451). That function is never on this path, and it
// disagrees with it: its NonSet branch writes `Vfx = variant` for the default subset (Imc.cs:384)
// instead of the entry's own vfx byte. See docs/TEXTOOLS_BUGS.md.

export const IMC_TYPE_UNKNOWN = 0; // ImcType.Unknown, Imc.cs:41
export const IMC_TYPE_NONSET = 1; // ImcType.NonSet,  Imc.cs:42
export const IMC_TYPE_SET = 31; // ImcType.Set,     Imc.cs:43

const ENTRY_SIZE = 6; // subEntrySize, XivDependencyRoot.cs:1185
const STARTING_OFFSET = 4; // startingOffset, XivDependencyRoot.cs:1184

// Imc.SlotOffsetDictionary (Imc.cs:547-559): the equipment and accessory slot->offset dictionaries
// merged. Their key sets are disjoint, so one lookup serves both.
const SLOT_OFFSET: Record<string, number> = {
  met: 0,
  top: 1,
  glv: 2,
  dwn: 3,
  sho: 4,
  ear: 0,
  nek: 1,
  wrs: 2,
  rir: 3,
  ril: 4,
};

export interface ImcRootInfo {
  primaryType: "equipment" | "accessory" | "weapon" | "monster" | "demihuman";
  primaryId: number;
  secondaryType: string | null;
  secondaryId: number | null;
  slot: string | null;
}

// XivItemTypes.GetSystemPrefix (XivItemType.cs) — the one-letter path prefix per type.
const SYSTEM_PREFIX: Record<string, string> = {
  equipment: "e",
  accessory: "a",
  weapon: "w",
  monster: "m",
  demihuman: "d",
  body: "b",
};

const pad4 = (n: number): string => String(n).padStart(4, "0");

// Imc.ImcSharingWeaponTypes (Imc.cs:53-59) — FistsOff, TwinfangsOff, DaggersOff, GlaivesOff —
// expressed as the id ranges XivWeaponTypes.GetWeaponType maps to those members
// (XivItemType.cs:184-250). An offhand in one of these ranges reads the MAINHAND's .imc.
function isImcSharingWeapon(primaryId: number): boolean {
  return (
    (primaryId > 350 && primaryId <= 400) || // FistsOff
    (primaryId > 1650 && primaryId <= 1700) || // FistsOff
    (primaryId > 1850 && primaryId <= 1900) || // DaggersOff
    (primaryId > 2650 && primaryId <= 2700) || // GlaivesOff
    (primaryId > 3050 && primaryId <= 3100) || // TwinfangsOff
    (primaryId > 3150 && primaryId <= 3200) // TwinfangsOff
  );
}

/** Port of XivDependencyRoot.GetRawImcFilePath (XivDependencyRoot.cs:1093-1126). */
export function rawImcFilePath(root: ImcRootInfo): string {
  if (root.secondaryType === null || root.secondaryId === null) {
    // :1102-1107 — named from the PRIMARY type/id, directly under the root folder.
    const prefix = SYSTEM_PREFIX[root.primaryType]!;
    const id = pad4(root.primaryId);
    return `chara/${root.primaryType}/${prefix}${id}/${prefix}${id}.imc`;
  }
  // :1108-1124 — named from the SECONDARY type/id, with the weapon redirect applied to the
  // FOLDER's primary id only (nInfo.PrimaryId -= 50, :1119).
  const secPrefix = SYSTEM_PREFIX[root.secondaryType]!;
  const secId = pad4(root.secondaryId);
  let primaryId = root.primaryId;
  if (root.primaryType === "weapon" && isImcSharingWeapon(primaryId)) {
    primaryId -= 50;
  }
  const priPrefix = SYSTEM_PREFIX[root.primaryType]!;
  return (
    `chara/${root.primaryType}/${priPrefix}${pad4(primaryId)}` +
    `/obj/${root.secondaryType}/${secPrefix}${secId}/${secPrefix}${secId}.imc`
  );
}

/** Port of the offset arithmetic in XivDependencyRoot.GetImcEntryPaths (:1184-1199).
 *  Returns one byte offset per entry, in file order. Empty for ImcType.Unknown (:1179-1182). */
export function imcEntryOffsets(
  header: { subsetCount: number; identifier: number },
  slot: string | null,
): number[] {
  if (header.identifier === IMC_TYPE_UNKNOWN) return [];
  const entrySize =
    header.identifier === IMC_TYPE_NONSET ? ENTRY_SIZE : ENTRY_SIZE * 5;
  // :1188 guards on BOTH `Slot != null` and ContainsKey, so an unrecognized slot means offset 0
  // rather than a throw. Weapon/monster roots have no Slot at all and land here too.
  const subOffset =
    slot !== null && slot in SLOT_OFFSET ? SLOT_OFFSET[slot]! * ENTRY_SIZE : 0;
  const offsets: number[] = [];
  // Inclusive bound (:1195 `i <= subsetCount`): the DEFAULT subset plus every variant subset.
  for (let i = 0; i <= header.subsetCount; i++) {
    offsets.push(STARTING_OFFSET + i * entrySize + subOffset);
  }
  return offsets;
}

/** Port of Imc.GetEntries (Imc.cs:189-238) over the offsets above: six raw bytes per entry,
 *  skipping any that would run past the end of the file (:217). */
export function readImcEntries(data: Uint8Array, slot: string | null): number[][] {
  if (data.byteLength < STARTING_OFFSET) {
    throw new Error(
      `imc: file too short for header (${data.byteLength} bytes)`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const header = {
    subsetCount: view.getInt16(0, true),
    identifier: view.getInt16(2, true),
  };
  const entries: number[][] = [];
  for (const offset of imcEntryOffsets(header, slot)) {
    // Imc.cs:217 — `if (offset > imcByteData.Length - entrySize) continue;`. On a well-formed
    // file the margin is exactly zero and this never fires (spec §3.4.2); it exists so a
    // truncated file yields a SHORT list, as TexTools does, rather than an out-of-bounds read.
    if (offset > data.byteLength - ENTRY_SIZE) continue;
    entries.push(Array.from(data.subarray(offset, offset + ENTRY_SIZE)));
  }
  return entries;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/scripts/imc-entries.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Check and commit**

```bash
npm run check
npm run typecheck
git add scripts/lib/imc-entries.ts test/scripts/imc-entries.test.ts
git commit -m "feat(meta): port the IMC entry reader TexTools actually executes"
```

---

### Task 2: Re-key the table and its consumer

**Files:**
- Modify: `scripts/extract-meta-reference.ts` (replace `parseImcFile`/`imcSlotColumn`/`IMC_SLOT_OFFSET` and the enumeration + serialization around them)
- Modify: `src/meta/reference/imc-table.ts` (regenerated — do not hand-edit)
- Modify: `src/meta/reconstruct.ts:148-187`
- Test: `test/meta/reconstruct-imc.test.ts` (create)

**Interfaces:**
- Consumes: `rawImcFilePath`, `readImcEntries`, `ImcRootInfo` from Task 1; `GameIndex` from `scripts/lib/game-index.ts`.
- Produces: `IMC_TABLE: Record<string, number[][]>` keyed on the **lowercased `.meta` root path**, with `[]` for a root whose `.imc` is absent or `ImcType.Unknown`.

This task changes the table's key format and its only consumer together, because either alone leaves the tree red.

- [ ] **Step 1: Write the failing consumer tests**

Create `test/meta/reconstruct-imc.test.ts`. It exercises `reconstructMeta`'s three lookup outcomes (spec §3.2) against real keys in the regenerated table.

```ts
import { describe, expect, it } from "vitest";
import { reconstructMeta } from "../../src/meta/reconstruct";
import { IMC_TABLE } from "../../src/meta/reference/imc-table";
import type { ItemMeta } from "../../src/meta/types";

function metaWithImc(path: string, imc: Uint8Array[]): ItemMeta {
  return {
    version: 2,
    path,
    imc,
    eqp: null,
    eqdp: null,
    est: null,
    gmp: null,
  };
}

const WEAPON = "chara/weapon/w2021/obj/body/b0001/w2021b0001.meta";

describe("reconstructMeta IMC seeding (spec §3.2)", () => {
  it("keys the table on the .meta gamePath", () => {
    expect(IMC_TABLE[WEAPON]).toBeDefined();
  });

  // The case the backlog item was filed for: a weapon .meta with a SHORT imc must grow to the
  // base file's entry count, not pass through. ItemMetadata.cs:238-241.
  it("grows a short weapon IMC to the base entry count", () => {
    const base = IMC_TABLE[WEAPON]!;
    expect(base.length).toBeGreaterThan(1); // fixture precondition
    const mod = [new Uint8Array([9, 9, 9, 9, 9, 9])];
    const out = reconstructMeta(metaWithImc(WEAPON, mod), WEAPON);
    expect(out.imc).toHaveLength(base.length);
    expect(Array.from(out.imc![0]!)).toEqual([9, 9, 9, 9, 9, 9]); // mod wins where both exist
    expect(Array.from(out.imc![1]!)).toEqual(base[1]); // base fills the tail
  });

  it("leaves a mod IMC longer than the base untouched", () => {
    const long = Array.from(
      { length: 20 },
      (_, i) => new Uint8Array([i, 0, 0, 0, 0, 0]),
    );
    const out = reconstructMeta(metaWithImc(WEAPON, long), WEAPON);
    expect(out.imc).toHaveLength(20);
  });

  it("matches a key case-insensitively", () => {
    const upper = WEAPON.toUpperCase();
    // parseMetaRoot is case-sensitive on the path shape, so use the real path with only the
    // lookup exercised: an all-lowercase key must be found from a mixed-case gamePath.
    expect(IMC_TABLE[upper.toLowerCase()]).toBeDefined();
  });

  // Spec §3.2 row 3: a root the table has no data for cannot be seeded faithfully.
  it("throws on a root absent from the table", () => {
    const unknown = "chara/weapon/w9999/obj/body/b0001/w9999b0001.meta";
    expect(() =>
      reconstructMeta(
        metaWithImc(unknown, [new Uint8Array(6)]),
        unknown,
      ),
    ).toThrow(/no IMC_TABLE entry/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/meta/reconstruct-imc.test.ts`
Expected: FAIL — `IMC_TABLE[WEAPON]` is `undefined` (the table is still keyed `itemType/primaryId/slot` and has no weapon rows at all).

- [ ] **Step 3: Rewrite the extractor's IMC half**

In `scripts/extract-meta-reference.ts`:

1. Delete `IMC_SLOT_OFFSET`, `IMC_TYPE_SET`, `IMC_ENTRY_SIZE`, `IMC_SLOTS_PER_SUBSET`, `ParsedImc`, `parseImcFile`, `imcSlotColumn`, `ImcItemType`, `ImcItemRef`, `imcItems`, and `imcGamePath` (lines ~254-350 and ~357-421). They are replaced wholesale by Task 1's module.
2. Add `import { GameIndex } from "./lib/game-index";` and `import { type ImcRootInfo, rawImcFilePath, readImcEntries } from "./lib/imc-entries";`.
3. Add a `SQPACK` constant alongside the existing `CONSOLE_TOOLS_EXE`, matching the one in `scripts/extract-hair-materials.ts:27`.
4. Replace the enumeration query and the loop that follows it:

```ts
// Exhaustive enumeration from the framework's item_sets.db `roots` table over every primary type
// Imc.UsesImc accepts (Imc.cs · UsesImc · 74-85): equipment, accessory, weapon, monster, demihuman.
// `root_path` is stored verbatim as the .meta gamePath, which is the table key (spec §3.2).
interface ImcRootRow extends ImcRootInfo {
  rootPath: string;
}
const rootsDb = new DatabaseSync(ITEM_SETS_DB, { readOnly: true });
const roots = rootsDb
  .prepare(
    "SELECT primary_type AS primaryType, primary_id AS primaryId, " +
      "secondary_type AS secondaryType, secondary_id AS secondaryId, " +
      "slot, root_path AS rootPath FROM roots " +
      "WHERE primary_type IN ('equipment', 'accessory', 'weapon', 'monster', 'demihuman')",
  )
  .all() as unknown as ImcRootRow[];
rootsDb.close();

// One .imc serves many roots (every slot of an equipment set; every slot of a demihuman set), so
// extract per distinct PATH and fan the result back out to each root that reads it.
const pathOf = new Map<string, string>(); // rootPath -> .imc gamePath
for (const r of roots) pathOf.set(r.rootPath, rawImcFilePath(r));

// The game index is the existence oracle (AGENTS.md): a path absent here is a file the game
// genuinely does not have, which TexTools seeds as NOTHING (ItemMetadata.cs:236,243-246). Recording
// those as an explicit [] is what lets a table MISS mean "we have no data" and throw. Pre-filtering
// here also keeps us from spawning ConsoleTools for files that cannot be extracted.
const gameIndex = GameIndex.load(SQPACK);
const distinctPaths = [...new Set(pathOf.values())];
const presentPaths = distinctPaths.filter((p) => gameIndex.fileExists(p));
console.log(
  `\nIMC: ${roots.length} roots across ${distinctPaths.length} distinct .imc files; ` +
    `${presentPaths.length} present in game, ${distinctPaths.length - presentPaths.length} absent ` +
    "(recorded as [])",
);
```

5. Replace the extraction pool so it iterates `presentPaths` and keys `extractedBytes` on the `.imc` path itself:

```ts
const CONCURRENCY = 8;
const extractedBytes = new Map<string, Uint8Array>(); // .imc gamePath -> bytes
let cursor = 0;
async function extractWorker(wid: number): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), `imc-w${wid}-`));
  const dest = join(dir, "file.imc");
  while (true) {
    const i = cursor++;
    if (i >= presentPaths.length) break;
    const imcPath = presentPaths[i]!;
    try {
      await extractGameFileAsync(imcPath, dest);
      extractedBytes.set(imcPath, new Uint8Array(readFileSync(dest)));
    } catch {
      // Left unset; the table-building loop below fails loud, because the index said this
      // path exists and a failed extract of an existing file is not a faithful state.
    }
    if ((i + 1) % 200 === 0)
      console.log(`  ...extracted ${i + 1}/${presentPaths.length}`);
  }
}
await Promise.all(
  Array.from({ length: CONCURRENCY }, (_, w) => extractWorker(w)),
);
```

Then replace the table-building loop:

```ts
const imcTable: Record<string, number[][]> = {};
let imcParseFailed = false;
for (const r of roots) {
  const imcPath = pathOf.get(r.rootPath)!;
  const key = r.rootPath.toLowerCase();
  const bytes = extractedBytes.get(imcPath);
  if (!bytes) {
    // Absent from the game index, or the extract failed. Absent is a real, faithful state (see
    // above); a failed extract of a path the index says EXISTS is not, so fail loud on it.
    if (gameIndex.fileExists(imcPath)) {
      console.error(`FAILED extracting ${imcPath} (index says it exists)`);
      imcParseFailed = true;
      continue;
    }
    imcTable[key] = [];
    continue;
  }
  try {
    imcTable[key] = readImcEntries(bytes, r.slot);
  } catch (err) {
    console.error(`FAILED reading ${imcPath} for ${r.rootPath}: ${(err as Error).message}`);
    imcParseFailed = true;
  }
}
```

6. Re-key the two `VALIDATION_TARGETS` from `equipment/6137/top` / `equipment/724/top` to their root paths:

```ts
const VALIDATION_TARGETS = [
  {
    gamePath: "chara/equipment/e6137/e6137_top.meta",
    key: "chara/equipment/e6137/e6137_top.meta",
  },
  {
    gamePath: "chara/equipment/e0724/e0724_top.meta",
    key: "chara/equipment/e0724/e0724_top.meta",
  },
];
```

7. Rewrite the generated header string in the write block to describe the new provenance and scope. It must state: the three ported symbols (`GetRawImcFilePath`, `GetImcEntryPaths`, `GetEntries`), that the key is the lowercased `.meta` root path, that the value is the ordered 6-byte entries, that `[]` means the game has no `.imc` for that root, and that a MISS means the root is unknown to `item_sets.db` and is a fail-loud condition. Remove the "SCOPE: Set-only / NonSet out of scope" paragraph and its `docs/backlog/2026-07-10-nonset-imc-reference-table.md` pointer.

8. Update the file's own header comment (lines 1-25): drop the "restricted to ImcType.Set" framing, note the five types, and update the regen cost note (~8000 spawns).

- [ ] **Step 4: Regenerate the table**

Run:
```powershell
$env:NODE_OPTIONS='--experimental-sqlite'; npx tsx scripts/extract-meta-reference.ts --imc-only
```
Expected: the enumeration line reports ~13800 roots across ~8000 distinct `.imc` files with 9 absent; both `VALIDATED chara/equipment/…` lines print; `wrote …/imc-table.ts`.

**If either validation line fails, stop.** It means the re-derived equipment entries disagree with a cached ConsoleTools golden — a real porting bug in Task 1, not a fixture problem.

- [ ] **Step 5: Re-key the consumer**

In `src/meta/reconstruct.ts`, replace the IMC block (lines 148-187) with:

```ts
  let imc = mod.imc;
  if (imc) {
    // Base seed keyed on the .meta root path itself — the key IMC_TABLE is generated under
    // (item_sets.db `roots.root_path`). Lowercased at both ends so a path-case difference is a
    // hit, never a silent miss. See imc-table.ts's header for the extraction and its provenance.
    const key = gamePath.toLowerCase();
    const base = IMC_TABLE[key];
    if (base === undefined) {
      // The table is exhaustive over item_sets.db for every type Imc.UsesImc accepts, and records
      // a genuinely-absent .imc as [] (not as a miss). So a miss means a root we have no data for
      // — one added to the game after the last regen, or one item_sets.db never listed. The
      // golden's base seed (ItemMetadata.cs:238-241, reading the real .imc from the game) is
      // something we cannot reproduce, and passing the mod's IMC through could ship a
      // possibly-under-grown segment. Fail loud instead of guessing.
      throw new Error(
        `meta: ${gamePath} has no IMC_TABLE entry (unknown root, not in the item_sets.db-derived ` +
          "table; regenerate imc-table.ts or investigate — cannot faithfully reproduce the base " +
          "IMC seed, ItemMetadata.cs:238-241)",
      );
    }
    // ItemMetadata.cs:238-241 seeds ImcEntries from the base game before the PMP apply
    // (ManipulationsToMetadata's IMC handling) overwrites each variant the mod supplies, in place,
    // by index -- the base's own trailing entries (indices past the mod's own count) are left
    // untouched, i.e. the result grows to max(mod.length, base.length), with the mod's entry
    // winning wherever both exist. A base of [] (no .imc in the game) therefore passes the mod's
    // IMC through unchanged, with no special case.
    const count = Math.max(imc.length, base.length);
    const grown: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      grown.push(i < imc.length ? imc[i]! : new Uint8Array(base[i]!));
    }
    imc = grown;
  }
```

Also update the file's top-of-file comment (lines 7-15) where it describes the IMC seed, and delete the now-stale sentence about `IMC_TABLE` being Set-only.

- [ ] **Step 6: Run the consumer tests**

Run: `npx vitest run test/meta/reconstruct-imc.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Run the full suite and confirm no corpus byte moved**

Run: `npm test`
Expected: green, and `git status --short test/corpus/` reports **no** modified baseline files.

If any pack now diverges, that is the finding — investigate before proceeding. Do not re-bless.

- [ ] **Step 8: Check and commit**

```bash
npm run check
npm run typecheck
git add scripts/extract-meta-reference.ts src/meta/reference/imc-table.ts src/meta/reconstruct.ts test/meta/reconstruct-imc.test.ts
git commit -m "feat(meta): key IMC_TABLE on the root path and cover every UsesImc type"
```

---

### Task 3: Recognize demihuman roots

**Files:**
- Modify: `src/meta/root.ts:86-125`
- Test: `test/meta/root.test.ts` (create if absent; otherwise extend)

**Interfaces:**
- Consumes: `MetaRoot` from `src/meta/root.ts`.
- Produces: `parseMetaRoot` accepts `chara/demihuman/d####/obj/equipment/e####/d####e####_<slot>.meta` and returns `itemType: "demihuman"`. `MetaRoot.itemType` gains the `"demihuman"` member.

Demihuman previously threw `unrecognized root path`. Task 2 put demihuman keys in the table, so it can now be seeded; this task lets it through.

- [ ] **Step 1: Write the failing test**

Add to `test/meta/root.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseMetaRoot } from "../../src/meta/root";

describe("parseMetaRoot demihuman", () => {
  it("parses a demihuman equipment root", () => {
    const root = parseMetaRoot(
      "chara/demihuman/d1001/obj/equipment/e0001/d1001e0001_top.meta",
    );
    expect(root).toEqual({
      primaryId: 1001,
      slot: "top",
      itemType: "demihuman",
      // Est.GetEstType (Est.cs:91-94): anything that is not human or equipment -> Invalid.
      estType: null,
      race: null,
    });
  });

  it("still throws on a genuinely unrecognized root", () => {
    expect(() => parseMetaRoot("chara/human/c0101/obj/body/b0001/c0101b0001.meta")).toThrow(
      /unrecognized root path/,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/meta/root.test.ts`
Expected: FAIL — `meta: unrecognized root path chara/demihuman/…`.

- [ ] **Step 3: Implement**

In `src/meta/root.ts`, widen the `itemType` union on `MetaRoot` (line 16) to include `"demihuman"`, and add before the final `throw`:

```ts
  // Demihuman roots: PrimaryExtractionRegex (this file's header) matches these with
  // PrimaryType = demihuman, PrimaryId = the d#### id, SecondaryType = "equipment",
  // SecondaryId = the e#### id, and _slotRegex takes the `_xxx` filename suffix as the Slot.
  // Unlike weapon/monster these DO carry a slot, and their .imc is ImcType.Set (verified: 
  // d1001e0001.imc has TypeIdentifier 31), so the slot selects a column exactly as for equipment.
  // estType is null: Est.GetEstType (Est.cs:91-94) returns Invalid for every PrimaryType that is
  // not human or equipment.
  const demihuman = gamePath.match(
    /^chara\/demihuman\/d(\d+)\/obj\/equipment\/e\d+\/d\d+e\d+_(\w+)\.meta$/,
  );
  if (demihuman) {
    return {
      primaryId: Number.parseInt(demihuman[1]!, 10),
      slot: demihuman[2]!,
      itemType: "demihuman",
      estType: null,
      race: null,
    };
  }
```

Then rewrite the weapon/monster comment block (lines 86-99). Its final four sentences justify the placeholder `slot` on the grounds that `IMC_TABLE` is Set-only and always misses for these roots — no longer true. Replace with: the real `XivDependencyRootInfo.Slot` is unset for weapon/monster (no `_xxx` suffix, so `_slotRegex` never matches), we carry the `SecondaryType` string in its place, and `slot` no longer participates in the IMC lookup at all (the table is keyed on the root path), so it is inert for these roots.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/meta/root.test.ts`
Expected: PASS.

- [ ] **Step 5: Check, full suite, commit**

```bash
npm run check
npm run typecheck
npm test
git add src/meta/root.ts test/meta/root.test.ts
git commit -m "feat(meta): recognize demihuman meta roots"
```

---

### Task 4: Weapon synthetic pack with a ConsoleTools golden

**Files:**
- Modify: `scripts/generate-synthetics/ttmp2-builder.ts` (add a files-driven writer alongside the existing group-driven one)
- Create: `scripts/generate-synthetics/synthetic-mtrl.ts`
- Modify: `scripts/generate-synthetics/build-synthetic-absent-file-upgraded.ts` (import the shared mtrl builder instead of its local copy)
- Create: `scripts/generate-synthetics/build-synthetic-imc-weapon.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`

**Interfaces:**
- Consumes: `serializeMeta` (`src/meta/serialize.ts`), `encodeSqPackFile`/`SqPackType` (`src/sqpack/sqpack.ts`), `IMC_TABLE`.
- Produces:
  - `export function buildEwColorsetMtrl(texturePath: string): Uint8Array` in `synthetic-mtrl.ts`
  - `export function writeTtmp2Files(fileName: string, packName: string, files: { gamePath: string; data: Uint8Array }[]): void` in `ttmp2-builder.ts`

The existing `writeTtmp2Pack` is hardcoded to one dummy payload at one dummy gamePath, so it cannot express this fixture. Add a sibling rather than reshaping it — the selection-type packs depend on its exact `.mpl` key order and group shape.

- [ ] **Step 1: Extract the shared EW-colorset mtrl builder**

Move `buildMtrlWithNormalPath` verbatim out of `build-synthetic-absent-file-upgraded.ts` into a new `scripts/generate-synthetics/synthetic-mtrl.ts`, exported as `buildEwColorsetMtrl`, carrying its existing explanatory comment (the `DoesMtrlNeedDawntrailUpdate` / `EndwalkerUpgrade.cs:550` rationale). Update `build-synthetic-absent-file-upgraded.ts` to import it. Behaviour must not change.

Run: `npm run synthetics && npm test`
Expected: green, and `git status --short test/corpus/` shows no baseline change — the rebuilt `absent-file-upgraded.pmp` must be byte-identical, so its cached golden still keys.

- [ ] **Step 2: Add the files-driven TTMP2 writer**

Append to `scripts/generate-synthetics/ttmp2-builder.ts`:

```ts
/** Writes a one-page, one-group, one-option wizard .ttmp2 carrying arbitrary payloads, for
 *  fixtures whose point is the FILE CONTENT rather than the group structure writeTtmp2Pack
 *  exercises. Each file's bytes are SQPACK-compressed into the .mpd and pointed at by its own
 *  ModsJson (TTMP.cs:378/:488). Same pinned mtime and key order as writeTtmp2Pack, and for the
 *  same reasons — see this file's header. */
export function writeTtmp2Files(
  fileName: string,
  packName: string,
  files: { gamePath: string; data: Uint8Array }[],
): void {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const modsJsons = files.map((f) => {
    const blob = encodeSqPackFile(f.data, SqPackType.Standard);
    const entry = {
      Name: "Dummy",
      Category: "Unknown",
      FullPath: f.gamePath,
      ModOffset: offset,
      ModSize: blob.length,
      DatFile: "040000",
      IsDefault: false,
    };
    chunks.push(blob);
    offset += blob.length;
    return entry;
  });
  const mpd = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) {
    mpd.set(c, o);
    o += c.length;
  }
  const mpl = {
    TTMPVersion: "2.1w",
    Name: packName,
    Author: "synthetic",
    Version: "1.0.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    ModPackPages: [
      {
        PageIndex: 0,
        ModGroups: [
          {
            GroupName: "Main",
            OptionList: [
              {
                Name: "On",
                Description: "",
                ImagePath: "",
                GroupName: "Main",
                IsChecked: false,
                ModsJsons: modsJsons,
              },
            ],
          },
        ],
      },
    ],
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, fileName);
  writeFileSync(
    out,
    zipSync(
      {
        "TTMPL.mpl": new TextEncoder().encode(JSON.stringify(mpl)),
        "TTMPD.mpd": mpd,
      },
      { mtime: FIXED_MTIME },
    ),
  );
  console.log("wrote", out);
}
```

- [ ] **Step 3: Write the weapon builder**

Create `scripts/generate-synthetics/build-synthetic-imc-weapon.ts`:

```ts
// Builds test/corpus/synthetic/imc-weapon.ttmp2: a weapon .meta whose IMC segment is DELIBERATELY
// SHORT — one entry where the base game's chara/weapon/w2021/obj/body/b0001/b0001.imc carries two.
//
// This is the case docs/backlog/2026-07-10-nonset-imc-reference-table.md was filed for and no real
// corpus mod exercises: the load path re-materializes the .meta, base-seeding ImcEntries from the
// game (ItemMetadata.cs:238-241) so the segment GROWS to the base entry count, with the mod's own
// entry winning at index 0. Before the IMC table covered weapon roots, ours passed the short segment
// straight through — silently, with no throw and nothing to catch it. This pack is the golden that
// catches it.
//
// The .mtrl is not incidental. /upgrade writes a pack only `if (data.AnyChanges)`
// (ModpackUpgrader.cs:216), and .meta reconstruction is a LOAD/WRITE behaviour, not a transform
// round — a meta-only pack no-ops, ConsoleTools emits nothing, and the harness would fall back to
// diffing against the untouched input, which has no oracle behind it (see
// docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md §2). The EW 256-entry
// colorset makes DoesMtrlNeedDawntrailUpdate (EndwalkerUpgrade.cs:550) fire, so the upgrade really
// writes and the .meta growth lands in a real golden.
//
// The .ttmp2 is gitignored; regenerate with `npm run synthetics`.

import { serializeMeta } from "../../src/meta/serialize";
import { buildEwColorsetMtrl } from "./synthetic-mtrl";
import { writeTtmp2Files } from "./ttmp2-builder";

const META_PATH = "chara/weapon/w2021/obj/body/b0001/w2021b0001.meta";

// One entry where the base .imc yields two (16 bytes: 4-byte header + default + 1 subset).
// Distinctive bytes so the "mod entry wins at index 0" half of the assertion is unambiguous.
const SHORT_IMC = [new Uint8Array([7, 1, 2, 0, 3, 4])];

const meta = serializeMeta({
  version: 2,
  path: META_PATH,
  imc: SHORT_IMC,
  eqp: null,
  eqdp: null,
  est: null,
  gmp: null,
});

writeTtmp2Files("imc-weapon.ttmp2", "IMC Weapon Repro", [
  { gamePath: META_PATH, data: meta },
  {
    gamePath: "chara/weapon/w2021/obj/body/b0001/material/v0001/mt_w2021b0001_a.mtrl",
    data: buildEwColorsetMtrl(
      "chara/weapon/w2021/obj/body/b0001/texture/v01_w2021b0001_n.tex",
    ),
  },
]);
```

Register it in `build-all.ts`: add `import "./build-synthetic-imc-weapon";` at the end of the list.

- [ ] **Step 4: Build the pack and run the harness**

Run:
```powershell
npm run synthetics
npm test
```
Expected: green. The first run spawns ConsoleTools to produce the golden for the new pack; a **newly added pack has no baseline and is expected to fully match**.

If it does not match, read the diff before doing anything else: either the fixture is wrong (most likely — a malformed `.meta`, or the `.mtrl` failed to trigger `AnyChanges` so the pack no-opped), or Task 1/2 has a real porting bug. Do **not** bless a baseline for it.

- [ ] **Step 5: Commit**

```bash
npm run check
npm run typecheck
git add scripts/generate-synthetics/
git commit -m "test(corpus): add the weapon IMC growth synthetic and its golden"
```

---

### Task 5: Demihuman synthetic pack

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-imc-demihuman.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`

**Interfaces:**
- Consumes: `writeTtmp2Files`, `buildEwColorsetMtrl`, `serializeMeta` — all from Task 4.
- Produces: `test/corpus/synthetic/imc-demihuman.ttmp2`.

Demihuman moved from "`parseMetaRoot` throws" to "works" in Task 3. That transition gets an oracle rather than only our own expectation, and it pins the Set-shaped slot-column selection on a non-equipment root.

- [ ] **Step 1: Write the builder**

Create `scripts/generate-synthetics/build-synthetic-imc-demihuman.ts`:

```ts
// Builds test/corpus/synthetic/imc-demihuman.ttmp2: a demihuman .meta whose IMC segment is
// DELIBERATELY SHORT — two entries where the base game's
// chara/demihuman/d1001/obj/equipment/e0001/e0001.imc yields eight for the `top` column.
//
// Why demihuman gets its own pack rather than riding on the weapon one. The backlog item this
// closes grouped demihuman with weapon/monster as "NonSet", and it is not: d1001e0001.imc has
// TypeIdentifier 31 (ImcType.Set), the same five-slot subset layout as equipment, so its entries
// are SLOT-SELECTED by a 30-byte stride (XivDependencyRoot.cs:1186-1191) rather than read
// sequentially. This pack is the only thing in the corpus that pins that combination — a
// Set-shaped, slot-selected root that is neither equipment nor accessory. Until Task 3 it did not
// even parse: parseMetaRoot threw `unrecognized root path` on it.
//
// The .mtrl is not incidental. /upgrade writes a pack only `if (data.AnyChanges)`
// (ModpackUpgrader.cs:216), and .meta reconstruction is a LOAD/WRITE behaviour, not a transform
// round — a meta-only pack no-ops, ConsoleTools emits nothing, and the harness would fall back to
// diffing against the untouched input, which has no oracle behind it (see
// docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md §2). The EW 256-entry
// colorset makes DoesMtrlNeedDawntrailUpdate (EndwalkerUpgrade.cs:550) fire, so the upgrade really
// writes and the .meta growth lands in a real golden.
//
// The .ttmp2 is gitignored; regenerate with `npm run synthetics`.

import { serializeMeta } from "../../src/meta/serialize";
import { IMC_TABLE } from "../../src/meta/reference/imc-table";
import { buildEwColorsetMtrl } from "./synthetic-mtrl";
import { writeTtmp2Files } from "./ttmp2-builder";

const META_PATH =
  "chara/demihuman/d1001/obj/equipment/e0001/d1001e0001_top.meta";

// d1001e0001.imc is ImcType.Set with subsetCount 7, so the `top` column yields 8 entries.
// Supplying two forces a grow to 8. Distinctive bytes so "the mod's entries win at 0 and 1" is
// unambiguous in the golden.
const SHORT_IMC = [
  new Uint8Array([5, 1, 0, 0, 2, 3]),
  new Uint8Array([6, 1, 0, 0, 2, 3]),
];

// A fixture that cannot fail proves nothing: if the base seed were not LONGER than SHORT_IMC, the
// pack would pass trivially via pass-through and silently stop testing growth. Assert the premise
// at build time rather than trusting it.
const base = IMC_TABLE[META_PATH];
if (base === undefined || base.length <= SHORT_IMC.length) {
  throw new Error(
    `imc-demihuman fixture is inert: IMC_TABLE["${META_PATH}"] has ` +
      `${base?.length ?? "no"} entries, needs more than ${SHORT_IMC.length}`,
  );
}

const meta = serializeMeta({
  version: 2,
  path: META_PATH,
  imc: SHORT_IMC,
  eqp: null,
  eqdp: null,
  est: null,
  gmp: null,
});

writeTtmp2Files("imc-demihuman.ttmp2", "IMC Demihuman Repro", [
  { gamePath: META_PATH, data: meta },
  {
    gamePath:
      "chara/demihuman/d1001/obj/equipment/e0001/material/v0001/mt_d1001e0001_top_a.mtrl",
    data: buildEwColorsetMtrl(
      "chara/demihuman/d1001/obj/equipment/e0001/texture/v01_d1001e0001_top_n.tex",
    ),
  },
]);
```

Register it in `build-all.ts`: add `import "./build-synthetic-imc-demihuman";` at the end of the list.

- [ ] **Step 2: Add the same inert-fixture guard to the weapon builder**

Task 4's builder has the same failure mode. Add the identical `IMC_TABLE` import and premise assertion to `build-synthetic-imc-weapon.ts`, with `META_PATH` and `SHORT_IMC` as defined there.

- [ ] **Step 3: Build and run**

Run:
```powershell
npm run synthetics
npm test
```
Expected: green, new pack fully matches its golden with no baseline.

- [ ] **Step 4: Commit**

```bash
npm run check
npm run typecheck
git add scripts/generate-synthetics/
git commit -m "test(corpus): add the demihuman IMC growth synthetic and its golden"
```

---

### Task 6: Register the bug, retire the backlog item

**Files:**
- Modify: `docs/TEXTOOLS_BUGS.md`
- Delete: `docs/backlog/2026-07-10-nonset-imc-reference-table.md`
- Modify: `docs/BACKLOG.md`
- Modify: `docs/superpowers/specs/2026-07-19-imc-reference-table-unification-design.md` (status line)
- Modify: any file still citing the deleted backlog item

**Interfaces:** none — documentation only.

- [ ] **Step 1: Register the `GetFullImcInfo` NonSet defect**

Add an entry to `docs/TEXTOOLS_BUGS.md` following the file's existing entry format. Content: `Imc.GetFullImcInfo`'s `ImcType.NonSet` branch builds the **default subset** entry with `Vfx = variant` (`Imc.cs:384`) where it reads the entry's own `vfx` byte for every variant subset (`:401`) and for both subsets of the `Set` branch. The default entry's Vfx is therefore silently the material-set byte.

State explicitly that **we do not reproduce it**: the `.meta` base seed runs through `GetEntries` (`ItemMetadata.cs:238-241` → `GetImcEntryPaths` → `Imc.cs:216-233`), which reads six raw bytes and never constructs an `XivImc` this way. It is registered as an upstream defect we observed while porting, not one we knowingly reproduce.

Note the spec §3.4.2 finding in the same entry or adjacent to it — that the `GetEntries` EOF guard's margin is exactly zero on a well-formed `.imc` of either type, so it never fires there — so a future reader does not re-litigate it as a bug.

- [ ] **Step 2: Sweep every citation of the backlog item**

Run: `git grep -n "2026-07-10-nonset-imc-reference-table"`
Expected before the sweep: hits in `docs/BACKLOG.md`, and any surviving hits in `scripts/extract-meta-reference.ts`, `src/meta/root.ts`, `src/meta/reconstruct.ts`, `src/meta/reference/imc-table.ts` (Tasks 2 and 3 should already have removed those — this catches what they missed).

Remove every one. Per the backlog's own rule, a citation pointing at a deleted item is a dangling pointer and must die in the same change.

- [ ] **Step 3: Delete the item and its index entry**

```powershell
Remove-Item docs/backlog/2026-07-10-nonset-imc-reference-table.md
```

In `docs/BACKLOG.md`, delete numbered item 1 in **Prioritized** and renumber 2-4 to 1-3. Update the section's preamble if it references the count.

- [ ] **Step 4: Update the spec status line**

Change the spec's status line to `**implemented.**` with the date, following the convention in `2026-07-18-pmp-fileswap-preservation-design.md:3-5`.

- [ ] **Step 5: Verify nothing dangles and commit**

Run: `git grep -n "2026-07-10-nonset-imc-reference-table"`
Expected: no output.

```bash
npm run check
npm test
git add docs/
git commit -m "docs: register the GetFullImcInfo NonSet defect, retire the IMC backlog item"
```

---

## Final gate

- [ ] `npm run check` — green
- [ ] `npm run typecheck` — green
- [ ] `npm test` — green
- [ ] `git status --short test/corpus/` — no modified baselines (spec §4.1)
- [ ] `git grep -n "2026-07-10-nonset-imc-reference-table"` — no output
- [ ] Delete this plan file before opening the PR (AGENTS.md: plans are committed when written, deleted on the branch before the PR)
