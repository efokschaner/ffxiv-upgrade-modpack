# Housing/`bgcommon` `.meta` Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `upgradeModpack` throwing on furniture/housing packs by dropping any `.meta` that
yields zero Penumbra manipulations — reproducing, from ported C# rules, the fact that TexTools never
re-materializes a manipulation-less root.

**Architecture:** Restructure `metadataRound.fixOne` (`src/upgrade/upgrade.ts:205-219`) to mirror the
TexTools round-trip: deserialize → *would this meta produce any manipulation?* → drop if not,
otherwise reconstruct as today. The predicate is a direct port of the five segment gates in
`PMPExtensions.MetadataToManipulations`; the drop mirrors `PMP.ManipulationsToMetadata` grouping by
root and materializing nothing for a root with no manipulations. **No path matching, no housing
table, no change to `parseMetaRoot`.**

**Tech Stack:** TypeScript, Vitest, Biome. Port source: xivModdingFramework C# under `reference/`.

## Global Constraints

- Every line of business logic cites its C# provenance as `file · symbol · lines`. Verify each
  citation against `reference/` — do not port from memory.
- Fail loud, never silently diverge. A structure we cannot reproduce faithfully must `throw`.
- Byte-parity with the ConsoleTools `/upgrade` golden is the definition of correct for binary
  payloads. This change alters *which files exist* in a furniture pack's output; it must not move a
  single byte of any chara `.meta`.
- End-of-task ritual, all three green: `npm run check`, `npm run typecheck`, `npm test`.
- `reference/` is read-only. Never edit, lint, or format it.

## Established facts (do not re-derive)

Confirmed 2026-07-21 during planning; the spec's §6 empirical check is **done**:

- `npx tsx scripts/_tmp-inspect-meta.ts` output — all six housing metas across both corpus packs
  carry **zero** segments:
  ```
  === raykie Gym Equipment Posing Props V1_0_2.ttmp2 ===
    bgcommon/hou/indoor/general/0613/i0613.meta: bytes=60 segments=[NONE]
    bgcommon/hou/indoor/general/0467/i0467.meta: bytes=60 segments=[NONE]
    bgcommon/hou/indoor/general/0466/i0466.meta: bytes=60 segments=[NONE]
    bgcommon/hou/indoor/general/0824/i0824.meta: bytes=60 segments=[NONE]
  === SM-Cherry Blossom Upscale.ttmp2 ===
    bgcommon/hou/outdoor/general/0112/o0112.meta: bytes=61 segments=[NONE]
    bgcommon/hou/outdoor/general/0087/o0087.meta: bytes=61 segments=[NONE]
  ```
  So the drop path is the one real packs exercise; the invalid-input crash corner is not reachable
  from the corpus.
- `PmpExtensions.cs:422,429,436,446,456` — the five gates are `GmpEntry != null`,
  `EqpEntry != null`, `EstEntries != null && Count > 0`, `EqdpEntries != null && Count > 0`,
  `ImcEntries != null && Count > 0`. **The three collection segments gate on non-empty, not merely
  non-null.** The spec's §4 prose ("no `imc`/`eqp`/`gmp`/`est`/`eqdp`") understates this — mirror
  the C# exactly.
- `PmpExtensions.cs:216-224` — `XivItemTypeToPenumbraObject` maps only `weapon`, `equipment`,
  `accessory`, `demihuman`, `monster`, `body`. No `indoor`/`outdoor`. `PmpManipulation.cs:395`
  indexes it directly (`KeyNotFoundException` for housing).
- `PMP.cs:1258-1295` — `ManipulationsToMetadata` iterates `byRoot` (manipulations grouped by root).
  A root with no manipulations never appears in that grouping, so `GetMetadata`/`Serialize` never
  run for it and no `.meta` is emitted. This *is* the drop.
- `ItemMetadata.cs:869-921` (`Deserialize`) resolves the root via `XivCache.GetFirstRoot` and never
  throws on it.
- **Spec §4 step 3 needs no new code.** An IMC segment makes the predicate true, so control falls
  through to `reconstructMeta` → `parseMetaRoot(gamePath)` → the existing
  `meta: unrecognized root path …` throw (`src/meta/root.ts:151`). That is the required fail-loud
  behaviour for the housing-IMC invalid-input corner. Do not add a second check.

## File Structure

- **Modify** `src/upgrade/upgrade.ts` — add the `yieldsManipulations` predicate; change `fixOne` to
  return `ModpackFile | null` and have the loop skip nulls. ~25 lines, all in `metadataRound`'s
  region (`:198-220`).
- **Create** `test/upgrade/meta-drop.test.ts` — focused synthetic unit tests for the new rule.
  Kept separate from the large `test/upgrade/upgrade.test.ts` (material/texture rounds) because it
  covers one rule with its own fixture helper.
- **Delete** `scripts/_tmp-inspect-meta.ts` — scratch scaffolding, its job is done (see
  *Established facts*).
- **Modify** `docs/backlog/2026-07-21-bgcommon-housing-meta-root-unsupported.md` — close it out.

---

### Task 1: Drop manipulation-less `.meta` files in `metadataRound`

**Files:**
- Modify: `src/upgrade/upgrade.ts:198-220`
- Test: `test/upgrade/meta-drop.test.ts` (create)

**Interfaces:**
- Consumes: `deserializeMeta(data: Uint8Array): ItemMeta` (`src/meta/deserialize.ts`),
  `serializeMeta(m: ItemMeta): Uint8Array` (`src/meta/serialize.ts`),
  `reconstructMeta(mod: ItemMeta, gamePath: string): ItemMeta` (`src/meta/reconstruct.ts`),
  `requireBytes`, `restore` (both exported from `src/upgrade/upgrade.ts`),
  `ItemMeta` (`src/meta/types.ts`), `filesMap` (`test/helpers/make-packs.ts`).
- Produces: module-private `yieldsManipulations(m: ItemMeta): boolean`; `fixOne` narrows to
  `(path: string, f: ModpackFile) => ModpackFile | null`. Nothing outside `metadataRound` changes —
  `upgradeModpack`'s signature is untouched.

- [ ] **Step 1: Write the failing tests**

Create `test/upgrade/meta-drop.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { upgradeModpack } from "../../src/index";
import { serializeMeta } from "../../src/meta/serialize";
import type { ItemMeta } from "../../src/meta/types";
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../../src/model/modpack";
import { encodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { filesMap } from "../helpers/make-packs";

// A .meta with no segments at all -- byte-identical in shape to the real housing metas in the
// corpus (`bgcommon/hou/indoor/general/0613/i0613.meta` is 60 bytes: 4 version + 43 path + 1 NUL
// + 12 count/size/start, zero header entries, zero segment data).
function metaBytes(path: string, over: Partial<ItemMeta> = {}): Uint8Array {
  const m: ItemMeta = {
    version: 2,
    path,
    imc: null,
    eqp: null,
    eqdp: null,
    est: null,
    gmp: null,
    ...over,
  };
  return encodeSqPackFile(serializeMeta(m), SqPackType.Standard);
}

function packWithFiles(entries: [string, Uint8Array][]): ModpackData {
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
            selected: false,
            fileSwaps: {},
            manipulations: [],
            files: filesMap(
              entries.map(([p, data]) => [
                p,
                { data, storage: FileStorageType.SqPackCompressed },
              ]),
            ),
          },
        ],
      },
    ],
  };
}

const outFiles = (d: ModpackData) => d.groups[0]!.options[0]!.files;

describe("metadataRound: manipulation-less .meta files are dropped", () => {
  it("drops a housing .meta with no segments instead of throwing", () => {
    const path = "bgcommon/hou/indoor/general/0613/i0613.meta";
    const out = upgradeModpack(
      packWithFiles([
        [path, metaBytes(path)],
        ["bgcommon/hou/indoor/general/0613/asset/fun_b0_m0613.mdl", new Uint8Array([1, 2, 3])],
      ]),
    );
    expect([...outFiles(out).keys()]).toEqual([
      "bgcommon/hou/indoor/general/0613/asset/fun_b0_m0613.mdl",
    ]);
  });

  it("drops a segment-less CHARA .meta too -- the rule is segment-based, not path-based", () => {
    // PMPExtensions.MetadataToManipulations emits nothing for this meta either, so
    // ManipulationsToMetadata never materializes the root. Same drop, no path check involved.
    // Note the `_met` suffix: parseMetaRoot's equipment regex (root.ts:50) requires a slot, so a
    // slot-less `e0208.meta` would throw for an unrelated reason and prove nothing.
    const path = "chara/equipment/e0208/e0208_met.meta";
    const out = upgradeModpack(packWithFiles([[path, metaBytes(path)]]));
    expect(outFiles(out).size).toBe(0);
  });

  it("keeps failing loud on an unknown root that DOES carry a segment", () => {
    // An IMC segment yields a manipulation (PmpExtensions.cs:456), so control reaches
    // reconstructMeta -> parseMetaRoot, which throws. Mirrors FromImcEntry's direct index into
    // XivItemTypeToPenumbraObject (PmpManipulation.cs:395), which has no indoor/outdoor key
    // (PmpExtensions.cs:216-224) and so would raise KeyNotFoundException in C#.
    const path = "bgcommon/hou/indoor/general/0613/i0613.meta";
    expect(() =>
      upgradeModpack(
        packWithFiles([[path, metaBytes(path, { imc: [new Uint8Array(6)] })]]),
      ),
    ).toThrow(/unrecognized root path/);
  });

  it("does not drop a meta whose only segment is EQP", () => {
    // Sanity: the predicate's null-check arm (PmpExtensions.cs:429) keeps a real chara meta alive.
    // EQP-only means reconstructMeta touches no IMC_TABLE / EST_TABLE lookup, and primaryId 208
    // is not 0, so the ItemMetadata.cs:522-528 set-0 EQP-drop quirk does not fire either.
    const path = "chara/equipment/e0208/e0208_met.meta";
    const out = upgradeModpack(
      packWithFiles([[path, metaBytes(path, { eqp: new Uint8Array(8) })]]),
    );
    expect([...outFiles(out).keys()]).toEqual([path]);
  });

  it("drops a meta whose segments are all present-but-empty", () => {
    // PmpExtensions.cs:436,446,456 gate EST/EQDP/IMC on `Count > 0`, not merely non-null.
    const path = "chara/equipment/e0208/e0208_met.meta";
    const out = upgradeModpack(
      packWithFiles([
        [path, metaBytes(path, { imc: [], eqdp: new Map(), est: new Map() })],
      ]),
    );
    expect(outFiles(out).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/upgrade/meta-drop.test.ts`

Expected: FAIL.

- Test 1 ("drops a housing .meta") fails with `meta: unrecognized root path
  bgcommon/hou/indoor/general/0613/i0613.meta` — today every `.meta` reaches `parseMetaRoot`.
- Test 2 ("segment-less CHARA") fails on the assertion (`size` is 1, not 0): the chara root parses
  fine, so today the meta is reconstructed and kept rather than dropped.
- Test 5 ("present-but-empty") fails too, but the mechanism depends on the tables: `imc: []` is
  *truthy*, so today's `reconstructMeta` enters its `if (imc)` branch (`reconstruct.ts:149`) and
  either fails the `size` assertion or throws `has no IMC_TABLE entry` first. Either counts as red;
  after Step 4 it drops before `reconstructMeta` is ever called.
- Tests 3 and 4 should already PASS — they are regression guards for behaviour this change must not
  break, not drivers.

- [ ] **Step 3: Add the `yieldsManipulations` predicate**

In `src/upgrade/upgrade.ts`, add the `ItemMeta` type import alongside the existing meta imports at
the top of the file:

```ts
import type { ItemMeta } from "../meta/types";
```

Then insert this immediately after `const IS_META = /\.meta$/;` (currently `:198`):

```ts
/**
 * Would this `.meta` produce at least one Penumbra manipulation? Port of the five segment gates in
 * PMPExtensions.MetadataToManipulations (PmpExtensions.cs:417-467), which emits one manipulation
 * per PRESENT segment: Gmp (:422), Eqp (:429), Est (:436), Eqdp (:446), Imc (:456).
 *
 * The three collection segments gate on `Count > 0`, not merely non-null, so a present-but-empty
 * EST/EQDP/IMC segment yields nothing — mirrored with `.size`/`.length` rather than a bare
 * null-check. The two opaque-byte segments gate on null alone.
 */
function yieldsManipulations(m: ItemMeta): boolean {
  return (
    m.gmp !== null || // PmpExtensions.cs:422
    m.eqp !== null || // :429
    (m.est !== null && m.est.size > 0) || // :436
    (m.eqdp !== null && m.eqdp.size > 0) || // :446
    (m.imc !== null && m.imc.length > 0) // :456
  );
}
```

- [ ] **Step 4: Restructure `fixOne` to drop**

Replace the body of `metadataRound` (currently `src/upgrade/upgrade.ts:205-220`) with:

```ts
function metadataRound(option: ModpackOption): void {
  function fixOne(path: string, f: ModpackFile): ModpackFile | null {
    if (!IS_META.test(path)) return f;
    // No absent-file analogue: PMP .meta files are materialized from manipulations
    // (PMP.cs:1141-1164), never read from a zip member, so a .meta with no bytes is unreachable.
    // Write-side confirmation: TexTools' PMP writer turns any `.meta` into `Manipulations` rather
    // than a zip member (PMP.cs:891-895), so a PMP `Files` entry naming a `.meta` is not something
    // TexTools or Penumbra produce. Fail loud.
    const { bytes, type } = requireBytes(f, path);
    const meta = deserializeMeta(bytes); // ItemMetadata.Deserialize, ItemMetadata.cs:869-921
    if (!yieldsManipulations(meta)) {
      // DROP. The round-trip is read -> manipulations -> write: PMP.ManipulationsToMetadata
      // (PMP.cs:1258-1295) groups manipulations by root and only materializes+Serializes a root
      // that appears in that grouping, so a meta yielding zero manipulations is simply never
      // written back (WizardData.cs:463-482 adds a file per `manips.Metadatas` entry — and there
      // is none). Reproduced here by removing the file from the option.
      //
      // This is what makes housing/furniture packs work: `bgcommon/hou/**/{i,o}####.meta` carries
      // no segment at all, because housing uses no IMC (Imc.UsesImc returns false for
      // indoor/outdoor, Variants/FileTypes/Imc.cs:74-85; GetRawImcFilePath returns "" for it,
      // XivDependencyRoot.cs:1093-1095) and the other four segments are chara-only concepts.
      // Verified over the corpus: every housing meta in `raykie Gym Equipment Posing Props` and
      // `SM-Cherry Blossom Upscale` deserializes to zero segments, and `raykie`'s /upgrade golden
      // contains zero `.meta` references.
      //
      // Deliberately NOT a path check: the rule is the ported segment gate, so a segment-less
      // chara meta drops too — exactly as TexTools drops it. We therefore also do not need
      // housing in `parseMetaRoot` (root.ts:151), which stays the fail-loud guard for an unknown
      // root that DOES carry a segment.
      //
      // Narrow known deviation: C# reaches `m.Root.Info` unconditionally
      // (PmpExtensions.cs:420), so a segment-less meta whose path NO XivDependencyGraph regex
      // matches would NullReferenceException there, where we drop it quietly. Housing and chara
      // roots both resolve (XivDependencyGraph.cs:257,263,693-702), so this is unreachable for
      // any root TexTools recognizes.
      return null;
    }
    const out = serializeMeta(reconstructMeta(meta, path));
    return restore(f, out, type ?? SqPackType.Standard);
  }
  const next = new Map<string, ModpackFile>();
  for (const [path, f] of option.files) {
    const fixed = fixOne(path, f);
    if (fixed !== null) next.set(path, fixed); // dropped -> not carried into the new map
  }
  option.files = next;
}
```

Also update `metadataRound`'s existing doc comment (currently `:200-204`) to mention the drop —
append one sentence before the closing `*/`:

```
 * A meta that yields no manipulations is DROPPED rather than reconstructed (see `fixOne`); this is
 * what makes housing/furniture packs upgrade at all.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/upgrade/meta-drop.test.ts`

Expected: PASS, 5 passed.

- [ ] **Step 6: Run the gate**

Run: `npm run check; npm run typecheck`

Expected: Biome reports no errors (it may apply safe fixes — that is fine, re-stage them);
`tsc --noEmit` exits 0 with no output.

- [ ] **Step 7: Commit**

```bash
git add src/upgrade/upgrade.ts test/upgrade/meta-drop.test.ts
git commit -m "feat(meta): drop manipulation-less .meta files instead of reconstructing them

Ports the segment gates in PMPExtensions.MetadataToManipulations
(PmpExtensions.cs:417-467) and the by-root materialization in
PMP.ManipulationsToMetadata (PMP.cs:1258-1295): a .meta that yields zero
manipulations is never written back, so we remove it from the option.

Unblocks housing/furniture packs, whose bgcommon metas carry no segment at
all (housing uses no IMC, Imc.cs:74-85). No path check: a segment-less chara
meta drops identically, and parseMetaRoot stays the fail-loud guard for an
unknown root that does carry a segment."
```

---

### Task 2: Verify against the corpus goldens and close out the docs

**Files:**
- Delete: `scripts/_tmp-inspect-meta.ts`
- Modify: `docs/backlog/2026-07-21-bgcommon-housing-meta-root-unsupported.md`
- Modify: `docs/superpowers/specs/2026-07-21-housing-meta-drop-design.md`

**Interfaces:**
- Consumes: the shipped `metadataRound` from Task 1. Produces: no code surface.

- [ ] **Step 1: Run the full suite and read the corpus result**

Run: `npm test`

Expected: green. Specifically, per the spec's §5, **without re-blessing**:
- `raykie Gym Equipment Posing Props V1_0_2.ttmp2` — its four housing metas now absent, matching
  the golden's zero `.meta` references.
- `SM-Cherry Blossom Upscale.ttmp2` — stays a faithful `/upgrade` no-op.

Do **not** set `UPDATE_UPGRADE_BASELINE` to make a failure go away. If either pack still diffs, go to
Step 2.

- [ ] **Step 2: If a corpus pack still fails, triage before touching anything**

Two outcomes are expected-possible and must be told apart:

1. **`.meta` still present, or its bytes differ** → the drop is wrong. Stop and re-read
   `yieldsManipulations` against `PmpExtensions.cs:417-467`. This is a real bug in Task 1.
2. **`raykie` now fails on a `bgparts` `.mdl`** → this is the *separate*, already-filed furniture
   model gap, `docs/backlog/2026-07-21-furniture-bgparts-mdl-overrun.md`. It is out of scope here.
   Record it as a baseline entry for that pack only (bless), and note in the commit message that the
   remaining `raykie` diff is that backlog item, not this one. Bless with:

   ```powershell
   $env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
   ```

   Then re-run plain `npm test` and confirm green.

Any other diff shape: stop and report it rather than blessing.

- [ ] **Step 3: Delete the scratch decoder**

Run:

```powershell
Remove-Item scripts/_tmp-inspect-meta.ts
Get-ChildItem scripts -Filter "_tmp-*" | Select-Object -ExpandProperty Name
```

Expected: the second command prints nothing (no `_tmp-*.txt` leftovers remain).

- [ ] **Step 4: Close the backlog item**

In `docs/backlog/2026-07-21-bgcommon-housing-meta-root-unsupported.md`, replace the `## The fix —
DROP, not reconstruct (design done)` heading line with:

```markdown
## RESOLVED 2026-07-21 — fixed by the manipulation-less drop
```

and insert this paragraph directly beneath that heading, above the existing body text:

```markdown
**Shipped.** `metadataRound.fixOne` (`src/upgrade/upgrade.ts`) now drops any `.meta` that yields zero
Penumbra manipulations, ported from `PMPExtensions.MetadataToManipulations`
(`PmpExtensions.cs:417-467`) plus `PMP.ManipulationsToMetadata`'s by-root materialization
(`PMP.cs:1258-1295`). No housing support was added to `parseMetaRoot` and no housing base-data table
was needed. Regression cover: `test/upgrade/meta-drop.test.ts` plus the `raykie` /
`SM-Cherry Blossom Upscale` corpus goldens. The companion furniture `.mdl` gap
(`2026-07-21-furniture-bgparts-mdl-overrun.md`) remains open.
```

- [ ] **Step 5: Mark the spec as implemented**

In `docs/superpowers/specs/2026-07-21-housing-meta-drop-design.md`, replace the `**Status:**` line
(line 4-5) with:

```markdown
**Status:** Implemented 2026-07-21. §6's empirical check was run and confirmed the premise — all six
housing metas across both corpus packs deserialize to **zero** segments, so only the drop path is
reachable from the corpus. Two corrections found during implementation, applied in the shipped code:
§4's segment list must gate EST/EQDP/IMC on **non-empty**, not merely non-null
(`PmpExtensions.cs:436,446,456` use `Count > 0`); and §4 step 3 required **no new code** — an IMC
segment makes the predicate true, so control falls through to `parseMetaRoot`'s existing throw.
```

- [ ] **Step 6: Re-run the gate**

Run: `npm run check; npm run typecheck; npm test`

Expected: all three green.

- [ ] **Step 7: Commit**

```bash
git add docs/backlog/2026-07-21-bgcommon-housing-meta-root-unsupported.md docs/superpowers/specs/2026-07-21-housing-meta-drop-design.md
git rm scripts/_tmp-inspect-meta.ts 2>/dev/null || git add -A scripts
git commit -m "docs: close the bgcommon housing meta backlog item; drop scratch decoder"
```

(`scripts/_tmp-inspect-meta.ts` is untracked, so `git rm` will fail harmlessly — the file is already
deleted from disk in Step 3 and nothing needs staging for it.)

---

## Before opening a PR

Per `AGENTS.md`: **delete this plan on the branch before opening the pull request.** It is committed
so it lives in the branch's history, but a completed plan must not land on `main`.
