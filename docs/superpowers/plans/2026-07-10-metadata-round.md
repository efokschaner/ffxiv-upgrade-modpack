# Metadata Round (Round 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make our upgraded `.meta` output byte-identical to ConsoleTools `/upgrade` by faithfully reconstructing TexTools' metadata re-materialization (base-game seed + mod deltas), replacing today's opaque pass-through.

**Architecture:** A new `src/meta/` codec (parse/serialize the `.meta` binary) plus a reconstruction step that rebuilds each `.meta` from bundled minimal base-game tables (EST/EQP/GMP/IMC) with the mod's entries applied on top. EQDP needs no base data (zero-backfill wins). Wired into `src/upgrade/upgrade.ts` as a per-option `metadataRound`. Built incrementally so the golden ratchet burns down segment by segment.

**Tech Stack:** TypeScript, Node/Vite (browser target), Vitest, the existing SqPack codec (`src/sqpack/`) and golden harness (`test/helpers/`), ConsoleTools `/extract` for the offline extractor.

**Spec:** `docs/superpowers/specs/2026-07-10-metadata-round-design.md`. Read it first.

## Global Constraints

- **Byte-parity is correctness.** Output must be byte-identical to the ConsoleTools `/upgrade` golden. Target byte-zero ratchet; **no `DIVERGENCE_RULES` entry** for this round.
- **Every business-logic line cites its C# source** as `file · symbol · lines` in a header/comment. Port behaviour; reproduce quirks; never invent.
- **Split, don't blend.** Keep each `.meta` sub-piece in its own module mapping to a named C# symbol. Do not merge logic from different C# symbols into one module.
- **Fail loud, never silently diverge.** Any structure/path the port can't reproduce faithfully must throw, not best-effort.
- **End-of-task gate (required):** `npm run check` → `npm run typecheck` → `npm test`, all green, before a task is done.
- **Supply chain:** no new runtime deps expected; if any, pin-exact with ≥7-day min-release-age.
- **Reference C# is read-only** (`reference/`, gitignored). Read freely; never edit.

The `.meta` binary layout (from `ItemMetadata.cs:449-473, 503-660`), used throughout:
```
uint32  version (always 2 on write)
asciiZ  root file path (UTF-8, NUL-terminated)
uint32  header entry count
uint32  per-header size (always 12)
uint32  header entries start offset (= byte position right after this field)
  per present segment, in write order [Imc, Eqp, Eqdp, Est, Gmp]:
    uint32 type   (Imc=1, Eqdp=2, Eqp=3, Est=4, Gmp=5)
    uint32 data offset   (backfilled)
    uint32 data size     (backfilled)
data sections, same order, at the offsets above.
Segment payloads: Imc = N×6 bytes; Eqp = raw bytes; Eqdp = M×(uint32 race + 1 byte);
Est = K×(uint16 race, uint16 setId, uint16 skelId); Gmp = 5 bytes.
```

---

### Task 1: Corpus test data + before-state baselines

Bring the four verified packs into the local corpus and record their current (pre-round-5) baselines, so the `.meta` diffs are captured as the starting gap and burn down as later tasks land. No production code changes.

**Files:**
- Add (gitignored, user-supplied): `test/corpus/real/Purrfection Ears & Bow.ttmp2`, `test/corpus/real/[V] [VC] Paglth'an Redeux.ttmp2`, `test/corpus/real/[V] [AM] Vixen.ttmp2`, `test/corpus/real/•Arabella• Cambria [May 2023].ttmp2`
- Modify (gitignored): `test/corpus/.upgrade-baseline/*.json` (recorded by the bless step)

**Interfaces:**
- Consumes: nothing.
- Produces: four corpus packs whose golden diffs are baselined; later tasks assert the `.meta` entries in these baselines burn to empty.

- [ ] **Step 1: Copy the four packs into the corpus**

Source paths under `C:\Users\user\Documents\XIVModOriginals` (verified pre-Dawntrail, oracle-confirmed to upgrade):
```powershell
$src = "C:\Users\user\Documents\XIVModOriginals"
$dst = "test\corpus\real"
Copy-Item "$src\AestheticMods\Arabella's Aesthetics\Aesthetic Mods 2021 ♥ Arabella\Accessories\•Arabella• Purrfection\Purrfection Ears & Bow.ttmp2" $dst
Copy-Item "$src\AestheticMods\Vermillion's Aesthetics\2021 Releases\May 2021\[S] [AM] [VC] Paglth'an Redeux\[V] [VC] Paglth'an Redeux.ttmp2" $dst
Copy-Item "$src\AestheticMods\Vermillion's Aesthetics\2022 Releases\February 2022\[V] [AM] Vixen\[V] [AM] Vixen.ttmp2" $dst
Copy-Item "$src\AestheticMods\Arabella's Aesthetics\Aesthetic Mods 2023 ♥ Arabella\May 2023\•Arabella• Cambria [May 2023].ttmp2" $dst
```

- [ ] **Step 2: Populate goldens + record baselines (bless)**

Run: `$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`
Expected: the four packs spawn ConsoleTools `/upgrade` once each (cache cold), then their baselines are written under `test/corpus/.upgrade-baseline/`. Suite passes (bless mode records, never fails).

- [ ] **Step 3: Confirm the expected `.meta` diffs are present in the new baselines**

Run:
```powershell
Get-ChildItem test\corpus\.upgrade-baseline\*.json | ForEach-Object { $j = Get-Content $_ -Raw | ConvertFrom-Json; $j | Where-Object { $_.gamePath -like '*.meta' -and $_.status -eq 'mismatch' } | ForEach-Object { "$($_.gamePath)  $($_.detail)" } } | Sort-Object -Unique
```
Expected: includes `chara/equipment/e5035/e5035_met.meta` (EST-nz), `chara/equipment/e0724/e0724_top.meta` (IMC growth), plus EQDP/EST expansion diffs on Vixen/Cambria. These are the burn-down targets.

- [ ] **Step 4: Run the required gate**

Run: `npm run check; npm run typecheck; npm test`
Expected: all green (the new packs are baselined, so their known diffs don't fail).

- [ ] **Step 5: Commit** (baselines + corpus are gitignored, so this commit is effectively a no-op tree change — record the intent for history)

```bash
git commit --allow-empty -m "test(corpus): add metadata-round packs (Purrfection, Paglth'an, Vixen, Cambria) + baselines"
```

---

### Task 2: `.meta` deserialize codec

Parse the `.meta` binary into a structured `ItemMeta`, preserving segment order/bytes exactly so a later serialize can round-trip it.

**Files:**
- Create: `src/meta/types.ts`
- Create: `src/meta/deserialize.ts`
- Test: `src/meta/deserialize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface EqdpEntry { race: number; value: number }`
  - `interface EstEntry { race: number; setId: number; skelId: number }`
  - `interface ItemMeta { version: number; path: string; imc: Uint8Array[] | null; eqp: Uint8Array | null; eqdp: EqdpEntry[] | null; est: EstEntry[] | null; gmp: Uint8Array | null }`
  - `function deserializeMeta(data: Uint8Array): ItemMeta`

- [ ] **Step 1: Write the types**

Create `src/meta/types.ts`:
```ts
// Structured form of a TexTools .meta file. Ports the segment set documented in
// ItemMetadata.cs:31-44 (Imc, Eqdp, Eqp, Est, Gmp). EQP/GMP/IMC entries are kept as
// opaque bytes (we never reinterpret them for reconstruction); EQDP/EST are structured
// because the round manipulates them by race.
export interface EqdpEntry {
  race: number; // uint32 race code (e.g. 101), ItemMetadata.cs:743
  value: number; // 1 EQDP byte, EquipmentDeformationParameter.GetByte()
}
export interface EstEntry {
  race: number; // uint16 race code, ItemMetadata.cs:678
  setId: number; // uint16
  skelId: number; // uint16
}
export interface ItemMeta {
  version: number; // ItemMetadata._METADATA_VERSION (2)
  path: string; // root file path (e.g. "chara/equipment/e0208/e0208_met.meta")
  imc: Uint8Array[] | null; // N × 6-byte IMC sub-entries, ItemMetadata.cs:692-707
  eqp: Uint8Array | null; // raw EQP segment bytes, ItemMetadata.cs:813-816
  eqdp: EqdpEntry[] | null; // ItemMetadata.cs:735-748
  est: EstEntry[] | null; // ItemMetadata.cs:668-684
  gmp: Uint8Array | null; // raw GMP segment (5 bytes), ItemMetadata.cs:662-666
}
```

- [ ] **Step 2: Write the failing test**

Create `src/meta/deserialize.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { deserializeMeta } from "./deserialize";

// Hand-built minimal v2 .meta with a single EQDP segment of two races (101=3, 201=0).
// Layout per ItemMetadata.cs:503-660.
function buildEqdpOnly(): Uint8Array {
  const path = "chara/equipment/e0001/e0001_top.meta";
  const enc = new TextEncoder().encode(path);
  const headerStart = 4 + enc.length + 1 + 12; // version + pathZ + (count,size,start)
  const eqdpBytes = new Uint8Array(2 * 5);
  const dv0 = new DataView(eqdpBytes.buffer);
  dv0.setUint32(0, 101, true); dv0.setUint8(4, 3);
  dv0.setUint32(5, 201, true); dv0.setUint8(9, 0);
  const dataOffset = headerStart + 12; // one 12-byte segment header
  const total = dataOffset + eqdpBytes.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 2, true);
  out.set(enc, 4);
  out[4 + enc.length] = 0;
  let p = 4 + enc.length + 1;
  dv.setUint32(p, 1, true); // header count
  dv.setUint32(p + 4, 12, true); // per-header size
  dv.setUint32(p + 8, headerStart, true); // header start
  dv.setUint32(headerStart, 2, true); // type Eqdp
  dv.setUint32(headerStart + 4, dataOffset, true);
  dv.setUint32(headerStart + 8, eqdpBytes.length, true);
  out.set(eqdpBytes, dataOffset);
  return out;
}

describe("deserializeMeta", () => {
  it("parses version, path and an EQDP segment", () => {
    const m = deserializeMeta(buildEqdpOnly());
    expect(m.version).toBe(2);
    expect(m.path).toBe("chara/equipment/e0001/e0001_top.meta");
    expect(m.eqdp).toEqual([
      { race: 101, value: 3 },
      { race: 201, value: 0 },
    ]);
    expect(m.est).toBeNull();
    expect(m.imc).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/meta/deserialize.test.ts`
Expected: FAIL — `deserializeMeta` not defined.

- [ ] **Step 4: Implement `deserializeMeta`**

Create `src/meta/deserialize.ts` — port of `ItemMetadata.Deserialize` (`ItemMetadata.cs:869-967`) and the per-segment deserializers:
```ts
import type { EqdpEntry, EstEntry, ItemMeta } from "./types";

// Port of ItemMetadata.Deserialize (ItemMetadata.cs:869-967). Reads the header table then each
// present segment. EQP/GMP/IMC kept as opaque bytes; EQDP/EST structured (ItemMetadata.cs:715-847).
const TYPE_IMC = 1;
const TYPE_EQDP = 2;
const TYPE_EQP = 3;
const TYPE_EST = 4;
const TYPE_GMP = 5;

export function deserializeMeta(data: Uint8Array): ItemMeta {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = dv.getUint32(0, true);
  let p = 4;
  let path = "";
  while (data[p] !== 0) {
    path += String.fromCharCode(data[p]!);
    p++;
  }
  p++; // skip NUL
  const headerCount = dv.getUint32(p, true);
  const perHeaderSize = dv.getUint32(p + 4, true);
  const headerStart = dv.getUint32(p + 8, true);

  const seg = new Map<number, { offset: number; size: number }>();
  for (let i = 0; i < headerCount; i++) {
    const base = headerStart + i * perHeaderSize;
    seg.set(dv.getUint32(base, true), {
      offset: dv.getUint32(base + 4, true),
      size: dv.getUint32(base + 8, true),
    });
  }

  const imcSeg = seg.get(TYPE_IMC);
  let imc: Uint8Array[] | null = null;
  if (imcSeg) {
    imc = [];
    for (let o = 0; o < imcSeg.size; o += 6) {
      imc.push(data.slice(imcSeg.offset + o, imcSeg.offset + o + 6));
    }
  }

  const eqpSeg = seg.get(TYPE_EQP);
  const eqp = eqpSeg
    ? data.slice(eqpSeg.offset, eqpSeg.offset + eqpSeg.size)
    : null;

  const eqdpSeg = seg.get(TYPE_EQDP);
  let eqdp: EqdpEntry[] | null = null;
  if (eqdpSeg) {
    eqdp = [];
    for (let o = 0; o < eqdpSeg.size; o += 5) {
      const b = eqdpSeg.offset + o;
      eqdp.push({ race: dv.getUint32(b, true), value: dv.getUint8(b + 4) });
    }
  }

  const estSeg = seg.get(TYPE_EST);
  let est: EstEntry[] | null = null;
  if (estSeg) {
    est = [];
    for (let o = 0; o < estSeg.size; o += 6) {
      const b = estSeg.offset + o;
      est.push({
        race: dv.getUint16(b, true),
        setId: dv.getUint16(b + 2, true),
        skelId: dv.getUint16(b + 4, true),
      });
    }
  }

  const gmpSeg = seg.get(TYPE_GMP);
  const gmp = gmpSeg
    ? data.slice(gmpSeg.offset, gmpSeg.offset + gmpSeg.size)
    : null;

  return { version, path, imc, eqp, eqdp, est, gmp };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/meta/deserialize.test.ts`
Expected: PASS.

- [ ] **Step 6: Run gate + commit**

Run: `npm run check; npm run typecheck; npm test`
```bash
git add src/meta/types.ts src/meta/deserialize.ts src/meta/deserialize.test.ts
git commit -m "feat(meta): .meta deserialize codec (ItemMetadata.Deserialize port)"
```

---

### Task 3: `.meta` serialize codec + round-trip identity

Serialize an `ItemMeta` back to bytes, matching `ItemMetadata.Serialize` exactly. Prove it with a round-trip identity test over **real golden `.meta` bytes** from the corpus.

**Files:**
- Create: `src/meta/serialize.ts`
- Test: `src/meta/serialize.test.ts`
- Test: `test/meta/roundtrip.corpus.test.ts`

**Interfaces:**
- Consumes: `ItemMeta`, `deserializeMeta` (Task 2).
- Produces: `function serializeMeta(m: ItemMeta): Uint8Array`

- [ ] **Step 1: Write the failing unit test**

Create `src/meta/serialize.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { deserializeMeta } from "./deserialize";
import { serializeMeta } from "./serialize";
import type { ItemMeta } from "./types";

describe("serializeMeta", () => {
  it("round-trips a structured meta byte-for-byte", () => {
    const m: ItemMeta = {
      version: 2,
      path: "chara/equipment/e0001/e0001_top.meta",
      imc: null,
      eqp: null,
      eqdp: [
        { race: 101, value: 3 },
        { race: 201, value: 0 },
      ],
      est: [{ race: 101, setId: 1, skelId: 0 }],
      gmp: null,
    };
    const bytes = serializeMeta(m);
    expect(deserializeMeta(bytes)).toEqual(m);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/meta/serialize.test.ts`
Expected: FAIL — `serializeMeta` not defined.

- [ ] **Step 3: Implement `serializeMeta`**

Create `src/meta/serialize.ts` — port of `ItemMetadata.Serialize` (`ItemMetadata.cs:503-660`). Present-segment order and the two-phase (headers then data, offsets backfilled) must match exactly:
```ts
import type { ItemMeta } from "./types";

// Port of ItemMetadata.Serialize (ItemMetadata.cs:503-660). Writes the header table in the fixed
// order [Imc, Eqp, Eqdp, Est, Gmp] (ItemMetadata.cs:554-597) then each present segment's data
// (ItemMetadata.cs:603-657), backfilling offset/size. Per-header size is 12 (_METADATA_HEADER_SIZE).
const TYPE_IMC = 1, TYPE_EQDP = 2, TYPE_EQP = 3, TYPE_EST = 4, TYPE_GMP = 5;

function eqdpBytes(m: ItemMeta): Uint8Array {
  const e = m.eqdp!;
  const out = new Uint8Array(e.length * 5);
  const dv = new DataView(out.buffer);
  e.forEach((x, i) => {
    dv.setUint32(i * 5, x.race, true);
    dv.setUint8(i * 5 + 4, x.value);
  });
  return out;
}
function estBytes(m: ItemMeta): Uint8Array {
  const e = m.est!;
  const out = new Uint8Array(e.length * 6);
  const dv = new DataView(out.buffer);
  e.forEach((x, i) => {
    dv.setUint16(i * 6, x.race, true);
    dv.setUint16(i * 6 + 2, x.setId, true);
    dv.setUint16(i * 6 + 4, x.skelId, true);
  });
  return out;
}
function imcBytes(m: ItemMeta): Uint8Array {
  const chunks = m.imc!;
  const out = new Uint8Array(chunks.length * 6);
  chunks.forEach((c, i) => out.set(c, i * 6));
  return out;
}

export function serializeMeta(m: ItemMeta): Uint8Array {
  // Present segments in write order, each with its payload bytes.
  const segments: { type: number; data: Uint8Array }[] = [];
  if (m.imc) segments.push({ type: TYPE_IMC, data: imcBytes(m) });
  if (m.eqp) segments.push({ type: TYPE_EQP, data: m.eqp });
  if (m.eqdp) segments.push({ type: TYPE_EQDP, data: eqdpBytes(m) });
  if (m.est) segments.push({ type: TYPE_EST, data: estBytes(m) });
  if (m.gmp) segments.push({ type: TYPE_GMP, data: m.gmp });

  const enc = new TextEncoder().encode(m.path);
  const headerBase = 4 + enc.length + 1 + 12; // version + pathZ + (count,size,start)
  const headersLen = segments.length * 12;
  let dataLen = 0;
  for (const s of segments) dataLen += s.data.length;
  const total = headerBase + headersLen + dataLen;

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, m.version, true);
  out.set(enc, 4);
  out[4 + enc.length] = 0;
  let p = 4 + enc.length + 1;
  dv.setUint32(p, segments.length, true);
  dv.setUint32(p + 4, 12, true);
  dv.setUint32(p + 8, headerBase, true); // header entries start (== p + 12)

  let hdr = headerBase;
  let dataAt = headerBase + headersLen;
  for (const s of segments) {
    dv.setUint32(hdr, s.type, true);
    dv.setUint32(hdr + 4, dataAt, true);
    dv.setUint32(hdr + 8, s.data.length, true);
    out.set(s.data, dataAt);
    hdr += 12;
    dataAt += s.data.length;
  }
  return out;
}
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npx vitest run src/meta/serialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the corpus round-trip identity test**

The strongest codec proof: parse every real golden `.meta` and re-serialize to identical bytes. Create `test/meta/roundtrip.corpus.test.ts`:
```ts
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModpack } from "../../src/index";
import { allFiles, FileStorageType } from "../../src/model/modpack";
import { deserializeMeta } from "../../src/meta/deserialize";
import { serializeMeta } from "../../src/meta/serialize";
import { decodeSqPackFile } from "../../src/sqpack/sqpack";
import { corpusPacks } from "../helpers/corpus-roots";

const CACHE = join(__dirname, "..", "corpus", ".upgrade-cache");
function unc(f: { storage: FileStorageType; data: Uint8Array }): Uint8Array {
  return f.storage === FileStorageType.SqPackCompressed
    ? decodeSqPackFile(f.data).data
    : f.data;
}

describe("meta codec round-trips every golden .meta", () => {
  it("serialize(deserialize(x)) === x for all cached goldens", () => {
    let checked = 0;
    for (const pack of corpusPacks()) {
      const bytes = new Uint8Array(readFileSync(pack));
      const key = createHash("sha256").update(bytes).digest("hex");
      const goldenFile = existsSync(CACHE)
        ? readdirSync(CACHE).find((f) => f.startsWith(key) && f.endsWith(".bin"))
        : undefined;
      if (!goldenFile) continue;
      const golden = loadModpack(
        pack,
        new Uint8Array(readFileSync(join(CACHE, goldenFile))),
      );
      for (const f of allFiles(golden)) {
        if (!f.gamePath.endsWith(".meta")) continue;
        const raw = unc(f);
        expect(serializeMeta(deserializeMeta(raw))).toEqual(raw);
        checked++;
      }
    }
    // Corpus is local/gitignored; a fresh clone with no goldens checks nothing but must not fail.
    expect(checked).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 6: Run the corpus round-trip test**

Run: `npx vitest run test/meta/roundtrip.corpus.test.ts`
Expected: PASS (every golden `.meta` round-trips). If any fails, the codec is wrong — fix before proceeding; do not baseline around it.

- [ ] **Step 7: Run gate + commit**

Run: `npm run check; npm run typecheck; npm test`
```bash
git add src/meta/serialize.ts src/meta/serialize.test.ts test/meta/roundtrip.corpus.test.ts
git commit -m "feat(meta): .meta serialize codec + corpus round-trip identity (ItemMetadata.Serialize port)"
```

---

### Task 4: Root & EstType parsing

Derive from a `.meta` game path the values reconstruction needs: the primary set id, the slot, the item type (equipment vs accessory), and the `EstType`.

**Files:**
- Create: `src/meta/root.ts`
- Test: `src/meta/root.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type EstType = "Head" | "Body" | "Hair" | "Face" | null`
  - `interface MetaRoot { primaryId: number; slot: string; itemType: "equipment" | "accessory" | "other"; estType: EstType }`
  - `function parseMetaRoot(gamePath: string): MetaRoot`

- [ ] **Step 1: Write the failing test**

Create `src/meta/root.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseMetaRoot } from "./root";

describe("parseMetaRoot", () => {
  it("parses an equipment met meta (Head est)", () => {
    expect(parseMetaRoot("chara/equipment/e0208/e0208_met.meta")).toEqual({
      primaryId: 208,
      slot: "met",
      itemType: "equipment",
      estType: "Head",
    });
  });
  it("parses an equipment top meta (Body est)", () => {
    expect(parseMetaRoot("chara/equipment/e0724/e0724_top.meta")).toEqual({
      primaryId: 724,
      slot: "top",
      itemType: "equipment",
      estType: "Body",
    });
  });
  it("parses an accessory (no est)", () => {
    expect(parseMetaRoot("chara/accessory/a0038/a0038_nek.meta")).toEqual({
      primaryId: 38,
      slot: "nek",
      itemType: "accessory",
      estType: null,
    });
  });
  it("parses a hair meta (Hair est)", () => {
    const r = parseMetaRoot("chara/human/c0201/obj/hair/h0135/c0201h0135_hir.meta");
    expect(r.estType).toBe("Hair");
    expect(r.slot).toBe("hir");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/meta/root.test.ts`
Expected: FAIL — `parseMetaRoot` not defined.

- [ ] **Step 3: Implement `parseMetaRoot`**

Port the slot→EstType mapping from `Est.GetEstType` (`Est.cs`, grep `GetEstType`) and the root-file naming from `XivDependencyRootInfo.GetRootFile`. Read those C# symbols first; the mapping is: face→Face, hair→Hair, equipment `met` (head slot)→Head, equipment/accessory body slots that carry EST→Body, else null. Create `src/meta/root.ts`:
```ts
// Ports XivDependencyRootInfo path parsing + Est.GetEstType (Est.cs) enough to pick the
// reconstruction inputs for a .meta root. estType null means "no EST segment expansion".
export type EstType = "Head" | "Body" | "Hair" | "Face" | null;
export interface MetaRoot {
  primaryId: number;
  slot: string;
  itemType: "equipment" | "accessory" | "other";
  estType: EstType;
}

// Slot suffix -> EstType. met (head) -> Head est (extra_met.est); top/body-ish -> Body est
// (extra_top.est); hair -> Hair; face -> Face. Verify the exact slot set against Est.GetEstType
// and fail loud on an unmapped equipment/accessory slot rather than guessing.
const SLOT_EST: Record<string, EstType> = {
  met: "Head",
  top: "Body",
};

export function parseMetaRoot(gamePath: string): MetaRoot {
  const equip = gamePath.match(/^chara\/equipment\/e(\d+)\/e\d+_(\w+)\.meta$/);
  if (equip) {
    const slot = equip[2]!;
    return {
      primaryId: Number.parseInt(equip[1]!, 10),
      slot,
      itemType: "equipment",
      estType: SLOT_EST[slot] ?? null,
    };
  }
  const acc = gamePath.match(/^chara\/accessory\/a(\d+)\/a\d+_(\w+)\.meta$/);
  if (acc) {
    return {
      primaryId: Number.parseInt(acc[1]!, 10),
      slot: acc[2]!,
      itemType: "accessory",
      estType: null,
    };
  }
  const hair = gamePath.match(/\/hair\/h(\d+)\/c\d+h\d+_(\w+)\.meta$/);
  if (hair) {
    return {
      primaryId: Number.parseInt(hair[1]!, 10),
      slot: hair[2]!,
      itemType: "other",
      estType: "Hair",
    };
  }
  const face = gamePath.match(/\/face\/f(\d+)\/c\d+f\d+_(\w+)\.meta$/);
  if (face) {
    return {
      primaryId: Number.parseInt(face[1]!, 10),
      slot: face[2]!,
      itemType: "other",
      estType: "Face",
    };
  }
  throw new Error(`meta: unrecognized root path ${gamePath}`);
}
```

Note: verify the `SLOT_EST` map and body-slot set against `Est.GetEstType`; widen it (and the tests) if a corpus meta slot is unmapped. An unmapped slot on an EST-bearing item must surface — the throw or a null-est mismatch will show in the ratchet.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/meta/root.test.ts`
Expected: PASS.

- [ ] **Step 5: Run gate + commit**

Run: `npm run check; npm run typecheck; npm test`
```bash
git add src/meta/root.ts src/meta/root.test.ts
git commit -m "feat(meta): root + EstType parsing (Est.GetEstType port)"
```

---

### Task 5: EQDP reconstruction + wire the metadata round

Reconstruct EQDP data-free (canonical 18-race expansion, mod value or 0), pass EST/EQP/GMP/IMC through unchanged for now, and wire a `metadataRound` into `upgradeModpack`. This resolves the pure-EQDP `.meta` diffs in the ratchet.

**Files:**
- Create: `src/meta/reconstruct.ts`
- Create: `src/meta/playable-races.ts`
- Test: `src/meta/reconstruct.test.ts`
- Modify: `src/upgrade/upgrade.ts` (add `metadataRound`, call it in `upgradeModpack`)

**Interfaces:**
- Consumes: `ItemMeta` (Task 2), `deserializeMeta`, `serializeMeta`, `parseMetaRoot`.
- Produces:
  - `const PLAYABLE_RACES: number[]` (18 race codes, canonical order)
  - `function reconstructMeta(mod: ItemMeta, gamePath: string): ItemMeta`
  - `function metadataRound(option: ModpackOption): void` in `upgrade.ts`

- [ ] **Step 1: Write the playable-race list**

Create `src/meta/playable-races.ts` — port of `Eqp.PlayableRaces` (`Eqp.cs:48-70`), preserving the Viera **Male-before-Female** order quirk:
```ts
// Port of Eqp.PlayableRaces (Eqp.cs:48-70). Canonical Dawntrail 18-race order. NOTE the quirk:
// Viera Male (1701) precedes Viera Female (1801) here, unlike PlayableRacesWithNPCs (Eqp.cs:73-92).
export const PLAYABLE_RACES: number[] = [
  101, 201, 301, 401, 501, 601, 701, 801, 901, 1001, 1101, 1201, 1301, 1401,
  1501, 1601, 1701, 1801,
];
```

- [ ] **Step 2: Write the failing test**

Create `src/meta/reconstruct.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { reconstructMeta } from "./reconstruct";
import type { ItemMeta } from "./types";

describe("reconstructMeta EQDP expansion", () => {
  it("expands EQDP to canonical 18 races, mod value or 0, dropping mod order", () => {
    // Mod meta: 17 races missing 1601, with Viera in old order (1801 before 1701).
    const eqdp = [
      { race: 101, value: 3 }, { race: 201, value: 2 }, { race: 301, value: 0 },
      { race: 401, value: 0 }, { race: 501, value: 0 }, { race: 601, value: 0 },
      { race: 701, value: 0 }, { race: 801, value: 0 }, { race: 901, value: 2 },
      { race: 1001, value: 0 }, { race: 1101, value: 2 }, { race: 1201, value: 3 },
      { race: 1301, value: 0 }, { race: 1401, value: 0 }, { race: 1501, value: 0 },
      { race: 1801, value: 0 }, { race: 1701, value: 0 },
    ];
    const mod: ItemMeta = {
      version: 2, path: "chara/equipment/e0256/e0256_top.meta",
      imc: null, eqp: null, eqdp, est: null, gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect(out.eqdp!.map((e) => e.race)).toEqual([
      101, 201, 301, 401, 501, 601, 701, 801, 901, 1001, 1101, 1201, 1301,
      1401, 1501, 1601, 1701, 1801,
    ]);
    expect(out.eqdp!.find((e) => e.race === 1601)).toEqual({ race: 1601, value: 0 });
    expect(out.eqdp!.find((e) => e.race === 101)!.value).toBe(3);
  });

  it("leaves a meta with no EQDP segment untouched in EQDP", () => {
    const mod: ItemMeta = {
      version: 2, path: "chara/human/c0201/obj/hair/h0135/c0201h0135_hir.meta",
      imc: null, eqp: null, eqdp: null, est: [{ race: 201, setId: 135, skelId: 136 }], gmp: null,
    };
    expect(reconstructMeta(mod, mod.path).eqdp).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/meta/reconstruct.test.ts`
Expected: FAIL — `reconstructMeta` not defined.

- [ ] **Step 4: Implement EQDP reconstruction**

Create `src/meta/reconstruct.ts`. EQDP mirrors the net of the read-side backfill (`ItemMetadata.cs:782-788`, zero for missing races) + base-seed canonical order (`GetEquipmentDeformationParameters`): emit all `PLAYABLE_RACES` in order, mod value or 0. EST/EQP/GMP/IMC pass through for now (later tasks replace these):
```ts
import { parseMetaRoot } from "./root";
import { PLAYABLE_RACES } from "./playable-races";
import type { ItemMeta } from "./types";

// Reconstruct a .meta the way ConsoleTools /upgrade does: seed from the base game, apply the mod's
// deltas. EQDP is data-free (ItemMetadata.cs:782-788 injects 0 for missing PlayableRaces at read,
// overwriting the base seed), so we expand to the canonical 18 races here. EST/EQP/GMP/IMC are
// filled in by later tasks; for now they pass through unchanged.
export function reconstructMeta(mod: ItemMeta, gamePath: string): ItemMeta {
  parseMetaRoot(gamePath); // validate the path shape (throws on unknown roots)
  let eqdp = mod.eqdp;
  if (eqdp) {
    const byRace = new Map(eqdp.map((e) => [e.race, e.value]));
    eqdp = PLAYABLE_RACES.map((race) => ({ race, value: byRace.get(race) ?? 0 }));
  }
  return { ...mod, eqdp };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/meta/reconstruct.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire `metadataRound` into `upgradeModpack`**

Modify `src/upgrade/upgrade.ts`. Add imports and the round; `.meta` is a Standard (Type-2) SqPack entry in TTMP, raw in PMP — `uncompressedBytes`/`restore` already handle both:
```ts
// add to imports
import { deserializeMeta } from "../meta/deserialize";
import { reconstructMeta } from "../meta/reconstruct";
import { serializeMeta } from "../meta/serialize";
```
Add the round (near `partials`):
```ts
const IS_META = /\.meta$/;

/**
 * Metadata round (round 5). Replaces the opaque .meta pass-through: reconstruct each .meta the
 * way ConsoleTools /upgrade does (base-game seed + mod deltas). See
 * docs/superpowers/specs/2026-07-10-metadata-round-design.md.
 */
function metadataRound(option: ModpackOption): void {
  option.files = option.files.map((f) => {
    if (!IS_META.test(f.gamePath)) return f;
    const { bytes, type } = uncompressedBytes(f);
    const out = serializeMeta(reconstructMeta(deserializeMeta(bytes), f.gamePath));
    return restore(f, out, type ?? SqPackType.Standard);
  });
}
```
Call it in `upgradeModpack`, in pass 1's per-option loop (order-independent of model/material; run it alongside them):
```ts
  for (const group of out.groups) {
    for (const option of group.options) {
      modelRound(option, gate);
      metadataRound(option);
      for (const info of materialRound(option)) {
        const k = targetKey(info);
        if (!targets.has(k)) targets.set(k, info);
      }
    }
  }
```

- [ ] **Step 7: Run the golden harness; the pure-EQDP `.meta` diffs should now match**

Run: `npm test`
Expected: existing corpus packs with pure-EQDP `.meta` diffs (e.g. `e0049_dwn`, `e6041_sho`) now MATCH (regressions=0; their baseline entries become removable). EST/IMC `.meta` files still diff (unchanged) — still within baseline, so no failure.

- [ ] **Step 8: Re-bless to shrink the baselines to the new (smaller) diff set**

Run: `$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`
Then confirm pure-EQDP metas are gone from baselines:
```powershell
Get-ChildItem test\corpus\.upgrade-baseline\*.json | ForEach-Object { (Get-Content $_ -Raw | ConvertFrom-Json) | Where-Object { $_.gamePath -like '*.meta' } | ForEach-Object { $_.gamePath } } | Sort-Object -Unique
```
Expected: no more pure-EQDP-only paths; remaining `.meta` entries are EST/IMC ones (later tasks).

- [ ] **Step 9: Run gate + commit**

Run: `npm run check; npm run typecheck; npm test`
```bash
git add src/meta/reconstruct.ts src/meta/playable-races.ts src/meta/reconstruct.test.ts src/upgrade/upgrade.ts
git commit -m "feat(meta): EQDP reconstruction + wire metadataRound (data-free 18-race expansion)"
```

---

### Task 6: Extract EST/EQP/GMP reference tables

Build the offline extractor and the generated tables the EST/EQP/GMP reconstruction needs.

**Files:**
- Create: `scripts/extract-meta-reference.ts`
- Create (generated): `src/meta/reference/est-table.ts`, `src/meta/reference/eqp.ts`, `src/meta/reference/gmp.ts`

**Interfaces:**
- Consumes: `test/helpers/oracle.ts` `extractGameFile`, the est-file byte layout.
- Produces:
  - `const EST_TABLE: Record<string, Record<number, number>>` — keyed `"Head"|"Body"|"Hair"|"Face"` → `{ [ (race<<16)|setId ]: skelId }`. (Or an equivalent compact shape the reconstruction reads.)
  - `const EQP_FILE: Uint8Array` (base equipmentparameter.eqp) and `const GMP_FILE: Uint8Array` — only if a corpus case needs the base seed (EQP/GMP never grew; include the extraction but keep the tables behind a documented "seed only if the mod omits the segment" note).

- [ ] **Step 1: Read the est-file format**

Read `Est.cs:362-386` (`GetEstFile`) and `ExtraSkeletonEntry.Read`/`.Write` (grep `class ExtraSkeletonEntry`). Layout: `uint32 count`, then `count` × 6-byte entries; `Read(data, count, i)` decodes race/setId/skelId. Note entries are stored grouped and sorted (`SaveEstFile:388-406` sorts races then sets) — the extractor must produce a lookup, not rely on order.

- [ ] **Step 2: Write the extractor**

Create `scripts/extract-meta-reference.ts`, modelled on `scripts/extract-index-overrides.ts` (same `__dirname` shim + `extractGameFile`). Extract the four est files (`Est.cs:39-45`), parse each into `(race,setId)→skelId`, and write `src/meta/reference/est-table.ts`. Extract `equipmentparameter.eqp` and `gimmickparameter.gmp` (`Eqp.cs:28-29`) to `eqp.ts`/`gmp.ts` as base64/byte arrays. Fail loud (`process.exitCode = 1`) on any parse mismatch. Header each generated file `// GENERATED — regenerate via npx tsx scripts/extract-meta-reference.ts`.

- [ ] **Step 3: Run the extractor (requires a game install + ConsoleTools)**

Run: `npx tsx scripts/extract-meta-reference.ts`
Expected: writes the three generated files; prints entry counts; exit 0. **Measure the est-table size** and note it (expected small — tens of KB).

- [ ] **Step 4: Run gate + commit** (the generated tables are committed source)

Run: `npm run check; npm run typecheck; npm test`
```bash
git add scripts/extract-meta-reference.ts src/meta/reference/est-table.ts src/meta/reference/eqp.ts src/meta/reference/gmp.ts
git commit -m "feat(meta): extract EST/EQP/GMP base-game reference tables (Est.cs/Eqp.cs)"
```

---

### Task 7: EST + EQP/GMP reconstruction

Extend `reconstructMeta` to seed EST from the base est table (mod overrides on top) and EQP/GMP from the base seed when the mod omits them. Burns down the EST `.meta` diffs, including `e5035_met` (Purrfection) and `e6016_met`.

**Files:**
- Modify: `src/meta/reconstruct.ts`
- Test: `src/meta/reconstruct.test.ts` (add cases, incl. hair no-op)

**Interfaces:**
- Consumes: `EST_TABLE` (Task 6), `parseMetaRoot` (Task 4).
- Produces: EST/EQP/GMP handling inside `reconstructMeta` (same signature).

- [ ] **Step 1: Write failing tests (EST expansion with base skelId + hair no-op)**

Add to `src/meta/reconstruct.test.ts` (uses a stub of the est table via dependency injection or a small fixture; if `reconstructMeta` reads `EST_TABLE` directly, assert against real table values for a known item once Task 6 is run). Cover:
- an equipment meta whose EST expands to include race 1601 with the base table's skelId,
- a mod EST value overriding the base for a present race,
- a hair meta (`estType Hair`) whose EST is left byte-identical (no wrong expansion).

```ts
it("hair EST is not force-expanded to new races", () => {
  const est = [{ race: 201, setId: 135, skelId: 136 }];
  const mod: ItemMeta = {
    version: 2, path: "chara/human/c0201/obj/hair/h0135/c0201h0135_hir.meta",
    imc: null, eqp: null, eqdp: null, est, gmp: null,
  };
  // base Hair est for h0135 has no race-1601 entry, so no new race is added.
  expect(reconstructMeta(mod, mod.path).est).toEqual(est);
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement**, **Step 4: run to pass**

Implement in `reconstruct.ts`: when `estType != null`, take the base est table's race set for `primaryId` (the item's setId), build entries `{race, setId: primaryId, skelId: base or mod-override}`, in the base file's canonical order (races sorted per `SaveEstFile`); mod entries override matching races. Port faithfully from `Est.GetExtraSkeletonEntries` (`Est.cs:300-334`) + `ManipulationsToMetadata` apply. EQP/GMP: keep the mod's segment; if absent and base has one, use the base seed. Cite each.

Run: `npx vitest run src/meta/reconstruct.test.ts` (fail → pass across steps).

- [ ] **Step 5: Golden harness — EST metas match; re-bless**

Run: `npm test` then `$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`
Expected: EST `.meta` diffs (incl. `e5035_met`, `e6016_met`) now match; remaining `.meta` baseline entries are IMC-growth only (`e6137_top`, `e0724_top`).

- [ ] **Step 6: Run gate + commit**

Run: `npm run check; npm run typecheck; npm test`
```bash
git add src/meta/reconstruct.ts src/meta/reconstruct.test.ts test/corpus/.upgrade-baseline
git commit -m "feat(meta): EST + EQP/GMP reconstruction (base seed + mod deltas; Est.cs port)"
```

---

### Task 8: IMC extraction (+ measure) + reconstruction → byte-zero

Add base-game IMC so IMC variant lists grow to the base count (`e6137_top` 2→3, `e0724_top` 4→7). This is the last segment; it drives the `.meta` ratchet to byte-zero.

**Files:**
- Create (generated): `src/meta/reference/imc-table.ts`
- Modify: `scripts/extract-meta-reference.ts` (add IMC extraction)
- Modify: `src/meta/reconstruct.ts` (IMC reconstruction)
- Test: `src/meta/reconstruct.test.ts` (IMC growth case)

**Interfaces:**
- Consumes: base `.imc` files (via extractor), the IMC file/entry format.
- Produces: `const IMC_TABLE: Record<string, Uint8Array[]>` keyed `"<itemType>/<primaryId>/<slot>"` → ordered 6-byte variant entries (the meta's IMC section as base ships it).

- [ ] **Step 1: Read the IMC format**

Read `Imc.cs` — the file header (`SubsetCount`, `TypeIdentifier`, `Imc.cs:464-477`), per-variant per-slot entry layout, `SerializeEntry`/`DeserializeEntry` (`Imc.cs:310-330`), and how a slot's variant entries are selected (the meta's IMC section = this item/slot's entries across variants 0..SubsetCount). Confine this parsing to the **extractor** so runtime stays simple.

- [ ] **Step 2: Extend the extractor to build the IMC table; measure it**

In `scripts/extract-meta-reference.ts`, for every item root the corpus touches (enumerate from the est/eqdp item sets, or from `item_sets.db`), extract its `.imc`, parse per the format above, and emit `(itemType, primaryId, slot) → variantEntryBytes[]`. Write `src/meta/reference/imc-table.ts`.

Run: `npx tsx scripts/extract-meta-reference.ts`
**Measure `imc-table.ts` size and record it.** Per the spec's decision gate: if a few MB (≈ `item_sets.db`), bundle as-is; if large, reduce (e.g. omit items whose full variant set the corpus never trims) or stage — and note the tradeoff in the file header + `BACKLOG.md`.

- [ ] **Step 3: Write the failing IMC test**

```ts
it("grows IMC to the base variant count, mod entries overriding", () => {
  // Mod meta for e0724_top with 4 variants; base has 7. Expect 7 out, mod's 4 preserved.
  // (Fill concrete bytes from IMC_TABLE once Task 8 extraction is run.)
});
```

- [ ] **Step 4: Implement IMC reconstruction**

In `reconstruct.ts`: seed the IMC section from `IMC_TABLE[key]`; overlay the mod's IMC entries by variant index (index 0..mod.imc.length-1); keep base entries for higher variants. Ports `ManipulationsToMetadata`'s "grow to fit + override" (`PMP.cs:455-480`). If the key is missing from the table (base-game item not extracted), **throw** (fail loud) — do not silently emit the mod's short list.

- [ ] **Step 5: Golden harness — all `.meta` byte-zero; re-bless**

Run: `npm test`
Expected: `e6137_top`, `e0724_top` IMC metas now match. Confirm **no `.meta` entries remain** in any baseline:
```powershell
Get-ChildItem test\corpus\.upgrade-baseline\*.json | ForEach-Object { (Get-Content $_ -Raw | ConvertFrom-Json) | Where-Object { $_.gamePath -like '*.meta' } } | Measure-Object | Select-Object -ExpandProperty Count
```
Expected: `0`. Re-bless to drop them: `$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`.

- [ ] **Step 6: Run gate + commit**

Run: `npm run check; npm run typecheck; npm test`
```bash
git add scripts/extract-meta-reference.ts src/meta/reference/imc-table.ts src/meta/reconstruct.ts src/meta/reconstruct.test.ts test/corpus/.upgrade-baseline
git commit -m "feat(meta): IMC reconstruction + base IMC table -> .meta ratchet byte-zero (Imc.cs port)"
```

---

### Task 9: Roadmap + backlog burndown

Record the round as shipped and update the living docs.

**Files:**
- Modify: `docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md` (§8.2/§8.3 round 5 → shipped)
- Modify: `BACKLOG.md` (remove the "Metadata round" prioritized item; note any IMC-table sizing follow-up if one was recorded in Task 8)
- Delete: `docs/superpowers/plans/2026-07-10-metadata-round.md` (this plan — per AGENTS.md, plans are deleted once merged)

- [ ] **Step 1: Update the roadmap** — mark round 5 shipped in §8.2 and update the §8.3 burndown (`.meta` → byte-zero), citing `src/meta/` and the round-5 spec.
- [ ] **Step 2: Update `BACKLOG.md`** — drop the completed "Metadata round" prioritized entry; add any IMC-sizing follow-up surfaced in Task 8.
- [ ] **Step 3: Delete this plan file.**
- [ ] **Step 4: Run gate + commit**

Run: `npm run check; npm run typecheck; npm test`
```bash
git add -A
git commit -m "docs: metadata round (round 5) shipped — roadmap burndown, remove plan"
```

---

## Notes for the implementer

- **Incremental burndown is the design.** Tasks 5→7→8 each shrink the `.meta` ratchet (EQDP → EST → IMC); re-bless after each so regressions in later work are caught against the tighter baseline.
- **The codec round-trip test (Task 3) is the safety net** — if it ever fails, a serialize/deserialize bug is corrupting bytes; fix it before touching reconstruction.
- **Fail loud** on any unmapped slot/est type (Task 4) or missing IMC key (Task 8). A silent wrong `.meta` corrupts a mod and can slip the golden diff.
- **EQDP needs no base data** — do not add an EQDP extraction; it's an explicit non-dependency (spec §3.3).
- Read the cited C# for each task before porting; this repo's method is "reproduce TexTools, don't invent."
