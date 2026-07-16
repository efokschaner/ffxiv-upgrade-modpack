# Dict-ported-as-array fidelity sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three keyed-C#-collection-ported-as-array mis-ports with the JS structures that mirror them — `ModpackOption.files` and `ItemMeta.eqdp`/`ItemMeta.est` become `Map`s — with zero change to `/upgrade` golden bytes.

**Architecture:** Spec `docs/superpowers/specs/2026-07-15-dict-as-array-fidelity-design.md`. Part 1 (`option.files`) lands in two green commits — first `array → Map` keeping `gamePath` redundant on the value, then dropping `gamePath` so the key is the sole source of truth and `allFiles` re-attaches it as a `{ gamePath, file }` pair (mirroring C#'s `FileIdentifier`). Part 2 (`eqdp`/`est`) is independent and lands separately. Every task ends with the full suite green, which is the byte-parity proof.

**Tech Stack:** TypeScript (strict), Biome (format/lint), custom parallel test runner, v8 coverage. No new dependencies.

## Global Constraints

Copied from the spec and AGENTS.md; every task's requirements implicitly include these:

- **Byte-parity is the gate.** The `/upgrade` golden harness must stay byte-exact across the whole corpus, and `/resave` baselines must not regress. This is a structural reshape: **no golden may move, and no `DIVERGENCE_RULES` entry may be added.** If any golden diff appears, stop — it's a bug in the reshape, not an intended divergence.
- **Provenance.** Any comment that changes must keep its cited C# source (`file · symbol · lines`). Do not remove existing citations.
- **No blending.** Keep each member with its original C# owner; this plan only reshapes storage types, it does not move logic between modules.
- **Formatting is mechanical.** Run `npm run check` (Biome) — never hand-format.
- **No new deps.** Nothing here needs one. If that changes, stop and ask (`.npmrc save-exact`, ≥7-day min release age).
- **End-of-task ritual (required, every task):** `npm run check` → `npm run typecheck` → `npm test`, all green, before the task is done.
- **The compiler is the worklist.** For the two cross-cutting tasks (1 and 2), the model type change breaks every consumer at once by design. `npm run typecheck` enumerates every site to fix; the task is complete when typecheck and the full suite are green. The per-area checklists below are the map; the compiler is the ground truth.

---

## File Structure

**Part 1 — `option.files` (Tasks 1–2)**
- `src/model/modpack.ts` — `ModpackFile` type (Task 2 drops `gamePath`); `ModpackOption.files: Map<string, ModpackFile>`; `allFiles` return type.
- Readers: `src/container/ttmp2.ts`, `src/container/ttmp-legacy.ts`, `src/container/pmp.ts` — build the Map via `.set` in source order.
- Writers: `src/container/ttmp2.ts` (`writeTtmp2`/`buildBlob`/`modOf`), `src/container/pmp.ts` (`reconstructOption` Files loop), `src/container/resolve-duplicates.ts`.
- Prefixes: `src/container/option-prefix.ts` (`isEmptyDefaultOption`).
- Rounds: `src/upgrade/upgrade.ts` (`cloneOption`, `materialRound`/`modelRound`/`metadataRound`, `updateSkinPaths`, `requireBytes`), `src/upgrade/texture.ts` (`findFile`/`writeGeneratedTex`), `src/upgrade/texfix.ts` (`texFixRound`).
- Entry/harness: `src/index.ts` (`allFiles` consumer), `test/helpers/upgrade-diff.ts` (`byGamePath`).
- Tests: fixtures across `test/**` that build option `files` or read `allFiles`.

**Part 2 — `eqdp`/`est` (Task 3)**
- `src/meta/types.ts`, `src/meta/deserialize.ts`, `src/meta/serialize.ts`, `src/meta/reconstruct.ts`, `scripts/probes/probe-v1-meta.ts`, `src/meta/*.test.ts`.

---

## Task 1: `option.files` array → `Map<string, ModpackFile>` (keep `gamePath` on the value)

This task changes only the *container* shape. `ModpackFile` keeps its `gamePath` field for now (redundant with the key), so every `f.gamePath` read still compiles — isolating the container churn from Task 2's field-drop churn. It also lands the last-write-wins collapse regression test, because the Map's collapse behaviour appears here.

**Files:**
- Modify: `src/model/modpack.ts` (`ModpackOption.files`, `allFiles`)
- Modify: `src/container/ttmp2.ts`, `src/container/ttmp-legacy.ts`, `src/container/pmp.ts`, `src/container/resolve-duplicates.ts`, `src/container/option-prefix.ts`
- Modify: `src/upgrade/upgrade.ts`, `src/upgrade/texture.ts`, `src/upgrade/texfix.ts`
- Create/Modify: a test helper for building `files` Maps; fixtures across `test/**`
- Test: `test/container/ttmp2-read.test.ts` (new collapse test)

**Interfaces:**
- Produces: `ModpackOption.files: Map<string, ModpackFile>` (insertion order = source order). `allFiles(data): ModpackFile[]` unchanged in this task (implemented as `flatMap((o) => [...o.files.values()])`).
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing last-write-wins collapse test**

The array reader keeps two entries for a repeated `FullPath`; the C# `Dictionary` collapses to the later (`WizardData.cs:729-737`). This test asserts the collapse and will FAIL against today's array reader (it returns two files), then pass once `files` is a Map built via `.set`. Add to `test/container/ttmp2-read.test.ts` (construct a minimal wizard `.mpl`/`.mpd` with an option whose `ModsJsons` repeats one `FullPath` with two different byte payloads):

```ts
it("collapses a duplicate FullPath within one option last-write-wins (WizardData.cs:729-737)", () => {
  // Two ModsJsons with the same FullPath, different bytes; the later must win.
  const bytesA = new Uint8Array([1, 1, 1]);
  const bytesB = new Uint8Array([2, 2, 2]);
  const ttmp = buildWizardTtmp2({
    groups: [
      {
        name: "G",
        selectionType: "Single",
        options: [
          {
            name: "O",
            mods: [
              { fullPath: "chara/dup.tex", bytes: bytesA },
              { fullPath: "chara/dup.tex", bytes: bytesB },
            ],
          },
        ],
      },
    ],
  });
  const data = readTtmp2(ttmp);
  const files = data.groups[0]!.options[0]!.files;
  expect(files.size).toBe(1);
  expect(files.get("chara/dup.tex")!.data).toEqual(bytesB);
});
```

If `test/container/ttmp2-read.test.ts` has no `buildWizardTtmp2`-style helper, build the `.mpl`/`.mpd` inline the way the file's existing tests do (reuse whatever zip/blob helper they already import). The essential assertions are the three `expect`s.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- ttmp2-read` (or the runner's single-file form). Expected: FAIL — today's reader yields `files.length === 2` / no `.size` / `.get` (array), so the assertions don't hold.

- [ ] **Step 3: Change the model type**

In `src/model/modpack.ts`:
- `ModpackOption.files: ModpackFile[]` → `files: Map<string, ModpackFile>`.
- `allFiles`: `return data.groups.flatMap((g) => g.options.flatMap((o) => o.files));` → `return data.groups.flatMap((g) => g.options.flatMap((o) => [...o.files.values()]));`

Keep `ModpackFile.gamePath` for now (Task 2 removes it).

- [ ] **Step 4: Migrate the readers to build the Map via `.set` (this is the collapse)**

`src/container/ttmp2.ts` — both build sites. Simple-pack (was `files: mpl.SimpleModsList.map((m) => fileFromMod(m, mpd))`) and wizard (`files: o.ModsJsons.map((m) => fileFromMod(m, mpd))`) become a `.set` loop. Add a small local helper and document the collapse with the citation:

```ts
// Build the option's file map in ModsJsons order. Map.set on a repeated FullPath overwrites the
// earlier entry, reproducing C#'s last-write-wins collapse (WizardData.cs:729-737).
function filesFromMods(mods: TtmpModsJson[], mpd: Uint8Array): Map<string, ModpackFile> {
  const files = new Map<string, ModpackFile>();
  for (const m of mods) files.set(m.FullPath, fileFromMod(m, mpd));
  return files;
}
```

Use `filesFromMods(mpl.SimpleModsList, mpd)` and `filesFromMods(o.ModsJsons, mpd)`.

`src/container/ttmp-legacy.ts` — `const files: ModpackFile[] = lines.map(...)` → build a `Map<string, ModpackFile>` via a `.set` loop over `lines` (each parsed `OriginalModPackJson`), keyed by `m.FullPath`, same collapse citation.

`src/container/pmp.ts` `optionFromJson` — `const modFiles: ModpackFile[] = []; ... modFiles.push({...})` → `const modFiles = new Map<string, ModpackFile>(); ... modFiles.set(gamePath, {...})`. (PMP's source `Files` is already a dict, so no collapse occurs, but the shape must match.)

- [ ] **Step 5: Migrate the writers and prefix/dedup consumers**

`src/container/ttmp2.ts` `writeTtmp2`: `allFiles(data)` still returns `ModpackFile[]`, so `buildBlob(files)` and `modOf` are unchanged in this task. The per-option emission `ModsJsons: o.files.map(modOf)` → `ModsJsons: [...o.files.values()].map(modOf)`.

`src/container/pmp.ts` `reconstructOption`: `for (const f of o.files)` → `for (const f of o.files.values())`. `Files[f.gamePath] = ...` still compiles (gamePath retained).

`src/container/resolve-duplicates.ts`: `for (const file of option.files)` → `for (const file of option.files.values())`. `file.gamePath` still compiles. Update header point 3's line "Within an option, `option.files` is already in `Files`-map insertion order (the reader builds it that way, src/container/pmp.ts:81)" to note the store is now literally a `Map` whose iteration order is that insertion order.

`src/container/option-prefix.ts` `isEmptyDefaultOption`: `o.files.length === 0` → `o.files.size === 0`.

- [ ] **Step 6: Migrate the upgrade rounds**

`src/upgrade/upgrade.ts`:
- `cloneOption`: `files: o.files.map(cloneFile)` → `files: new Map([...o.files].map(([p, f]) => [p, cloneFile(f)]))`.
- `materialRound` / `modelRound` / `metadataRound`: each does `option.files = option.files.map((f) => …)`. The key never changes (these transform bytes only), so rebuild a Map preserving order:

```ts
// materialRound example — same pattern for modelRound / metadataRound
const next = new Map<string, ModpackFile>();
for (const [path, f] of option.files) {
  next.set(path, /* the existing per-file transform, unchanged, applied to f */);
}
option.files = next;
```

  Keep every existing per-file body (the `IS_CHARA_MTRL` guard, `resolveFile`, `try/catch`, `restore`, `infos.push`) exactly as-is — only the outer `.map` → Map-rebuild changes.
- `updateSkinPaths`: this is the canonical `ContainsKey`/`Add` transcription and closes the O(n²) review note. Replace:

```ts
export function updateSkinPaths(option: ModpackOption): void {
  const snapshot = [...option.files.values()];
  for (const f of snapshot) {
    const target = SKIN_REPATH_DICT.get(f.gamePath);
    if (target === undefined) continue;
    if (option.files.has(target)) continue;              // C# files.ContainsKey (ModpackUpgrader.cs:487)
    option.files.set(target, { ...f, gamePath: target }); // C# files.Add (ModpackUpgrader.cs:497)
  }
}
```

  Update the function's doc comment: the "checks the LIVE dict for the target" note now maps to `option.files.has(target)` literally.

`src/upgrade/texture.ts`:
- `findFile`: `return option.files.find((f) => f.gamePath === gamePath);` → `return option.files.get(gamePath);`
- `writeGeneratedTex`: `const existing = option.files.findIndex(...); if (existing >= 0) option.files[existing] = file; else option.files.push(file);` → `option.files.set(gamePath, file);` (Map.set replaces in place at the key's existing position, or appends — matching the old findIndex-replace-or-push). Keep the `file` object construction (still has `gamePath` this task).

`src/upgrade/texfix.ts` `texFixRound`: `option.files = option.files.filter((f) => { … })` → iterate and delete, preserving order:

```ts
for (const [path, f] of [...option.files]) {
  if (!IS_TEX.test(f.gamePath)) continue;
  if (IS_UI.test(f.gamePath)) continue;
  if (f.storage !== FileStorageType.SqPackCompressed) continue;
  try { decodeSqPackFile(f.data); } catch { option.files.delete(path); }
}
```

- [ ] **Step 7: Add the test helper and migrate fixtures**

Add a builder so fixtures don't hand-roll Maps. Put it beside the existing pack builders (e.g. `test/helpers/make-packs.ts`) and export it:

```ts
import type { ModpackFile } from "../../src/model/modpack";
/** Build an option's files Map from ordered entries. Keyed by gamePath, insertion order preserved. */
export function filesMap(files: ModpackFile[]): Map<string, ModpackFile> {
  const m = new Map<string, ModpackFile>();
  for (const f of files) m.set(f.gamePath, f);
  return m;
}
```

Then let `npm run typecheck` list every fixture that assigns `files: [ … ]` or reads `option.files` as an array, and fix each: wrap array literals in `filesMap([...])`; change `.length`→`.size`, `.find`→`.get`, `.some(f => f.gamePath === p)`→`.has(p)`, `.push`→`.set`, `.map`/`for..of` over the array → over `.values()` or `[...map]`. `allFiles(...)` consumers are unchanged (still `ModpackFile[]`). `test/helpers/upgrade-diff.ts` `byGamePath` iterates `allFiles(d)` — unchanged this task.

- [ ] **Step 8: Verify the collapse test passes and run the full gate**

Run: `npm test -- ttmp2-read` → the Step 1 test PASSES. Then the full ritual:

Run: `npm run check && npm run typecheck && npm test`
Expected: all green. **Zero golden diffs** — if any corpus `upgrade`/`resave` pack regresses, a mutation reordered or dropped a file; fix before continuing.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(model): option.files array -> Map (mirror the C# Dictionary)"
```

---

## Task 2: Drop `gamePath` from `ModpackFile`; `allFiles` returns `{ gamePath, file }`

Now the game path lives only as the Map key (faithful to `FileStorageInformation`, which carries none — `TransactionDataHandler.cs:42-47`). `allFiles` re-attaches the key as a pair, mirroring `FileIdentifier { Path, Info }` (`PmpExtensions.cs:603-608`). Every `f.gamePath` read must instead take the key from its iteration context.

**Files:**
- Modify: `src/model/modpack.ts` (`ModpackFile` drops `gamePath`; `allFiles` return type)
- Modify: every site that read `f.gamePath` — `src/container/ttmp2.ts`, `pmp.ts`, `resolve-duplicates.ts`; `src/upgrade/upgrade.ts` (`requireBytes`), `texture.ts`, `texfix.ts`; `src/index.ts`; `test/helpers/upgrade-diff.ts`; fixtures.

**Interfaces:**
- Produces: `ModpackFile` = `{ storage, data(, ttmp) }` (no `gamePath`). `allFiles(data): { gamePath: string; file: ModpackFile }[]`.
- Consumes: `ModpackOption.files: Map<string, ModpackFile>` from Task 1.

- [ ] **Step 1: Change the model**

`src/model/modpack.ts`:
- Remove `gamePath` from `ModpackFileBase` (update the surrounding doc comment: the game path is now the `files` Map key, not a field).
- `allFiles`:

```ts
export function allFiles(data: ModpackData): { gamePath: string; file: ModpackFile }[] {
  return data.groups.flatMap((g) =>
    g.options.flatMap((o) => [...o.files].map(([gamePath, file]) => ({ gamePath, file }))),
  );
}
```

- [ ] **Step 2: Run typecheck to enumerate the break sites**

Run: `npm run typecheck`
Expected: errors at every `f.gamePath` read and every `allFiles(...)` consumer. This list is the worklist for Steps 3–5.

- [ ] **Step 3: Thread the key at the container seams**

`src/container/ttmp2.ts`:
- `fileFromMod` no longer sets `gamePath` (build `{ data, storage, ttmp }`). Its caller already keys by `m.FullPath`.
- `writeTtmp2`: `buildBlob` takes `ModpackFile[]`; it doesn't read `gamePath`, so pass `allFiles(data).map((e) => e.file)` — but `modOf` DOES need the path. Refactor the emission to carry the pair: iterate `[...o.files]` (entries) and build each `ModsJsons` entry with `modOf(gamePath, file)`. Change `modOf`'s signature to `modOf(gamePath: string, f: ModpackFile)` and set `FullPath: gamePath`. `buildBlob` keys its dedup on bytes only, so it's unaffected by the field drop (still takes the file list — pass `[...o.files.values()]` per option or the flattened `.file`s, matching its current `allFiles`-fed call).

`src/container/pmp.ts` `optionFromJson`: `modFiles.set(gamePath, { data, storage })` (drop `gamePath` from the object). `reconstructOption`: `for (const [gamePath, f] of o.files) { … Files[gamePath] = zip.replace(...) }` and look up `zipPaths.get(f)` by the file value as before.

`src/container/resolve-duplicates.ts`: `for (const [gamePath, file] of option.files) { entries.push({ file, pmpPath: prefix + gamePath, hash: … }) }`.

- [ ] **Step 4: Thread the key at the upgrade seams**

`src/upgrade/upgrade.ts`:
- `requireBytes(f)` reads `f.gamePath` only in its throw message. Add a `gamePath` param: `requireBytes(f: ModpackFile, gamePath: string)` and use it in the message. Update its three callers (`modelRound`, `metadataRound`, and any other) to pass the key they're already iterating.
- `materialRound`/`modelRound`/`metadataRound`: the Map-rebuild loops already have `[path, f]`; pass `path` where `f.gamePath` was used (guards like `IS_CHARA_MTRL.test(path)`, `parseMtrl(bytes, path)`, `reconstructMeta(deserializeMeta(bytes), path)`).
- `updateSkinPaths`: `SKIN_REPATH_DICT.get(f.gamePath)` — iterate entries instead: `for (const [path, f] of snapshot)` where `snapshot = [...option.files]`; use `path`. The stapled entry becomes `option.files.set(target, { ...f })` (no `gamePath` field to set).

`src/upgrade/texture.ts`:
- `writeGeneratedTex`: build the file object without `gamePath` (`{ storage, data }` for both branches); `option.files.set(gamePath, file)` as in Task 1. The GearMaskNew throw at `old.gamePath` — `old` came from `findFile(option, info.files.mask_old!)`, so use `info.files.mask_old` in the message.

`src/upgrade/texfix.ts`: the delete loop already has `[path, f]`; replace `f.gamePath` in the `IS_TEX`/`IS_UI` tests with `path`.

- [ ] **Step 5: Thread the key at the entry point, harness, and fixtures**

`src/index.ts`: `const bad = allFiles(data).find((f) => f.storage !== needed)` → `.find(({ file }) => file.storage !== needed)`, and the throw's `bad.gamePath`/`bad.storage` → `bad.gamePath` (from the pair) / `bad.file.storage`.

`test/helpers/upgrade-diff.ts` `byGamePath`: `for (const f of allFiles(d)) { const bytes = uncompressed(f); … m.get(f.gamePath) … }` → `for (const { gamePath, file } of allFiles(d)) { const bytes = uncompressed(file); … m.get(gamePath) … }`.

Fixtures: `filesMap` (from Task 1) takes `ModpackFile[]`, which no longer carry `gamePath`. Change its signature to take entries: `filesMap(entries: Array<[string, ModpackFile]>)` (or a `{ gamePath, ...file }[]` shape it destructures). Migrate fixture construction sites the compiler flags — each becomes `filesMap([["chara/x.tex", { storage, data }], …])`. Any test reading `allFiles(...)[i].gamePath` destructures the pair.

- [ ] **Step 6: Run the full gate**

Run: `npm run check && npm run typecheck && npm test`
Expected: all green, **zero golden diffs**. If a `common/N` member name or `ModsJsons` count moved, a key was threaded from the wrong context — fix before committing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(model): drop ModpackFile.gamePath; allFiles re-attaches the key (FileIdentifier shape)"
```

---

## Task 3: `ItemMeta.eqdp` / `est` array → race-keyed `Map` (independent of Tasks 1–2)

Mirror `Dictionary<XivRace, …>` (`ItemMetadata.cs:79/:84`): EQDP → `Map<number, number>` (race → byte, value carries no race), EST → `Map<number, EstEntry>` (value keeps its race, like `ExtraSkeletonEntry`). Reproduce the dict's uniqueness by **throwing on a duplicate race** at deserialize (`ret.Add`, `ItemMetadata.cs:773/:843`).

**Files:**
- Modify: `src/meta/types.ts`, `src/meta/deserialize.ts`, `src/meta/serialize.ts`, `src/meta/reconstruct.ts`, `scripts/probes/probe-v1-meta.ts`
- Test: `src/meta/deserialize.test.ts` (new dup-race throws), `src/meta/serialize.test.ts`, `src/meta/reconstruct.test.ts`

**Interfaces:**
- Produces: `ItemMeta.eqdp: Map<number, number> | null`; `ItemMeta.est: Map<number, EstEntry> | null`; `EqdpEntry` removed; `EstEntry` unchanged (`{ race, setId, skelId }`).

- [ ] **Step 1: Write the failing dup-race throw tests**

In `src/meta/deserialize.test.ts`, add two tests that build a `.meta` byte buffer whose EQDP (5-byte stride) and EST (6-byte stride) segments each repeat a race code, and assert `deserializeMeta` throws. Reuse the file's existing meta-buffer construction helper (mirror an existing deserialize test's setup):

```ts
it("throws on a duplicate EQDP race (ItemMetadata.cs:773 Dictionary.Add)", () => {
  const buf = buildMeta({ eqdp: [{ race: 101, value: 3 }, { race: 101, value: 5 }] });
  expect(() => deserializeMeta(buf)).toThrow(/duplicate.*race/i);
});
it("throws on a duplicate EST race (ItemMetadata.cs:843 Dictionary.Add)", () => {
  const buf = buildMeta({ est: [{ race: 101, setId: 1, skelId: 2 }, { race: 101, setId: 1, skelId: 9 }] });
  expect(() => deserializeMeta(buf)).toThrow(/duplicate.*race/i);
});
```

If no `buildMeta`-style helper exists, serialize a known-good `ItemMeta` via `serializeMeta` first, then hand-append the duplicate row into the raw bytes — or construct the segment bytes directly the way the existing tests do.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- deserialize` (meta). Expected: FAIL — today's array reader silently keeps both rows, no throw.

- [ ] **Step 3: Change the types**

`src/meta/types.ts`:
- Remove the `EqdpEntry` interface.
- `eqdp: EqdpEntry[] | null` → `eqdp: Map<number, number> | null; // race -> EQDP byte; Dictionary<XivRace, EquipmentDeformationParameter>, ItemMetadata.cs:79`
- `est: EstEntry[] | null` → `est: Map<number, EstEntry> | null; // race -> entry; Dictionary<XivRace, ExtraSkeletonEntry>, ItemMetadata.cs:84`
- Keep `EstEntry` (`race`/`setId`/`skelId`); update its comment to note it also serves as the Map value, carrying its own race like `ExtraSkeletonEntry`.

- [ ] **Step 4: Build the Maps in deserialize, throwing on duplicates**

`src/meta/deserialize.ts` — drop the `EqdpEntry` import; keep `EstEntry`. EQDP block:

```ts
const eqdpSeg = firstOfType(TYPE_EQDP);
let eqdp: Map<number, number> | null = null;
if (eqdpSeg) {
  eqdp = new Map();
  for (let o = 0; o < eqdpSeg.size; o += 5) {
    reader.seek(eqdpSeg.offset + o);
    const race = reader.readUint32();
    const value = reader.readUint8();
    // C# ret.Add(race, entry) throws on a repeat (ItemMetadata.cs:773); the array silently kept both.
    if (eqdp.has(race)) throw new Error(`meta: duplicate EQDP race ${race} (ItemMetadata.cs:773)`);
    eqdp.set(race, value);
  }
}
```

EST block, same shape (6-byte stride, `readUint16` ×3), `if (est.has(race)) throw … ItemMetadata.cs:843`, `est.set(race, { race, setId, skelId })`.

- [ ] **Step 5: Iterate the Maps in serialize, keeping the C# key-vs-value race exact**

`src/meta/serialize.ts`:

```ts
function eqdpBytes(m: ItemMeta): Uint8Array {
  const b = new ByteBuilder();
  for (const [race, value] of m.eqdp!) { // key IS the race (ItemMetadata.cs:743 writes kv.Key)
    b.u32(race);
    b.u8(value);
  }
  return b.toUint8Array();
}
function estBytes(m: ItemMeta): Uint8Array {
  const b = new ByteBuilder();
  for (const x of m.est!.values()) { // value's race (ItemMetadata.cs:678 writes kv.Value.Race)
    b.u16(x.race);
    b.u16(x.setId);
    b.u16(x.skelId);
  }
  return b.toUint8Array();
}
```

- [ ] **Step 6: Build/read Maps in reconstruct, dropping the ad-hoc conversions**

`src/meta/reconstruct.ts`:
- EQDP block: the non-playable-race guard iterates the mod races — `for (const race of eqdp.keys())` (the `e.race` reference becomes `race`). The intermediate `const byRace = new Map(eqdp.map(...))` is gone: `eqdp` already IS `Map<number, number>`. Capture it before reassigning, then emit a Map in `PLAYABLE_RACES` order:

```ts
const modEqdp = eqdp; // Map<number, number>
eqdp = new Map(PLAYABLE_RACES.map((race) => [race, modEqdp.get(race) ?? 0]));
```

- EST equipment branch (`Head`/`Body`): non-playable guard `for (const race of est.keys())`; `byRace` is `est` itself, so `est.has(race)` / `est.get(race)`. Build the seed as a Map preserving `PLAYABLE_RACES` order:

```ts
const modEst = est; // Map<number, EstEntry>
const seed = new Map<number, EstEntry>();
for (const race of PLAYABLE_RACES) {
  const raceTable = baseByRace[race];
  if (raceTable === undefined) {
    if (modEst.has(race)) throw new Error(/* existing KeyNotFoundException-equivalent message */);
    continue;
  }
  const override = modEst.get(race);
  seed.set(race, { race, setId, skelId: override ? override.skelId : (raceTable[setId] ?? 0) });
}
est = seed;
```

- EST hair/face branch: iterate `for (const modEntry of est.values())` for the single-race check/assign; emit `est = new Map([[entry.race, entry]])`.
- The final `return { ...mod, eqdp, est, imc, eqp }` is unchanged (now spreads Map values).

- [ ] **Step 7: Fix the probe consumer**

`scripts/probes/probe-v1-meta.ts`: any `.length` on `eqdp`/`est` → `.size`; any array indexing/iteration → Map iteration. Let `npm run typecheck` pin the exact lines.

- [ ] **Step 8: Migrate the meta test fixtures**

`src/meta/serialize.test.ts` and `reconstruct.test.ts`: fixtures that set `eqdp: [...]` / `est: [...]` become `eqdp: new Map([[race, value], …])` / `est: new Map([[race, { race, setId, skelId }], …])`; assertions using `.length`/index become `.size`/`.get(race)`. Compiler-driven.

- [ ] **Step 9: Verify the dup tests pass and run the full gate**

Run: `npm test -- deserialize` → Step 1 tests PASS. Then:

Run: `npm run check && npm run typecheck && npm test`
Expected: all green. **Zero golden diffs** — reconstruct must still emit races in `PLAYABLE_RACES` (or single-entry) order so serialize bytes are identical.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(meta): eqdp/est arrays -> race-keyed Maps (mirror the C# Dictionary)"
```

---

## Self-review (author checklist — done)

- **Spec coverage:** Part 1 §Decision/§Invariants/§Seams → Tasks 1–2; the last-write-wins collapse (spec §Why-now, §Testing) → Task 1 Step 1–2 test; `allFiles`→`FileIdentifier` shape (spec §Where-the-path-re-attaches) → Task 2 Step 1. Part 2 §Decision/§Seams/§Testing → Task 3, incl. the dup-race throw tests. tt-model exclusion (spec §Scope) → no task, by design.
- **Placeholder scan:** every code step shows real code or an enumerated before→after; the two cross-cutting tasks name the compiler as the exhaustive worklist rather than hiding sites behind "etc."
- **Type consistency:** `filesMap` helper signature changes deliberately between Task 1 (`ModpackFile[]`, gamePath present) and Task 2 (entries, gamePath dropped) — flagged in Task 2 Step 5. `allFiles` return type is `ModpackFile[]` in Task 1, `{ gamePath, file }[]` in Task 2 — consumers updated in the same task. `requireBytes` gains a `gamePath` param in Task 2 Step 4.
- **Ordering:** Tasks 1→2 are sequential (2 depends on 1's Map). Task 3 is independent and may run before, after, or in parallel.
