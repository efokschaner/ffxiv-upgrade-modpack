# TTMP2 `SelectionType` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `readTtmp2`/`writeTtmp2` reproduce TexTools' `SelectionType` handling exactly, so a multi-select group survives our pipeline instead of being silently downgraded to single-select.

**Architecture:** A matched pair of errors in `src/container/ttmp2.ts` — reader and writer both use a `"Multi Selection"`/`"Single Selection"` spelling that exists nowhere in TexTools except two doc-comments. They masked each other on round-trip. Replace both with literal ports of `WizardData.cs:652` (read) and `:877`/`:419` (write), scrub the invented spelling from the three other places it spread to, and prove it with the existing corpus goldens plus two new synthetic `.ttmp2` packs.

**Tech Stack:** TypeScript, Vitest, Biome, `tsx`, `fflate`. Oracle is ConsoleTools (`/upgrade` and `/resave` golden harnesses).

**Spec:** `docs/superpowers/specs/2026-07-13-ttmp2-selection-type-design.md` — read it first. It records *why* the backlog item's own prescribed fix was wrong, and why two "obvious" additions (a `TEXTOOLS_BUGS.md` entry, a writer guard on unrecognized values) were retracted.

## Global Constraints

- **Byte-parity with ConsoleTools is the definition of correct.** Do not "improve" on TexTools.
- **Every line of business logic cites its C# source** as `file · symbol · lines` in a comment.
- **`reference/` is read-only.** Never edit, lint, or format it.
- **No per-file license headers.**
- **Formatting is mechanical** — run `npm run check`; never hand-format.
- **End-of-task ritual, all green:** `npm run check`, `npm run typecheck`, `npm test`.
- **Do not add a `docs/TEXTOOLS_BUGS.md` entry.** This is not a TexTools bug; see spec §3.
- **Do not add a writer guard on unrecognized `selectionType` values.** It has no C# counterpart and would throw on `"Combining"`, which TexTools writes as `"Multi"`; see spec §4.

## File Structure

| File | Responsibility |
|---|---|
| `src/container/ttmp2.ts` (modify `:101-102`, `:198-218`) | The fix: reader collapse + writer collapse + Imc throw |
| `test/helpers/make-packs.ts` (modify `:98`, `:105`, `:123`) | Scrub the invented spelling from shared fixtures |
| `test/container/ttmp2-selection-type.test.ts` (create) | Unit tests pinning both collapses and the Imc throw |
| `scripts/generate-synthetics/ttmp2-builder.ts` (create) | Shared TTMP2 pack scaffolding (all 5 existing builders are PMP-only) |
| `scripts/generate-synthetics/build-synthetic-selection-type.ts` (create) | Pack 1: the three present-value groups |
| `scripts/generate-synthetics/build-synthetic-selection-type-absent.ts` (create) | Pack 2: the omitted-key group, isolated |
| `scripts/generate-synthetics/build-all.ts` (modify) | Wire both builders into `npm run synthetics` |
| `docs/superpowers/specs/2026-07-12-pmp-writer-regeneration-design.md` (modify `:307-320`) | Correct the "legacy spelling" claim in a durable spec |
| `docs/BACKLOG.md` (modify), `docs/backlog/2026-07-13-ttmp2-selection-type-spelling.md` (delete) | Retire the shipped item |

## A note on the ratchet, so nobody panics

`compareToBaseline` (`test/helpers/upgrade-baseline.ts:53-61`) passes when **actual ⊆ baseline**. The fix only *removes* diffs, so the corpus checks stay **green** from Task 1 onward without re-blessing. Task 2's bless is a deliberate **burn-down** of 643 now-stale entries, not a repair. If any corpus check goes *red* at any point, you have introduced a new divergence — stop and investigate, do not bless it away.

---

### Task 1: Fix the reader and the writer

**Files:**
- Modify: `src/container/ttmp2.ts:101-102` (reader), `:198-218` (writer)
- Modify: `test/helpers/make-packs.ts:98,105,123`
- Test: `test/container/ttmp2-selection-type.test.ts` (create)

**Interfaces:**
- Consumes: `readTtmp2(bytes: Uint8Array): ModpackData`, `writeTtmp2(data: ModpackData): Uint8Array` (existing, unchanged signatures); `ModpackGroup.selectionType: string` (`src/model/modpack.ts:76`).
- Produces: no new exports. `ModpackData` read from a TTMP now carries `selectionType: "Single" | "Multi"` (previously always `"Single"`).

- [ ] **Step 1: Write the failing test**

Create `test/container/ttmp2-selection-type.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ModPackJson } from "../../src/container/manifest-types";
import { readTtmp2, writeTtmp2 } from "../../src/container/ttmp2";
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../../src/model/modpack";
import { readZip, writeZip } from "../../src/zip/zip";

const enc = new TextEncoder();
const dec = new TextDecoder();

const PATH = "chara/human/c0101/obj/body/b0001/model/c0101b0001.mdl";
const BLOB = new Uint8Array([0xaa, 0x01, 0x02, 0x03]);

/** A group JSON authored as a raw object, not the typed TtmpModGroupJson: only a raw object can
 *  OMIT SelectionType, which is one of the cases WizardData.cs:652 has to answer for. */
function groupJson(selectionType?: string): Record<string, unknown> {
  const sel = selectionType === undefined ? {} : { SelectionType: selectionType };
  return {
    GroupName: "G",
    ...sel,
    OptionList: [
      {
        Name: "A",
        Description: "",
        ImagePath: "",
        GroupName: "G",
        ...sel,
        ModsJsons: [
          {
            Name: "N",
            Category: "C",
            FullPath: PATH,
            ModOffset: 0,
            ModSize: BLOB.length,
            DatFile: "040000.win32.dat0",
            IsDefault: false,
          },
        ],
      },
    ],
  };
}

function wizardPack(group: Record<string, unknown>): Uint8Array {
  const mpl = {
    TTMPVersion: "2.1w",
    Name: "sel",
    Author: "test",
    Version: "1.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    ModPackPages: [{ PageIndex: 0, ModGroups: [group] }],
  };
  return writeZip(
    new Map<string, Uint8Array>([
      ["TTMPL.mpl", enc.encode(JSON.stringify(mpl))],
      ["TTMPD.mpd", BLOB],
    ]),
  );
}

function dataWith(selectionType: string): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: false,
    meta: {
      name: "m",
      author: "a",
      version: "1",
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
        selectionType,
        defaultSettings: 0,
        options: [
          {
            name: "A",
            description: "",
            image: "",
            priority: 0,
            fileSwaps: {},
            manipulations: [],
            files: [
              {
                gamePath: PATH,
                data: BLOB,
                storage: FileStorageType.SqPackCompressed,
              },
            ],
          },
        ],
      },
    ],
  };
}

function writtenMpl(data: ModpackData): ModPackJson {
  const entries = readZip(writeTtmp2(data));
  return JSON.parse(dec.decode(entries.get("TTMPL.mpl")!)) as ModPackJson;
}

// WizardData.cs:652 — `tGroup.SelectionType == "Single" ? Single : Multi`. The comparison is against
// "Single" ONLY, so every other value — including the "Single Selection" spelling this port once
// invented, and an absent key — lands on Multi.
describe("readTtmp2 SelectionType (WizardData.cs:652)", () => {
  it.each([
    ["Single", "Single"],
    ["Multi", "Multi"],
    ["Single Selection", "Multi"],
    ["Multi Selection", "Multi"],
  ])("maps %j to %j", (raw, expected) => {
    const data = readTtmp2(wizardPack(groupJson(raw)));
    expect(data.groups[0]!.selectionType).toBe(expected);
  });

  it("maps an absent SelectionType to Multi", () => {
    const data = readTtmp2(wizardPack(groupJson(undefined)));
    expect(data.groups[0]!.selectionType).toBe("Multi");
  });
});

// WizardData.cs:877 (group) / :419 (option) — `SelectionType = OptionType.ToString()`, where
// OptionType is the two-valued EOptionType (:25-29) both readers collapse into (:652 TTMP, :769 PMP),
// and an option delegates to its group (:335-341).
describe("writeTtmp2 SelectionType (WizardData.cs:877/:419)", () => {
  it.each([
    ["Single", "Single"],
    ["Multi", "Multi"],
    // Not "Single", therefore Multi — the case a guard on "unrecognized" values would have wrongly
    // thrown on. FromPMPGroup (:769) collapses it exactly this way.
    ["Combining", "Multi"],
  ])("writes %j as %j at group and option level", (input, expected) => {
    const mpl = writtenMpl(dataWith(input));
    const g = mpl.ModPackPages![0]!.ModGroups[0]!;
    expect(g.SelectionType).toBe(expected);
    expect(g.OptionList[0]!.SelectionType).toBe(expected);
  });

  it("never writes the invented '… Selection' spelling", () => {
    const raw = dec.decode(readZip(writeTtmp2(dataWith("Multi"))).get("TTMPL.mpl")!);
    expect(raw).not.toContain("Selection\"");
    expect(raw).toContain('"SelectionType":"Multi"');
  });

  // ToModOption throws NotImplementedException when StandardData is null (WizardData.cs:423-426),
  // which is true exactly for an Imc group's options.
  it("throws on an Imc group (ToModOption, WizardData.cs:423-426)", () => {
    expect(() => writeTtmp2(dataWith("Imc"))).toThrow(
      /does not support one or more of the selected Option types/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/container/ttmp2-selection-type.test.ts`

Expected: FAIL. The reader cases for `"Multi"` and the absent key report `"Single"`; the writer cases report `"Multi Selection"` / `"Single Selection"`; the Imc case does not throw.

- [ ] **Step 3: Fix the reader**

In `src/container/ttmp2.ts`, replace lines 101-102:

```ts
        selectionType:
          g.SelectionType === "Multi Selection" ? "Multi" : "Single",
```

with:

```ts
        // WizardData.cs:652 — `tGroup.SelectionType == "Single" ? Single : Multi`. The comparison is
        // against "Single" ONLY: every other value, including an absent one, is Multi. Do NOT
        // "restore" a `"Multi Selection"` / `"Single Selection"` test here. Those strings appear
        // nowhere in TexTools except two doc-comments (ModGroup.cs:32, ModPackJson.cs:144); no C#
        // has ever read or written them, and coding that comment instead of the code is the bug
        // this line replaced. See docs/superpowers/specs/2026-07-13-ttmp2-selection-type-design.md.
        selectionType: g.SelectionType === "Single" ? "Single" : "Multi",
```

- [ ] **Step 4: Fix the writer**

In `src/container/ttmp2.ts`, replace the `for (const g of data.groups)` body (lines 199-218) with:

```ts
    for (const g of data.groups) {
      // WizardData.cs:423-426 — ToModOption throws NotImplementedException("TTMP Export does not
      // support one or more of the selected Option types.") when StandardData is null, which is
      // true exactly for an Imc group's options (StandardData returns null unless GroupType ==
      // Standard, :375-386; GroupType is Imc iff ImcData != null, :609-618). Only a PMP source
      // carries an Imc group and /upgrade never converts formats, so this is unreachable today.
      // Reproduced because it is TexTools' behaviour — not invented as a defensive guard.
      // `selectionType === "Imc"` is the same stand-in for GroupType used at option-prefix.ts:288
      // and pmp.ts:485.
      if (g.selectionType === "Imc") {
        throw new Error(
          "ttmp2: TTMP Export does not support one or more of the selected Option types.",
        );
      }
      // WizardData.cs:877 (group) / :419 (option) — `SelectionType = OptionType.ToString()`, where
      // OptionType is EOptionType { Single, Multi } (:25-29), the two-valued enum BOTH readers
      // collapse the raw string into at load (:652 TTMP, :769 PMP). So any non-"Single" value —
      // "Combining" included — writes as "Multi". An option has no type of its own: it delegates to
      // its group (:335-341), so the same value is written at both levels.
      const selectionType = g.selectionType === "Single" ? "Single" : "Multi";
      const list = byPage.get(g.page) ?? [];
      list.push({
        GroupName: g.name,
        SelectionType: selectionType,
        OptionList: g.options.map((o) => ({
          Name: o.name,
          Description: o.description,
          ImagePath: o.image,
          GroupName: g.name,
          SelectionType: selectionType,
          ModsJsons: o.files.map(modOf),
        })),
      });
      byPage.set(g.page, list);
    }
```

- [ ] **Step 5: Scrub the invented spelling from the shared fixtures**

In `test/helpers/make-packs.ts`, change all three occurrences of `SelectionType: "Single Selection",` (lines 98, 105, 123) to `SelectionType: "Single",`.

This is required, not cosmetic: with the reader fixed, `"Single Selection"` reads as **Multi**, so leaving it would silently turn `makeTtmp2Wizard`'s group into a multi-select group under `harness.test.ts` and `upgrade-harness.test.ts`, which never meant to test that.

- [ ] **Step 6: Run the new test to verify it passes**

Run: `npx vitest run test/container/ttmp2-selection-type.test.ts`
Expected: PASS, all 9 cases.

- [ ] **Step 7: Run the full gate**

Run: `npm run check`, then `npm run typecheck`, then `npm test`.

Expected: all green, **including the corpus checks** — the ratchet passes on `actual ⊆ baseline` and this change only removes diffs. The `[upgrade]` / `[resave]` console lines for the 36 wizard packs should now report *fewer* diffs than their baseline count. If anything is **red**, you have introduced a new divergence: stop, investigate, do not bless.

- [ ] **Step 8: Commit**

```powershell
git add src/container/ttmp2.ts test/helpers/make-packs.ts test/container/ttmp2-selection-type.test.ts
git commit -m "fix(ttmp2): port SelectionType from WizardData.cs, not from its doc-comment"
```

---

### Task 2: Burn 643 stale entries out of both ratchet baselines

**Files:**
- Modify: `test/corpus/.upgrade-baseline/*.json`, `test/corpus/.resave-baseline/*.json` (gitignored — **not** committed; this task's deliverable is the *evidence*, not a diff)

**Interfaces:**
- Consumes: the fix from Task 1.
- Produces: nothing later tasks import. Establishes the "nothing else moved" fact the spec (§6.1) demands.

The baselines are gitignored, so `git diff` cannot check this. Snapshot them by hand first.

- [ ] **Step 1: Snapshot the baselines and record the before-counts**

```powershell
$snap = "$env:TEMP\selectiontype-baseline-before"
Remove-Item -Recurse -Force $snap -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $snap | Out-Null
Copy-Item -Recurse test/corpus/.upgrade-baseline "$snap\upgrade"
Copy-Item -Recurse test/corpus/.resave-baseline "$snap\resave"
"upgrade SelectionType: " + (Select-String -Path test/corpus/.upgrade-baseline/*.json -Pattern SelectionType).Count
"resave SelectionType:  " + (Select-String -Path test/corpus/.resave-baseline/*.json -Pattern SelectionType).Count
```

Expected: `643` and `643`. If they differ, the corpus has changed since the spec was measured — report the new numbers and carry on with them.

- [ ] **Step 2: Bless**

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

- [ ] **Step 3: Verify that ONLY SelectionType pointers left, and nothing moved in**

```powershell
$snap = "$env:TEMP\selectiontype-baseline-before"
function Ids($p) {
  if (-not (Test-Path $p)) { return @() }
  (Get-Content -LiteralPath $p -Raw | ConvertFrom-Json) |
    ForEach-Object { "{0}|{1}#{2}:{3}" -f ($_.kind ?? "payload"), $_.gamePath, $_.index, $_.status }
}
foreach ($h in @("upgrade","resave")) {
  $removed = @(); $added = @()
  foreach ($f in Get-ChildItem "$snap\$h" -Filter *.json) {
    $before = Ids $f.FullName
    $after  = Ids "test/corpus/.$h-baseline/$($f.Name)"
    $removed += (Compare-Object $before $after | Where-Object SideIndicator -eq "<=").InputObject
    $added   += (Compare-Object $before $after | Where-Object SideIndicator -eq "=>").InputObject
  }
  "=== $h ==="
  "removed: {0} ({1} of them SelectionType)" -f $removed.Count, ($removed | Where-Object { $_ -match "SelectionType" }).Count
  "ADDED:   {0}" -f $added.Count
  $removed | Where-Object { $_ -notmatch "SelectionType" } | ForEach-Object { "  removed NON-SelectionType: $_" }
  $added | ForEach-Object { "  ADDED: $_" }
}
```

Expected, for **both** harnesses: `removed: 643 (643 of them SelectionType)`, `ADDED: 0`, and **no** lines printed for non-`SelectionType` removals or additions.

**If anything else moved, stop.** A non-`SelectionType` removal means the fix changed something the spec did not predict; an addition means it introduced a divergence. Either is a finding to report, not churn to accept. Restore from `$snap` and investigate.

- [ ] **Step 4: Confirm the counts are now zero and the suite is green**

```powershell
"upgrade SelectionType: " + (Select-String -Path test/corpus/.upgrade-baseline/*.json -Pattern SelectionType).Count
"resave SelectionType:  " + (Select-String -Path test/corpus/.resave-baseline/*.json -Pattern SelectionType).Count
npm test
```

Expected: `0`, `0`, suite green.

- [ ] **Step 5: Report (no commit — the baselines are gitignored)**

Report the before/after counts and the removed/added tallies. There is nothing to commit in this task.

---

### Task 3: Synthetic TTMP2 builder + `selection-type.ttmp2`

**Files:**
- Create: `scripts/generate-synthetics/ttmp2-builder.ts`
- Create: `scripts/generate-synthetics/build-synthetic-selection-type.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`

**Interfaces:**
- Consumes: `encodeSqPackFile(data: Uint8Array, type: SqPackType): Uint8Array` and `SqPackType.Standard` from `src/sqpack/sqpack.ts:36,5`.
- Produces: `writeTtmp2Pack(fileName: string, packName: string, groups: SyntheticTtmpGroup[]): void` and `interface SyntheticTtmpGroup { name: string; selectionType?: string }` — Task 4 imports both.

- [ ] **Step 1: Create the builder**

Create `scripts/generate-synthetics/ttmp2-builder.ts`:

```ts
// Shared scaffolding for the synthetic TTMP2 builders in this directory. Emits the minimal wizard
// .ttmp2 shape TexTools reads — TTMPL.mpl + TTMPD.mpd (TTMP.cs:378/:488, WizardData.cs:645). This is
// test scaffolding, not ported business logic; each builder supplies only what makes its repro
// distinct. The PMP equivalent is pmp-builder.ts.
//
// Two things here are load-bearing and must not be "tidied":
//   - the JSON key order below fixes the .mpl bytes the golden harness compares;
//   - the pinned mtime keeps a pack byte-reproducible, so rebuilding it keeps its cached golden
//     (the cache is keyed by sha256(input pack)). Same reasoning as pmp-builder.ts.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { encodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "corpus",
  "synthetic",
);

/** See pmp-builder.ts: fflate stamps Date.now() into every entry unless pinned, which would make
 * each rebuild miss the sha256-keyed golden cache. */
const FIXED_MTIME = new Date("2024-01-01T00:00:00");

/** A gamePath /upgrade ignores, so ConsoleTools no-ops and the /upgrade harness compares our output
 * against the input pack. /resave writes regardless, and IS the oracle for these packs. */
const DUMMY_GAME_PATH = "chara/dummy/selection_type_dummy.bin";

/** Unlike a PMP's raw zip members, TTMP payloads live in the .mpd as SQPACK-COMPRESSED blobs, so a
 * bare byte string will not decode. This is a real Type 2 entry. */
const DUMMY_PAYLOAD = encodeSqPackFile(
  new Uint8Array([0, 1, 2, 3]),
  SqPackType.Standard,
);

export interface SyntheticTtmpGroup {
  name: string;
  /** Written verbatim. `undefined` OMITS the key entirely — a case the typed TtmpModGroupJson
   * cannot express, and one WizardData.cs:652 still has to answer for. */
  selectionType?: string;
}

/** Writes a one-page wizard .ttmp2 into test/corpus/synthetic/ (gitignored, like the real corpus).
 * Every group gets one option carrying the same dummy payload. */
export function writeTtmp2Pack(
  fileName: string,
  packName: string,
  groups: SyntheticTtmpGroup[],
): void {
  const modsJson = {
    Name: "Dummy",
    Category: "Unknown",
    FullPath: DUMMY_GAME_PATH,
    ModOffset: 0,
    ModSize: DUMMY_PAYLOAD.length,
    DatFile: "040000.win32.dat0",
    IsDefault: false,
  };
  const modGroups = groups.map((g) => {
    const sel =
      g.selectionType === undefined ? {} : { SelectionType: g.selectionType };
    return {
      GroupName: g.name,
      ...sel,
      OptionList: [
        {
          Name: "On",
          Description: "",
          ImagePath: "",
          GroupName: g.name,
          ...sel,
          IsChecked: false,
          ModsJsons: [modsJson],
        },
      ],
    };
  });
  const mpl = {
    TTMPVersion: "2.1w",
    Name: packName,
    Author: "synthetic",
    Version: "1.0.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    ModPackPages: [{ PageIndex: 0, ModGroups: modGroups }],
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, fileName);
  writeFileSync(
    out,
    zipSync(
      {
        "TTMPL.mpl": new TextEncoder().encode(JSON.stringify(mpl)),
        "TTMPD.mpd": DUMMY_PAYLOAD,
      },
      { mtime: FIXED_MTIME },
    ),
  );
  console.log("wrote", out);
}
```

- [ ] **Step 2: Create the pack-1 builder**

Create `scripts/generate-synthetics/build-synthetic-selection-type.ts`:

```ts
// Builds test/corpus/synthetic/selection-type.ttmp2: a wizard TTMP declaring one group per
// SelectionType spelling, so ConsoleTools' /resave golden tells us what TexTools' reader+writer
// actually do with each — instead of us inferring it from WizardData.cs:652.
//
// Predicted (design spec §6.2): "Single" -> "Single"; "Multi" -> "Multi"; "Single Selection" ->
// "Multi" (the :652 comparison is against "Single" only, and "Single Selection" is a string no
// TexTools code has ever written — it was invented by this port from a doc-comment). If the oracle
// disagrees, the ORACLE WINS and the reader follows it.
//
// The .ttmp2 is gitignored; regenerate with `npm run synthetics`.

import { writeTtmp2Pack } from "./ttmp2-builder";

writeTtmp2Pack("selection-type.ttmp2", "SelectionType Repro", [
  { name: "Modern Single", selectionType: "Single" },
  { name: "Modern Multi", selectionType: "Multi" },
  { name: "Invented Legacy", selectionType: "Single Selection" },
]);
```

- [ ] **Step 3: Wire it into `npm run synthetics`**

In `scripts/generate-synthetics/build-all.ts`, append after the existing imports:

```ts
import "./build-synthetic-selection-type";
```

- [ ] **Step 4: Build the pack**

Run: `npm run synthetics`
Expected: `wrote …\test\corpus\synthetic\selection-type.ttmp2` among the others.

- [ ] **Step 5: Run the suite and read what the oracle said**

Run: `npm test`

This spawns ConsoleTools for the new pack (both harnesses) and caches the goldens. The pack is new, so it has no baseline and is expected to differ; the run may fail on it. **That is not a failure to fix — it is the oracle speaking.** Read what it said:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$h = (Get-FileHash -LiteralPath test/corpus/synthetic/selection-type.ttmp2 -Algorithm SHA256).Hash.ToLower()
$z = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path "test/corpus/.resave-cache/$h.bin"))
$e = $z.Entries | Where-Object FullName -like "*.mpl"
$sr = New-Object System.IO.StreamReader($e.Open()); $txt = $sr.ReadToEnd(); $sr.Close(); $z.Dispose()
[regex]::Matches($txt, '"GroupName":"(?<g>[^"]*)","SelectionType":"(?<s>[^"]*)"') |
  ForEach-Object { "{0,-16} -> {1}" -f $_.Groups['g'].Value, $_.Groups['s'].Value }
```

Expected (the spec's prediction):

```
Modern Single    -> Single
Modern Multi     -> Multi
Invented Legacy  -> Multi
```

- [ ] **Step 6: Reconcile prediction against oracle**

- **If the oracle matches the prediction:** our reader already agrees with it, so the pack's `/resave` diff carries no `SelectionType` entry. Continue.
- **If the oracle disagrees:** the oracle wins. Report exactly what it emitted, and revise `src/container/ttmp2.ts` and Task 1's unit test to match it *before* blessing anything. Do not bless a `SelectionType` mismatch on this pack into the baseline — that would re-bury the very defect this branch exists to remove.

- [ ] **Step 7: Bless the new pack and verify what it recorded**

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
"upgrade SelectionType: " + (Select-String -Path test/corpus/.upgrade-baseline/*.json -Pattern SelectionType).Count
"resave SelectionType:  " + (Select-String -Path test/corpus/.resave-baseline/*.json -Pattern SelectionType).Count
npm test
```

Expected: **resave = 0** — our writer agrees with TexTools' writer, which is the whole point. **upgrade = 2** — one group pointer and one option pointer for the `Invented Legacy` group, because `/upgrade` no-ops on this pack so its "golden" is the *input*, which declares `"Single Selection"` by construction while we correctly write `"Multi"`. Suite green.

If `resave` is non-zero, our writer still disagrees with TexTools — that is a real bug, not a blessable diff. Stop and report.

- [ ] **Step 8: Commit**

```powershell
git add scripts/generate-synthetics/ttmp2-builder.ts scripts/generate-synthetics/build-synthetic-selection-type.ts scripts/generate-synthetics/build-all.ts
git commit -m "test(synthetics): add a TTMP2 builder and the SelectionType repro pack"
```

---

### Task 4: `selection-type-absent.ttmp2`, on its own

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-selection-type-absent.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`

**Interfaces:**
- Consumes: `writeTtmp2Pack`, `SyntheticTtmpGroup` from Task 3's `ttmp2-builder.ts`.

Its own task because its blast radius differs. An omitted `SelectionType` is the only group that could plausibly be *rejected* by ConsoleTools. `/resave` absorbs an erroring oracle (`resave-golden.ts:44-58`, reported UNVERIFIED); the `/upgrade` harness models only `pack | noop` and would hard-fail, uncached, every run. Keeping it out of pack 1 means a rejection costs one quarantined pack instead of taking three known-good groups' golden down with it.

Rejection is nonetheless **unlikely**: a missing key deserializes to `null`, and `null == "Single"` (`WizardData.cs:652`) is an ordinary C# string value comparison — `false`, no dereference. Expect `Multi`.

- [ ] **Step 1: Create the builder**

Create `scripts/generate-synthetics/build-synthetic-selection-type-absent.ts`:

```ts
// Builds test/corpus/synthetic/selection-type-absent.ttmp2: one group with the SelectionType key
// OMITTED entirely. Separate from selection-type.ttmp2 deliberately — this is the only input that
// could plausibly be rejected by ConsoleTools, and /upgrade's harness models only pack|noop, so an
// erroring pack would hard-fail it uncached every run (see docs/backlog/2026-07-11-expected-failure-
// golden.md). Isolating it keeps a rejection from taking the good pack's golden down with it.
//
// Predicted: Multi. A missing key deserializes to null, and `null == "Single"` (WizardData.cs:652)
// is an ordinary C# string value comparison — false, no dereference.
//
// The .ttmp2 is gitignored; regenerate with `npm run synthetics`.

import { writeTtmp2Pack } from "./ttmp2-builder";

writeTtmp2Pack("selection-type-absent.ttmp2", "SelectionType Absent Repro", [
  { name: "No SelectionType" },
]);
```

- [ ] **Step 2: Wire it in**

In `scripts/generate-synthetics/build-all.ts`, append:

```ts
import "./build-synthetic-selection-type-absent";
```

- [ ] **Step 3: Build and run**

Run: `npm run synthetics`, then `npm test`.

- [ ] **Step 4: Read the oracle's verdict**

```powershell
$h = (Get-FileHash -LiteralPath test/corpus/synthetic/selection-type-absent.ttmp2 -Algorithm SHA256).Hash.ToLower()
Get-ChildItem "test/corpus/.resave-cache/$h.*" | ForEach-Object { $_.Name }
```

- **A `.bin`** ⇒ ConsoleTools resaved it. Extract its `.mpl` (same snippet as Task 3 Step 5) and confirm the group came back as `Multi`. Then bless and verify, as in Task 3 Step 7 (expected: `resave` contributes 0 new `SelectionType` entries; `/upgrade` contributes 2, since the input omits the key while we write `"Multi"`).
- **An error marker** ⇒ ConsoleTools rejected it. `/resave` reports UNVERIFIED and skips, but `/upgrade` will hard-fail. **Do not** paper over it. Report the error text, delete the pack and its builder import, and record the finding — either as a new backlog note or as the trigger to land the deferred `/upgrade` expected-failure capability. That decision is the operator's; surface it, do not pre-empt it.

- [ ] **Step 5: Commit (only if the oracle accepted the pack)**

```powershell
git add scripts/generate-synthetics/build-synthetic-selection-type-absent.ts scripts/generate-synthetics/build-all.ts
git commit -m "test(synthetics): pin ConsoleTools' handling of an absent SelectionType"
```

---

### Task 5: Retire the phantom from the docs

**Files:**
- Modify: `docs/superpowers/specs/2026-07-12-pmp-writer-regeneration-design.md:307-320`
- Modify: `docs/BACKLOG.md` (delete the prioritized item 1 entry; renumber item 2 → 1)
- Delete: `docs/backlog/2026-07-13-ttmp2-selection-type-spelling.md`

**Interfaces:** none.

- [ ] **Step 1: Check for dangling citations before deleting anything**

```powershell
Select-String -Path src/*,test/*,scripts/*,docs/* -Pattern "ttmp2-selection-type-spelling" -Recurse
```

Expected: hits only in `docs/BACKLOG.md` and the item file itself. Any hit in `src/`, `test/` or `scripts/` must be updated or removed in this same change — the backlog's own rule (`docs/BACKLOG.md:23-26`).

- [ ] **Step 2: Correct the durable spec's false claim**

In `docs/superpowers/specs/2026-07-12-pmp-writer-regeneration-design.md`, the lessons bullet at `:307-320` calls this "the legacy `"Multi Selection"`/`"Single Selection"` `SelectionType` spelling". That is now known false. Rewrite the first sentence of that bullet to:

```markdown
- **The write-side oracle's biggest catch wasn't in this spec's scope at all.** Building the
  `/resave` oracle (§4.3, item B) to prove the writer port surfaced `writeTtmp2` writing a
  `"Multi Selection"`/`"Single Selection"` `SelectionType` spelling that **TexTools has never
  written or read** — it exists only in two doc-comments (`ModGroup.cs:32`, `ModPackJson.cs:144`),
  and the port had coded the comment instead of the code (`WizardData.cs:652`). Our *reader* never
  matched the bare `"Multi"`/`"Single"` TexTools actually writes, so every `Multi`-select group we
  ever emitted was silently downgraded to single-select.
```

Leave the rest of the bullet (the 643 blessed diffs, the per-pointer-granularity lesson) intact — it is still true, and it sharpens: the defect the harness caught was introduced *by a comment*. Update its closing sentence, which says the item is "still-open, deliberately not fixed here", to point at the fix instead:

```markdown
  Fixed on its own branch; see `docs/superpowers/specs/2026-07-13-ttmp2-selection-type-design.md`.
```

- [ ] **Step 3: Retire the backlog item**

Delete `docs/backlog/2026-07-13-ttmp2-selection-type-spelling.md`. In `docs/BACKLOG.md`, remove the numbered entry 1 (lines 39-43) from the **Prioritized** section and renumber the Partials round entry from `2.` to `1.`.

- [ ] **Step 4: Run the full gate**

Run: `npm run check`, `npm run typecheck`, `npm test`. All green.

- [ ] **Step 5: Commit**

```powershell
git add docs/
git rm docs/backlog/2026-07-13-ttmp2-selection-type-spelling.md
git commit -m "docs: retire the SelectionType backlog item; correct the phantom in the pmp-writer spec"
```

---

## Done when

- `readTtmp2` and `writeTtmp2` cite `WizardData.cs` and contain no `"… Selection"` string.
- Both ratchet baselines contain **zero** `SelectionType` entries for real corpus packs (the only survivors are the two `/upgrade` pointers per synthetic pack, whose *input* is deliberately non-TexTools).
- `npm run check`, `npm run typecheck`, `npm test` all green.
- The backlog item and its index entry are gone; the pmp-writer spec no longer claims a legacy spelling exists.
