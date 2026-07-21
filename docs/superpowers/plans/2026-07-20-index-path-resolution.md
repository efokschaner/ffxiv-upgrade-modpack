# Faithful index-path (`_id.tex`) resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the corpus-scoped, silently-falling-back `INDEX_PATH_OVERRIDES` table with a complete,
enumerated, compressed index-path resolver that faithfully ports `EndwalkerUpgrade.cs:923-936`.

**Architecture:** A native (no-ConsoleTools) game-dat reader enumerates every base-game material that has an
index sampler — seeded from `item_sets.db` roots + the hair grid, walked down models → materials — and reads
each one's index-sampler path. The result is emitted as a compressed, hash-keyed runtime table (one bit per
material for the regular case + a small exceptions map) plus an `_id.tex` membership set for gate B. The
runtime in `material.ts` ports all three C# reads.

**Tech Stack:** TypeScript, `tsx` for scripts, `node:sqlite` (`--experimental-sqlite`) for `item_sets.db`,
existing `src/sqpack` decoders and `src/mtrl` / `src/mdl` parsers, Biome, the custom test runner.

## Global Constraints

- **Every business-logic line cites its C# source** (`file · symbol · lines`) in a header/comment. Port from
  `reference/`, not memory. Extraction tooling under `scripts/` cites the C# read it stands in for.
- **`reference/` is read-only.** Never edit/lint/format it.
- **JSON compared semantically; binary compared byte-for-byte.** This change touches `.mtrl` bytes and
  `.tex` member names — byte-parity territory. The `/upgrade` goldens must stay byte-exact except where a
  ratchet baseline is re-blessed to *empty* (a burn-down, never a new suppression).
- **Fail loud, never silently diverge.** A resolver miss must mean "genuinely not a base material with an
  index sampler" — guaranteed by the extractor's completeness cross-check, not hoped for.
- **End-of-task ritual (required before declaring any task done):** `npm run check`, `npm run typecheck`,
  `npm test` — all green.
- **Generated tables are committed** (like `imc-table.ts`, `hair-texture-index.ts`). The extractor needs a
  local game install; a fresh clone uses the committed tables.
- **Game install path:** `C:\Program Files (x86)\Steam\steamapps\common\FINAL FANTASY XIV Online\game\sqpack\ffxiv`
  (see `scripts/extract-hair-texture-index.ts:12-13`).

---

## File Structure

- `scripts/lib/game-index.ts` — **modify**: add offset retention + `read(gamePath)` native dat reader.
- `scripts/extract-index-table.ts` — **create**: the item-seeded enumerator (replaces `extract-index-overrides.ts`).
- `scripts/extract-index-overrides.ts` — **delete**.
- `src/upgrade/reference/index-table.ts` — **create (generated)**: `INDEX_PACKED` (10-byte
  hash+version+bit records), `INDEX_EXCEPTIONS` map (true cross-root cases), `ID_TEX_PACKED` set.
- `src/upgrade/reference/index-path-overrides.ts` — **delete**.
- `src/upgrade/reference/index-path-reconstruct.ts` — **create**: `reconstructIndexPath(materialPath,
  keepLetter)` — the one pure regular-case reconstruction, imported by **both** the extractor (Task 3) and
  the runtime resolver (Task 4), so the logic lives in exactly one place (no script/runtime duplication).
- `src/upgrade/reference/index-path-resolver.ts` — **create**: `resolveStolenIndexPath(materialPath)` +
  `idTexExists(path)` (runtime logic; mirrors `hair-texture-exists.ts`).
- `src/upgrade/material.ts` — **modify** `:135-147`: port gate A (table membership) + gate B + steal.
- `test/upgrade/index-path-resolver.test.ts` — **create**: encoder round-trip, gate-B, reconstruction.
- `scripts/generate-synthetics/build-synthetic-index-fallback.ts` — **create**: the §1.1 edge-case pack.
- `docs/backlog/2026-07-10-index-path-overrides-e0208.md` and
  `docs/backlog/2026-07-20-hair-texture-exists-namespace-scope.md` — **modify** (T4 closed; sibling gets the
  shared pattern reference).

---

## Task 1: Native dat reader in `game-index.ts`

**Files:**
- Modify: `scripts/lib/game-index.ts`
- Test: `scripts/probes/probe-dat-read.ts` (a throwaway manual check; not wired into the suite)

**Interfaces:**
- Produces: `GameIndex.read(gamePath: string): Uint8Array` — decompressed bytes of a base-game file, or
  throws if the path is absent. `GameIndex.fileExists` unchanged.

- [ ] **Step 1: Add offset retention.** In `GameIndex.load`, alongside the existing `entries` Set, build a
  `Map<string, number>` from `${folderHash}:${fileHash}` → the raw `dataOffset` int32 read at `p + 8`
  (FileIndexEntry: `dataFileOffset` @ +8, per `IndexFile.cs`). Keep the existing membership Set.

```ts
private readonly offsets = new Map<string, number>(); // `${folderHash}:${fileHash}` -> raw dataOffset
// in load(), inside the loop:
const rawOffset = buf.readUInt32LE(p + 8) >>> 0;
gi.offsets.set(`${folderHash}:${fileHash}`, rawOffset);
```

- [ ] **Step 2: Add the native reader.** Decode `(datFileId, byteOffset)` and read the SqPack entry from the
  matching `.dat`, then decompress via the existing decoder. Cite `IndexFile.cs` (offset encoding) and
  `Dat.cs` (entry header → length).

```ts
import { decodeSqPackFile } from "../../src/sqpack/sqpack";
// ...
/** Reads and decompresses a base-game file by path. Ports IndexFile offset decode + Dat.ReadSqPackFile.
 *  Extraction tooling only. Throws if the path is absent in the 040000 index. */
read(gamePath: string): Uint8Array {
  const slash = gamePath.lastIndexOf("/");
  const key = `${computeHash(gamePath.slice(0, slash))}:${computeHash(gamePath.slice(slash + 1))}`;
  const raw = this.offsets.get(key);
  if (raw === undefined) throw new Error(`game-index: absent ${gamePath}`);
  // IndexFile.cs: bit0 flag, bits1-3 dat number, remainder<<3 is the byte offset.
  const datNum = (raw & 0x0e) >> 1;
  const byteOffset = (raw & ~0xf) * 8;
  const dat = readFileSync(join(this.sqpackDir, `040000.win32.dat${datNum}`));
  // Dat entry header (Dat.cs): headerSize @0; type @4; then the block table. The total on-disk
  // length is headerSize + sum of the compressed block sizes. Read the header, compute length, slice.
  const headerSize = dat.readUInt32LE(byteOffset);
  const header = dat.subarray(byteOffset, byteOffset + headerSize);
  const total = headerSize + entryBodyLength(header); // see Step 3
  const entry = new Uint8Array(dat.subarray(byteOffset, byteOffset + total));
  return decodeSqPackFile(entry).data;
}
```

Store `sqpackDir` on the instance in `load` (add a private field + assign).

- [ ] **Step 3: Implement `entryBodyLength(header)`** by reading the block table per the entry type
  (`type2`/`type3`/`type4` layouts in `Dat.cs`). Transcribe the block-count/offset/size fields from
  `Dat.cs · ReadSqPackFile` (Type 2: block table of `(offset, compressedSize, decompressedSize)`; the body
  length is the max `blockOffset + compressedBlockOnDiskSize`). Cite exact lines.

- [ ] **Step 4: Manual verification.** Write `scripts/probes/probe-dat-read.ts` that reads a known material
  (`chara/equipment/e0194/material/v0001/mt_c0201e0194_top_a.mtrl`) via `GameIndex.read`, `parseMtrl`s it,
  and prints its index-sampler path.

Run: `npx tsx scripts/probes/probe-dat-read.ts`
Expected: prints `chara/equipment/e0194/texture/v01_c0201e0194_top_id.tex` (matches the ConsoleTools probe).

- [ ] **Step 5: Commit.**

```powershell
git add scripts/lib/game-index.ts scripts/probes/probe-dat-read.ts
git commit -m "feat(scripts): native SqPack dat reader in GameIndex (no ConsoleTools)"
```

---

## Task 2: Enumerator core — item-seeded material walk

**Files:**
- Create: `scripts/extract-index-table.ts`

**Interfaces:**
- Produces (internal to this script, consumed by Task 3): `pairs: Map<string, string>` (materialPath →
  indexPath) and `idTexPaths: Set<string>` (every base-game `_id.tex` observed).

- [ ] **Step 1: Header + roots.** Create the script with a provenance header citing
  `XivDependencyGraph.GetChildFiles`, `Mdl.GetReferencedMaterialPaths`, `XivDependencyRoot.GetModelPath` /
  `GetMaterialPath` (`XivDependencyRoot.cs:228-300`), and `item_sets.db`. Read the `roots` table exactly as
  `extract-meta-reference.ts:279-307` does (`primary_type IN ('equipment','accessory','weapon','monster','demihuman')`,
  selecting `primary_type, primary_id, secondary_type, secondary_id, slot, root_path`). Load
  `GameIndex.load(SQPACK)`.

- [ ] **Step 2: Model-path derivation.** Port `GetModelPath` (`XivDependencyRoot.cs:228-249`): equipment and
  accessory use **racial** model names (`GetRacialModelName` over the race grid already in
  `extract-hair-texture-index.ts:16-55`); weapon/monster/demihuman use the simple model name
  (`GetSimpleModelName`, `:418-425`). Transcribe the `RootFolderFormatPrimary/Secondary`,
  `BaseFileFormatWithSlot/NoSlot`, and racial/simple `ModelNameFormat` strings from `XivDependencyRoot.cs`
  and `XivItemTypes.cs` (`GetSystemName`/`GetSystemPrefix`). Keep only model paths present in the index
  (`gameIndex.fileExists`).

- [ ] **Step 3: Model → material names.** For each present model, `GameIndex.read` it, `readModel` (from
  `src/mdl/model/read-model.ts`) it, and take `pathData.materialList` — the referenced material basenames
  (e.g. `/mt_c0201e0194_top_a.mtrl`). These carry the real variant letters; do **not** invent them.

- [ ] **Step 4: Material version-folder expansion (existence-probing).** For each material basename from the
  model's `materialList` (strip any leading `/`), build `{rootFolder}material/v{N:D4}/{basename}` for
  `N = 1..MAX` (use `const MAX_MATERIAL_VERSION = 64`) and keep every path that `gameIndex.fileExists`.
  Deduplicate across models (many models share materials — use a `Set`). This is a deliberate substitute for
  an IMC-set expansion: gate A is a pure `FileExists(MTRLPath)` (`EndwalkerUpgrade.cs:926`), so probing every
  existing version folder is exactly right and needs no IMC parsing. `rootFolder` is the model path up to and
  including the `.../` before `model/` (e.g. model `chara/equipment/e0194/model/c0201e0194_top.mdl` →
  rootFolder `chara/equipment/e0194/`). **Fail-loud guard:** if any material exists at `v{MAX_MATERIAL_VERSION:D4}`,
  push a problem and set `process.exitCode = 1` — the bound is too low and must be raised.

- [ ] **Step 5: Material → index sampler.** For each present material, `GameIndex.read` + `parseMtrl`
  (`src/mtrl/mtrl.ts`), find the index sampler
  (`samplerIdToTexUsage(t.sampler.samplerIdRaw, mtrl) === XivTexType.Index`). If present, record
  `pairs.set(materialPath, idx.texturePath)` and `idTexPaths.add(idx.texturePath)`. Materials with no index
  sampler record nothing.

- [ ] **Step 6: Smoke run.** Add an `INDEX_LIMIT` env guard (like `IMC_LIMIT`) that truncates the roots to
  the first N so a smoke run is fast. Log counts (roots, models present, materials present, pairs,
  idTexPaths).

Run: `$env:INDEX_LIMIT=50; npx tsx scripts/extract-index-table.ts; Remove-Item Env:\INDEX_LIMIT`
Expected: nonzero pairs; the e0194 pair present; no crash.

- [ ] **Step 7: Commit** (script only; table emission is Task 3).

```powershell
git add scripts/extract-index-table.ts
git commit -m "feat(scripts): item-seeded index-table enumerator core (no emission yet)"
```

---

## Task 3: Compression encoder + table emission + full run

**Files:**
- Modify: `scripts/extract-index-table.ts` (add the encoder + `writeFileSync`)
- Create (generated by the run): `src/upgrade/reference/index-table.ts`

**Interfaces:**
- Produces the generated module exporting: `INDEX_PACKED: string` (base64 10-byte records —
  `(folderHash u32, fileHash u32, version-with-keepLetter-flag u16)` LE), `INDEX_EXCEPTIONS:
  Record<string, string>` (materialPath → full indexPath), `ID_TEX_PACKED: string` (base64
  `(folderHash,fileHash)` pairs, LE u32, like `HAIR_TEX_INDEX_PACKED`).

- [ ] **Step 1: Create the shared reconstruction module** `src/upgrade/reference/index-path-reconstruct.ts`
  (imported here by the extractor **and** by the runtime resolver in Task 4 — one definition, no
  duplication). Given a material path, produce the regular-case index path for a given `keepLetter` boolean:

```ts
// src/upgrade/reference/index-path-reconstruct.ts
// The regular-case base-material index path, derived from the material path plus the two non-derivable
// values the extractor stores per material: the texture VERSION number and the keep-variant-letter bit.
// TexTools reads this whole path from the base material (EndwalkerUpgrade.cs:923-936); we store only what
// cannot be derived from the material path string. NOTE: `version` is the index-TEXTURE version prefix,
// which is NOT the material's own folder version (they diverge for most equipment — see Task 3). Shared by
// scripts/extract-index-table.ts (encoder) and index-path-resolver.ts (runtime).
// mt_c0201e0194_top_a.mtrl + (version 1, keepLetter false)  ->  .../texture/v01_c0201e0194_top_id.tex
export function reconstructIndexPath(
  materialPath: string,
  version: number,
  keepLetter: boolean,
): string | null {
  const m = materialPath.match(/^(.*)\/material\/v\d{4}\/mt_(.+)\.mtrl$/);
  if (!m) return null;
  const [, root, name] = m;
  const vv = String(version).padStart(2, "0");                     // 1 -> "01" ; 18 -> "18" ; 100 -> "100"
  const body = keepLetter ? name! : name!.replace(/_[a-z]$/, "");
  return `${root}/texture/v${vv}_${body}_id.tex`;
}
```

  The extractor imports it: `import { reconstructIndexPath } from "../src/upgrade/reference/index-path-reconstruct";`

- [ ] **Step 2: Classify each pair by deriving `(version, keepLetter)`.** For each
  `(materialPath, indexPath)`: parse the observed index path with
  `/^(.*)\/texture\/v(\d+)_(.+)_id\.tex$/`. If it matches, its root equals the material's root, and its
  name equals the material name (keepLetter=true) or the material name minus a trailing `_[a-z]`
  (keepLetter=false) — i.e. `reconstructIndexPath(materialPath, version, keepLetter) === indexPath` for the
  parsed `version` and that `keepLetter` — record a **regular** entry `(materialPath, version, keepLetter)`.
  Otherwise record `EXCEPTIONS[materialPath] = indexPath` (the true cross-root / non-conforming ~1.9k, e.g.
  `chara/common/texture/id_N.tex`). Log the regular vs exception counts (and the max version seen).

- [ ] **Step 3: Pack the regular table.** Emit fixed 10-byte records — `computeHash(folder)` u32,
  `computeHash(file)` u32, then a u16 holding `version | (keepLetter ? 0x8000 : 0)` (version ≤ 0x7fff, and
  the extractor asserts this — the observed max is well under 100). Sort by `(folderHash, fileHash)` for a
  stable diff; base64. This mirrors `extract-hair-texture-index.ts:87-101` but with the extra u16 per
  record. Pack `ID_TEX_PACKED` from `idTexPaths` in the plain 8-byte `(folderHash, fileHash)` form
  (identical to `hair-texture-index.ts`).

- [ ] **Step 4: Emit** `src/upgrade/reference/index-table.ts` with a GENERATED header citing
  `EndwalkerUpgrade.cs:923-936` and this extractor, exporting: `INDEX_PACKED: string` (the 10-byte records),
  `INDEX_EXCEPTIONS: Record<string, string>` (materialPath → full indexPath), and `ID_TEX_PACKED: string`.
  Exclude the file from Biome formatting in `biome.jsonc` (it exceeds the 1 MiB `files.maxSize`; same
  pattern as `imc-table.ts`).

- [ ] **Step 5: Completeness cross-check (fail-loud).** After building `pairs`, assert every base material
  referenced by the local corpus is covered. Reuse the corpus-scan approach: for each corpus input with a
  cached golden, load it, find every `.mtrl` gamePath that `gameIndex.fileExists`, and assert it is either in
  `pairs` (has an index sampler) or was read and genuinely had none. Collect misses into `problems`; if any,
  print them and `process.exitCode = 1` (pattern: `extract-index-overrides.ts:179-184`). This is the
  regression guard the item demands.

- [ ] **Step 6: Full run.**

Run: `npx tsx scripts/extract-index-table.ts`
Expected: `wrote … index entries (DROP=… KEEP=… EXCEPTIONS=…)`, 0 problems, exit 0. `EXCEPTIONS` contains
the hair-`_acc` → `chara/common/texture/id_*.tex` cases.

- [ ] **Step 7: Sanity-check the generated file** builds: `npm run typecheck`.

- [ ] **Step 8: Commit** the script changes and the generated table.

```powershell
git add scripts/extract-index-table.ts src/upgrade/reference/index-table.ts
git commit -m "feat(reference): generate complete compressed index-table + id_tex membership"
```

---

## Task 4: Runtime resolver

**Files:**
- Create: `src/upgrade/reference/index-path-resolver.ts`
- Test: `test/upgrade/index-path-resolver.test.ts`

**Interfaces:**
- Consumes: `INDEX_PACKED`, `INDEX_EXCEPTIONS`, `ID_TEX_PACKED` from `index-table.ts`; `reconstructIndexPath`
  from `index-path-reconstruct.ts`.
- Produces: `resolveStolenIndexPath(materialPath: string): string | undefined` (the base material's index
  path, or `undefined` if not a base material with an index sampler) and `idTexExists(path: string):
  boolean`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { idTexExists, resolveStolenIndexPath } from "../../src/upgrade/reference/index-path-resolver";

describe("index-path-resolver", () => {
  it("drops the variant letter where the game does (e0194)", () => {
    expect(resolveStolenIndexPath("chara/equipment/e0194/material/v0001/mt_c0201e0194_top_a.mtrl"))
      .toBe("chara/equipment/e0194/texture/v01_c0201e0194_top_id.tex");
  });
  it("keeps the variant letter where the game does (e0100)", () => {
    expect(resolveStolenIndexPath("chara/equipment/e0100/material/v0001/mt_c0101e0100_top_a.mtrl"))
      .toBe("chara/equipment/e0100/texture/v01_c0101e0100_top_a_id.tex");
  });
  it("returns undefined for a non-base material path", () => {
    expect(resolveStolenIndexPath("chara/equipment/e9999/material/v0001/mt_c0101e9999_xyz_a.mtrl"))
      .toBeUndefined();
  });
  it("idTexExists is true for a real base index texture, false otherwise", () => {
    expect(idTexExists("chara/equipment/e0194/texture/v01_c0201e0194_top_id.tex")).toBe(true);
    expect(idTexExists("chara/equipment/e0194/texture/made_up_a_id.tex")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** (module missing).

Run: `npm test -- index-path-resolver`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement the resolver** mirroring `hair-texture-exists.ts` (duplicate the `computeHash`
  CRC32 — the codebase already keeps a per-table copy; note the shared origin in a comment). Decode
  `INDEX_PACKED` into a `Map<string, { version: number; keepLetter: boolean }>` keyed by `"fh:xh"` (read
  each 10-byte record: folderHash u32, fileHash u32, then u16 → `version = u16 & 0x7fff`,
  `keepLetter = (u16 & 0x8000) !== 0`). `resolveStolenIndexPath`: check `INDEX_EXCEPTIONS[materialPath]`
  first (return it); else hash the material path, look up the map; on a hit reconstruct via
  `reconstructIndexPath(materialPath, rec.version, rec.keepLetter)` **imported from**
  `./index-path-reconstruct` (the same module the extractor uses — do not re-implement it); else
  `undefined`. `idTexExists` decodes `ID_TEX_PACKED` into a `Set<string>` and does the membership check like
  `hairTextureExists`.

```ts
// Runtime port of EndwalkerUpgrade.cs:923-936's base-material index-path steal. Data: index-table.ts
// (generated by scripts/extract-index-table.ts). CRC32 duplicated from hair-texture-exists.ts by the
// same codebase convention (per-table copy).
// TABLE is Map<"fh:xh", { version: number; keepLetter: boolean }> decoded from INDEX_PACKED's 10-byte
// records (u16 -> version = u16 & 0x7fff, keepLetter = (u16 & 0x8000) !== 0).
export function resolveStolenIndexPath(materialPath: string): string | undefined {
  const ex = INDEX_EXCEPTIONS[materialPath];
  if (ex !== undefined) return ex;
  const slash = materialPath.lastIndexOf("/");
  const key = `${computeHash(materialPath.slice(0, slash))}:${computeHash(materialPath.slice(slash + 1))}`;
  const rec = TABLE.get(key);
  if (rec !== undefined)
    return reconstructIndexPath(materialPath, rec.version, rec.keepLetter) ?? undefined;
  return undefined;
}
```

- [ ] **Step 4: Run tests, verify pass.**

Run: `npm test -- index-path-resolver`
Expected: PASS (assuming the generated table from Task 3 contains e0194/e0100; if e0100 wasn't corpus-seeded,
it still enumerates from the game, so it is present).

- [ ] **Step 5: Commit.**

```powershell
git add src/upgrade/reference/index-path-resolver.ts test/upgrade/index-path-resolver.test.ts
git commit -m "feat(upgrade): runtime index-path resolver (gate A + reconstruction + id_tex membership)"
```

---

## Task 5: Wire the resolver into `material.ts` (gate A + gate B + steal)

**Files:**
- Modify: `src/upgrade/material.ts:135-147`

**Interfaces:**
- Consumes: `resolveStolenIndexPath`, `idTexExists`.

- [ ] **Step 1: Replace the override block.** Swap the `INDEX_PATH_OVERRIDES` import + `:144-147` block for
  the faithful three-read port:

```ts
import { idTexExists, resolveStolenIndexPath } from "./reference/index-path-resolver";
// ...
// EndwalkerUpgrade.cs:923-936. Gate A (mod overwrites a base material with an index sampler) is answered by
// the resolver's table membership; gate B (!FileExists(convention idPath)) by idTexExists. When both hold,
// steal the base material's own index-sampler path. Complete over the enumerated domain (see
// scripts/extract-index-table.ts) — a miss means genuinely-not-a-base-material, a faithful convention keep.
const stolen = resolveStolenIndexPath(mtrl.mtrlPath);
if (stolen !== undefined && !idTexExists(idPath)) {
  idPath = stolen;
}
```

- [ ] **Step 2: Typecheck + full suite** (the corpus `upgrade` check exercises this on real packs).

Run: `npm run typecheck; npm test`
Expected: typecheck clean. The corpus `upgrade` check may now FAIL on the affected packs because the output
*changed* (it now matches the golden where it previously diverged into a baseline entry) — that is expected
and handled by the re-bless in Task 6. No **new** unrelated failures.

- [ ] **Step 3: Commit.**

```powershell
git add src/upgrade/material.ts
git commit -m "feat(upgrade): port EndwalkerUpgrade idPath refinement faithfully (gates A+B, steal)"
```

---

## Task 6: Delete the old table, re-bless the corpus, close the item

**Files:**
- Delete: `scripts/extract-index-overrides.ts`, `src/upgrade/reference/index-path-overrides.ts`
- Modify: `docs/backlog/2026-07-10-index-path-overrides-e0208.md` (delete — item shipped),
  `docs/BACKLOG.md` (remove the T4 index entry), `docs/backlog/2026-07-20-hair-texture-exists-namespace-scope.md`
  (note the shared enumeration pattern now exists)

- [ ] **Step 1: Grep for dangling references** to the deleted modules/item and fix each.

Run: `rg "index-path-overrides|INDEX_PATH_OVERRIDES|2026-07-10-index-path-overrides-e0208" -l`
Expected: only the files this task deletes/edits. Fix any straggler (e.g. the material-colorset spec §6 note
that cited the 11-entry table — update it to point at this design).

- [ ] **Step 2: Delete** the old extractor, the old generated table, and the shipped backlog item file.

- [ ] **Step 3: Re-bless the corpus ratchet** so the now-fixed packs burn down to empty (not suppressed).

Run: `$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`
Then inspect the diff of `test/corpus/.upgrade-baseline/`: the affected `.mtrl` / `#…:added` entries for the
index-path packs must **disappear** (burn-down). If any *new* entry appears, that is a regression — stop and
investigate, do not commit the bless.

- [ ] **Step 4: Update `docs/BACKLOG.md`** — remove the T4 entry (item 1 in Prioritized) and renumber the
  ranking note if needed. Note in the sibling `hair-texture-exists` item that the item-seeded enumeration
  pattern (`scripts/extract-index-table.ts`) is the template to adopt.

- [ ] **Step 5: Full ritual.**

Run: `npm run check; npm run typecheck; npm test`
Expected: all green.

- [ ] **Step 6: Commit.**

```powershell
git add -A
git commit -m "chore: delete corpus index-overrides table; re-bless corpus; close T4"
```

---

## Task 7: Synthetic golden for the edge case

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-index-fallback.ts`
- Modify: `package.json` (`synthetics` script already fans over the builders — confirm it is picked up)

- [ ] **Step 1: Author the pack.** Using `scripts/generate-synthetics/pmp-builder.ts`, build a minimal pack
  that overwrites a base-game equipment material's **colorset** (a base material known to have an index
  sampler, e.g. e0194) **without** including that material's normal `.tex` in the same option — the §1.1
  edge case (index reference added, no index generated). Follow an existing builder
  (`build-synthetic-f1.ts`) for structure and the byte-reproducible zip mtime pinning.

- [ ] **Step 2: Build + generate the golden.**

Run: `npm run synthetics; npm test`
Expected: the new synthetic pack gets a real ConsoleTools `/upgrade` golden; its `upgrade` check runs. With
the resolver in place it should **fully match** (we now emit the canonical, in-game path TexTools does). If
it does not fully match, either the resolver has a gap or the divergence is intended — investigate before
baselining.

- [ ] **Step 3: Confirm no baseline entry is needed** for the synthetic (full match). If a baseline entry is
  required, that is a finding — stop and investigate.

- [ ] **Step 4: Commit.**

```powershell
git add scripts/generate-synthetics/build-synthetic-index-fallback.ts package.json
git commit -m "test(synthetic): edge-case pack — base-material overwrite without shipped normal"
```

---

## Self-Review notes

- **Spec §3.1 (runtime, gates A+B, steal)** → Task 5. **§3.2 (compressed tables)** → Tasks 3+4. **§3.3
  (item-seeded enumerator)** → Task 2. **§3.4 (native dat reader)** → Task 1. **§3.5 (completeness)** →
  Task 3 Step 5. **§4 (delete old)** → Task 6. **§5 (tests)** → Tasks 4 (unit), 6 (ratchet), 7 (synthetic
  golden).** §1.1 edge case** → Task 7.
- **Type consistency:** `resolveStolenIndexPath` / `idTexExists` / `reconstructIndexPath(materialPath,
  version, keepLetter)` / `INDEX_PACKED` / `INDEX_EXCEPTIONS` / `ID_TEX_PACKED` used consistently across
  Tasks 3–5. `GameIndex.read` defined in Task 1, consumed in Task 2.
- **Known risk to watch during execution:** the `entryBodyLength` transcription (Task 1 Step 3) is the
  fiddliest port; the Task 1 Step 4 manual check against the known e0194 index path is the guard. If Type 3
  (model) and Type 2 (material) entry layouts differ enough to complicate one function, split
  `entryBodyLength` by type — both are in `Dat.cs`.
