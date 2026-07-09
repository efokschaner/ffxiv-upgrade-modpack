# Skin-Reference Fixup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reachable `fixUpSkinReferences` no-op with a faithful port of TexTools'
`ModelModifiers.FixUpSkinReferences` (+ `XivRaceTree.GetSkinRace` and the `hairFix` branch), so
cross-race skin/hair material references are rewritten byte-identically to the ConsoleTools golden.

**Architecture:** `getSkinRace` is resolved from a committed static `race → skin-race` table
generated **offline** by a new `human.pbd` extractor (no runtime game-data access). The `hairFix`
branch is a minimal faithful projection of `XivDependencyRootInfo` / `ExtractRootInfoFilenameOnly`
/ `GetHairMaterialRoot`. `fixUpSkinReferences` wires these together and is already called from
`from-raw.ts`. Correctness is proven by two authored legacy-TTMP synthetics run through the
`/upgrade` golden harness, plus unit tests for every branch.

**Tech Stack:** TypeScript (ESM), Biome, the repo's custom parallel test runner (`npm test`),
ConsoleTools (golden oracle, via `test/helpers/oracle.ts`).

## Global Constraints

- **Byte-parity is correctness.** Output must be byte-identical to ConsoleTools `/upgrade` except
  documented divergences; reproduce C# quirks, do not "fix" them.
- **Every business-logic line cites its C# source** as `file · symbol · lines` in a header/comment.
- **Split, don't blend:** each new module maps to ONE C# owner; do not merge logic from different
  C# files/symbols into one module.
- **Fail loud:** on any structure/path the port does not reproduce faithfully, throw.
- **`reference/` is read-only.** Never edit it.
- **Formatting is mechanical:** run `npm run check` (Biome) — never hand-format.
- **End-of-task gate (required, all green):** `npm run check`, `npm run typecheck`, `npm test`.
- **No per-file license headers.** Upstream-origin comment only.
- **Spec:** `docs/superpowers/specs/2026-07-08-skin-reference-fixup-design.md` (authoritative).

---

### Task 1: Minimal `XivItemType` + system-prefix maps

**Files:**
- Create: `src/items/item-type.ts`
- Test: `src/items/item-type.test.ts`

**Interfaces:**
- Produces: `enum XivItemType`; `fromSystemPrefix(ch: string): XivItemType`;
  `getSystemPrefix(t: XivItemType): string`.

Port of `Items/Enums/XivItemType.cs` (`enum XivItemType :30-51`, `GetSystemPrefix :318-333`,
`FromSystemPrefix :340-345`, the static prefix dict `:285-311`). The C# builds the prefix map by
reflection off `[Description(...)]`; we bake the resulting maps directly (documented).

- [ ] **Step 1: Write the failing test**

```ts
// src/items/item-type.test.ts
import { describe, expect, it } from "vitest";
import { fromSystemPrefix, getSystemPrefix, XivItemType } from "./item-type";

describe("item-type", () => {
  it("maps the human prefix quirk 'c' <-> human", () => {
    expect(fromSystemPrefix("c")).toBe(XivItemType.human);
    expect(getSystemPrefix(XivItemType.human)).toBe("c");
  });
  it("maps hair and body via first-letter of the system name", () => {
    expect(fromSystemPrefix("h")).toBe(XivItemType.hair);
    expect(getSystemPrefix(XivItemType.hair)).toBe("h");
    expect(getSystemPrefix(XivItemType.body)).toBe("b");
  });
  it("returns unknown for an unmapped prefix", () => {
    expect(fromSystemPrefix("q")).toBe(XivItemType.unknown);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/items/item-type.test.ts`
Expected: FAIL — cannot find module `./item-type`.

- [ ] **Step 3: Write the implementation**

```ts
// src/items/item-type.ts
// Ported from xivModdingFramework Items/Enums/XivItemType.cs: the XivItemType enum (:30-51),
// GetSystemPrefix (:318-333), FromSystemPrefix (:340-345). The C# builds systemPrefixToTypeDict /
// typeToSystemNameDict by reflecting over [Description(...)] (:285-311); we bake the resulting maps
// directly. Only the members/maps the hair-material-root path needs are exercised, but the full
// enum + prefix maps are ported for faithfulness (split, don't blend).

export enum XivItemType {
  unknown = "unknown",
  none = "none",
  weapon = "weapon",
  equipment = "equipment",
  accessory = "accessory",
  monster = "monster",
  demihuman = "demihuman",
  body = "body",
  hair = "hair",
  tail = "tail",
  ear = "ear",
  face = "face",
  human = "human",
  decal = "decal",
  ui = "ui",
  indoor = "indoor",
  outdoor = "outdoor",
  painting = "painting",
  fish = "fish",
}

// [Description(...)] system names (XivItemType.cs:32-50). "" = no system name (unknown/none/decal/ui).
const SYSTEM_NAME: Record<XivItemType, string> = {
  [XivItemType.unknown]: "",
  [XivItemType.none]: "",
  [XivItemType.weapon]: "weapon",
  [XivItemType.equipment]: "equipment",
  [XivItemType.accessory]: "accessory",
  [XivItemType.monster]: "monster",
  [XivItemType.demihuman]: "demihuman",
  [XivItemType.body]: "body",
  [XivItemType.hair]: "hair",
  [XivItemType.tail]: "tail",
  [XivItemType.ear]: "zear", // note: 'z' prefix (XivItemType.cs:42)
  [XivItemType.face]: "face",
  [XivItemType.human]: "human",
  [XivItemType.decal]: "",
  [XivItemType.ui]: "",
  [XivItemType.indoor]: "indoor",
  [XivItemType.outdoor]: "outdoor",
  [XivItemType.painting]: "pic",
  [XivItemType.fish]: "gyo",
};

/** GetSystemPrefix (XivItemType.cs:318-333): human is the hard-coded 'c'; otherwise the first
 *  letter of the system name. */
export function getSystemPrefix(t: XivItemType): string {
  if (t === XivItemType.human) return "c";
  const name = SYSTEM_NAME[t];
  return name.length > 0 ? name[0]! : "";
}

// systemPrefixToTypeDict (XivItemType.cs:285-311): first letter -> type, human forced to 'c'.
const PREFIX_TO_TYPE: Record<string, XivItemType> = (() => {
  const m: Record<string, XivItemType> = {};
  for (const t of Object.values(XivItemType)) {
    const name = SYSTEM_NAME[t as XivItemType];
    if (name.length === 0) continue;
    const key = name === "human" ? "c" : name[0]!;
    if (!(key in m)) m[key] = t as XivItemType; // first writer wins (enum declaration order)
  }
  return m;
})();

/** FromSystemPrefix (XivItemType.cs:340-345): unmapped -> unknown. */
export function fromSystemPrefix(ch: string): XivItemType {
  return PREFIX_TO_TYPE[ch] ?? XivItemType.unknown;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/items/item-type.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: `npm run check` then commit**

```powershell
npm run check
git add src/items/item-type.ts src/items/item-type.test.ts
git commit -m "feat(items): port minimal XivItemType + system-prefix maps"
```

---

### Task 2: `XivRace` enum + race-code helpers

**Files:**
- Create: `src/general/xiv-race.ts`
- Test: `src/general/xiv-race.test.ts`

**Interfaces:**
- Produces: `enum XivRace`; `getRaceCode(r: XivRace): string`; `getXivRace(code: string): XivRace`.

Port of `General/Enums/XivRace.cs`: the `XivRace` enum (`:78-123`), `GetRaceCode :515-519`
(returns the `[Description]` 4-digit code), `GetXivRace(string) :866-871` (FirstOrDefault by code,
default `All_Races`).

- [ ] **Step 1: Write the failing test**

```ts
// src/general/xiv-race.test.ts
import { describe, expect, it } from "vitest";
import { getRaceCode, getXivRace, XivRace } from "./xiv-race";

describe("xiv-race", () => {
  it("getRaceCode returns the zero-padded 4-digit code", () => {
    expect(getRaceCode(XivRace.Hyur_Midlander_Male)).toBe("0101");
    expect(getRaceCode(XivRace.Elezen_Female)).toBe("0601");
    expect(getRaceCode(XivRace.NPC_Male)).toBe("9104");
  });
  it("getXivRace maps a 4-digit code back to the race", () => {
    expect(getXivRace("0601")).toBe(XivRace.Elezen_Female);
    expect(getXivRace("1401")).toBe(XivRace.AuRa_Female);
  });
  it("getXivRace returns All_Races for an unknown code (FirstOrDefault default)", () => {
    expect(getXivRace("2001")).toBe(XivRace.All_Races);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/general/xiv-race.test.ts`
Expected: FAIL — cannot find module `./xiv-race`.

- [ ] **Step 3: Write the implementation**

```ts
// src/general/xiv-race.ts
// Ported from xivModdingFramework General/Enums/XivRace.cs: the XivRace enum (:78-123), GetRaceCode
// (XivRaces.GetRaceCode :515-519 -> the [Description] 4-digit code), GetXivRace(string) (:866-871).
// The C# GetRaceCode reads a [Description] attribute; for every real race that equals the enum value
// zero-padded to 4 digits, so we compute it. (All_Races/Monster/DemiHuman share Description "0000"
// in C#; those never flow through skin/hair paths — codes here are always real chara race codes.)

export enum XivRace {
  All_Races = 0,
  Hyur_Midlander_Male = 101,
  Hyur_Midlander_Male_NPC = 104,
  Hyur_Midlander_Female = 201,
  Hyur_Midlander_Female_NPC = 204,
  Hyur_Highlander_Male = 301,
  Hyur_Highlander_Male_NPC = 304,
  Hyur_Highlander_Female = 401,
  Hyur_Highlander_Female_NPC = 404,
  Elezen_Male = 501,
  Elezen_Male_NPC = 504,
  Elezen_Female = 601,
  Elezen_Female_NPC = 604,
  Miqote_Male = 701,
  Miqote_Male_NPC = 704,
  Miqote_Female = 801,
  Miqote_Female_NPC = 804,
  Roegadyn_Male = 901,
  Roegadyn_Male_NPC = 904,
  Roegadyn_Female = 1001,
  Roegadyn_Female_NPC = 1004,
  Lalafell_Male = 1101,
  Lalafell_Male_NPC = 1104,
  Lalafell_Female = 1201,
  Lalafell_Female_NPC = 1204,
  AuRa_Male = 1301,
  AuRa_Male_NPC = 1304,
  AuRa_Female = 1401,
  AuRa_Female_NPC = 1404,
  Hrothgar_Male = 1501,
  Hrothgar_Male_NPC = 1504,
  Hrothgar_Female = 1601,
  Hrothgar_Female_NPC = 1604,
  Viera_Male = 1701,
  Viera_Male_NPC = 1704,
  Viera_Female = 1801,
  Viera_Female_NPC = 1804,
  NPC_Male = 9104,
  NPC_Female = 9204,
}

const REAL_RACE_CODES = new Set<number>(
  Object.values(XivRace).filter((v): v is number => typeof v === "number" && v !== 0),
);

/** GetRaceCode (XivRace.cs:515-519): the [Description] code = the enum value zero-padded to 4. */
export function getRaceCode(r: XivRace): string {
  return String(r).padStart(4, "0");
}

/** GetXivRace(string) (XivRace.cs:866-871): FirstOrDefault by code; unknown -> All_Races (default). */
export function getXivRace(code: string): XivRace {
  const n = Number.parseInt(code, 10);
  return REAL_RACE_CODES.has(n) ? (n as XivRace) : XivRace.All_Races;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/general/xiv-race.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: `npm run check` then commit**

```powershell
npm run check
git add src/general/xiv-race.ts src/general/xiv-race.test.ts
git commit -m "feat(general): port XivRace enum + race-code helpers"
```

---

### Task 3: Offline `human.pbd` extractor → generated race→skin-race table

**Files:**
- Create: `scripts/extract-race-tree.ts`
- Create (generated by running the script): `src/general/reference/race-skin-table.ts`

**Interfaces:**
- Produces: `export const RACE_TO_SKIN_RACE: Record<number, number>` (race code → skin-race code).

Port (offline only) of `PDB.GetBoneDeformSets` (`Models/FileTypes/PDB.cs:68-133`, headers + tree
edges ONLY — no bone matrices), `XivRaceTree.BuildRaceTree`/`AddChildren`/`MakeNode`
(`XivRace.cs:136-203`), the `SkinRaces` set (`:165-183`), and `GetSkinRace` (`:353-381`). Uses the
existing `extractGameFile()` (`test/helpers/oracle.ts:157`). This runs on a machine with the game +
ConsoleTools (the maintainer's — same constraint as `extract-index-overrides.ts`).

- [ ] **Step 1: Write the extractor script**

```ts
// scripts/extract-race-tree.ts
// Generates src/general/reference/race-skin-table.ts.
//
// GetSkinRace (XivRace.cs:353-381) resolves a race to its nearest skin-bearing ancestor using the
// race tree, whose PARENT edges come from the base-game file chara/xls/bonedeformer/human.pbd
// (PDB.GetBoneDeformSets, PDB.cs:68-133; BuildRaceTree, XivRace.cs:136-203). That file is a
// per-patch constant, so we resolve every tree-member race OFFLINE here and commit the flat map;
// the runtime never reads game data. Regenerate via `npx tsx scripts/extract-race-tree.ts`.
//
// We parse ONLY the set headers + tree entries (parent edges). The bone name/matrix payload at
// DataOffset (PDB.cs:135-188) is irrelevant to GetSkinRace and is not read.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// oracle.ts reads __dirname at module scope (Vite-only global); shim it before importing, exactly as
// scripts/extract-index-overrides.ts does.
(globalThis as unknown as { __dirname: string }).__dirname = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "helpers",
);
const { extractGameFile } = await import("../test/helpers/oracle");

// SkinRaces HashSet (XivRace.cs:165-183) -> HasSkin. Codes are XivRace enum values.
const SKIN_RACES = new Set<number>([
  101, 201, 1301, 1401, 1501, 1601, 301, 401, 1701, 1801, 901, 1101, 104, 804, 1304, 1404,
]);
const ROOT = 101; // Hyur_Midlander_Male (BuildRaceTree root, XivRace.cs:141)
const ALL_RACES = 0;

// --- extract + parse human.pbd (headers + tree edges only) ---
const tmp = mkdtempSync(join(tmpdir(), "pbd-"));
const pbdPath = join(tmp, "human.pbd");
extractGameFile("chara/xls/bonedeformer/human.pbd", pbdPath);
const buf = readFileSync(pbdPath);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

let p = 0;
const numSets = dv.getInt32(p, true);
p += 4;

// Set headers (PDB.cs:85-103): RaceId u16, TreeIndex u16, DataOffset u32, Scale f32 (12 bytes).
const raceOfTree = new Map<number, number>(); // treeIndex -> raceId
const parentTreeOf = new Map<number, number>(); // raceId -> parentTreeIndex
const raceIds: number[] = [];
for (let i = 0; i < numSets; i++) {
  const raceId = dv.getUint16(p, true);
  const treeIndex = dv.getUint16(p + 2, true);
  p += 12;
  if (raceId === 0xffff) continue; // PDB.cs:92-95
  raceOfTree.set(treeIndex, raceId);
  raceIds.push(raceId);
}
// Tree entries (PDB.cs:106-122): ParentIndex, FirstChildIndex, NextSiblingIndex, DeformerIndex (u16 x4).
for (let treeId = 0; treeId < numSets; treeId++) {
  const parentIndex = dv.getUint16(p, true);
  p += 8;
  const owner = raceOfTree.get(treeId);
  if (owner !== undefined) parentTreeOf.set(owner, parentIndex);
}

// parent(raceId) -> parent raceId (or undefined at the root). Mirrors PDB.cs:124-133 binding.
function parentOf(raceId: number): number | undefined {
  const pt = parentTreeOf.get(raceId);
  if (pt === undefined) return undefined;
  const parentRace = raceOfTree.get(pt);
  return parentRace === raceId ? undefined : parentRace; // guard self-parent at root
}

// Tree membership = races reachable from ROOT via parent chain (BuildRaceTree/AddChildren start at
// Midlander_Male; MakeNode excludes All_Races). A race is a member iff its parent chain reaches ROOT.
function isMember(raceId: number): boolean {
  if (raceId === ALL_RACES) return false;
  let cur: number | undefined = raceId;
  const seen = new Set<number>();
  while (cur !== undefined) {
    if (cur === ROOT) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = parentOf(cur);
  }
  return false;
}

// GetSkinRace (XivRace.cs:353-381) computed over the PDB parent chain.
function skinRace(raceId: number): number {
  if (raceId === 1001) return 401; // Roegadyn_Female special case (XivRace.cs:363-366)
  let cur: number | undefined = raceId;
  if (SKIN_RACES.has(cur)) return cur;
  while ((cur = parentOf(cur!)) !== undefined) {
    if (SKIN_RACES.has(cur)) return cur;
  }
  return ROOT; // fallback (XivRace.cs:380)
}

const table: Record<number, number> = {};
for (const raceId of [...raceIds].sort((a, b) => a - b)) {
  if (!isMember(raceId)) continue;
  table[raceId] = skinRace(raceId);
}
rmSync(tmp, { recursive: true, force: true });

// --- emit ---
const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "general",
  "reference",
  "race-skin-table.ts",
);
const body = Object.entries(table)
  .map(([race, skin]) => `  ${race}: ${skin},`)
  .join("\n");
const contents =
  "// GENERATED - regenerate via `npx tsx scripts/extract-race-tree.ts`. Do not edit by hand.\n" +
  "// race code -> nearest skin-bearing ancestor race code, resolving XivRaceTree.GetSkinRace\n" +
  "// (XivRace.cs:353-381) offline over chara/xls/bonedeformer/human.pbd. Pinned to the game\n" +
  "// baseline. A race absent here is not a tree member -> getSkinRace throws (fail loud).\n" +
  "export const RACE_TO_SKIN_RACE: Record<number, number> = {\n" +
  body +
  "\n};\n";
writeFileSync(outPath, contents);
console.log(`wrote ${outPath} (${Object.keys(table).length} races)`);
```

- [ ] **Step 2: Run the extractor**

Run: `npx tsx scripts/extract-race-tree.ts`
Expected: prints `wrote .../race-skin-table.ts (N races)` with N ~40-50. Creates
`src/general/reference/race-skin-table.ts`.

- [ ] **Step 3: Sanity-check the generated table**

Open `src/general/reference/race-skin-table.ts` and confirm the playable entries match the spec
§4.4: `101:101, 201:201, 301:301, 401:401, 501:101, 601:201, 701:101, 801:201, 901:901,
1001:401, 1101:1101, 1201:1101, 1301:1301, 1401:1401, 1501:1501, 1601:1601, 1701:1701,
1801:1801`. If any playable value differs, STOP — the extractor or a code assumption is wrong;
diagnose before continuing (do not hand-edit the generated file).

- [ ] **Step 4: `npm run check` then commit**

```powershell
npm run check
git add scripts/extract-race-tree.ts src/general/reference/race-skin-table.ts
git commit -m "feat(general): offline human.pbd extractor + generated race->skin-race table"
```

---

### Task 4: `getSkinRace` (runtime table lookup + fail-loud)

**Files:**
- Create: `src/general/race-tree.ts`
- Test: `src/general/race-tree.test.ts`

**Interfaces:**
- Consumes: `RACE_TO_SKIN_RACE` (Task 3); `XivRace`, `getRaceCode` (Task 2).
- Produces: `getSkinRace(race: XivRace): XivRace`.

Port of `XivRaceTree.GetSkinRace` (`XivRace.cs:353-381`) as a memoized lookup: the walk, special
case, and fallback are baked into the table (Task 3); the runtime reproduces `GetSkinRace`'s output
and its **throw on an off-tree race** (`GetNode = _Dict[race]` throws `KeyNotFoundException`,
`XivRace.cs:314-317`; the `if (node == null)` guard at `:356` is dead — spec §4.3).

- [ ] **Step 1: Write the failing test**

```ts
// src/general/race-tree.test.ts
import { describe, expect, it } from "vitest";
import { RACE_TO_SKIN_RACE } from "./reference/race-skin-table";
import { getSkinRace } from "./race-tree";
import { XivRace } from "./xiv-race";

describe("getSkinRace", () => {
  it("returns own race for skin races and Midlander for skinless Midlander-family races", () => {
    expect(getSkinRace(XivRace.Hyur_Midlander_Female)).toBe(XivRace.Hyur_Midlander_Female);
    expect(getSkinRace(XivRace.Elezen_Female)).toBe(XivRace.Hyur_Midlander_Female);
    expect(getSkinRace(XivRace.Miqote_Male)).toBe(XivRace.Hyur_Midlander_Male);
    expect(getSkinRace(XivRace.Lalafell_Female)).toBe(XivRace.Lalafell_Male);
  });
  it("reproduces the Roegadyn_Female -> Highlander_Female special case", () => {
    expect(getSkinRace(XivRace.Roegadyn_Female)).toBe(XivRace.Hyur_Highlander_Female);
  });
  it("throws on an off-tree race (fail loud; _Dict[race] KeyNotFound)", () => {
    expect(() => getSkinRace(XivRace.All_Races)).toThrow();
  });
  it("invariant: every table target is itself a skin race (its own skin race)", () => {
    for (const skin of Object.values(RACE_TO_SKIN_RACE)) {
      expect(RACE_TO_SKIN_RACE[skin]).toBe(skin);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/general/race-tree.test.ts`
Expected: FAIL — cannot find module `./race-tree`.

- [ ] **Step 3: Write the implementation**

```ts
// src/general/race-tree.ts
// Ported from xivModdingFramework General/Enums/XivRace.cs XivRaceTree.GetSkinRace (:353-381).
// The tree walk, the Roegadyn_Female special case (:363-366), the HasSkin check, and the
// Midlander_Male fallback are all resolved offline into RACE_TO_SKIN_RACE (see the extractor,
// scripts/extract-race-tree.ts); this reproduces GetSkinRace's OUTPUT. GetNode is _Dict[race], a
// dictionary indexer that THROWS on a race absent from the tree (:314-317) -- the `node == null`
// guard at :356 is therefore dead. We mirror that: an off-tree race throws (fail loud, spec §4.3).

import { RACE_TO_SKIN_RACE } from "./reference/race-skin-table";
import { getRaceCode, XivRace } from "./xiv-race";

export function getSkinRace(race: XivRace): XivRace {
  const skin = RACE_TO_SKIN_RACE[race as number];
  if (skin === undefined) {
    throw new Error(`getSkinRace: race ${getRaceCode(race)} is not in the race tree`);
  }
  return skin as XivRace;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/general/race-tree.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: `npm run check` then commit**

```powershell
npm run check
git add src/general/race-tree.ts src/general/race-tree.test.ts
git commit -m "feat(general): port getSkinRace as a table lookup with fail-loud off-tree throw"
```

---

### Task 5: `XivDependencyRootInfo` + `isValid` / `validate` / `getBaseFileName`

**Files:**
- Create: `src/cache/dependency-root.ts`
- Test: `src/cache/dependency-root.test.ts`

**Interfaces:**
- Consumes: `XivItemType`, `getSystemPrefix` (Task 1).
- Produces: `interface XivDependencyRootInfo { primaryType; primaryId; secondaryType; secondaryId; slot }`;
  `isValid(r)`, `validate(r)`, `getBaseFileName(r, includeSlot=true)`.

Port of `Cache/XivDependencyRoot.cs`: the `XivDependencyRootInfo` fields (`:40-57`), `IsValid`
(`:101-114`), `Validate` (`:482-521`), `GetBaseFileName` (`:138-158`).

- [ ] **Step 1: Write the failing test**

```ts
// src/cache/dependency-root.test.ts
import { describe, expect, it } from "vitest";
import { XivItemType } from "../items/item-type";
import { getBaseFileName, isValid, validate, type XivDependencyRootInfo } from "./dependency-root";

const hairRoot: XivDependencyRootInfo = {
  primaryType: XivItemType.human,
  primaryId: 1401,
  secondaryType: XivItemType.hair,
  secondaryId: 170,
  slot: "hir",
};

describe("dependency-root", () => {
  it("getBaseFileName builds c####h#### with and without slot", () => {
    expect(getBaseFileName(hairRoot, true)).toBe("c1401h0170_hir");
    expect(getBaseFileName(hairRoot, false)).toBe("c1401h0170");
  });
  it("isValid is true for a human/hair root, false for unknown/human-id-0", () => {
    expect(isValid(hairRoot)).toBe(true);
    expect(isValid({ ...hairRoot, primaryType: XivItemType.unknown })).toBe(false);
    expect(isValid({ ...hairRoot, primaryId: 0 })).toBe(false);
  });
  it("validate leaves a human/hair root intact", () => {
    expect(validate(hairRoot)).toEqual(hairRoot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cache/dependency-root.test.ts`
Expected: FAIL — cannot find module `./dependency-root`.

- [ ] **Step 3: Write the implementation**

```ts
// src/cache/dependency-root.ts
// Ported from xivModdingFramework Cache/XivDependencyRoot.cs: the XivDependencyRootInfo datapoints
// (:40-57), IsValid (:101-114), Validate (:482-521), GetBaseFileName (:138-158). Only the members
// the hair-material-root path needs are ported (split, don't blend).

import { getSystemPrefix, XivItemType } from "../items/item-type";

export interface XivDependencyRootInfo {
  primaryType: XivItemType;
  primaryId: number;
  secondaryType: XivItemType | null;
  secondaryId: number | null;
  slot: string | null;
}

/** IsValid (XivDependencyRoot.cs:101-114). */
export function isValid(r: XivDependencyRootInfo): boolean {
  if (r.primaryType === XivItemType.unknown || r.primaryType === XivItemType.none) return false;
  if (r.primaryType === XivItemType.human && r.primaryId === 0) return false;
  return true;
}

/** Validate (XivDependencyRoot.cs:482-521): invert human+equipment/accessory; blank unresolvable
 *  roots. Faithful port; for human/hair (our path) it returns the root unchanged. */
export function validate(r: XivDependencyRootInfo): XivDependencyRootInfo {
  const out: XivDependencyRootInfo = { ...r };
  if (
    r.primaryType === XivItemType.human &&
    (r.secondaryType === XivItemType.equipment || r.secondaryType === XivItemType.accessory)
  ) {
    out.primaryType = r.secondaryType;
    out.primaryId = r.secondaryId!;
    out.secondaryId = null;
    out.secondaryType = null;
  }
  const blank: XivDependencyRootInfo = {
    primaryType: XivItemType.unknown,
    primaryId: 0,
    secondaryType: null,
    secondaryId: null,
    slot: null,
  };
  if (r.slot == null) {
    if (
      out.primaryType === XivItemType.equipment ||
      out.primaryType === XivItemType.accessory ||
      out.primaryType === XivItemType.demihuman
    ) {
      return blank;
    }
  }
  if (out.secondaryType == null) {
    if (
      out.primaryType !== XivItemType.equipment &&
      out.primaryType !== XivItemType.accessory &&
      out.primaryType !== XivItemType.indoor &&
      out.primaryType !== XivItemType.outdoor &&
      out.primaryType !== XivItemType.fish &&
      out.primaryType !== XivItemType.painting
    ) {
      return blank;
    }
  }
  return out;
}

/** GetBaseFileName (XivDependencyRoot.cs:138-158): e.g. c1401h0170_hir (or c1401h0170 no slot). */
export function getBaseFileName(r: XivDependencyRootInfo, includeSlot = true): string {
  const pId = String(r.primaryId).padStart(4, "0");
  const pPrefix = getSystemPrefix(r.primaryType);
  let sId = "";
  let sPrefix = "";
  if (r.secondaryType != null) {
    sId = String(r.secondaryId).padStart(4, "0");
    sPrefix = getSystemPrefix(r.secondaryType);
  }
  if (r.slot != null && includeSlot) return `${pPrefix}${pId}${sPrefix}${sId}_${r.slot}`;
  return `${pPrefix}${pId}${sPrefix}${sId}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cache/dependency-root.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: `npm run check` then commit**

```powershell
npm run check
git add src/cache/dependency-root.ts src/cache/dependency-root.test.ts
git commit -m "feat(cache): port XivDependencyRootInfo + isValid/validate/getBaseFileName"
```

---

### Task 6: `extractRootInfoFilenameOnly` + `getFileNameRootInfo`

**Files:**
- Create: `src/cache/dependency-graph.ts`
- Create: `src/cache/xiv-cache.ts`
- Test: `src/cache/dependency-graph.test.ts`

**Interfaces:**
- Consumes: `XivItemType`, `fromSystemPrefix` (Task 1); `XivDependencyRootInfo`, `validate` (Task 5).
- Produces: `extractRootInfoFilenameOnly(name: string, doValidate=true): XivDependencyRootInfo`
  (in `dependency-graph.ts`); `getFileNameRootInfo(fileName: string): XivDependencyRootInfo`
  (in `xiv-cache.ts`).

Port of `XivDependencyGraph.ExtractRootInfoFilenameOnly` (`Cache/XivDependencyGraph.cs:607-645`)
and `XivCache.GetFileNameRootInfo` (`Cache/XivCache.cs:1791-1795`). Two files because they map to
two C# owners (split, don't blend).

- [ ] **Step 1: Write the failing test**

```ts
// src/cache/dependency-graph.test.ts
import { describe, expect, it } from "vitest";
import { XivItemType } from "../items/item-type";
import { getFileNameRootInfo } from "./xiv-cache";
import { extractRootInfoFilenameOnly } from "./dependency-graph";

describe("dependency-graph", () => {
  it("parses a hair filename into a human/hair root", () => {
    expect(extractRootInfoFilenameOnly("c1401h0170_hir")).toEqual({
      primaryType: XivItemType.human,
      primaryId: 1401,
      secondaryType: XivItemType.hair,
      secondaryId: 170,
      slot: "hir",
    });
  });
  it("returns an empty root for an unmatched name", () => {
    expect(extractRootInfoFilenameOnly("not_a_root").primaryType).toBe(XivItemType.unknown);
  });
  it("getFileNameRootInfo strips folder + extension before parsing", () => {
    const r = getFileNameRootInfo("chara/human/c1401/obj/hair/h0170/model/c1401h0170_hir.mdl");
    expect(r.secondaryType).toBe(XivItemType.hair);
    expect(r.primaryId).toBe(1401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cache/dependency-graph.test.ts`
Expected: FAIL — cannot find module `./dependency-graph`.

- [ ] **Step 3: Write both implementations**

```ts
// src/cache/dependency-graph.ts
// Ported from xivModdingFramework Cache/XivDependencyGraph.cs ExtractRootInfoFilenameOnly (:607-645):
// regex-parses a bare filename (no extension) into a XivDependencyRootInfo, mapping prefixes via
// XivItemTypes.FromSystemPrefix and (by default) running Validate.

import { fromSystemPrefix, XivItemType } from "../items/item-type";
import { validate, type XivDependencyRootInfo } from "./dependency-root";

const ROOT_REGEX = /([a-z])([0-9]{4})([a-z])([0-9]{4})_?([a-z]{3})?/;

function emptyRoot(): XivDependencyRootInfo {
  return {
    primaryType: XivItemType.unknown,
    primaryId: 0,
    secondaryType: null,
    secondaryId: null,
    slot: null,
  };
}

export function extractRootInfoFilenameOnly(
  filenameWithoutExtension: string,
  doValidate = true,
): XivDependencyRootInfo {
  if (!filenameWithoutExtension) return emptyRoot();
  const m = ROOT_REGEX.exec(filenameWithoutExtension);
  if (!m) return emptyRoot();

  // C# always assigns slot from Groups[5].Value (Count > 5 is always true); an unmatched optional
  // group yields "" there, so mirror with `?? ""` rather than leaving it null.
  const root: XivDependencyRootInfo = {
    primaryType: fromSystemPrefix(m[1]![0]!),
    primaryId: Number.parseInt(m[2]!, 10),
    secondaryType: fromSystemPrefix(m[3]![0]!),
    secondaryId: Number.parseInt(m[4]!, 10),
    slot: m[5] ?? "",
  };
  return doValidate ? validate(root) : root;
}
```

```ts
// src/cache/xiv-cache.ts
// Ported from xivModdingFramework Cache/XivCache.cs GetFileNameRootInfo (:1791-1795):
// Path.GetFileNameWithoutExtension then XivDependencyGraph.ExtractRootInfoFilenameOnly.

import { extractRootInfoFilenameOnly } from "./dependency-graph";
import type { XivDependencyRootInfo } from "./dependency-root";

/** GetFileNameRootInfo (XivCache.cs:1791-1795). Internal paths use '/'; strip folder + extension. */
export function getFileNameRootInfo(fileName: string): XivDependencyRootInfo {
  const base = fileName.split("/").pop() ?? fileName;
  const noExt = base.replace(/\.[^.]*$/, "");
  return extractRootInfoFilenameOnly(noExt, true);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cache/dependency-graph.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: `npm run check` then commit**

```powershell
npm run check
git add src/cache/dependency-graph.ts src/cache/xiv-cache.ts src/cache/dependency-graph.test.ts
git commit -m "feat(cache): port extractRootInfoFilenameOnly + getFileNameRootInfo"
```

---

### Task 7: `getHairMaterialRoot`

**Files:**
- Create: `src/mtrl/hair-material-root.ts`
- Test: `src/mtrl/hair-material-root.test.ts`

**Interfaces:**
- Consumes: `XivItemType` (Task 1); `XivDependencyRootInfo` (Task 5).
- Produces: `getHairMaterialRoot(root: XivDependencyRootInfo): XivDependencyRootInfo`.

Port of `Materials/FileTypes/Mtrl.cs GetHairMaterialRoot` (`:1429-1485`).

- [ ] **Step 1: Write the failing test**

```ts
// src/mtrl/hair-material-root.test.ts
import { describe, expect, it } from "vitest";
import { XivItemType } from "../items/item-type";
import type { XivDependencyRootInfo } from "../cache/dependency-root";
import { getHairMaterialRoot } from "./hair-material-root";

const hair = (primaryId: number, secondaryId: number): XivDependencyRootInfo => ({
  primaryType: XivItemType.human,
  primaryId,
  secondaryType: XivItemType.hair,
  secondaryId,
  slot: "hir",
});

describe("getHairMaterialRoot", () => {
  it("throws for a non-hair root", () => {
    expect(() => getHairMaterialRoot({ ...hair(1401, 170), secondaryType: XivItemType.body })).toThrow();
  });
  it("Hrothgar (1501/1601) never shares -> returns self", () => {
    expect(getHairMaterialRoot(hair(1601, 170)).primaryId).toBe(1601);
  });
  it("racial-unique hairs (<101) return self", () => {
    expect(getHairMaterialRoot(hair(401, 3)).primaryId).toBe(401);
  });
  it("101-115 band: Miqo/Hroth keep self, others collapse to Midlander by gender", () => {
    expect(getHairMaterialRoot(hair(801, 110)).primaryId).toBe(801); // Miqo F self
    expect(getHairMaterialRoot(hair(401, 110)).primaryId).toBe(201); // Highlander F -> Midlander F
    expect(getHairMaterialRoot(hair(301, 110)).primaryId).toBe(101); // Highlander M -> Midlander M
  });
  it("116-200 band: collapse to Midlander by gender", () => {
    expect(getHairMaterialRoot(hair(401, 170)).primaryId).toBe(201); // female
    expect(getHairMaterialRoot(hair(1101, 170)).primaryId).toBe(101); // Lala M (odd) -> male
  });
  it(">=201 hairs return self", () => {
    expect(getHairMaterialRoot(hair(401, 205)).primaryId).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/mtrl/hair-material-root.test.ts`
Expected: FAIL — cannot find module `./hair-material-root`.

- [ ] **Step 3: Write the implementation**

```ts
// src/mtrl/hair-material-root.ts
// Ported from xivModdingFramework Materials/FileTypes/Mtrl.cs GetHairMaterialRoot (:1429-1485):
// resolves a hair root to the root whose hair MATERIALS it shares. isFemale = (PrimaryId/100) % 2 == 0
// (integer division), collapsing to Midlander F (201) or M (101) for the shared-hair bands.

import type { XivDependencyRootInfo } from "../cache/dependency-root";
import { XivItemType } from "../items/item-type";

export function getHairMaterialRoot(root: XivDependencyRootInfo): XivDependencyRootInfo {
  if (root.primaryType !== XivItemType.human || root.secondaryType !== XivItemType.hair) {
    throw new Error("getHairMaterialRoot: non-hair root");
  }
  if (root.primaryId === 1601 || root.primaryId === 1501) return root; // Hrothgar never share
  const secondaryId = root.secondaryId!;
  if (secondaryId < 101) return root; // racial uniques

  const isFemale = Math.floor(root.primaryId / 100) % 2 === 0;
  const collapse = (): XivDependencyRootInfo => ({
    primaryId: isFemale ? 201 : 101,
    primaryType: root.primaryType,
    secondaryType: root.secondaryType,
    secondaryId: root.secondaryId,
    slot: root.slot,
  });

  if (secondaryId < 116) {
    // 101-115: Midlander M/F, plus Miqo M/F + Hroth M/F keep their own.
    if (root.primaryId === 701 || root.primaryId === 801 || root.primaryId === 1501 || root.primaryId === 1601) {
      return root;
    }
    return collapse();
  }
  if (secondaryId < 201) return collapse(); // 116-200: just Midlander M/F
  return root; // >=201: uniques
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/mtrl/hair-material-root.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: `npm run check` then commit**

```powershell
npm run check
git add src/mtrl/hair-material-root.ts src/mtrl/hair-material-root.test.ts
git commit -m "feat(mtrl): port GetHairMaterialRoot"
```

---

### Task 8: Real `fixUpSkinReferences` (both overloads + hairFix)

**Files:**
- Modify: `src/mdl/model/model-modifiers.ts` (replace the stub at `:446-460`)
- Modify: `src/mdl/model/from-raw.ts` (comment only; the call at `:51` is unchanged)
- Test: `src/mdl/model/fix-up-skin-references.test.ts`

**Interfaces:**
- Consumes: `getSkinRace` (Task 4), `getXivRace`/`getRaceCode` (Task 2),
  `getFileNameRootInfo` (Task 6), `isValid` (Task 5), `getHairMaterialRoot` (Task 7),
  `getBaseFileName` (Task 5), `XivItemType` (Task 1); `TTModel`, `TTMeshGroup` (`tt-model.ts`).
- Produces: `fixUpSkinReferences(model: TTModel, newInternalPath: string): void` (in-place).

Port of `ModelModifiers.FixUpSkinReferences` overloads (`ModelModifiers.cs:2309-2336` +
`:2347-2399`) and `SkinMaterialRegex` (`:2298`). The `bodyReplacement != ""` branch (`:2386-2389`)
is dead on our path (`bodyReplacement` is always `""`) and is documented, not ported.

- [ ] **Step 1: Write the failing test**

```ts
// src/mdl/model/fix-up-skin-references.test.ts
import { describe, expect, it } from "vitest";
import type { TTMeshGroup, TTModel } from "./tt-model";
import { fixUpSkinReferences } from "./model-modifiers";

const grp = (material: string): TTMeshGroup => ({
  name: "g",
  meshType: 0,
  parts: [],
  material,
  bones: [],
});
const model = (source: string, ...materials: string[]): TTModel => ({
  source,
  mdlVersion: 6,
  meshGroups: materials.map(grp),
  attributes: [],
  bones: [],
  materials: [],
  shapeNames: [],
  anisotropicLighting: false,
  flags1: 0,
});

describe("fixUpSkinReferences", () => {
  it("rewrites a cross-race skin material to the model's skin race + resets body to b0001", () => {
    // Elezen F body model referencing its own-race skin material; getSkinRace(0601)=0201.
    const m = model(
      "chara/human/c0601/obj/body/b0001/model/c0601b0001_top.mdl",
      "/mt_c0601b0002_a.mtrl",
    );
    fixUpSkinReferences(m, m.source);
    expect(m.meshGroups[0]!.material).toBe("/mt_c0201b0001_a.mtrl");
  });
  it("leaves a correct child->parent skin reference untouched (already the skin race)", () => {
    // Elezen F model already referencing Midlander F skin (c0201) => no change.
    const m = model(
      "chara/human/c0601/obj/body/b0001/model/c0601b0001_top.mdl",
      "/mt_c0201b0001_a.mtrl",
    );
    fixUpSkinReferences(m, m.source);
    expect(m.meshGroups[0]!.material).toBe("/mt_c0201b0001_a.mtrl");
  });
  it("ignores non-skin materials", () => {
    const m = model(
      "chara/human/c0601/obj/body/b0001/model/c0601b0001_top.mdl",
      "chara/equipment/e0194/material/v0001/mt_c0601e0194_top_a.mtrl",
    );
    fixUpSkinReferences(m, m.source);
    expect(m.meshGroups[0]!.material).toBe(
      "chara/equipment/e0194/material/v0001/mt_c0601e0194_top_a.mtrl",
    );
  });
  it("returns early for a non-racial model path (no c#### match)", () => {
    const m = model("bgcommon/whatever/foo.mdl", "/mt_c0601b0001_a.mtrl");
    fixUpSkinReferences(m, m.source);
    expect(m.meshGroups[0]!.material).toBe("/mt_c0601b0001_a.mtrl");
  });
  it("hairFix redirects a hair model's own-race material to the shared hair root", () => {
    // c0401h0170 hair model referencing its own-race hair material -> collapses to c0201h0170.
    const m = model(
      "chara/human/c0401/obj/hair/h0170/model/c0401h0170_hir.mdl",
      "chara/human/c0401/obj/hair/h0170/material/v0001/mt_c0401h0170_hir_a.mtrl",
    );
    fixUpSkinReferences(m, m.source);
    expect(m.meshGroups[0]!.material).toBe(
      "chara/human/c0201/obj/hair/h0170/material/v0001/mt_c0201h0170_hir_a.mtrl",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/mdl/model/fix-up-skin-references.test.ts`
Expected: FAIL — the stub no-ops, so every mutation assertion fails.

- [ ] **Step 3: Replace the stub in `model-modifiers.ts`**

Replace the whole deferred stub (the doc comment + function at `src/mdl/model/model-modifiers.ts:446-460`)
with:

```ts
/** Port of ModelModifiers.FixUpSkinReferences (ModelModifiers.cs:2309-2336 -> :2347-2399): rewrites
 *  a mesh's skin-material race/body code to the model path's resolved skin race, and (for hair
 *  models) redirects hair-material references to the shared hair root. Called from fromRaw with
 *  `newInternalPath = rm.source`. The `bodyReplacement != ""` branch (:2386-2389) is dead on this
 *  path (bodyReplacement is always "") and is intentionally not ported. C#'s `if (m.Material ==
 *  null)` guard (:2372) is a no-op here (our material defaults to "", never null). */
const RACE_REGEX = /(c[0-9]{4})/;
const SKIN_MATERIAL_REGEX = /^\/mt_c([0-9]{4})b([0-9]{4})_.+\.mtrl$/;

export function fixUpSkinReferences(model: TTModel, newInternalPath: string): void {
  const newRaceMatch = RACE_REGEX.exec(newInternalPath);
  if (!newRaceMatch) return; // not in a racial folder -- nothing to fix (ModelModifiers.cs:2324-2328)
  const baseRace = getXivRace(newRaceMatch[1]!.substring(1)); // strip 'c' (ModelModifiers.cs:2333)
  fixUpSkinReferencesForRace(model, baseRace, newInternalPath);
}

function fixUpSkinReferencesForRace(
  model: TTModel,
  baseRace: XivRace,
  source: string,
): void {
  const skinRaceString = `c${getRaceCode(getSkinRace(baseRace))}`; // ModelModifiers.cs:2354-2355

  const modelRoot = getFileNameRootInfo(source); // ModelModifiers.cs:2360
  let hairFix = false;
  let oldHairBase = "";
  let newHairBase = "";
  if (isValid(modelRoot) && modelRoot.secondaryType === XivItemType.hair) {
    hairFix = true;
    const hairInfo = getHairMaterialRoot(modelRoot);
    oldHairBase = getBaseFileName(modelRoot, false);
    newHairBase = getBaseFileName(hairInfo, false);
  }

  for (const m of model.meshGroups) {
    if (SKIN_MATERIAL_REGEX.test(m.material)) {
      const mtrlMatch = RACE_REGEX.exec(m.material);
      if (mtrlMatch && mtrlMatch[1] !== skinRaceString) {
        // .Replace replaces ALL occurrences (C# string.Replace); mirror with split/join.
        m.material = m.material.split(mtrlMatch[1]!).join(skinRaceString);
        // Reset the body ID -- Regex.Replace is global, so use the /g flag. (ModelModifiers.cs:2383-2384)
        m.material = m.material.replace(/(b[0-9]{4})/g, "b0001");
      }
    }
    if (hairFix) {
      m.material = m.material.split(oldHairBase).join(newHairBase); // ModelModifiers.cs:2394
    }
  }
}
```

Add the imports at the top of `model-modifiers.ts` (keep the existing imports):

```ts
import { getFileNameRootInfo } from "../../cache/xiv-cache";
import { isValid } from "../../cache/dependency-root";
import { getBaseFileName } from "../../cache/dependency-root";
import { getSkinRace } from "../../general/race-tree";
import { getRaceCode, getXivRace, type XivRace } from "../../general/xiv-race";
import { getHairMaterialRoot } from "../../mtrl/hair-material-root";
import { XivItemType } from "../../items/item-type";
```

(Combine the two `dependency-root` imports into one line; `npm run check` will organize them.)

- [ ] **Step 4: Update the `from-raw.ts` comment**

In `src/mdl/model/from-raw.ts`, change the call-site comment at `:51` from
`fixUpSkinReferences(model, rm.source); // deferred no-op` to
`fixUpSkinReferences(model, rm.source); // skin/hair material race fixup (ModelModifiers.cs:2309)`,
and update the paragraph in the file header doc comment that calls it a "deferred no-op stub" to
describe it as the real port.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/mdl/model/fix-up-skin-references.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: `npm run check`, `npm run typecheck`, then commit**

```powershell
npm run check; npm run typecheck
git add src/mdl/model/model-modifiers.ts src/mdl/model/from-raw.ts src/mdl/model/fix-up-skin-references.test.ts
git commit -m "feat(mdl/model): port fixUpSkinReferences (skin rewrite + hairFix)"
```

---

### Task 9: Synthetic cross-race skin golden pack

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-skin.mjs`
- Output (gitignored): `test/corpus/synthetic/skin-crossrace.ttmp2`

**Interfaces:**
- Consumes (from `src/`): `encodeSqPackFile`, `SqPackType` (`src/sqpack/sqpack.ts`); `writeZip`
  (`src/zip/zip.ts`); `extractGameFile`, `decodeSqPackFile` where needed.

Builds a **legacy** TTMP (`TTMPVersion "1.3s"`, major < 2 → `needsMdlFix` fires) wrapping one racial
body model at a non-self-skin race whose skin material is its own race, so ConsoleTools `/upgrade`
rewrites it to the Midlander code + `b0001`. The harness auto-discovers packs in
`test/corpus/synthetic/` and diffs our output against the ConsoleTools golden (spec §6, fixture 2).

- [ ] **Step 1: Write the builder (extract-and-inspect approach)**

```js
// scripts/generate-synthetics/build-synthetic-skin.mjs
// Builds test/corpus/synthetic/skin-crossrace.ttmp2: a LEGACY TTMP (major<2 -> needsMdlFix) wrapping
// one base-game racial body model at a non-self-skin race (Elezen F, c0601). The model references its
// OWN-race skin material (/mt_c0601b####...), so both our fixUpSkinReferences and ConsoleTools
// /upgrade rewrite it to c0201 + b0001 (getSkinRace(0601)=0201). Exercises the skin-rewrite branch the
// single-race corpus never reaches (spec §6 fixture 2). The .ttmp2 is gitignored; regenerate with
// `node scripts/generate-synthetics/build-synthetic-skin.mjs`.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { encodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "test", "corpus", "synthetic");
const CONSOLE_TOOLS = "C:\\Program Files\\FFXIV TexTools\\FFXIV_TexTools\\ConsoleTools.exe";

// A base-game Elezen-F body model. Elezen F (c0601) is skinless -> getSkinRace = c0201.
const gamePath = "chara/human/c0601/obj/body/b0001/model/c0601b0001_top.mdl";
const tmp = mkdtempSync(join(tmpdir(), "syn-skin-"));
const decompressed = join(tmp, "model.mdl");
execFileSync(CONSOLE_TOOLS, ["/extract", gamePath, decompressed], { stdio: "pipe" });
const mdlBytes = new Uint8Array(readFileSync(decompressed));

// INSPECT: confirm the model references an own-race (c0601) skin material -> the rewrite will fire.
// If this prints only c0201 skin refs, the base-game model already uses the shared skin; switch to a
// length-preserving byte patch of the material string (see the fallback note below) before shipping.
const asText = Buffer.from(mdlBytes).toString("latin1");
const skinRefs = [...asText.matchAll(/\/mt_c[0-9]{4}b[0-9]{4}_[^\0]*?\.mtrl/g)].map((m) => m[0]);
console.log("skin material refs in model:", [...new Set(skinRefs)]);
if (!skinRefs.some((s) => s.startsWith("/mt_c0601b"))) {
  throw new Error("model does not reference an own-race (c0601) skin material; see fallback note");
}

// SqPack-compress (Type 3, Model) and lay out a legacy TTMPD.mpd + TTMPL.mpl by hand.
const entry = encodeSqPackFile(mdlBytes, SqPackType.Model);
const mpl = {
  TTMPVersion: "1.3s",
  Name: "Synthetic Cross-Race Skin",
  Author: "synthetic",
  Version: "1.0.0",
  Description: "",
  Url: "",
  MinimumFrameworkVersion: "1.3.0.0",
  SimpleModsList: [
    {
      Name: "c0601 body",
      Category: "",
      FullPath: gamePath,
      ModOffset: 0,
      ModSize: entry.length,
      DatFile: "chara",
      IsDefault: false,
    },
  ],
};
const members = {
  "TTMPL.mpl": new TextEncoder().encode(JSON.stringify(mpl)),
  "TTMPD.mpd": entry,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "skin-crossrace.ttmp2"), zipSync(members));
console.log("wrote", join(outDir, "skin-crossrace.ttmp2"));
```

> **Fallback (if the inspection throws):** if the base-game Elezen body model already references the
> shared `c0201` skin material, make the cross-race condition with a **length-preserving** byte patch
> instead — replace one `c0201` occurrence inside a `/mt_c0201b####_…mtrl` string with `c0601` (same
> length) in `mdlBytes` before compressing, keeping the model path at `c0601`. Both pipelines then
> rewrite `c0601 → c0201 + b0001` identically. Document the patch in the builder.

- [ ] **Step 2: Build the pack**

Run: `node scripts/generate-synthetics/build-synthetic-skin.mjs`
Expected: prints the model's skin refs and `wrote .../skin-crossrace.ttmp2`. If it throws on the
inspection, apply the fallback byte patch, then re-run.

- [ ] **Step 3: Run the upgrade golden for this pack**

Run: `npx vitest run test/upgrade.test.ts -t skin-crossrace`
(If the harness test id differs, run the full `npm test` and locate the `skin-crossrace` upgrade case.)
Expected: PASS — our upgraded `.mdl` is byte-identical to the ConsoleTools golden (the golden shows
the material rewritten to `/mt_c0201b0001_…`). A diff here is a real bug — fix the port, not the test.

- [ ] **Step 4: Commit the builder (not the gitignored pack)**

```powershell
npm run check
git add scripts/generate-synthetics/build-synthetic-skin.mjs
git commit -m "test(corpus): synthetic cross-race skin golden pack builder"
```

---

### Task 10: Synthetic hairFix-rewrite golden pack

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-hair.mjs`
- Output (gitignored): `test/corpus/synthetic/hair-rewrite.ttmp2`

**Interfaces:**
- Consumes: same `src/` helpers as Task 9.

Builds a **legacy** TTMP wrapping a base-game hair model at a shareable non-Midlander race
(`c0401h0170`) whose hair material is its own race, so `hairFix` rewrites it to the shared
`c0201h0170` root. Exercises the hairFix rewrite branch (spec §6, fixture 3).

- [ ] **Step 1: Write the builder**

```js
// scripts/generate-synthetics/build-synthetic-hair.mjs
// Builds test/corpus/synthetic/hair-rewrite.ttmp2: a LEGACY TTMP (major<2) wrapping one base-game
// hair model c0401h0170 (Highlander F, hair 170 in the 116-200 shared band). Its own-race hair
// material (mt_c0401h0170_...) is redirected by hairFix to the shared root c0201h0170
// (getHairMaterialRoot(c0401,170) -> c0201). Exercises the hairFix rewrite branch (spec §6 fixture 3).
// Gitignored; regenerate with `node scripts/generate-synthetics/build-synthetic-hair.mjs`.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { encodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "test", "corpus", "synthetic");
const CONSOLE_TOOLS = "C:\\Program Files\\FFXIV TexTools\\FFXIV_TexTools\\ConsoleTools.exe";

const gamePath = "chara/human/c0401/obj/hair/h0170/model/c0401h0170_hir.mdl";
const tmp = mkdtempSync(join(tmpdir(), "syn-hair-"));
const decompressed = join(tmp, "model.mdl");
execFileSync(CONSOLE_TOOLS, ["/extract", gamePath, decompressed], { stdio: "pipe" });
const mdlBytes = new Uint8Array(readFileSync(decompressed));

// INSPECT: hairFix rewrites materials that contain the model root base "c0401h0170". Confirm the
// model references it; if it references the already-shared "c0201h0170" instead, length-preserving
// byte-patch "c0201h0170" -> "c0401h0170" (same length) before compressing (documented fallback).
const asText = Buffer.from(mdlBytes).toString("latin1");
if (!asText.includes("c0401h0170")) {
  throw new Error("hair model does not reference its own-race root c0401h0170; see fallback note");
}

const entry = encodeSqPackFile(mdlBytes, SqPackType.Model);
const mpl = {
  TTMPVersion: "1.3s",
  Name: "Synthetic Hair Rewrite",
  Author: "synthetic",
  Version: "1.0.0",
  Description: "",
  Url: "",
  MinimumFrameworkVersion: "1.3.0.0",
  SimpleModsList: [
    { Name: "c0401h0170 hair", Category: "", FullPath: gamePath, ModOffset: 0, ModSize: entry.length, DatFile: "chara", IsDefault: false },
  ],
};
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "hair-rewrite.ttmp2"), zipSync({
  "TTMPL.mpl": new TextEncoder().encode(JSON.stringify(mpl)),
  "TTMPD.mpd": entry,
}));
console.log("wrote", join(outDir, "hair-rewrite.ttmp2"));
```

> **Fallback:** same length-preserving byte-patch strategy as Task 9 if the base-game hair model
> already references the shared `c0201h0170` material.

- [ ] **Step 2: Build the pack**

Run: `node scripts/generate-synthetics/build-synthetic-hair.mjs`
Expected: `wrote .../hair-rewrite.ttmp2` (or throws on inspection → apply fallback, re-run).

- [ ] **Step 3: Run the upgrade golden for this pack**

Run: `npm test` (locate the `hair-rewrite` upgrade case in the output).
Expected: PASS — our `.mdl` output is byte-identical to the ConsoleTools golden (materials rewritten
`c0401h0170 → c0201h0170`). A diff is a real bug.

- [ ] **Step 4: Commit the builder**

```powershell
npm run check
git add scripts/generate-synthetics/build-synthetic-hair.mjs
git commit -m "test(corpus): synthetic hairFix-rewrite golden pack builder"
```

---

### Task 11: Full-suite regression + docs (backlog / roadmap / audit)

**Files:**
- Modify: `BACKLOG.md` (remove the resolved 6-1 item)
- Modify: `docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md` (§8.2 deferred note)
- Modify: `docs/audits/2026-07-07-porting-guideline-audit.md` (mark 6-1 resolved)

**Interfaces:** none (verification + docs).

- [ ] **Step 1: Run the full gate**

Run: `npm run check; npm run typecheck; npm test`
Expected: all green. In particular the existing hair packs `Misty_Hairstyle_Female` and `Eliza`
stay byte-exact (no regression — the ported hairFix must be a no-op on them, spec §5), and the two
new synthetics pass. If a corpus hair pack now diverges, that is a real latent divergence the port
surfaced (spec §5 verification): capture it as a golden/baseline and reconcile before proceeding.

- [ ] **Step 2: Remove the resolved backlog item**

In `BACKLOG.md`, delete the `**`fixUpSkinReferences` (audit 6-1).**` bullet from the Prioritized
list (it is now shipped).

- [ ] **Step 3: Update the roadmap deferred note**

In `docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md` §8.2, change the
"Deferred-but-documented: `FixUpSkinReferences` (no-op stub, never fired on the corpus)" clause to
record it as shipped (skin rewrite + hairFix, static race table via offline extractor; synthetics
cover the rewrite branches).

- [ ] **Step 4: Mark the audit finding resolved**

In `docs/audits/2026-07-07-porting-guideline-audit.md`, update the 6-1 row/line (`:88`, `:224`) to
note it is resolved by this work (cite the spec/plan).

- [ ] **Step 5: Commit**

```powershell
git add BACKLOG.md docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md docs/audits/2026-07-07-porting-guideline-audit.md
git commit -m "docs: mark audit 6-1 (fixUpSkinReferences) resolved; update backlog + roadmap"
```

---

## Self-Review

**Spec coverage:**
- Full port (skin rewrite + hairFix) → Tasks 1-8. ✓
- Static race→skin-race table via offline extractor (spec §4) → Task 3. ✓
- Fail-loud off-tree throw (spec §4.3) → Task 4. ✓
- hairFix dependency projection (spec §2.3) → Tasks 1, 5, 6, 7. ✓
- Ordering before `computeModelLists` (spec §3.1) → unchanged `from-raw.ts` call (Task 8); verified by Task 11 full suite. ✓
- Synthetic cross-race skin + hairFix-rewrite goldens (spec §6 fixtures 2, 3) → Tasks 9, 10. ✓
- Unit tests: `getSkinRace` (fixture 4), `getHairMaterialRoot` (fixture 5), root parse (fixture 6) → Tasks 4, 7, 6. ✓
- No new real hair packs (spec §5.1 decision) → honored; Task 11 asserts Misty/Eliza no-regression. ✓
- §5 implementation-time verification (decode a Misty model) → folded into Task 11 Step 1 guard. ✓

**Placeholder scan:** every code step contains complete code; the only deliberately open items are
the synthetic builders' base-model *choice*, which each carry a runnable default plus an explicit
inspection guard and a documented length-preserving byte-patch fallback — not placeholders.

**Type consistency:** `XivRace` (numeric enum) flows Task 2 → 4 → 8; `XivDependencyRootInfo`
(fields `primaryType/primaryId/secondaryType/secondaryId/slot`) is defined in Task 5 and consumed
identically in Tasks 6, 7, 8; `XivItemType` (Task 1) used consistently; `getBaseFileName`,
`getHairMaterialRoot`, `getSkinRace`, `getFileNameRootInfo`, `isValid` signatures match across
producer/consumer tasks.

**Note on the extractor (Task 3):** the generated table's exact NPC-race entries are not known
until the script runs on a game-equipped machine; Task 4's unit test asserts the 18 playable
outcomes + the Roe-F special case + a self-consistency invariant over the whole table (every target
is its own skin race), which validates the generated NPC entries without hardcoding them.
