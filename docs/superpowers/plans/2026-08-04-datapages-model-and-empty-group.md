# DataPages model + zero-option group drop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model `WizardData.DataPages` faithfully, then port the zero-option-group drop both C# loaders perform — diverging deliberately from the PMP `ClearNulls` NRE rather than reproducing it.

**Architecture:** `ModpackData.pages: ModpackPage[]` replaces `groups: ModpackGroup[]`, built at **load** by each reader (where the C# builds it) instead of at write by `option-prefix.ts`'s `buildPages`. `ClearNulls` becomes its own module. Phase 1 is a byte-neutral structural move proven by the corpus ratchet; Phase 2 adds the drop, the dense `PageIndex` renumber, and the divergence.

**Tech Stack:** TypeScript, Vitest via a custom parallel runner, Biome, `tsx` for scripts. Oracle is ConsoleTools `/upgrade` and `/resave`.

**Spec:** `docs/superpowers/specs/2026-08-04-datapages-model-and-empty-group-design.md`. Read it before Task 1 — every behavioural claim here traces to a measurement recorded there.

## Global Constraints

- **Every line of business logic cites its C# source** as `file · symbol · lines` in a header or comment. Verify each citation against `reference/` by reading the C#; do not port from memory.
- **`reference/` is read-only.** Never edit, lint or format it.
- **Split, don't blend.** Logic from different C# symbols does not share a TS module or a helper.
- **Port gaps throw `UnportedGapError`** (`src/util/errors.ts`), never a bare `Error`.
- **End-of-task ritual, required before any task is considered done:** `npm run check`, then `npm run typecheck`, then `npm test` — all green.
- **Every commit must typecheck.** A lefthook pre-commit hook runs Biome + `tsc --noEmit` on every commit, so a task may never leave the tree uncompilable "for the next task to fix". This is why Phase 1 migrates behind a compatibility scaffold (`pages` optional, `groups` retained) and removes the scaffold in one final task, rather than swapping the field out in one step.
- **Baselines must not move in Phase 1.** Do **not** set `UPDATE_UPGRADE_BASELINE` during Tasks 1–6. If a baseline moves, that is the bug Phase 1 exists to catch.
- Formatting is Biome's; never hand-format.
- The corpus (`test/corpus/real`, `test/corpus/synthetic`, `test/corpus/upgrade-error`) is gitignored and local-only. Rebuild synthetics with `npm run synthetics`.

## File Structure

**Created**
- `src/container/clear-nulls.ts` — port of `WizardData.ClearNulls` (`WizardData.cs:1234-1266`) alone, plus the two `HasData` predicates it reads (`:621-627`, `:969-975`). Owns the deliberate divergence.
- `scripts/generate-synthetics/build-synthetic-empty-group.ts` — the eight fixtures of spec §7.
- `test/container/clear-nulls.test.ts` — unit tests for the above.

**Modified**
- `src/model/modpack.ts` — `ModpackPage`; `pages` replaces `groups`; `ModpackGroup.page` deleted; `allFiles` walks pages.
- `src/container/pmp.ts` — `readPmp` builds pages (`FromPmp:1118-1159`); `writePmp` drops `buildPages`, calls `clearNulls` at the `WritePmp:1462` seam.
- `src/container/ttmp2.ts` — `readTtmp2` builds pages + drops zero-option groups; `writeTtmp2` calls `clearNulls`, prunes and renumbers densely (`WriteWizardPack:1332-1357`).
- `src/container/ttmp-legacy.ts` — one page.
- `src/container/option-prefix.ts` — page construction and `ClearNulls` removed; prefix builders stay.
- `src/container/resolve-duplicates.ts`, `src/upgrade/upgrade.ts`, `src/upgrade/resolve-highlight.ts`, `src/upgrade/repath-hair-mashups.ts`, `src/index.ts` — walk pages.
- `test/helpers/upgrade-compare.ts` — `ORACLE_ERROR_DIVERGENCE_RULES`.
- `test/helpers/corpus-upgrade.ts` — third outcome in `assertMatchedUpgradeFailure`.
- ~30 test files — fixtures migrate from `groups:` to `pages:`.

---

# Phase 1 — structural, byte-neutral

## Task 1: `ModpackPage`, and readers that build pages

**Files:**
- Modify: `src/model/modpack.ts`
- Modify: `src/container/ttmp2.ts:148-195` (`readTtmp2`), `src/container/pmp.ts:197-307` (`readPmp`), `src/container/ttmp-legacy.ts:84-108`
- Test: `test/container/pages-construction.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface ModpackPage { groups: (ModpackGroup | null)[]; sourcePageIndex?: number }`
  - `ModpackData.pages?: ModpackPage[]` — **optional in this task**, alongside the retained `groups`.
  - `export function allGroups(data: ModpackData): ModpackGroup[]` — flattens pages, dropping nulls; falls back to `data.groups` while `pages` is absent.
  - `allFiles(data)` keeps its existing signature `{ gamePath, file }[]` and its current behaviour.

**Why the scaffold.** `pages` is optional and `groups` stays populated only until Task 4. The pre-commit hook typechecks every commit, so the field cannot be swapped in one step across ~40 files; Tasks 1–3 migrate producers then consumers behind the scaffold, and Task 4 removes it. Nothing in `src/` reads `pages` in this task, which is what makes Task 1 byte-neutral by construction rather than by argument.

- [ ] **Step 1: Write the failing test**

Create `test/container/pages-construction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readPmp } from "../../src/container/pmp";
import { allGroups } from "../../src/model/modpack";
import { buildTestPmp } from "../helpers/pmp-fixture";

describe("readPmp page construction (WizardData.FromPmp:1118-1159)", () => {
  it("omits the Default page when default_mod.json is an empty option (:1118)", () => {
    const data = readPmp(buildTestPmp({ defaultModFiles: {}, groups: [
      { name: "G", page: 0, optionNames: ["On"] },
    ]}));
    expect(allGroups(data).map((g) => g.name)).toEqual(["G"]);
  });

  it("puts the synthesized Default group first when default_mod.json is non-empty (:1136)", () => {
    const data = readPmp(buildTestPmp({
      defaultModFiles: { "chara/dummy/a.bin": "files\\a.bin" },
      groups: [{ name: "G", page: 0, optionNames: ["On"] }],
    }));
    expect(allGroups(data).map((g) => g.name)).toEqual(["Default", "G"]);
  });

  it("reproduces the page off-by-one: a Page-0 group joins the Default page (#7)", () => {
    const data = readPmp(buildTestPmp({
      defaultModFiles: { "chara/dummy/a.bin": "files\\a.bin" },
      groups: [{ name: "G", page: 0, optionNames: ["On"] }],
    }));
    // TWO pages: the Default page, plus the page built for index 0 that the off-by-one leaves
    // empty (WizardData.cs:1144-1150 creates it, :1155 routes G to DataPages[0] instead). That
    // orphaned page survives until ClearNulls prunes it — which FromPmp calls at :1159 but this
    // task does not yet wire up (see the plan's Task 6).
    expect(data.pages).toHaveLength(2);
    expect(data.pages![0]!.groups.map((g) => g?.name)).toEqual(["Default", "G"]);
    expect(data.pages![1]!.groups).toEqual([]);
  });
});
```

`buildTestPmp` does not exist yet — create `test/helpers/pmp-fixture.ts` in this task, reusing the zip and JSON shapes from `scripts/generate-synthetics/pmp-builder.ts` (`syntheticMeta`, `EMPTY_DEFAULT_MOD`, `singleOptionGroup`). Its signature:

```ts
export function buildTestPmp(spec: {
  defaultModFiles: Record<string, string>;
  groups: { name: string; page: number; optionNames: string[] }[];
}): Uint8Array;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/container/pages-construction.test.ts`
Expected: FAIL — `allGroups` is not exported and `data.pages` is undefined.

- [ ] **Step 3: Add the model types**

In `src/model/modpack.ts`, add above `ModpackData`:

```ts
/** Mirrors WizardPageEntry (reference/.../Mods/WizardData.cs · WizardPageEntry · 963-990). A `null`
 *  entry is deliberate and load-bearing: WizardData.FromPmp adds FromPMPGroup's result to
 *  page.Groups UNCONDITIONALLY at both its call sites (:1136, :1156), and that result is `null` for
 *  a zero-option group (FromPMPGroup:851-855). ClearNulls prunes them afterwards. The TTMP path
 *  never admits one — FromWizardModpackPage discards it at the call site (:986). */
export interface ModpackPage {
  groups: (ModpackGroup | null)[];
}
```

Change `ModpackData`: **keep** `groups: ModpackGroup[]` exactly as it is, and add beside it

```ts
  /** Mirrors WizardData.DataPages (WizardData.cs:1080). There is no flat group list in the C# and
   *  there will be none here either — `groups` above is a migration scaffold this field replaces
   *  (see the plan's Task 4). Optional only while both exist; every reader already populates it.
   *  Use `allGroups` to iterate. */
  pages?: ModpackPage[];
```

**Keep** `page: number` on `ModpackGroup` for now — Task 4 deletes it, once `readPmp` is the only thing that needs a group's page number and reads it transiently from the parsed JSON, as `FromPmp:1155` does.

Add below `emptyMeta`:

```ts
/** Every non-null group across every page, in page order — the order WritePmp's own loops use
 *  (WizardData.cs:1506-1542, :1583-1600). Nulls are skipped rather than thrown on: ClearNulls has
 *  already removed them from any page this walks (see src/container/clear-nulls.ts).
 *
 *  MIGRATION SCAFFOLD: the `?? data.groups` fallback exists only while `pages` is optional, so a
 *  ModpackData literal that predates the migration still resolves. Task 4 makes `pages` required,
 *  deletes `groups`, and deletes this fallback with it. */
export function allGroups(data: ModpackData): ModpackGroup[] {
  if (!data.pages) return data.groups;
  return data.pages.flatMap((p) =>
    p.groups.filter((g): g is ModpackGroup => g !== null),
  );
}
```

**Leave `allFiles` alone in this task.** It still walks `data.groups`; Task 2 switches it. Changing it here would move the flat iteration order (spec §3.1) in the same commit that introduces the model, making a byte movement impossible to attribute.

- [ ] **Step 4: Build pages in `readTtmp2`**

In `src/container/ttmp2.ts`, the simple branch (currently returning `groups: [group]`) returns `pages: [{ groups: [group] }]`, with this comment above it:

```ts
    // WizardData.cs · FromSimpleTtmp · 1204-1231 — one hand-built page holding one hand-built
    // group, added UNCONDITIONALLY (:1230) with no ClearNulls call. FromWizardGroup's zero-option
    // early return (:749-753) cannot fire on it: the group is constructed with exactly one option
    // (:1218-1225), so the null this add would otherwise leak is unreachable.
```

The wizard branch builds one `ModpackPage` per `mpl.ModPackPages` element, in array order, pushing each built group into that page's `groups`. Keep the `options.length > 0` backstop guard **exactly as it is** — Task 7 removes it. Return `pages` instead of `groups`.

Carry the source index for now, so the writer stays byte-neutral. Add to `ModpackPage`:

```ts
  /** TRANSITIONAL (deleted in the dense-renumber task). The source ModPackPageJson.PageIndex, kept
   *  only so writeTtmp2 can keep emitting today's value while the model migration lands separately
   *  from the behaviour change. WizardPageEntry has no such field — page identity is positional
   *  (FromWizardTtmp:1180-1184) and the number is re-derived at write (WriteWizardPack:1348-1357). */
  sourcePageIndex?: number;
```

- [ ] **Step 5: Build pages in `readPmp`**

Replace `readPmp`'s group-collecting block with a direct transcription of `FromPmp:1118-1159`:

```ts
  const pages: ModpackPage[] = [];

  // WizardData.cs:1118-1138 — the synthesized Default page, iff default_mod.json is not an empty
  // option. `IsEmptyOption` (PMP.cs:1513-1517) reads the RAW document, which is exactly what we
  // hold here; the old write-time check had to reconstruct it from `o.raw` because it ran after
  // canImport filtering (see option-prefix.ts's isEmptyDefaultOption, deleted in this task).
  if (!isEmptyPmpOption(defaultMod)) {
    const defaultOption = optionFromJson(defaultMod, filesByKey, referencedKeys);
    // WizardData.cs:1122/1128 — fakeOption.Name and fakeGroup.Name are HARDCODED "Default",
    // not read from default_mod.json (whose Name is virtually always absent —
    // ShouldSerializeName is false, PMP.cs:1499).
    defaultOption.name = "Default";
    defaultOption.selected = true; // fakeGroup.DefaultSettings defaults to 0 -> Single index 0
    pages.push({
      groups: [{
        name: "Default",
        description: "",
        image: "",
        priority: 0,
        selectionType: "Single",
        defaultSettings: 0,
        options: [defaultOption],
      }],
    });
  }
```

then the real groups:

```ts
  const realGroups = groupNames.map((name) => /* existing per-group build, unchanged */);
  if (realGroups.length > 0) {
    // WizardData.cs:1142-1150 — one page per index 0..pageMax, APPENDED after the Default page.
    const pageMax = Math.max(...realGroups.map((r) => r.page));
    for (let i = 0; i <= pageMax; i++) pages.push({ groups: [] });
    // WizardData.cs:1152-1157 — `data.DataPages[g.Page]`, a RAW index into a list that already has
    // the optional Default page on the front. Ported verbatim; this IS the page off-by-one
    // (docs/TEXTOOLS_BUGS.md #7). The add is UNCONDITIONAL (:1156).
    for (const r of realGroups) pages[r.page]!.groups.push(r.group);
  }
```

`isEmptyPmpOption(raw)` is the port of `PmpStandardOptionJson.IsEmptyOption` (`PMP.cs:1513-1517`), moved from `option-prefix.ts` and simplified to read the raw document only:

```ts
function isEmptyPmpOption(raw: PmpOptionJsonRaw): boolean {
  return (
    Object.keys(raw.Files ?? {}).length === 0 &&
    Object.keys(raw.FileSwaps ?? {}).length === 0 &&
    (raw.Manipulations ?? []).length === 0
  );
}
```

Do **not** call `clearNulls` here yet — Task 6 adds it. Keep `data.pages` un-pruned for now; no corpus pack has a zero-option group, so nothing is pruned in practice.

**Byte-neutrality note for the reviewer.** Hardcoding the synthesized option's name to `"Default"` is a behaviour change on paper, so verify it is inert on output before accepting the task. Three consumers read that name, and none of them can move a byte: (a) `optionToJson(..., includeMeta=false, ...)` drops `Name` from the emitted `default_mod.json` entirely; (b) `makeOptionPrefix` (`option-prefix.ts`) only uses the option name when `group.options.length > 1`, and the synthesized group has exactly one; (c) `writePmp`'s absorption search compares it, and both the old value and `"Default"` select the same group — the old code reached it through an identity shortcut, which Task 2 deletes precisely because the hardcoded name makes the structural predicate match on its own.

- [ ] **Step 6: One page in `readLegacyTtmp`**

`src/container/ttmp-legacy.ts` returns `pages: [{ groups: [group] }]` **in addition to** its existing `groups: [group]`, with the same `FromSimpleTtmp` citation as Step 4 (a legacy pack loads through `FromSimpleTtmp` via the synthesized `"0.1s"` mpl, `TTMP.cs:453-462`). **Keep** `page: 0` on its group literal — `ModpackGroup.page` is still required until Task 4, and `writeTtmp2` still buckets on it until Task 7.

- [ ] **Step 7: Run the new test**

Run: `npx vitest run test/container/pages-construction.test.ts`
Expected: PASS. The rest of the suite will not compile yet — that is Task 2.

- [ ] **Step 8: Commit**

```bash
git add src/model/modpack.ts src/container/ttmp2.ts src/container/pmp.ts src/container/ttmp-legacy.ts test/container/pages-construction.test.ts test/helpers/pmp-fixture.ts
git commit -m "feat(model): build WizardData.DataPages at load, per FromPmp/FromWizardTtmp"
```

---

## Task 2: Migrate `src/` consumers to pages

**Files:**
- Modify: `src/index.ts:83`, `src/container/option-prefix.ts`, `src/container/pmp.ts:544-570,661-742`, `src/container/ttmp2.ts:296`, `src/container/resolve-duplicates.ts:79-90`, `src/upgrade/upgrade.ts:73-84,288,293,408,432`, `src/upgrade/resolve-highlight.ts:41,85`, `src/upgrade/repath-hair-mashups.ts:28`

**Interfaces:**
- Consumes: `ModpackPage`, `allGroups`, `allFiles` from Task 1.
- Produces: `option-prefix.ts` exports `optionPrefixes(data)` only — `buildPages` and `Page` are deleted; the prefix builders take `ModpackPage[]` and `ModpackPage`.
- Produces: `ModpackData.groups` becomes **optional** (`groups?: ModpackGroup[]`) at the end of this task, and `allGroups`'s fallback becomes `data.groups ?? []`. Nothing in `src/` reads `groups` directly after this task; test fixtures still set it until Task 3.

**Scaffold state entering this task:** `pages` is optional and populated by all three readers; `groups` is required and populated; nothing in `src/` reads `pages` yet. This task flips `src/` over. **This is where spec §3.1's flat-iteration-order hazard actually lands** — `allFiles` switching from `data.groups` to page order is the byte-visible change — so run the full corpus before committing and report any pack that moves.

> **EXECUTION ORDER — this task runs AFTER Task 5.** The original ordering was wrong and a corpus run caught it. `buildPages` did page construction **and** `ClearNulls` pruning in one function; Task 1 moved only the construction, so an `optionPrefixes` that walks `data.pages` sees pages the old code had pruned — notably the stranded empty page the `FromPmp` page off-by-one creates (`docs/TEXTOOLS_BUGS.md` #7). That inflates `pages.length` and emits a spurious `pN/` prefix. Measured 2026-08-04: 3 packs regressed (`胖莫古力.pmp`, `[Nyameru]Cute Loop.pmp`, `[Shy] Tactical Hoodie [DT].pmp`). The C# does not hit this because `WritePmp` calls `ClearNulls()` at `:1462` before any prefix is generated — so Task 5 must land first, and this task adds the write-seam calls below.

**Write-seam `clearNulls` calls (moved here from the original Task 6).** Both writers call it; the C# genuinely calls it at load *and* write, so reproduce both rather than picking one.
- `writePmp` — `clearNulls(data.pages)` immediately before the `const pages = data.pages` line this task introduces, citing `WizardData.cs · WritePmp · 1462`.
- `writeTtmp2` — `clearNulls(data.pages)` as the first statement of the wizard branch, citing `WizardData.cs · WriteWizardPack · 1334`.

- [ ] **Step 1: Delete `buildPages` from `option-prefix.ts`**

Delete `buildPages`, `isEmptyDefaultOption`, the local `Page` interface, and the `import { ... } from "./pmp"` line for `folderSafeName` only if unused. Keep `groupHasData` where it is for now — **Task 5** moves it to `clear-nulls.ts`; leave it exported from `option-prefix.ts` unchanged in this task.

Replace `Page` with `ModpackPage` throughout `makePagePrefix` / `makeGroupPrefix`. `makePagePrefix`'s memo currently lives on `page.folderPath`; keep that by giving `ModpackPage` an optional `folderPath?: string` field, citing `WizardPageEntry.FolderPath` (`WizardData.cs:967`) — the C# has exactly this field and `ClearNulls` nulls it at `:1239`.

`page.groups` is now `(ModpackGroup | null)[]`. Every read in the prefix builders must filter nulls; add at the top of `optionPrefixes`:

```ts
  // ClearNulls has already run (at load for PMP, FromPmp:1159; at write for both, WritePmp:1462 /
  // WriteWizardPack:1334), so no page reaching here holds a null. Narrow rather than assert.
  const pages = data.pages.map((p) => ({
    ...p,
    groups: p.groups.filter((g): g is ModpackGroup => g !== null),
  }));
```

`optionPrefixes` no longer calls `buildPages`; it walks `data.pages` directly.

- [ ] **Step 2: Update `writePmp`**

- `const pages = buildPages(data)` (`pmp.ts:686`) becomes `const pages = data.pages` (Task 6 inserts the `clearNulls` call here).
- `data.groups.slice(1)` (`:559`) becomes `allGroups(data)`, and the Default-group exemption comment plus the `slice(1)` skip are **deleted**: Task 1 hardcoded the synthesized option's name to `"Default"` per `WizardData.cs:1122`, so it can no longer trip the blank-name guard and needs no exemption.
- `const defaultGroup = data.groups[0]` (`:661`) becomes:

```ts
  // The synthesized Default group is DataPages[0].Groups[0] when it exists (WizardData.cs:1133-1137)
  // — FromPmp unshifts its page onto the front before any real page is appended.
  const defaultGroup = data.pages[0]?.groups[0] ?? undefined;
```

Its identity shortcut at `:700` (`g === defaultGroup ? true : …`) can now be **deleted** — with the name hardcoded to `"Default"`, the structural predicate matches it naturally, exactly as the C# search does. Verify by reading `WizardData.cs:1553-1578` before deleting.

- `for (const g of page.groups)` (`:741`) needs the null filter from Step 1.

- [ ] **Step 3: Update `writeTtmp2`**

`for (const g of data.groups)` (`ttmp2.ts:296`) becomes a walk over `data.pages`. Keep the `byPage` bucketing and the `PageIndex` emission **byte-identical** by keying on the transitional `sourcePageIndex`:

```ts
    for (const page of data.pages) {
      for (const g of page.groups) {
        if (g === null) continue;
        // ... existing per-group body unchanged ...
        const key = page.sourcePageIndex ?? 0;
        const list = byPage.get(key) ?? [];
        list.push({ /* unchanged */ });
        byPage.set(key, list);
      }
    }
```

Leave `[...byPage.keys()].sort((a, b) => a - b)` and `PageIndex: p` untouched — Task 7 replaces both.

- [ ] **Step 4: Update the remaining `src/` walkers**

Mechanical, one rule: `data.groups` → `allGroups(data)`, `out.groups` → `allGroups(out)`.

- `src/index.ts:83` — `allFiles(data)` already; no change (verify).
- `src/container/resolve-duplicates.ts:86` — `new Set(allGroups(data).flatMap((g) => g.options))`; update the message at `:90` to say `data.pages` instead of `data.groups`.
- `src/upgrade/upgrade.ts:77` — `cloneModpack` must clone the page structure, not the flat list:

```ts
    pages: data.pages.map((p) => ({
      ...p,
      groups: p.groups.map((g) => (g === null ? null : cloneGroup(g))),
    })),
```

  and `:288`, `:293`, `:408`, `:432` become `allGroups(data)` / `allGroups(out)`.
- `src/upgrade/resolve-highlight.ts:41,85` and `src/upgrade/repath-hair-mashups.ts:28` — `allGroups(data)`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS for `src/`; remaining errors must all be under `test/` (Task 3).

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "refactor(container): walk DataPages instead of a flat group list"
```

---

## Task 3: Migrate test fixtures to pages

**Files:**
- Modify: every file under `test/` that constructs `ModpackData` with `groups:` (18 files, 29 occurrences) or reads `.groups` (20 files, 76 occurrences), and the 44 `page:` occurrences in group literals.

**Interfaces:**
- Consumes: `ModpackPage`, `allGroups` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Enumerate the work**

Run:

```powershell
Select-String -Path (Get-ChildItem -Recurse test -Include *.ts | ForEach-Object FullName) -Pattern "^\s*groups:|\.groups\b|^\s*page:" | Select-Object -ExpandProperty Path -Unique
```

Expected: ~30 paths. Work through them one file at a time.

- [ ] **Step 2: Apply the three mechanical rules**

1. A `ModpackData` literal's `groups: [g1, g2]` becomes `pages: [{ groups: [g1, g2] }]` — **one page**, unless the fixture's groups carried different `page:` values, in which case build one `ModpackPage` per distinct value in ascending order, each holding that value's groups in their original relative order. Delete the `groups:` key in the same edit; it is optional as of Task 2 and Task 4 removes it from the model.
2. Leave each `ModpackGroup` literal's `page: N` line alone — Task 4 deletes the field.
3. A read of `data.groups` becomes `allGroups(data)`; a read of `data.groups[i]` becomes `allGroups(data)[i]`. Where a test is specifically about page structure, assert on `data.pages` directly instead.

Do **not** change any assertion's expected values. If an assertion's meaning depends on group order, verify against rule 1 that the order is preserved.

- [ ] **Step 3: Typecheck and run the non-corpus suite**

Run: `npm run typecheck`
Expected: PASS, zero errors.

Run: `npx vitest run test/container test/upgrade test/model`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/
git commit -m "test: migrate ModpackData fixtures from groups to pages"
```

---

## Task 4: Remove the scaffold, and gate Phase 1

**Files:**
- Modify: `src/model/modpack.ts`, plus any remaining `page:` occurrences in `test/` fixtures and in `src/container/pmp.ts`/`ttmp-legacy.ts` group literals.

**Interfaces:**
- Consumes everything from Tasks 1–3.
- Produces the final Phase 1 model: `ModpackData.pages: ModpackPage[]` (**required**), no `groups`, and `ModpackGroup` with no `page`.

- [ ] **Step 1: Delete the compatibility scaffold**

In `src/model/modpack.ts`:
- Delete `groups?: ModpackGroup[]` from `ModpackData`.
- Make `pages` required: `pages: ModpackPage[]`, and delete the "MIGRATION SCAFFOLD" paragraph from its doc comment.
- Delete `allGroups`' `if (!data.pages) return data.groups;` fallback line and the scaffold paragraph from its doc comment.
- Delete `page: number` from `ModpackGroup`, with this note in the commit body rather than the code: `WizardGroupEntry` carries no page; `readPmp` reads `PMPGroupJson.Page` transiently while assigning pages, exactly as `FromPmp:1155` does.

Then delete every now-dead `page:` line from group literals in `src/container/pmp.ts`, `src/container/ttmp-legacy.ts`, `src/container/ttmp2.ts` and the `test/` fixtures. `readPmp` keeps a **local** page number per parsed group for its page-assignment loop — that is not the model field and must survive.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS, zero errors. Every remaining reference to `data.groups` or `group.page` is now a compile error, so this step is what proves the migration is complete rather than merely working.

- [ ] **Step 3: Full gate**

Run, in order:

```powershell
npm run check
npm run typecheck
npm test
```

Expected: all green, and **no baseline file modified**. Confirm with:

```powershell
git status --porcelain test/corpus
```

Expected: empty output (baselines are gitignored, so this is a belt-and-braces check that nothing else moved).

Reference: the pre-migration baseline on this machine was **550 test files, 2024 passed, 1 skipped, ~3.4 min**. The counts should be unchanged except for the tests Task 1 added.

- [ ] **Step 4: If a corpus pack now fails, STOP**

A failing pack means the flat-iteration reorder of spec §3.1 moved bytes — the specific hazard this phase exists to detect. Do **not** re-bless. Diagnose which pack, and whether `allFiles` order or `resolveDuplicates`' `common/N` assignment changed, and report back before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/ test/
git commit -m "refactor(model): drop the flat group list; DataPages is the model"
```

---

# Phase 2 — behavioural

## Task 5: `clear-nulls.ts`, with the divergence

**Files:**
- Create: `src/container/clear-nulls.ts`, `test/container/clear-nulls.test.ts`
- Modify: `src/container/option-prefix.ts` (delete `groupHasData`, import it instead)

**Interfaces:**
- Produces:
  - `export function groupHasData(g: ModpackGroup): boolean`
  - `export function pageHasData(p: ModpackPage): boolean`
  - `export function clearNulls(pages: ModpackPage[]): void` — mutates in place, mirroring the C# `void`.

> **EXECUTION ORDER — this task runs SECOND, immediately after Task 1 and BEFORE Task 2.** See Task 2's execution-order note for why: `optionPrefixes` cannot walk `data.pages` until something prunes them the way `buildPages` used to. This task also takes the **load-seam wiring** that the original Task 6 held (Task 6 is now empty — its write-seam half moved into Task 2).

**Load-seam wiring (moved here from the original Task 6).** After the module and its tests are green, add the `FromPmp` call: at the end of `readPmp`'s page construction, before `extraFiles` is built,

```ts
  clearNulls(pages); // WizardData.cs · FromPmp · 1159 — FromPmp's own call, on the way out
```

Add a comment on `readTtmp2` recording the asymmetry: `FromWizardTtmp` (`:1163-1186`) does **not** call `ClearNulls`; only `FromPmp` does. Reproduce that — do not add a call there.

This stays byte-neutral: `src/` still reads `data.groups`, so pruning `data.pages` changes no output yet. It is what makes Task 2 byte-neutral in turn.

- [ ] **Step 1: Write the failing test**

Create `test/container/clear-nulls.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clearNulls } from "../../src/container/clear-nulls";
import type { ModpackGroup, ModpackPage } from "../../src/model/modpack";

const group = (name: string, optionCount: number): ModpackGroup => ({
  name,
  description: "",
  image: "",
  priority: 0,
  selectionType: "Single",
  defaultSettings: 0,
  options: Array.from({ length: optionCount }, (_, i) => ({
    name: `o${i}`,
    description: "",
    image: "",
    priority: 0,
    selected: false,
    files: new Map(),
    fileSwaps: {},
    manipulations: [],
  })),
});

describe("clearNulls (WizardData.cs:1234-1266)", () => {
  it("removes a null group but keeps the page (:1249)", () => {
    const pages: ModpackPage[] = [{ groups: [group("Real", 1), null] }];
    clearNulls(pages);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.groups.map((g) => g?.name)).toEqual(["Real"]);
  });

  it("removes a page left with no data (:1240-1244)", () => {
    const pages: ModpackPage[] = [{ groups: [null] }, { groups: [group("Real", 1)] }];
    clearNulls(pages);
    expect(pages.map((p) => p.groups.map((g) => g?.name))).toEqual([["Real"]]);
  });

  it("DIVERGES: a leading null does not crash (docs/TEXTOOLS_BUGS.md #22)", () => {
    const pages: ModpackPage[] = [{ groups: [null, group("Real", 1)] }];
    expect(() => clearNulls(pages)).not.toThrow();
    expect(pages[0]!.groups.map((g) => g?.name)).toEqual(["Real"]);
  });

  it("keeps a content-free group that has at least one option", () => {
    const pages: ModpackPage[] = [{ groups: [group("Contentless", 1)] }];
    clearNulls(pages);
    expect(pages[0]!.groups).toHaveLength(1);
  });

  it("removes a zero-option group (HasData reduces to Options.Count > 0)", () => {
    const pages: ModpackPage[] = [{ groups: [group("Real", 1), group("Empty", 0)] }];
    clearNulls(pages);
    expect(pages[0]!.groups.map((g) => g?.name)).toEqual(["Real"]);
  });

  it("nulls each surviving page's folderPath (:1239)", () => {
    const pages: ModpackPage[] = [{ groups: [group("Real", 1)], folderPath: "p1/" }];
    clearNulls(pages);
    expect(pages[0]!.folderPath).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/container/clear-nulls.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/container/clear-nulls.ts`**

The module header must carry the full `WizardOptionEntry.HasData` read-mode argument currently living in `option-prefix.ts`'s header (why `groupHasData` is `options.length > 0` and must never become a content check) — move that prose here, since it is about these predicates, and leave `option-prefix.ts`'s header describing only the prefix builders.

```ts
// Port of WizardData.ClearNulls (reference/.../Mods/WizardData.cs · WizardData.ClearNulls ·
// 1234-1266) and the two HasData predicates it reads: WizardGroupEntry.HasData (· 621-627) and
// WizardPageEntry.HasData (· 969-975).
//
// [move option-prefix.ts's read-mode HasData analysis here verbatim — it explains why
//  groupHasData is `options.length > 0` and must NOT become a content check.]

import type { ModpackGroup, ModpackPage } from "../model/modpack";

export function groupHasData(g: ModpackGroup): boolean {
  return g.options.length > 0;
}

// DELIBERATE DIVERGENCE — docs/TEXTOOLS_BUGS.md #22.
// The C# is `Groups.Any(x => x.HasData)` (WizardData.cs:973), which dereferences a null group and
// throws. Measured 2026-08-03: ConsoleTools /upgrade exits -1 with NO output file whenever a
// zero-option group is FIRST on its page; any preceding data-carrying group shields it, because
// Any short-circuits. We treat a null as "no data" so the pack upgrades instead of failing.
// Confirmed by ORACLE_ERROR_DIVERGENCE_RULES (test/helpers/upgrade-compare.ts), not suppressed by
// a ratchet baseline. See docs/superpowers/specs/2026-08-04-datapages-model-and-empty-group-design.md §5.
export function pageHasData(p: ModpackPage): boolean {
  return p.groups.some((g) => g !== null && groupHasData(g));
}

export function clearNulls(pages: ModpackPage[]): void {
  // `DataPages.ToList()` (:1236) — iterate a SNAPSHOT while removing from the live list.
  for (const p of [...pages]) {
    p.folderPath = undefined; // :1239 — `p.FolderPath = null`
    if (!pageHasData(p)) {
      pages.splice(pages.indexOf(p), 1); // :1242
      continue;
    }
    // :1246-1253 — same snapshot-then-remove shape, at the group level. This check IS null-guarded
    // in the C#; only the page-level one above is not.
    for (const g of [...p.groups]) {
      if (g === null || !groupHasData(g)) {
        p.groups.splice(p.groups.indexOf(g), 1);
        continue;
      }
      // :1254 — g.FolderPath = null. Our group folder paths live in optionPrefixes' local Maps
      // (rebuilt per call), so there is no stored field to null here.
    }
    // :1256-1263 — `if (o == null) g.Options.Remove(o)` is NOT ported: ModpackOption has no null
    // representation, so the step can never apply to data built from our model.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/container/clear-nulls.test.ts`
Expected: PASS, all six.

- [ ] **Step 5: Import `groupHasData` in `option-prefix.ts`**

Delete the local definition; `import { groupHasData } from "./clear-nulls"`.

- [ ] **Step 6: Full gate and commit**

Run: `npm run check && npm run typecheck && npm test` — all green, no baseline movement.

```bash
git add src/container/clear-nulls.ts src/container/option-prefix.ts test/container/clear-nulls.test.ts
git commit -m "feat(container): port WizardData.ClearNulls as its own module"
```

---

## Task 6: (retired — folded into Tasks 5 and 2)

This task no longer exists. A corpus run on 2026-08-04 showed the wiring cannot come after the consumer migration: the load-seam call moved into **Task 5** and the two write-seam calls into **Task 2**. See both tasks' execution-order notes. The original text is kept below, struck through, only so the C# citations stay findable; **do not execute it**.

<details><summary>Original Task 6 (do not execute)</summary>

### Retired: Wire `clearNulls` into both seams

**Files:**
- Modify: `src/container/pmp.ts` (`readPmp` tail, `writePmp` at the `:1462` seam), `src/container/ttmp2.ts` (`writeTtmp2` head)

**Interfaces:** Consumes `clearNulls` from Task 5.

- [ ] **Step 1: Call it at load, PMP only**

At the end of `readPmp`'s page construction, before building `extraFiles`:

```ts
  clearNulls(pages); // WizardData.cs:1159 — FromPmp's own call, on the way out
```

Add a comment on `readTtmp2` recording the asymmetry: `FromWizardTtmp` (`:1163-1186`) does **not** call `ClearNulls`; only `FromPmp` does. Reproduce that — do not add a call there.

- [ ] **Step 2: Call it at write, both writers**

`writePmp`: `clearNulls(data.pages)` immediately before `const pages = data.pages`, citing `WizardData.cs:1462` (`WritePmp`'s own redundant second call).

`writeTtmp2`: `clearNulls(data.pages)` as the first statement of the wizard branch, citing `WizardData.cs:1334` (`WriteWizardPack`'s call).

Note in both: the C# genuinely calls it twice (load and write); reproduce both rather than picking one.

- [ ] **Step 3: Full gate and commit**

Run: `npm run check && npm run typecheck && npm test` — all green, no baseline movement. Nothing should change: no corpus pack has a zero-option group.

```bash
git add src/container/pmp.ts src/container/ttmp2.ts
git commit -m "feat(container): call ClearNulls at both C# seams (load and write)"
```

</details>

---

## Task 7: Drop the zero-option group, and renumber pages densely

**Files:**
- Modify: `src/container/ttmp2.ts` (`readTtmp2` wizard branch, `writeTtmp2` page emission), `src/container/pmp.ts` (`readPmp` group loop)
- Modify: `src/model/modpack.ts` (delete `sourcePageIndex`)
- Modify: `test/container/ttmp2-selected.test.ts`, `test/container/pmp-selected.test.ts`

**Interfaces:** Consumes `clearNulls`, `pageHasData`.

- [ ] **Step 1: Write the failing tests**

Rewrite the two existing tests to assert **absence**. In `test/container/ttmp2-selected.test.ts`, replace the test named "a zero-option Single group does not trip the backstop" with:

```ts
  it("drops a zero-option group entirely (FromWizardGroup:749-753 + FromWizardModpackPage:986)", () => {
    const data = readTtmp2(buildWizardTtmp2([
      { name: "Empty", options: [] },
      { name: "Real", options: ["On"] },
    ]));
    expect(allGroups(data).map((g) => g.name)).toEqual(["Real"]);
  });
```

In `test/container/pmp-selected.test.ts`, replace "Single: a zero-option group does not trip the backstop" with the equivalent asserting the group is absent after `readPmp`.

Add to `test/container/ttmp2-write.test.ts`:

```ts
  it("renumbers PageIndex densely over surviving pages (WriteWizardPack:1348-1357)", () => {
    // Measured against ConsoleTools /resave 2026-08-04: a source page whose only group is
    // option-less is dropped, and the survivor is emitted as PageIndex 0, not 1.
    const data = readTtmp2(buildWizardTtmp2Pages([
      { pageIndex: 0, groups: [{ name: "Empty", options: [] }] },
      { pageIndex: 1, groups: [{ name: "Real", options: ["On"] }] },
    ]));
    const mpl = readMplFrom(writeTtmp2(data));
    expect(mpl.ModPackPages).toHaveLength(1);
    expect(mpl.ModPackPages[0].PageIndex).toBe(0);
  });

  it("emits pages in source array order, not sorted by PageIndex (:1349)", () => {
    const data = readTtmp2(buildWizardTtmp2Pages([
      { pageIndex: 1, groups: [{ name: "Second", options: ["On"] }] },
      { pageIndex: 0, groups: [{ name: "First", options: ["On"] }] },
    ]));
    const mpl = readMplFrom(writeTtmp2(data));
    expect(mpl.ModPackPages.map((p) => p.ModGroups[0].GroupName)).toEqual(["Second", "First"]);
    expect(mpl.ModPackPages.map((p) => p.PageIndex)).toEqual([0, 1]);
  });

  it("keeps two source pages sharing a PageIndex separate (:1349)", () => {
    const data = readTtmp2(buildWizardTtmp2Pages([
      { pageIndex: 0, groups: [{ name: "Alpha", options: ["On"] }] },
      { pageIndex: 0, groups: [{ name: "Beta", options: ["On"] }] },
    ]));
    const mpl = readMplFrom(writeTtmp2(data));
    expect(mpl.ModPackPages.map((p) => p.ModGroups[0].GroupName)).toEqual(["Alpha", "Beta"]);
  });
```

Three new helpers in `test/helpers/ttmp2-fixture.ts`, built from `scripts/generate-synthetics/ttmp2-builder.ts`'s shapes (its `.mpl` key order, its `encodeSqPackFile` dummy payload, its pinned mtime); create all three in this task:

```ts
/** One-page wizard .ttmp2. A group with `options: []` emits an empty `OptionList`. */
export function buildWizardTtmp2(
  groups: { name: string; options: string[] }[],
): Uint8Array;

/** Multi-page wizard .ttmp2. `pageIndex` is written verbatim as ModPackPageJson.PageIndex, and
 *  pages are emitted in ARRAY order — so the caller can author sparse, duplicated, or
 *  out-of-order indices, which is the whole point of the three renumbering tests. */
export function buildWizardTtmp2Pages(
  pages: { pageIndex: number; groups: { name: string; options: string[] }[] }[],
): Uint8Array;

/** Parse TTMPL.mpl back out of a written .ttmp2. */
export function readMplFrom(archive: Uint8Array): ModPackJson;
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/container/ttmp2-selected.test.ts test/container/pmp-selected.test.ts test/container/ttmp2-write.test.ts`
Expected: FAIL — groups still present, `PageIndex` still the source value.

- [ ] **Step 3: Port the TTMP drop**

In `readTtmp2`'s wizard branch, before pushing the built group:

```ts
        // WizardData.cs · FromWizardGroup · 749-753 — `if (group.Options.Count == 0) return null;`,
        // BEFORE the Single "none selected" backstop at :755-757. The caller,
        // WizardPageEntry.FromWizardModpackPage (:983-988), discards the null at the call site
        // (`if (g == null) continue;`, :986) — so a skip-the-push here is the honest transcription.
        if (built.options.length === 0) continue;
```

Then **delete** the `built.options.length > 0` clause from the backstop condition and the two lines of its comment that explain why the guard exists (`ttmp2.ts:181-184` in the pre-Task-1 numbering) — the early return now makes it unreachable.

- [ ] **Step 4: Port the PMP drop**

In `readPmp`'s per-group build, return `null` for a zero-option group instead of a group:

```ts
      // WizardData.cs · FromPMPGroup · 851-855 — `if (group.Options.Count == 0) return null;`,
      // BEFORE the backstop at :857-860. NOT a skip-the-push: FromPmp adds the result
      // unconditionally (:1156) and ClearNulls prunes it afterwards (:1249), so the null must
      // reach page.groups for the control flow to match.
      if (options.length === 0) return null;
```

and **delete** the `options.length > 0` clause from that file's backstop condition and its explanatory comment.

- [ ] **Step 5: Dense renumber in `writeTtmp2`**

Replace the `byPage` map, its sort, and `PageIndex: p` with a direct walk:

```ts
    // WizardData.cs · WriteWizardPack · 1348-1357 — pages are emitted in DataPages ORDER with a
    // DENSE counter, not by the source PageIndex, and a page with no data is skipped entirely.
    // Measured against ConsoleTools /resave 2026-08-04: a sparse source index (3) emits as 0; two
    // pages sharing an index stay two pages; source array order is preserved rather than sorted.
    const pages: TtmpModPackPageJsonWrite[] = [];
    for (const page of data.pages) {
      if (!pageHasData(page)) continue; // :1351
      const modGroups: TtmpModGroupJsonWrite[] = [];
      for (const g of page.groups) {
        if (g === null) continue;
        // ... existing per-group body, unchanged ...
        modGroups.push({ /* unchanged */ });
      }
      pages.push({ PageIndex: pages.length, ModGroups: modGroups }); // :1355-1356
    }
    mpl.ModPackPages = pages;
```

Delete `sourcePageIndex` from `ModpackPage` and its assignment in `readTtmp2`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/container`
Expected: PASS.

- [ ] **Step 7: Full gate**

Run: `npm run check && npm run typecheck && npm test`

Baselines **may** move here — this is the first behavioural change. Any movement must be explained before blessing: a `PageIndex` shift is expected only for a pack whose source `.mpl` has sparse, duplicated or out-of-order page indices. Report which packs moved and why before running the bless.

- [ ] **Step 8: Commit**

```bash
git add src/ test/
git commit -m "feat(container): drop zero-option groups; renumber TTMP pages densely"
```

---

## Task 8: Synthetic fixtures

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-empty-group.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`, `scripts/generate-synthetics/pmp-builder.ts` (add a multi-group/multi-page helper), `scripts/generate-synthetics/ttmp2-builder.ts` (add a multi-page writer)

**Interfaces:**
- Produces the eight packs of spec §7. Exact names, used by Task 9's rule:
  - `synthetic/empty-group-shielded.pmp`, `synthetic/empty-group-default-shielded.pmp`
  - `upgrade-error/empty-group-first.pmp`, `upgrade-error/empty-group-page1.pmp`
  - `synthetic/empty-group-first-sibling.pmp`, `synthetic/empty-group-page1-sibling.pmp`
  - `synthetic/empty-page0.ttmp2`, `synthetic/sparse-pageindex.ttmp2`, `synthetic/out-of-order-pages.ttmp2`, `synthetic/duplicate-pageindex.ttmp2`

- [ ] **Step 1: Write the builder**

Header must record the measurement, following `build-synthetic-pmp-group-type.ts`'s style ("What the oracle does, measured"). The four PMP shapes are exactly the probe shapes in spec §1.2; the four TTMP shapes are §1.3's. Each `*-sibling.pmp` is byte-identical to its partner except that the zero-option group's `group_NNN_*.json` member is absent.

Reuse `pmp-builder.ts`'s `syntheticMeta`, `EMPTY_DEFAULT_MOD`, `DUMMY_PAYLOAD`, `writePmp` and the pinned `FIXED_MTIME`. **Do not reorder** any JSON key or zip member — those orders are load-bearing for the golden cache key.

- [ ] **Step 2: Register in `build-all.ts`**

Add the import following the existing pattern.

- [ ] **Step 3: Build and verify shapes**

Run: `npm run synthetics`
Expected: ten `wrote …` lines for this builder.

Verify the oracle still behaves as measured — the two `upgrade-error` packs must produce a `.error` marker and the six `synthetic` packs must not:

```powershell
npm test 2>&1 | Select-String -Pattern "empty-group|pageindex|empty-page0|out-of-order"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/
git commit -m "test(synthetics): fixtures for the empty-group drop and page renumbering"
```

---

## Task 9: `ORACLE_ERROR_DIVERGENCE_RULES`

**Files:**
- Modify: `test/helpers/upgrade-compare.ts`, `test/helpers/corpus-upgrade.ts:35-82,288-304`
- Test: `test/helpers/corpus-upgrade.test.ts`

**Interfaces:**
- Produces:

```ts
export interface OracleErrorDivergenceRule {
  reason: string;
  /** Matches the ORACLE's captured trace. Key on the failure signature, never on a pack name. */
  matches: (oracleTrace: string) => boolean;
  /** The corpus pack whose golden supplies the expected bytes, given the crashing pack's name. */
  siblingOf: (packName: string) => string;
}
export const ORACLE_ERROR_DIVERGENCE_RULES: OracleErrorDivergenceRule[];
```

- [ ] **Step 1: Write the failing test**

Add to `test/helpers/corpus-upgrade.test.ts`:

```ts
describe("ORACLE_ERROR_DIVERGENCE_RULES", () => {
  const NRE_TRACE =
    "System.NullReferenceException: Object reference not set to an instance of an object.\n" +
    "   at xivModdingFramework.Mods.WizardPageEntry.<>c.<get_HasData>b__4_0(WizardGroupEntry x)";

  it("matches the ClearNulls NRE signature", () => {
    expect(ORACLE_ERROR_DIVERGENCE_RULES.some((r) => r.matches(NRE_TRACE))).toBe(true);
  });

  it("does not match an unrelated oracle error", () => {
    const other = "System.NotImplementedException: Unimplemented PMP group type: Bogus";
    expect(ORACLE_ERROR_DIVERGENCE_RULES.some((r) => r.matches(other))).toBe(false);
  });

  it("names a sibling pack for a crashing pack", () => {
    const rule = ORACLE_ERROR_DIVERGENCE_RULES.find((r) => r.matches(NRE_TRACE))!;
    expect(rule.siblingOf("empty-group-first.pmp")).toBe("empty-group-first-sibling.pmp");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/helpers/corpus-upgrade.test.ts`
Expected: FAIL — export not found.

- [ ] **Step 3: Add the rule**

In `test/helpers/upgrade-compare.ts`, below `DIVERGENCE_RULES`:

```ts
// Registry of INTENTIONAL divergences where the ORACLE ITSELF FAILS and we deliberately succeed —
// distinct from DIVERGENCE_RULES above, which confirm a byte difference between two produced packs.
// Keyed on the oracle's TRACE SIGNATURE, never on a pack name: one rule then covers every pack that
// trips the underlying TexTools defect, today's synthetics and tomorrow's user uploads alike, with
// nothing blessed individually. An oracle error matching no rule stays a hard failure.
export const ORACLE_ERROR_DIVERGENCE_RULES: OracleErrorDivergenceRule[] = [
  {
    reason:
      "WizardData.ClearNulls reads WizardPageEntry.HasData (`Groups.Any(x => x.HasData)`, " +
      "WizardData.cs:969-975) over a list FromPmp fills with nulls (:1136/:1156) and that the very " +
      "next loop prunes — so a zero-option PMP group that lands FIRST on its page NREs the load and " +
      "ConsoleTools /upgrade emits no file at all. We treat a null as 'no data' and upgrade the " +
      "pack. docs/TEXTOOLS_BUGS.md #22; spec 2026-08-04-datapages-model-and-empty-group-design §5.",
    matches: (trace) =>
      /NullReferenceException/.test(trace) &&
      /WizardPageEntry\.<>c\.<get_HasData>/.test(trace),
    siblingOf: (packName) => packName.replace(/\.pmp$/i, "-sibling.pmp"),
  },
];
```

- [ ] **Step 4: Add the third outcome in `corpus-upgrade.ts`**

`assertMatchedUpgradeFailure` gains a parameter for the confirmed-divergence path. Before the `ourMessage === undefined` failure at `:60-65`, check the rules: if one matches `oracleMessage` **and** our upgrade succeeded, load the sibling pack's golden and require our written archive to byte-match it via the existing `diffArchives` path; log a `[upgrade] <name>: confirmed oracle-error divergence` line. If no rule matches, keep today's hard failure verbatim.

Guard the sibling: if the named sibling pack is not in the corpus, `expect.fail` with a message saying the rule named it and it is missing — a silently absent sibling would turn the confirmation into a no-op.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/helpers/corpus-upgrade.test.ts`
Expected: PASS.

- [ ] **Step 6: Full gate and commit**

Run: `npm run check && npm run typecheck && npm test` — the two `upgrade-error` packs must now pass as confirmed divergences, not as matched failures.

```bash
git add test/helpers/
git commit -m "test(harness): confirm oracle-error divergences by reason, not by baseline"
```

---

## Task 10: Documentation and backlog cleanup

**Files:**
- Modify: `docs/BACKLOG.md`, `docs/superpowers/specs/2026-08-04-datapages-model-and-empty-group-design.md`
- Delete: `docs/backlog/2026-07-20-empty-group-not-dropped.md`, `docs/backlog/2026-07-13-buildpages-called-twice.md`, `docs/superpowers/plans/2026-08-04-datapages-model-and-empty-group.md` (this plan)

- [ ] **Step 1: Grep for inbound references**

```powershell
Select-String -Path (Get-ChildItem -Recurse src,test,scripts,docs -Include *.ts,*.md | ForEach-Object FullName) -Pattern "2026-07-20-empty-group-not-dropped|2026-07-13-buildpages-called-twice"
```

Every hit must be updated or removed in this task — a dangling pointer to a deleted item is exactly what `docs/BACKLOG.md`'s convention forbids.

- [ ] **Step 2: Delete the two item files and their index entries**

Remove prioritized entry 1 from `docs/BACKLOG.md` and renumber the remaining prioritized list. Remove the `buildPages is called twice` bullet from *Unprioritized → PMP write path*. Add a dated pass-log bullet recording what shipped, following the existing format.

- [ ] **Step 3: Add a shipped-status line to the spec**

Change the spec's status line to `Status: shipped <date>` and add a short closing note recording anything the implementation learned that the design did not predict — especially any corpus baseline that moved in Task 7 and why.

- [ ] **Step 4: Delete this plan**

Per AGENTS.md: the plan is committed when written and deleted on the branch before the PR opens.

```bash
git rm docs/superpowers/plans/2026-08-04-datapages-model-and-empty-group.md
```

- [ ] **Step 5: Final gate and commit**

Run: `npm run check && npm run typecheck && npm test`

```bash
git add docs/
git commit -m "docs: retire the empty-group and buildPages backlog items"
```

---

## Self-Review

**Spec coverage.** §1.1 → Task 5 (`groupHasData` reduction preserved). §1.2 → Tasks 5, 8, 9. §1.3 → Task 7. §1.4/§3 → Tasks 1–3. §3.1 → Task 4. §4 → Tasks 1, 6, 7. §5 → Task 5. §6 → Tasks 6, 7. §7 → Tasks 8, 9. §8 → Tasks 7, 10. §9 is explicitly deferred and needs no task.

**Type consistency.** `allGroups(data)` / `clearNulls(pages)` / `groupHasData(g)` / `pageHasData(p)` are spelled identically in every task that uses them. `ModpackPage` carries `groups`, optional `folderPath`, and (Tasks 1–6 only) optional `sourcePageIndex`, deleted in Task 7 Step 5.

**Known soft spots, flagged rather than hidden.** Task 3 is bulk mechanical work whose per-file detail cannot be pre-written; its safety net is the type checker plus Task 4's byte-neutrality gate. Task 9 Step 4 describes the sibling-comparison wiring in prose rather than code because it must thread through `registerUpgradeCheck`'s existing `diffArchives` call, whose surrounding context the implementer must read first.
