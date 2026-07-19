# `/upgrade` No-Op Branch Oracle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `/upgrade` no-op branch from comparing zip member names and manifest JSON against the raw Penumbra input (which has no oracle behind it), and replace that with a transform-no-op assertion mirroring TexTools' own `AnyChanges` predicate.

**Architecture:** Three edits confined to the `golden.kind === "noop"` branch of `registerUpgradeCheck`: keep `diffUpgrade` (content, by `gamePath`), add a new per-option file-set comparison fed into the existing ratchet, and stop calling `diffArchives`. Writer parity for the same packs is already covered by `registerResaveCheck` against a real TexTools `/resave` golden. Then delete the now-dead `stripOursPrefix` machinery.

**Tech Stack:** TypeScript, Vitest (custom parallel runner), Biome, PowerShell 7 on Windows.

**Spec:** `docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md` — read it before starting.

## Global Constraints

- **Every line of business logic cites TexTools provenance** as `file · symbol · lines`. This plan's new code is *harness* code, not ported business logic, but the predicate it mirrors must still be cited (`ModpackUpgrader.cs · AnyChanges · 25-49`). See `AGENTS.md`.
- **`reference/` is read-only.** Never edit, lint, or format it.
- **Formatting is mechanical.** Biome owns it — run `npm run check`, never hand-format.
- **End-of-task ritual (required):** `npm run check`, `npm run typecheck`, `npm test` — all green before a task is complete.
- **Do not bless baselines to make the suite green.** Baselines are re-recorded only in Task 4, and only after reading the actual diffs.

## Operational facts you will need

These are not in the spec and will cost you a 3-minute test cycle each to rediscover:

- **`npm test` takes ~165 seconds.** Budget for it.
- **Corpus checks live in a virtual module** (`virtual:corpus-unit:NN`), so `npx vitest run -t "<pack name>"` matches **nothing** and silently reports "689 skipped". You cannot run a single corpus pack. Run the full `npm test` and read the output.
- **Non-corpus unit tests DO work individually:** `npx vitest run test/helpers/upgrade-noop.test.ts`.
- **`--reporter=basic` does not exist** in this Vitest version and fails at startup. Omit it.
- **Bless command (Task 4 only):**
  `$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`
  It rewrites **every** pack's baseline, including `/resave`'s. That is why it comes last.
- **The corpus is gitignored and local-only.** Baseline changes are not committed and each contributor re-derives them.

---

### Task 1: The transform-no-op predicate

Compares a pack before and after our transform, per option, and reports every file-set change. Mirrors `ModpackUpgrader.AnyChanges` (`reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/Mods/ModpackUpgrader.cs:25-49`), which compares only each option's `StandardData.Files` — count, keys, and `FileStorageInformation` equality — and nothing else.

Deliberately **file sets only**, not whole-model identity: TexTools still no-ops when its transform mutates manipulations, so a faithful port must be free to do the same (spec §3.2).

**Files:**
- Create: `test/helpers/upgrade-noop.ts`
- Create: `test/helpers/upgrade-noop.test.ts`

**Interfaces:**
- Consumes: `ModpackData`, `ModpackOption`, `ModpackFile` from `src/model/modpack`; `bytesEqual` from `test/helpers/compare`; `FileDiff` from `test/helpers/upgrade-diff`.
- Produces: `export function transformChanges(before: ModpackData, after: ModpackData): FileDiff[]` — consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/upgrade-noop.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  type ModpackGroup,
  type ModpackOption,
  emptyMeta,
  ModpackFormat,
} from "../../src/model/modpack";
import { transformChanges } from "./upgrade-noop";

function file(...bytes: number[]): ModpackFile {
  return {
    storage: FileStorageType.RawUncompressed,
    data: new Uint8Array(bytes),
  };
}

function option(
  files: Record<string, ModpackFile>,
  manipulations: unknown[] = [],
): ModpackOption {
  return {
    name: "o",
    description: "",
    image: "",
    priority: 0,
    files: new Map(Object.entries(files)),
    fileSwaps: {},
    manipulations,
  };
}

function group(...options: ModpackOption[]): ModpackGroup {
  return {
    name: "g",
    description: "",
    image: "",
    page: 0,
    priority: 0,
    selectionType: "Single",
    defaultSettings: 0,
    options,
  };
}

function pack(...groups: ModpackGroup[]): ModpackData {
  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: emptyMeta(),
    groups,
  };
}

describe("transformChanges", () => {
  it("reports nothing when every option's file set is unchanged", () => {
    const before = pack(group(option({ "chara/a.mdl": file(1, 2) })));
    const after = pack(group(option({ "chara/a.mdl": file(1, 2) })));
    expect(transformChanges(before, after)).toEqual([]);
  });

  it("reports a gamePath the transform ADDED", () => {
    const before = pack(group(option({ "chara/a.mdl": file(1) })));
    const after = pack(
      group(option({ "chara/a.mdl": file(1), "chara/b.tex": file(2) })),
    );
    expect(transformChanges(before, after)).toEqual([
      {
        kind: "transform",
        gamePath: "g0/o0|chara/b.tex",
        index: 0,
        status: "added",
        detail: undefined,
      },
    ]);
  });

  it("reports a gamePath the transform REMOVED", () => {
    const before = pack(
      group(option({ "chara/a.mdl": file(1), "chara/b.tex": file(2) })),
    );
    const after = pack(group(option({ "chara/a.mdl": file(1) })));
    expect(transformChanges(before, after)).toEqual([
      {
        kind: "transform",
        gamePath: "g0/o0|chara/b.tex",
        index: 0,
        status: "removed",
        detail: undefined,
      },
    ]);
  });

  it("reports CHANGED content under the same gamePath", () => {
    const before = pack(group(option({ "chara/a.mdl": file(1, 2) })));
    const after = pack(group(option({ "chara/a.mdl": file(1, 9) })));
    expect(transformChanges(before, after)).toEqual([
      {
        kind: "transform",
        gamePath: "g0/o0|chara/a.mdl",
        index: 0,
        status: "mismatch",
        detail: "2 vs 2 bytes",
      },
    ]);
  });

  // PINS THE DELIBERATE SCOPE (spec §3.2). TexTools' AnyChanges compares ONLY
  // StandardData.Files, so a transform that rewrites manipulations still no-ops and still
  // writes nothing. Tightening this predicate to whole-model identity would diverge from the
  // oracle's own branch condition -- this test must fail if someone tries.
  it("does NOT report a manipulation change when the file set is identical", () => {
    const before = pack(
      group(option({ "chara/a.mdl": file(1) }, [{ Type: "Eqp", SetId: 1 }])),
    );
    const after = pack(
      group(option({ "chara/a.mdl": file(1) }, [{ Type: "Eqp", SetId: 999 }])),
    );
    expect(transformChanges(before, after)).toEqual([]);
  });

  it("keys changes per OPTION, so a file moving between options is caught", () => {
    const before = pack(
      group(option({ "chara/a.mdl": file(1) }), option({})),
    );
    const after = pack(
      group(option({}), option({ "chara/a.mdl": file(1) })),
    );
    expect(transformChanges(before, after)).toEqual([
      {
        kind: "transform",
        gamePath: "g0/o0|chara/a.mdl",
        index: 0,
        status: "removed",
        detail: undefined,
      },
      {
        kind: "transform",
        gamePath: "g0/o1|chara/a.mdl",
        index: 0,
        status: "added",
        detail: undefined,
      },
    ]);
  });

  it("reports a structural change when option counts differ", () => {
    const before = pack(group(option({}), option({})));
    const after = pack(group(option({})));
    expect(transformChanges(before, after)).toEqual([
      {
        kind: "transform",
        gamePath: "g0/o1|<option>",
        index: 0,
        status: "removed",
        detail: undefined,
      },
    ]);
  });

  it("treats an absent payload as equal only to another absent payload", () => {
    const absent: ModpackFile = { storage: FileStorageType.RawUncompressed };
    const before = pack(group(option({ "chara/a.mdl": absent })));
    const sameAbsent = pack(group(option({ "chara/a.mdl": absent })));
    expect(transformChanges(before, sameAbsent)).toEqual([]);

    const nowPresent = pack(group(option({ "chara/a.mdl": file(1) })));
    expect(transformChanges(before, nowPresent)).toEqual([
      {
        kind: "transform",
        gamePath: "g0/o0|chara/a.mdl",
        index: 0,
        status: "mismatch",
        detail: "absent vs 1 bytes",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/helpers/upgrade-noop.test.ts`
Expected: FAIL — `Failed to resolve import "./upgrade-noop"`.

- [ ] **Step 3: Extend `DiffKind` with `"transform"`**

Modify `test/helpers/upgrade-diff.ts:16`. There is direct precedent immediately above it: `"roundtrip"` was added for exactly this shape — a non-oracle, self-consistency assertion that shares the ratchet machinery. Replace the existing `DiffKind` line, keeping the `roundtrip` comment above it intact, and append the new note:

```ts
export type DiffKind =
  | "payload"
  | "manifest"
  | "structure"
  | "roundtrip"
  | "transform";
// "transform" is likewise NOT an oracle comparison. It records that OUR upgrade transform changed
// an option's file set for a pack ConsoleTools /upgrade left alone (it wrote no output at all), so
// there is no TexTools artifact on the other side of it -- see
// docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md §3.2. It mirrors the exact
// predicate the oracle itself branches on (ModpackUpgrader.cs · AnyChanges · 25-49).
```

- [ ] **Step 4: Write the implementation**

Create `test/helpers/upgrade-noop.ts`:

```ts
// Harness-side mirror of ModpackUpgrader.AnyChanges
// (reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/Mods/ModpackUpgrader.cs
// · AnyChanges · 25-49, called at :186-209 and gating the write at :212-219).
//
// This is NOT ported business logic and does not belong in src/: our product deliberately diverges
// from TexTools by ALWAYS resaving rather than declining to write when nothing changed. The harness
// needs the predicate only to interpret the oracle's SILENCE -- a missing golden means "/upgrade's
// transform changed no option's file set", and this asserts our transform agrees.
// See docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md §3.2 and §4.
//
// Scope is file sets ONLY, matching the C#: AnyChanges compares each option's
// StandardData.Files (count, keys, FileStorageInformation equality) and nothing else. TexTools
// still no-ops when its transform mutates manipulations or group structure, so a faithful port must
// be free to do the same. Do NOT tighten this to whole-model identity -- upgrade-noop.test.ts pins
// that deliberately.
//
// C# captures `originals` AFTER WizardData.FromModpack (:58 then :64-80), so load-time fixes are
// baked into the baseline and are invisible to the predicate. Our caller mirrors that by passing
// the POST-LOAD, PRE-TRANSFORM model as `before`. This is therefore the ONLY assertion on the no-op
// branch that bypasses the writer, deliberately: it is about the transform alone.
//
// TWO deliberate departures from the C#, both of which make this predicate WEAKER, never stronger:
//
//  1. Pairing. C# keys `originals` by WizardOptionEntry REFERENCE (:64, :76), which works because
//     its transform mutates options in place; ours clones, so we pair by group index then option
//     index. Neither pipeline adds or removes options, so position aligns them -- the same
//     assumption 2026-07-04-upgrade-golden-harness-design.md §3 already relies on. A count mismatch
//     is reported rather than silently truncated.
//
//  2. Equality. C# compares FileStorageInformation.Equals, and that type is a plain struct with NO
//     custom Equals (TransactionDataHandler.cs:42-71) -- so it is field-wise over StorageType,
//     RealOffset, RealPath, FileSize, and RealPath is a TEMP FILE PATH. In C#, rewriting a file to
//     byte-identical content is therefore still a change. We compare bytes, because ModpackFile
//     carries no such descriptor.
//
//     Safe precisely because it is weaker: a byte change implies a FileStorageInformation change, so
//     anything we flag C# would have flagged too. The converse gap cannot arise HERE -- had C# seen
//     any change it would have written a golden and we would be on the real-golden branch. On the
//     no-op branch the two verdicts cannot disagree.

import type {
  ModpackData,
  ModpackFile,
  ModpackOption,
} from "../../src/model/modpack";
import { bytesEqual } from "./compare";
import type { FileDiff } from "./upgrade-diff";

/** `<group index>/<option index>|<gamePath>` — the identity a transform change is keyed by. The
 *  option coordinates are part of the key because AnyChanges compares PER OPTION: the same gamePath
 *  in two options is two independent entries, and a file moving between options is a removal plus an
 *  addition, not a match. (diffUpgrade's whole-pack multiset flattens exactly that away.) */
function changeKey(group: number, option: number, gamePath: string): string {
  return `g${group}/o${option}|${gamePath}`;
}

function describe(f: ModpackFile): string {
  return f.data === undefined ? "absent" : `${f.data.length} bytes`;
}

/** Byte comparison that treats an ABSENT payload (a PMP `Files` entry naming a zip member the
 *  archive does not contain — see ModpackFile's doc comment) as equal only to another absent
 *  payload, never to empty bytes. */
function sameContent(a: ModpackFile, b: ModpackFile): boolean {
  if (a.data === undefined || b.data === undefined) {
    return a.data === undefined && b.data === undefined;
  }
  return bytesEqual(a.data, b.data);
}

function optionChanges(
  before: ModpackOption,
  after: ModpackOption,
  group: number,
  option: number,
): FileDiff[] {
  const diffs: FileDiff[] = [];
  for (const [gamePath, b] of before.files) {
    const a = after.files.get(gamePath);
    if (a === undefined) {
      diffs.push({
        kind: "transform",
        gamePath: changeKey(group, option, gamePath),
        index: 0,
        status: "removed",
        detail: undefined,
      });
      continue;
    }
    if (!sameContent(b, a)) {
      diffs.push({
        kind: "transform",
        gamePath: changeKey(group, option, gamePath),
        index: 0,
        status: "mismatch",
        detail: `${describe(b)} vs ${describe(a)}`,
      });
    }
  }
  for (const gamePath of after.files.keys()) {
    if (!before.files.has(gamePath)) {
      diffs.push({
        kind: "transform",
        gamePath: changeKey(group, option, gamePath),
        index: 0,
        status: "added",
        detail: undefined,
      });
    }
  }
  return diffs;
}

/** Every file-set change our transform made, per option. EMPTY means our upgrade satisfies the same
 *  condition ConsoleTools branches on when it declines to write a golden.
 *
 *  `before` must be the POST-LOAD, PRE-TRANSFORM model and `after` the transform's result. Safe to
 *  pass the same `source` object the caller handed `upgradeModpack`: it clones and never mutates its
 *  argument (src/upgrade/upgrade.ts). */
export function transformChanges(
  before: ModpackData,
  after: ModpackData,
): FileDiff[] {
  const diffs: FileDiff[] = [];
  const groupCount = Math.max(before.groups.length, after.groups.length);
  for (let g = 0; g < groupCount; g++) {
    const bg = before.groups[g];
    const ag = after.groups[g];
    if (bg === undefined || ag === undefined) {
      diffs.push({
        kind: "transform",
        gamePath: changeKey(g, 0, "<group>"),
        index: 0,
        status: bg === undefined ? "added" : "removed",
        detail: undefined,
      });
      continue;
    }
    const optionCount = Math.max(bg.options.length, ag.options.length);
    for (let o = 0; o < optionCount; o++) {
      const bo = bg.options[o];
      const ao = ag.options[o];
      if (bo === undefined || ao === undefined) {
        diffs.push({
          kind: "transform",
          gamePath: changeKey(g, o, "<option>"),
          index: 0,
          status: bo === undefined ? "added" : "removed",
          detail: undefined,
        });
        continue;
      }
      diffs.push(...optionChanges(bo, ao, g, o));
    }
  }
  return diffs;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/helpers/upgrade-noop.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Run the required gate**

Run: `npm run check; npm run typecheck; npm test`
Expected: all green. `npm test` is unchanged in behaviour at this point — nothing calls `transformChanges` yet.

- [ ] **Step 7: Commit**

```bash
git add test/helpers/upgrade-noop.ts test/helpers/upgrade-noop.test.ts test/helpers/upgrade-diff.ts
git commit -m "test(harness): add a transform-no-op predicate mirroring TexTools' AnyChanges"
```

---

### Task 2: Rewire the no-op branch

**Files:**
- Modify: `test/helpers/corpus-upgrade.ts:94-198` (the block from `const oursModel = ...` through the `diffArchives` call)

**Interfaces:**
- Consumes: `transformChanges` from Task 1.
- Produces: no new exports. `registerUpgradeCheck`'s behaviour changes only on the `golden.kind === "noop"` branch.

**Design decision to be aware of:** the transform changes are fed into the **existing ratchet** (merged into `diff.files`) rather than raised as a hard `expect.fail`. Spec §3.2 says "assert", and a ratcheted entry is still an assertion — but a hard fail would turn a currently-green pack red the moment our transform legitimately changes a file on a no-op pack, with no way to record it. Ratcheting keeps the failure mode consistent with every other check in this harness. Spec §3.4's prediction (a no-op pack's baseline should be *empty*) is unaffected: a correct transform produces zero entries either way.

- [ ] **Step 1: Add the import**

Modify `test/helpers/corpus-upgrade.ts`. After the existing `import { diffUpgrade } from "./upgrade-diff";` line, add:

```ts
import { transformChanges } from "./upgrade-noop";
```

(Biome sorts imports; `npm run check` in Step 5 will place it correctly.)

- [ ] **Step 2: Replace the layout-divergence block**

In `test/helpers/corpus-upgrade.ts`, delete the entire comment block and code from `// Two INDEPENDENT reasons the zip layout cannot match member-for-member,` (currently line 129) down to and including the closing `}` of the `if (layoutEquivalent) { ... }` block (currently line 180). Replace all of it with:

```ts
      // A NO-OP golden means ConsoleTools wrote NO ARCHIVE, so `reference`/`goldenBytes` above are
      // the UNTOUCHED INPUT PACK — a Penumbra export whose layout and manifest spelling TexTools'
      // writer never produced. Comparing our member NAMES or manifest JSON against it asserts "our
      // writer reproduces this author's arbitrary choices", which has no oracle behind it and takes
      // our own writer as ground truth. So on this branch we do NOT call diffArchives at all.
      //
      // What replaces it:
      //  - CONTENT is still compared, by `diffUpgrade` above, keyed by gamePath — the assertion the
      //    harness spec designed for this branch (2026-07-04-upgrade-golden-harness-design.md §4.3).
      //  - The TRANSFORM is asserted directly below, mirroring the very predicate the oracle
      //    branches on when it declines to write (ModpackUpgrader.cs · AnyChanges · 25-49). This is
      //    STRICTER than diffUpgrade in one way that matters: it is keyed per OPTION, so a file
      //    moving between options is caught where diffUpgrade's whole-pack multiset flattens it away.
      //  - WRITER PARITY is covered by registerResaveCheck (corpus-resave.ts) against a real
      //    ConsoleTools /resave golden. /upgrade and /resave are the same call minus the transform
      //    (Program.cs:204-211 vs ModpackUpgrader.cs:58 + :212-219), so when /upgrade no-ops the
      //    /resave golden IS what /upgrade would have written. The two harnesses stay INDEPENDENT:
      //    this branch deliberately does not consult /resave's cache or its error markers.
      //
      // See docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md.
      const noopReference = golden.kind === "noop";
      const transform = noopReference ? transformChanges(source, oursModel) : [];

      // Gated on the INPUT pack carrying FileSwaps, not on `ours` or the golden —
      // PopulatePmpStandardOption (PMP.cs:873-875) has already destroyed the golden's swaps by the
      // time we'd read it here, so gating on the golden would never fire. See the
      // FileSwap-preservation spec, §5.2.
      const layoutEquivalent = packHasFileSwaps(readZip(bytes));
      if (layoutEquivalent) {
        console.log(
          `[upgrade] ${name}: input carries FileSwaps -> payload compared SEMANTICALLY ` +
            `(redirect table, not member names). See the FileSwap-preservation spec, §5.2.`,
        );
      }
```

- [ ] **Step 3: Make the `diffArchives` call conditional**

Still in `test/helpers/corpus-upgrade.ts`, replace the `const archive = diffArchives(...)` call (currently lines 188-198) — keeping the explanatory comment above it — with:

```ts
      const archive = noopReference
        ? []
        : diffArchives(
            oursArchive,
            goldenBytes,
            target === "pmp",
            confirmDivergence,
            layoutEquivalent,
          );
```

Note the removed 6th argument: `stripOursPrefix` is no longer passed by anyone. Task 3 removes the parameter itself.

- [ ] **Step 4: Merge the transform diffs into the ratchet**

Find the `const diff = { ... }` assembly (currently around line 164-167, after the `selfDiffs` block) and add `...transform` to the merged array:

```ts
      const diff = {
        ...payload,
        files: [...payload.files, ...archive, ...selfDiffs, ...transform],
      };
```

- [ ] **Step 5: Run the gate and READ the corpus output**

Run: `npm run check; npm run typecheck; npm test`

Expected: **some `upgrade` corpus checks may FAIL here, and that is the point of this step.** Baselines still contain the `structure`/`manifest` entries this change stops producing — a *shrinking* diff is a subset of its baseline and passes, so most packs stay green. A pack fails only if it now produces an entry it did not before, which can only be a `kind: "transform"` entry.

**Do not bless.** Record every failing pack and its transform entries; you will need them in Task 4. If any pack reports transform entries, stop and report before continuing — it means our upgrade changes a file set for a pack ConsoleTools left alone, which is a genuine finding, not plan fallout.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/corpus-upgrade.ts
git commit -m "test(harness): drop diffArchives from the /upgrade no-op branch"
```

---

### Task 3: Delete the dead `stripOursPrefix` machinery

Added 2026-07-19 to confirm the `default/` prefix a default-only PMP gets against a raw-input reference. Task 2 removed its only call site, so it is now unreachable.

**Files:**
- Modify: `test/helpers/upgrade-archive-diff.ts` (parameter on three functions, the fail-loud guard, and two doc blocks)

**Interfaces:**
- Consumes: nothing new.
- Produces: `diffArchives`, `diffPayloadSemantic`, and `dropConfirmedAbsentKeys` lose their trailing `stripOursPrefix` parameter. No caller passes it after Task 2.

- [ ] **Step 1: Confirm it is dead**

Run: `npx vitest run test/helpers/upgrade-archive-diff.test.ts`
Then: `Select-String -Path test\helpers\*.ts -Pattern "stripOursPrefix"`

Expected: matches **only** inside `test/helpers/upgrade-archive-diff.ts`. If any other file matches, Task 2 is incomplete — go back and finish it before deleting anything.

- [ ] **Step 2: Remove the parameter from `diffPayloadSemantic`**

In `test/helpers/upgrade-archive-diff.ts`, remove `stripOursPrefix?: string,` from the signature. Then remove the `strip` helper and restore `outsideNames` to its original single-argument form:

```ts
  const outsideNames = (m: Map<string, Uint8Array>) =>
    payloadMemberNames(m).filter((n) => !looseKey(n).startsWith("common/"));
```

Delete the `// `stripOursPrefix` (see `diffArchives`' doc comment ...` comment block immediately above it, and update the two call sites back to:

```ts
  const ob = bucket(outsideNames(ours));
  const gb = bucket(outsideNames(golden));
```

- [ ] **Step 3: Remove the parameter from `dropConfirmedAbsentKeys`**

Remove `stripOursPrefix?: string,` from the signature, and delete the whole `if (stripOursPrefix !== undefined && !missingFromOurs) { ... }` block (the one whose comment begins ``// `stripOursPrefix`: the member-NAME counterpart of this exemption``). Leave the `layoutEquivalent` / `isCommon` block above it untouched.

- [ ] **Step 4: Remove the parameter from `diffArchives`**

Remove `stripOursPrefix?: string,` from the signature and delete the fail-loud guard that begins:

```ts
  if (stripOursPrefix !== undefined && !layoutEquivalent) {
```

(the whole `if` block including its `throw new Error(...)`). Leave the `layoutEquivalent && !checkPayloadMembers` guard directly below it untouched. Then update the two internal calls to drop the argument:

```ts
        dropConfirmedAbsentKeys(o, g, gm, layoutEquivalent),
```

```ts
      ...(layoutEquivalent
        ? diffPayloadSemantic(om, gm, confirmDivergence)
        : diffPayloadMembers(om, gm, confirmDivergence)),
```

- [ ] **Step 5: Restore the doc comments**

In `diffArchives`' doc block, delete the `stripOursPrefix` paragraph (beginning `` * `stripOursPrefix` removes one known leading folder ``) through the end of the "Deliberately NOT generalized" paragraph. Then restore the gate list to describe only the FileSwaps gate, since the no-op gate no longer exists:

```
 * `layoutEquivalent` swaps the payload comparison for `diffPayloadSemantic` — compare the redirect
 * table rather than the member-name multiset. Pass `true` ONLY when the INPUT pack carries FileSwaps
 * (`packHasFileSwaps`), never based on what the diff looks like: gating on the symptom would
 * silently absorb genuine writer regressions in every pack. See the spec, §5.2.
```

In `dropConfirmedAbsentKeys`' doc block, restore the final bullet to:

```
 *     the redundant name-shaped report of that same fact, never substitutes for it. Callers must gate
 *     `layoutEquivalent` on `packHasFileSwaps` of the INPUT pack, same as `diffArchives` requires. */
```

- [ ] **Step 6: Run the gate**

Run: `npm run check; npm run typecheck; npm test`

Expected: `test/helpers/upgrade-archive-diff.test.ts` passes unchanged — no test exercised `stripOursPrefix`, so removing it must not move any assertion. Corpus results identical to Task 2 Step 5. **Real-golden packs must be unchanged**, which is the meaningful version of "diffArchives is still consulted on the real-golden branch": if any real-golden pack's result moved, this deletion touched the wrong code path.

- [ ] **Step 7: Commit**

```bash
git add test/helpers/upgrade-archive-diff.ts
git commit -m "test(harness): remove the now-dead stripOursPrefix confirmation"
```

---

### Task 4: Re-bless, verify the prediction, retire the backlog item

**Files:**
- Modify: `docs/BACKLOG.md` (remove one index entry)
- Delete: `docs/backlog/2026-07-19-noop-reference-manifest-spelling.md`
- Modify: `test/corpus/.upgrade-baseline/*.json` (gitignored — not committed)

- [ ] **Step 1: Capture the no-op packs' diffs BEFORE blessing**

Spec §3.4 predicts every no-op pack's `/upgrade` baseline becomes **empty**. Verify that rather than assuming it.

```powershell
cd C:\dev\efokschaner\ffxiv-upgrade-modpack
Get-ChildItem test\corpus\.upgrade-cache\*.noop | ForEach-Object {
  $k = $_.BaseName
  $b = "test\corpus\.upgrade-baseline\$k.json"
  $n = if (Test-Path $b) { ((Get-Content $b -Raw | ConvertFrom-Json) | Measure-Object).Count } else { 0 }
  [pscustomobject]@{ key = $k.Substring(0,12); entriesBefore = $n }
} | Format-Table -AutoSize
```

Record the output.

- [ ] **Step 2: Bless**

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

Expected: all green.

- [ ] **Step 3: Verify the prediction**

Re-run the Step 1 snippet. Expected: every no-op pack now reports `entriesBefore = 0`.

**If any no-op pack is non-empty, STOP and report it.** Read the remaining entries. A `kind: "transform"` entry means our transform changed a file set the oracle left alone — a genuine divergence. A `kind: "payload"` entry means our written-then-re-read content differs from the input. Neither is plan fallout; both need explaining before the plan can be called done.

- [ ] **Step 4: Confirm the `SetId` entries are gone**

```powershell
Get-ChildItem test\corpus\.upgrade-baseline\*.json | ForEach-Object {
  (Get-Content $_.FullName -Raw | ConvertFrom-Json) | Where-Object { $_.gamePath -like "*Manipulation*" }
} | Measure-Object | Select-Object Count
```

Expected: `Count = 0` (was 18). If non-zero, the remaining entries are on **real-golden** packs and are genuine — the backlog item must NOT be deleted in Step 5; update it instead to cover only those.

- [ ] **Step 5: Retire the backlog item**

Per `docs/BACKLOG.md`'s own rules, grep for references before deleting:

```powershell
Select-String -Path docs\*.md,docs\backlog\*.md,docs\superpowers\specs\*.md,src\*.ts,test\*.ts -Pattern "2026-07-19-noop-reference-manifest-spelling" -Recurse
```

The spec (§6, §9) references it and should keep its reference as history — it explains why the item existed and why it is gone. Remove the **index entry** from `docs/BACKLOG.md` (the bullet under "PMP write path" beginning `` - [`SetId` manifest mismatches on no-op packs ``), then delete the item file:

```powershell
Remove-Item docs\backlog\2026-07-19-noop-reference-manifest-spelling.md
```

- [ ] **Step 6: Final gate**

Run: `npm run check; npm run typecheck; npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add docs/BACKLOG.md docs/backlog/2026-07-19-noop-reference-manifest-spelling.md
git commit -m "docs: retire the no-op manifest-spelling backlog item"
```

- [ ] **Step 8: Delete this plan before opening the PR**

Per `AGENTS.md`: a plan is committed when written (so it lives in branch history) then deleted on the branch before the PR, so the reviewed diff carries only the durable spec and the shipped work.

```powershell
Remove-Item docs\superpowers\plans\2026-07-19-upgrade-noop-branch-oracle.md
```

```bash
git add docs/superpowers/plans/2026-07-19-upgrade-noop-branch-oracle.md
git commit -m "docs: remove completed implementation plan"
```
