# `writeTtmp2` `.mpl` Manifest Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `writeTtmp2` emit the four `.mpl` fields ConsoleTools always writes (`IsChecked`, `ModPackEntry`, the null sibling of `ModPackPages`/`SimpleModsList`, and verbatim-null descriptions), closing `docs/backlog/2026-07-13-resave-ttmp2-missing-mpl-fields.md`.

**Architecture:** `IsChecked` is not derivable at write time — it is a copy of `WizardOptionEntry.Selected`, a real model field. So we add `ModpackOption.selected`, populate it at both read seams the way each C# loader does, and read it at write time. Separately, TexTools serializes the manifest with Newtonsoft defaults (`NullValueHandling.Include`), so nulls are emitted rather than omitted; we stop coalescing the four nullable strings. Adding a real `selected` flag also retires `computeSelection`, which existed only to simulate it.

**Tech Stack:** TypeScript, Vitest, Biome, custom parallel test runner. Read the spec first: `docs/superpowers/specs/2026-07-20-ttmp2-mpl-manifest-fidelity-design.md`.

## Global Constraints

- **Every line of business logic cites TexTools provenance** as `file · symbol · lines` in a comment. Verify each citation against `reference/` — read the C#, do not port from memory.
- **`reference/` is read-only.** Never edit, lint, or format it.
- **Do not hand-format.** Biome owns formatting; run `npm run check`.
- **End-of-task ritual (required, every task):** `npm run check`, then `npm run typecheck`, then `npm test` — all green before the task is complete.
- **Reproduce TexTools faithfully, including its quirks.** In particular: the Single-group backstop fires only when *zero* options are selected; it must NOT clamp a group with more than one. Do not invent an invariant the C# lacks.
- Reference C# root: `reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/`. Below, `WizardData.cs` = `<root>/Mods/WizardData.cs`, `TTMPWriter.cs` = `<root>/Mods/TTMPWriter.cs`, `ModPackJson.cs` = `<root>/Mods/DataContainers/ModPackJson.cs`, `PMP.cs` = `<root>/Mods/FileTypes/PMP.cs`.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/model/modpack.ts` | Domain model. Gains `ModpackOption.selected`; `description` + 4 meta strings widen to `string \| null`. | 1, 3 |
| `src/container/ttmp2.ts` | TTMP2 read/write. Reader sets `selected` + backstop, stops coalescing; writer emits the 4 fields. | 1, 2, 3, 5 |
| `src/container/pmp.ts` | PMP read/write. Reader derives `selected` from `DefaultSettings` + backstop; writer reads real flags; `computeSelection` deleted. | 1, 3, 4 |
| `src/container/manifest-types.ts` | `.mpl` JSON shapes. `IsChecked` added; `Description` nullable. | 2, 3 |
| `test/container/ttmp2-selected.test.ts` | **New.** TTMP `selected` derivation + backstop. | 1 |
| `test/container/pmp-selected.test.ts` | **New.** PMP index/bitmask derivation + backstop. | 1 |
| `test/container/ttmp2-write.test.ts` | Existing. Gains `.mpl` field assertions. | 2, 3, 5 |
| `docs/backlog/2026-07-20-empty-group-not-dropped.md` | **New.** Out-of-scope finding from spec §5. | 6 |

---

### Task 1: `ModpackOption.selected` — model field and both read seams

**Files:**
- Modify: `src/model/modpack.ts:60-71` (add field to `ModpackOption`)
- Modify: `src/container/ttmp2.ts:108-161` (both reader branches)
- Modify: `src/container/pmp.ts:142-231` (`optionFromJson` return + both group pushes)
- Test: `test/container/ttmp2-selected.test.ts` (create), `test/container/pmp-selected.test.ts` (create)

**Interfaces:**
- Produces: `ModpackOption.selected: boolean`. Consumed by Task 2 (`writeTtmp2`) and Task 4 (`pmp.ts` writer).
- Produces: `applySingleGroupBackstop` does **not** exist — the backstop is duplicated inline at each seam by design (spec §4.2). Do not create a shared helper.

- [ ] **Step 1: Write the failing tests**

Create `test/container/ttmp2-selected.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readTtmp2 } from "../../src/container/ttmp2";
import { makeTtmp2WizardWithChecked } from "../helpers/make-packs";

describe("readTtmp2 selected", () => {
  it("copies IsChecked verbatim", () => {
    const data = readTtmp2(makeTtmp2WizardWithChecked([false, true]).bytes);
    expect(data.groups[0]!.options.map((o) => o.selected)).toEqual([false, true]);
  });

  it("treats an absent IsChecked as false, then backstops option 0", () => {
    const data = readTtmp2(makeTtmp2WizardWithChecked([undefined, undefined]).bytes);
    expect(data.groups[0]!.options.map((o) => o.selected)).toEqual([true, false]);
  });

  // WizardData.cs:668 copies verbatim and the :755-757 backstop only fires when ZERO are
  // selected — a Single group with several checked stays several. Guards against inventing
  // an exclusivity invariant the C# model does not have.
  it("does NOT clamp a Single group with multiple IsChecked", () => {
    const data = readTtmp2(makeTtmp2WizardWithChecked([true, true]).bytes);
    expect(data.groups[0]!.options.map((o) => o.selected)).toEqual([true, true]);
  });
});
```

Add this helper to `test/helpers/make-packs.ts` (follow the existing `makeTtmp2Wizard` there for zip/blob assembly; only the manifest differs). It builds a 2-option **Single** group named `G` with options `A`/`B`, writing `IsChecked` only where the argument is not `undefined`:

```ts
/** A 2-option Single-group wizard pack whose options' `IsChecked` is set per `checked`;
 *  an `undefined` entry omits the key entirely (C#'s `bool` field default is false). */
export function makeTtmp2WizardWithChecked(
  checked: Array<boolean | undefined>,
): { bytes: Uint8Array } {
  // Reuse makeTtmp2Wizard's file/blob construction, then override OptionList entries with
  // `IsChecked` present/absent per `checked`.
}
```

Create `test/container/pmp-selected.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readPmp } from "../../src/container/pmp";
import { makePmpWithGroup } from "../helpers/make-packs";

describe("readPmp selected", () => {
  // WizardData.cs:807 — Single reads DefaultSettings as an INDEX.
  it("Single: DefaultSettings is an index", () => {
    const data = readPmp(makePmpWithGroup({ Type: "Single", DefaultSettings: 1, optionCount: 3 }));
    expect(data.groups[1]!.options.map((o) => o.selected)).toEqual([false, true, false]);
  });

  // WizardData.cs:857-859 — out of range selects nothing, so the backstop takes option 0.
  it("Single: out-of-range DefaultSettings backstops to option 0", () => {
    const data = readPmp(makePmpWithGroup({ Type: "Single", DefaultSettings: 9, optionCount: 3 }));
    expect(data.groups[1]!.options.map((o) => o.selected)).toEqual([true, false, false]);
  });

  // WizardData.cs:810-811 — Multi reads it as a bitmask, and has NO backstop (Multi only).
  it("Multi: DefaultSettings is a bitmask", () => {
    const data = readPmp(makePmpWithGroup({ Type: "Multi", DefaultSettings: 0b101, optionCount: 3 }));
    expect(data.groups[1]!.options.map((o) => o.selected)).toEqual([true, false, true]);
  });

  it("Multi: zero selects nothing and is NOT backstopped", () => {
    const data = readPmp(makePmpWithGroup({ Type: "Multi", DefaultSettings: 0, optionCount: 3 }));
    expect(data.groups[1]!.options.map((o) => o.selected)).toEqual([false, false, false]);
  });
});
```

Add to `test/helpers/make-packs.ts`, following the existing PMP builders there (`groups[0]` is always the synthetic `Default` group from `default_mod.json`, so the group under test is `groups[1]`):

```ts
/** A minimal .pmp with one group_001 of `optionCount` options named O0..On. */
export function makePmpWithGroup(opts: {
  Type: string;
  DefaultSettings: number;
  optionCount: number;
}): Uint8Array {
  // meta.json + default_mod.json + group_001_G.json, zipped as the other PMP helpers do.
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/container/ttmp2-selected.test.ts test/container/pmp-selected.test.ts`
Expected: FAIL — `selected` is not a property of `ModpackOption` (typecheck error), and the helpers do not exist.

- [ ] **Step 3: Add the model field**

In `src/model/modpack.ts`, inside `interface ModpackOption` (after `priority`):

```ts
  /** Mirrors `WizardOptionEntry.Selected` (WizardData.cs:281-321) — a plain `bool` with no
   *  initializer, so `false`. NOT an exclusivity flag: the C# setter does IMC-only mutual
   *  exclusion and nothing for Single groups (Single radio behaviour is a WPF binding, not a
   *  model invariant), so a Single group CAN legally carry several selected options. */
  selected: boolean;
```

Then fix every construction site the compiler flags (`src/container/*.ts`, `src/upgrade/*.ts`, `test/helpers/*`) by adding `selected: false`, except the two seams below.

- [ ] **Step 4: Populate it in `readTtmp2`**

In `src/container/ttmp2.ts`, the `SimpleModsList` branch option (around `:109-117`) gets `selected: true` — `WizardData.cs:1218-1221` synthesizes the simple pack's fake option with `IsChecked = true`.

In the wizard branch (around `:149-157`), replace the `options:` mapping and append the backstop:

```ts
        // WizardData.cs:668 — `wizOp.Selected = o.IsChecked;`, verbatim, no clamping. An absent
        // key leaves C#'s `bool` field at its `false` default (ModPackJson.cs:189-198).
        options: g.OptionList.map((o) => ({
          name: o.Name,
          description: o.Description ?? "",
          image: o.ImagePath ?? "",
          priority: 0,
          selected: o.IsChecked ?? false,
          fileSwaps: {},
          manipulations: [],
          files: filesFromMods(o.ModsJsons, mpd, loadFix),
        })),
```

Then, immediately after the group object is pushed inside the `for (const g of page.ModGroups)` loop, add:

```ts
      // WizardData.cs:755-757 — FromWizardGroup's tail, AFTER every option is in the list. A
      // "none selected" backstop ONLY: it never corrects a Single group with more than one.
      const built = groups[groups.length - 1]!;
      if (
        built.selectionType === "Single" &&
        !built.options.some((o) => o.selected)
      ) {
        built.options[0]!.selected = true;
      }
```

Note `built.options[0]` is safe here only because C# returns null for a zero-option group
(`WizardData.cs:749-753`) — which we do not yet port. Guard it with `built.options.length > 0 &&`
in the condition so a zero-option group cannot crash; Task 6 files the real gap.

- [ ] **Step 5: Populate it in `readPmp`**

`optionFromJson` has no index or group type, so `selected` is assigned in the group loop. In
`src/container/pmp.ts`, give `optionFromJson`'s returned object `selected: false`, then in the
`for (const name of groupNames)` loop replace the `options:` mapping with a `const` built before the
`groups.push`:

```ts
    // WizardData.cs:805-812 — FromPMPGroup derives Selected from DefaultSettings: an INDEX for a
    // Single group, a BITMASK otherwise. `group.OptionType = Type == "Single" ? Single : Multi`
    // (:769), so Imc/Combining take the bitmask branch exactly like Multi.
    //
    // DefaultSettings -> ulong via CustomUInt64Converter (PMP.cs:1558-1571), which reinterprets a
    // negative JSON number as its 64-bit two's-complement UNSIGNED value (the documented "-1 meant
    // 2^64-1" shim, :1564-1565). BigInt.asUintN(64, ...) reproduces that; JS's 32-bit `|` would not.
    const rawSettings = BigInt.asUintN(64, BigInt(Math.trunc(g.DefaultSettings)));
    const options = g.Options.map((o, idx) => {
      const opt = optionFromJson(o, filesByKey, referencedKeys);
      opt.selected =
        g.Type === "Single"
          ? rawSettings === BigInt(idx)
          : (rawSettings & (1n << BigInt(idx))) !== 0n;
      return opt;
    });
    // WizardData.cs:857-859 — FromPMPGroup's tail, same backstop as the TTMP seam.
    if (
      g.Type === "Single" &&
      options.length > 0 &&
      !options.some((o) => o.selected)
    ) {
      options[0]!.selected = true;
    }
```

and pass `options` into the `groups.push({ ... })`.

The synthetic `Default` group pushed at `pmp.ts:193-202` is a Single group with one option and
`defaultSettings: 0`, so its option is `selected: true` by the index match — set it explicitly and
cite `WizardData.cs:1218-1221`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/container/ttmp2-selected.test.ts test/container/pmp-selected.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: End-of-task ritual**

Run: `npm run check`, `npm run typecheck`, `npm test`. All green.

- [ ] **Step 8: Commit**

```bash
git add src/model/modpack.ts src/container/ttmp2.ts src/container/pmp.ts test/
git commit -m "feat(model): add ModpackOption.selected, ported from WizardOptionEntry.Selected"
```

---

### Task 2: `writeTtmp2` emits `IsChecked`, `ModPackEntry`, and the null sibling

**Files:**
- Modify: `src/container/manifest-types.ts:2-39`
- Modify: `src/container/ttmp2.ts:205-283`
- Test: `test/container/ttmp2-write.test.ts`

**Interfaces:**
- Consumes: `ModpackOption.selected` (Task 1).
- Produces: a `.mpl` whose option objects carry `IsChecked`, whose mods jsons carry `ModPackEntry: null`, and which always spells both `ModPackPages` and `SimpleModsList`.

- [ ] **Step 1: Write the failing test**

Append to `test/container/ttmp2-write.test.ts`:

```ts
function mpl(bytes: Uint8Array): Record<string, unknown> {
  const entries = readZip(bytes);
  const name = [...entries.keys()].find((k) => k.toLowerCase().endsWith(".mpl"))!;
  return JSON.parse(new TextDecoder().decode(entries.get(name)!));
}

describe("writeTtmp2 .mpl fidelity", () => {
  it("writes IsChecked on every option", () => {
    const data = readTtmp2(makeTtmp2Wizard().bytes);
    data.groups[0]!.options[0]!.selected = true;
    const out = mpl(writeTtmp2(data)) as any;
    expect(out.ModPackPages[0].ModGroups[0].OptionList.map((o: any) => o.IsChecked))
      .toEqual([true, false]);
  });

  it("writes ModPackEntry: null on every mods json", () => {
    const out = mpl(writeTtmp2(readTtmp2(makeTtmp2Wizard().bytes))) as any;
    const mods = out.ModPackPages[0].ModGroups[0].OptionList.flatMap((o: any) => o.ModsJsons);
    expect(mods.length).toBeGreaterThan(0);
    for (const m of mods) {
      expect(m).toHaveProperty("ModPackEntry");
      expect(m.ModPackEntry).toBeNull();
    }
  });

  it("spells the unused list as an explicit null (both directions)", () => {
    const wizard = mpl(writeTtmp2(readTtmp2(makeTtmp2Wizard().bytes)));
    expect(wizard).toHaveProperty("SimpleModsList");
    expect(wizard.SimpleModsList).toBeNull();
    expect(Array.isArray(wizard.ModPackPages)).toBe(true);

    const simple = mpl(writeTtmp2(readTtmp2(makeTtmp2Simple().bytes)));
    expect(simple).toHaveProperty("ModPackPages");
    expect(simple.ModPackPages).toBeNull();
    expect(Array.isArray(simple.SimpleModsList)).toBe(true);
  });
});
```

Add `import { readZip } from "../../src/zip/zip";` to the file's imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/container/ttmp2-write.test.ts`
Expected: FAIL — `IsChecked` undefined, `ModPackEntry` absent, `SimpleModsList` absent on the wizard pack.

- [ ] **Step 3: Update the manifest types**

In `src/container/manifest-types.ts`, add to `TtmpModOptionJson` (declaration order matters — see Step 4):

```ts
  IsChecked: boolean;
```

and change `TtmpModsJson.ModPackEntry` from `ModPackEntry?: unknown | null;` to a required, always-written key:

```ts
  // ModPackJson.cs:262 — `public ModPack? ModPackEntry { get; set; }`, never assigned in either
  // AddFile initializer (TTMPWriter.cs:168-177, :198-207), so always null on write. TexTools
  // serializes with Newtonsoft defaults (NullValueHandling.Include, TTMPWriter.cs:324), so the
  // key is physically present as `null` rather than omitted.
  ModPackEntry: null;
```

Make `ModPackPages` and `SimpleModsList` both required and nullable:

```ts
  ModPackPages: TtmpModPackPageJson[] | null;
  SimpleModsList: TtmpModsJson[] | null;
```

- [ ] **Step 4: Update the writer**

In `src/container/ttmp2.ts`, `modOf` gains the key (last, matching `ModsJson`'s declaration order in
`ModPackJson.cs:222-262`):

```ts
    IsDefault: f.ttmp?.isDefault ?? false,
    ModPackEntry: null,
```

Initialize both list keys on the `mpl` literal and assign in the branches:

```ts
  const mpl: ModPackJson = {
    TTMPVersion: data.isSimple ? "2.1s" : "2.1w",
    Name: data.meta.name,
    Author: data.meta.author,
    Version: data.meta.version,
    Description: data.meta.description,
    Url: data.meta.url,
    MinimumFrameworkVersion: data.meta.minimumFrameworkVersion,
    // TTMPWriter's ctor initializes exactly ONE of these (TTMPWriter.cs:74-77) and leaves the
    // other at null; the bare JsonConvert.SerializeObject at :324 uses Newtonsoft's default
    // NullValueHandling.Include, so BOTH names always appear, one of them as `null`.
    ModPackPages: null,
    SimpleModsList: null,
  };
```

Reorder the `OptionList` mapping to `ModOptionJson`'s declaration order (`ModPackJson.cs:159-198`)
and add `IsChecked`:

```ts
        OptionList: g.options.map((o) => ({
          Name: o.name,
          Description: o.description,
          ImagePath: o.image,
          ModsJsons: [...o.files].map(([gamePath, f]) => modOf(gamePath, f)),
          GroupName: g.name,
          SelectionType: selectionType,
          // TTMPWriter.cs:148 — `IsChecked = modOption.IsChecked`, itself a verbatim copy of
          // WizardOptionEntry.Selected (WizardData.cs:418). No write-time derivation.
          IsChecked: o.selected,
        })),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/container/ttmp2-write.test.ts`
Expected: PASS.

- [ ] **Step 6: End-of-task ritual**

Run: `npm run check`, `npm run typecheck`, `npm test`.
**Expected:** corpus `upgrade`/`resave` checks may now report *fewer* baselined diffs — that is the
point. A baseline is a subset check, so fewer diffs still passes. If any pack reports a **new** diff,
stop and investigate; do not re-bless here (Task 6 does that).

- [ ] **Step 7: Commit**

```bash
git add src/container/manifest-types.ts src/container/ttmp2.ts test/container/ttmp2-write.test.ts
git commit -m "fix(ttmp2): write IsChecked, ModPackEntry and the null ModPackPages/SimpleModsList sibling"
```

---

### Task 3: Null fidelity for the nullable manifest strings

**Files:**
- Modify: `src/model/modpack.ts:60-97`
- Modify: `src/container/manifest-types.ts` (`TtmpModOptionJson.Description`, `ModPackJson` strings)
- Modify: `src/container/ttmp2.ts:96-106` (meta read), `:149-157` (option read), writer literal
- Modify: `src/container/pmp.ts:416, 597, 762` (coalesce at the PMP seams)
- Test: `test/container/ttmp2-write.test.ts`

**Interfaces:**
- Produces: `ModpackOption.description: string | null`; `ModpackMeta.name/.author/.description/.url: string | null`. `ModpackMeta.version` stays `string`.

- [ ] **Step 1: Write the failing test**

Append to `test/container/ttmp2-write.test.ts`:

```ts
describe("writeTtmp2 null fidelity", () => {
  it("round-trips a null option Description as null, and '' as ''", () => {
    const data = readTtmp2(makeTtmp2Wizard().bytes);
    data.groups[0]!.options[0]!.description = null;
    data.groups[0]!.options[1]!.description = "";
    const out = mpl(writeTtmp2(data)) as any;
    const list = out.ModPackPages[0].ModGroups[0].OptionList;
    expect(list[0].Description).toBeNull();
    expect(list[1].Description).toBe("");
  });

  // WizardMetaEntry.FromTtmp (WizardData.cs:1052-1069) assigns all five verbatim with no `?? ""`;
  // WriteWizardPack (:1332-1346) passes Name/Author/Url/Description straight through.
  it("round-trips null top-level Name/Author/Description/Url", () => {
    const data = readTtmp2(makeTtmp2Wizard().bytes);
    data.meta.name = null;
    data.meta.author = null;
    data.meta.description = null;
    data.meta.url = null;
    const out = mpl(writeTtmp2(data));
    expect(out.Name).toBeNull();
    expect(out.Author).toBeNull();
    expect(out.Description).toBeNull();
    expect(out.Url).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/container/ttmp2-write.test.ts`
Expected: FAIL — assigning `null` is a type error; values come out as `""`.

- [ ] **Step 3: Widen the model**

`src/model/modpack.ts` — `ModpackOption.description` and the four `ModpackMeta` strings:

```ts
  /** `string | null`: the TTMP path copies verbatim with no coalesce (WizardData.cs:663 on load,
   *  :414 in ToModOption, TTMPWriter.cs:144 on write), and the manifest serializer includes nulls,
   *  so a null description survives a TexTools round-trip. The PMP path is NOT symmetric — it
   *  coalesces (`op.Description = Description ?? ""`, WizardData.cs:544) — so the PMP writer
   *  coalesces at its own seam rather than the model forcing a value here. */
  description: string | null;
```

```ts
export interface ModpackMeta {
  // Name/Author/Description/Url are assigned verbatim on load (WizardMetaEntry.FromTtmp,
  // WizardData.cs:1052-1069) and on write (WriteWizardPack, :1332-1346) — the `= ""` field
  // initializers at :1015-1020 are overwritten by load, so null survives to serialization.
  name: string | null;
  author: string | null;
  // `version` is NOT nullable: WriteWizardPack forces it non-null via
  // `Version.TryParse(...); ver ??= new Version("1.0")` (:1333-1335), re-guarded in the
  // TTMPWriter ctor (TTMPWriter.cs:61).
  version: string;
  description: string | null;
  url: string | null;
  ...
}
```

`emptyMeta()` keeps its `""` values — they mirror the C# initializers.

- [ ] **Step 4: Stop coalescing at the TTMP read seam, coalesce at the PMP write seams**

`src/container/ttmp2.ts` meta read — drop `?? ""` from `Name`, `Author`, `Description`, `Url`
(keep it on `version`, which is non-nullable). Option read — `description: o.Description ?? null`
(an *absent* key is `undefined`; C#'s uninitialized `string` field is `null`, so normalize to null).

`src/container/manifest-types.ts` — `TtmpModOptionJson.Description: string | null;` and the four
`ModPackJson` strings likewise.

`src/container/pmp.ts` — the PMP writer must not emit null. At `:416` and `:762` use
`o.description ?? ""` / `g.description ?? ""`, and at `:597` `data.meta.description ?? ""`, each
citing `WizardData.cs:543-544` (`op.Description = Description ?? ""`) and `:946-947`
(`pg.Name = (Name ?? "").Trim()`). Do the same for `meta.Name`/`Website` if the compiler flags them.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/container/ttmp2-write.test.ts`
Expected: PASS.

- [ ] **Step 6: End-of-task ritual**

Run: `npm run check`, `npm run typecheck`, `npm test`. Same expectation as Task 2 Step 6 — fewer
baselined diffs is good; a *new* diff means stop and investigate.

- [ ] **Step 7: Commit**

```bash
git add src/ test/
git commit -m "fix(ttmp2): preserve null Description and null top-level meta strings"
```

---

### Task 4: Retire `computeSelection`

**Files:**
- Modify: `src/container/pmp.ts:327-369` (delete), `:769-773` (call site)
- Test: existing `test/container/pmp-write.test.ts` must stay green unchanged

**Interfaces:**
- Consumes: `ModpackOption.selected` (Task 1).
- Produces: `groupSelection(group: ModpackGroup): number` in `src/container/pmp.ts`.

- [ ] **Step 1: Replace the simulation with a read of the real flags**

Delete `computeSelection` (`:327-369`) and add, citing the getter it now ports directly:

```ts
/** Port of `WizardGroupEntry.Selection` (WizardData.cs:578-604). `ToPmpGroup` writes
 *  `pg.DefaultSettings = Selection` (:949) rather than the source value.
 *
 *  This used to RECONSTRUCT the per-option `Selected` flags from the group's raw `defaultSettings`,
 *  because the domain model had none. It now reads the real flags, which readPmp/readTtmp2 derive
 *  at the same seam the C# loaders do — so this is the getter itself, nothing more.
 *
 *  Single: `Options.FirstOrDefault(x => x.Selected)`, and `return 0` when none matched (:584-588).
 *  Multi: OR bit i for each selected option, i < Options.Count (:594-601). Caps at Number precision
 *  (2^53); a real group is never near 53 options, and the model types DefaultSettings as `number`. */
function groupSelection(g: ModpackGroup): number {
  if (g.selectionType === "Single") {
    const i = g.options.findIndex((o) => o.selected);
    return i < 0 ? 0 : i;
  }
  let total = 0n;
  for (let i = 0; i < g.options.length; i++) {
    if (g.options[i]!.selected) total |= 1n << BigInt(i);
  }
  return Number(total);
}
```

Call site becomes `DefaultSettings: groupSelection(g),`.

**Do not** add `SelectedSettings`: it is `[JsonIgnore]` (`PMP.cs:1399-1400`) and absent from a real
ConsoleTools group json, so our omitting it is already correct.

- [ ] **Step 2: Run the full suite**

Run: `npm test`
**Expected: ZERO PMP byte movement.** The old simulation was exact for PMP-sourced groups by
construction, so no corpus pack's PMP/resave diff may change. If any does, **stop** — that is a
finding about one of the two derivations, not a re-bless.

- [ ] **Step 3: End-of-task ritual**

Run: `npm run check`, `npm run typecheck`, `npm test`. All green.

- [ ] **Step 4: Commit**

```bash
git add src/container/pmp.ts
git commit -m "refactor(pmp): read real selected flags instead of simulating them in computeSelection"
```

---

### Task 5: Version reformat (SEPARABLE — may be dropped)

> Spec §4.4. This is a latent divergence **not named by the backlog item**, in scope only because it
> lives in the same object literal and the same C# method as Task 3. If it proves noisy, drop this
> task entirely; nothing later depends on it.

**Files:**
- Create: `src/util/dotnet-version.ts`
- Modify: `src/container/pmp.ts:321-325` (delete `reformatPmpVersion`, import the shared one)
- Modify: `src/container/ttmp2.ts` (writer literal)
- Test: `test/util/dotnet-version.test.ts` (create)

**Interfaces:**
- Produces: `export function reformatDotnetVersion(source: string): string` in `src/util/dotnet-version.ts`.

- [ ] **Step 1: Write the failing test**

Create `test/util/dotnet-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reformatDotnetVersion } from "../../src/util/dotnet-version";

describe("reformatDotnetVersion", () => {
  it("keeps a parseable version's component count", () => {
    expect(reformatDotnetVersion("1.2")).toBe("1.2");
    expect(reformatDotnetVersion("1.2.3")).toBe("1.2.3");
    expect(reformatDotnetVersion("1.2.3.4")).toBe("1.2.3.4");
  });

  it("falls back to 1.0 for anything TryParse rejects", () => {
    // .NET Version.TryParse requires at least major.minor, so a bare "1" fails.
    expect(reformatDotnetVersion("1")).toBe("1.0");
    expect(reformatDotnetVersion("")).toBe("1.0");
    expect(reformatDotnetVersion("v1.2")).toBe("1.0");
    expect(reformatDotnetVersion("1.-2")).toBe("1.0");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/util/dotnet-version.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the shared util**

Move `reformatPmpVersion`'s body verbatim from `src/container/pmp.ts:321-325` into
`src/util/dotnet-version.ts` as `reformatDotnetVersion`, with a header comment citing the **.NET
primitive** rather than either caller (the shared thing is `Version.TryParse`/`ToString()`, not one
caller's logic), and noting its two call sites: `WizardData.cs:1474-1475+:1494` (PMP) and
`WizardData.cs:1333-1335` (TTMP).

Update `src/container/pmp.ts` to import it, keeping its existing call site's own citation comment.

- [ ] **Step 4: Use it in `writeTtmp2`**

```ts
    // WriteWizardPack (WizardData.cs:1333-1335) normalizes through Version.TryParse before the
    // TTMPWriter ctor stringifies it, so a source spelling "1" is written "1.0".
    Version: reformatDotnetVersion(data.meta.version),
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/util/dotnet-version.test.ts`
Expected: PASS.

- [ ] **Step 6: End-of-task ritual**

Run: `npm run check`, `npm run typecheck`, `npm test`.
If this task causes **new** corpus diffs on packs whose versions previously matched, drop the task
(`git checkout -- .`) and note it in the PR body rather than re-blessing.

- [ ] **Step 7: Commit**

```bash
git add src/util/dotnet-version.ts src/container/pmp.ts src/container/ttmp2.ts test/util/dotnet-version.test.ts
git commit -m "fix(ttmp2): normalize the pack version through .NET Version semantics on write"
```

---

### Task 6: Re-bless baselines, close the item, file the out-of-scope finding

**Files:**
- Delete: `docs/backlog/2026-07-13-resave-ttmp2-missing-mpl-fields.md`
- Modify: `docs/BACKLOG.md` (item 7 in Prioritized; the `/resave` findings section note)
- Create: `docs/backlog/2026-07-20-empty-group-not-dropped.md`
- Modify: `test/corpus/.upgrade-baseline/`, `.resave-baseline/` (gitignored)

- [ ] **Step 1: Grep for references before deleting the item**

Run: `rg "2026-07-13-resave-ttmp2-missing-mpl-fields" src test scripts docs`
Every hit must be updated or removed in this commit — a dangling pointer to a deleted item file is a
BACKLOG.md rule violation.

- [ ] **Step 2: Confirm the synthetic pack is clean**

The item's own reproduction target is `test/corpus/synthetic/imc-weapon.ttmp2`. Rebuild and check:

Run: `npm run synthetics` then `npm test`
Expected: that pack reports **no** `IsChecked`, `ModPackEntry` or `SimpleModsList` diffs. Its
baseline should now be empty or reduced to entries attributable to the two sibling items
(`Name`/`Category` re-derivation, option file order). Any other residue is a bug — investigate.

- [ ] **Step 3: Re-bless**

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

Then inspect the diff of the baseline directories. **Every removed entry must be one of the four
fields this change fixes, and every remaining entry on a touched pack must be attributable to a
named sibling item.** Record the before/after entry counts for the PR body.

- [ ] **Step 4: File the out-of-scope finding**

Create `docs/backlog/2026-07-20-empty-group-not-dropped.md` per BACKLOG.md's format: both C# loaders
`return null` for a zero-option group (`WizardData.cs:749-753`, `:851-855`), dropping it from the
wizard model entirely; our readers keep it. Note it was found while porting the Single-group backstop
that sits two lines below it, and that Task 1's `options.length > 0` guards exist because of it.
Link it from BACKLOG.md's *Unprioritized → `/resave` findings* section.

- [ ] **Step 5: Close the item**

Delete `docs/backlog/2026-07-13-resave-ttmp2-missing-mpl-fields.md`. In `docs/BACKLOG.md`, update
Prioritized item 7 to name only the two remaining siblings and correct its entry/pack counts, and
update the `/resave` findings section's "Three `writeTtmp2` manifest items moved" note to two.

- [ ] **Step 6: End-of-task ritual**

Run: `npm run check`, `npm run typecheck`, `npm test`. All green.

- [ ] **Step 7: Commit**

```bash
git add docs/
git commit -m "docs: close the writeTtmp2 missing .mpl fields item, file the empty-group finding"
```

---

## Before opening the PR

Per AGENTS.md, **delete this plan file on the branch** so the PR under review contains only the
durable spec and the shipped work:

```bash
git rm docs/superpowers/plans/2026-07-20-ttmp2-mpl-manifest-fidelity.md
git commit -m "docs: remove the completed implementation plan"
```
