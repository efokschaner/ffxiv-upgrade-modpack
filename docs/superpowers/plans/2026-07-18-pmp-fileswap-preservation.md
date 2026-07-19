# PMP FileSwap Preservation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the FileSwap-preservation work — build the synthetic pack that makes TexTools'
placeholder `idx`-burn observable, add the cause-gated semantic-comparison mode that lets our
(deliberately different) `common/N` numbering pass, and confirm the manifest `FileSwaps` divergence
explicitly instead of via a gitignored ratchet baseline.

**Architecture:** Three seams, all in the test harness — the shipped `src/` change already landed.
(1) A two-group synthetic PMP whose swaps and duplicate pair sit in *different* options, so the
burned `idx` precedes the duplicate and shifts its `common/N`. (2) A `layoutEquivalent` mode in
`diffArchives` that compares payload **through the redirect table** (`gamePath` → bytes) instead of
by zip member name, gated on the *input* pack carrying ≥1 FileSwap. (3) A manifest carve-out
confirming `ours.FileSwaps` non-empty against `golden.FileSwaps` empty.

**Tech Stack:** TypeScript, Vitest (custom parallel runner), Biome, `fflate` for zip.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md`. Section
  references below (§5.1, §5.2, §6.1, §7) are to that file.
- **Every line of business logic cites TexTools provenance** as `file · symbol · lines`, verified
  against `reference/` — not from memory. Test-harness code cites the C# behaviour it confirms.
- **A divergence recorded only in a gitignored ratchet baseline is NOT documented** (AGENTS.md).
  Confirmation rules must *confirm the specific expected difference and reject everything else*.
- **Never widen a tolerance to make a test pass.** If a comparison needs to change shape, it must
  still fail on anything other than the exact predicted divergence.
- **`reference/` is read-only.** Never edit, lint, or format it.
- **Formatting is mechanical** — run `npm run check`; never hand-format.
- **End-of-task ritual:** `npm run check`, `npm run typecheck`, `npm test` — all green.
- **Bless command:** `$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`
- Branch: `feat/pmp-fileswap-preservation` (already created, already carries Task 1's draft files).

## File Structure

| File | Responsibility |
|---|---|
| `scripts/generate-synthetics/pmp-builder.ts` | **Modify.** `singleOptionGroup` gains an optional `fileSwaps` param (already drafted). |
| `scripts/generate-synthetics/build-synthetic-file-swaps.ts` | **Create.** The two-group synthetic (already drafted). |
| `scripts/generate-synthetics/build-all.ts` | **Modify.** Register the new builder (already drafted). |
| `test/helpers/archive-redirects.ts` | **Create.** `packHasFileSwaps` + `resolveRedirects` — reading a PMP archive as Penumbra's redirect table. One responsibility: archive → `(gamePath → bytes)`. |
| `test/helpers/archive-redirects.test.ts` | **Create.** Unit tests for the above. |
| `test/helpers/upgrade-archive-diff.ts` | **Modify.** `layoutEquivalent` mode + the §5.1 `FileSwaps` carve-out. |
| `test/helpers/upgrade-archive-diff.test.ts` | **Modify.** Tests for both. |
| `test/helpers/corpus-upgrade.ts`, `test/helpers/corpus-resave.ts` | **Modify.** Compute the gate from the input pack, pass it through. |

---

### Task 1: The two-group synthetic pack

**Files:**
- Modify: `scripts/generate-synthetics/pmp-builder.ts` (`singleOptionGroup`)
- Create: `scripts/generate-synthetics/build-synthetic-file-swaps.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`

**Interfaces:**
- Consumes: `writePmp`, `syntheticMeta`, `EMPTY_DEFAULT_MOD`, `DUMMY_PAYLOAD`, `singleOptionGroup` from `./pmp-builder`.
- Produces: `test/corpus/synthetic/file-swaps.pmp`. Later tasks rely on it existing and on it being the pack whose `/resave` golden shows the `common/N` shift.

**Context the implementer needs.** Working files are already drafted on this branch (uncommitted).
Read them first; this task is mostly verification, not authoring. The critical property — and the
reason for two groups — is in §6.1: `UnpackPmpOption` (`PMP.cs:1104-1137`) appends an option's
placeholders *after* that option's own `Files`, and `ResolveDuplicates` walks option-by-option
(`PmpExtensions.cs:594-611`), so a one-option pack burns its `idx` after every duplicate is already
numbered and proves nothing.

`pmp-builder.ts`'s JSON key order and zip member order are **load-bearing** (AGENTS.md) — the
`fileSwaps` parameter must fill the existing `FileSwaps` slot and default to `{}` so every other
pack's bytes are unchanged.

- [ ] **Step 1: Confirm the existing synthetics are byte-unchanged by the builder edit**

The `fileSwaps` param defaults to `{}`, so every pre-existing pack must rebuild identically. Record
hashes, rebuild, compare:

```powershell
$before = Get-ChildItem test/corpus/synthetic/*.pmp | ForEach-Object { "$($_.Name) $((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" }
npm run synthetics
$after = Get-ChildItem test/corpus/synthetic/*.pmp | Where-Object { $_.Name -ne "file-swaps.pmp" } | ForEach-Object { "$($_.Name) $((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" }
Compare-Object $before $after
```

Expected: `Compare-Object` prints nothing except the new `file-swaps.pmp` appearing in `$before`'s
absence. Any other difference means the key order changed — stop and fix before continuing.

- [ ] **Step 2: Verify the pack is byte-reproducible**

Cached goldens are keyed by `sha256(input pack)`, so a non-reproducible pack silently re-spawns
ConsoleTools every run.

```powershell
$h1 = (Get-FileHash test/corpus/synthetic/file-swaps.pmp -Algorithm SHA256).Hash
npm run synthetics
$h2 = (Get-FileHash test/corpus/synthetic/file-swaps.pmp -Algorithm SHA256).Hash
if ($h1 -eq $h2) { "REPRODUCIBLE" } else { "NOT REPRODUCIBLE - investigate FIXED_MTIME" }
```

Expected: `REPRODUCIBLE`.

- [ ] **Step 3: Verify the swap sources actually resolve in the game index**

If they do not, TexTools skips them (`offset <= 0`, `PMP.cs:1118-1122`), no placeholder is created,
and the pack proves nothing. Write `scratch-check.ts` in the scratchpad directory (NOT the repo):

```typescript
import { GameIndex } from "C:/dev/efokschaner/ffxiv-upgrade-modpack/scripts/lib/game-index.ts";
const gi = GameIndex.load(
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online\\game\\sqpack\\ffxiv",
);
for (const s of [
  "chara/equipment/e6120/texture/v01_c0101e6120_top_n.tex",
  "chara/equipment/e6120/texture/v01_c0101e6120_top_m.tex",
]) console.log(`${gi.fileExists(s) ? "EXISTS " : "MISSING"}  ${s}`);
```

Run: `npx tsx <scratchpad>/scratch-check.ts`
Expected: both `EXISTS`. If either is `MISSING`, pick different real base-game paths and update the
builder.

- [ ] **Step 4: Run the suite and CAPTURE the resave diff for this pack**

The pack is new, so it has no baseline and is expected to fully match — it will not. **That failure
is the measurement this whole plan is built on.** Do not bless it yet.

Run: `npm test 2>&1 | Select-String -Pattern "file-swaps" -Context 0,20`

Expected: the `resave golden: file-swaps.pmp` check fails. **Record the exact diff list in the commit
message.** The predicted shape (§6.1) is: golden has `common/2/...`, ours has `common/1/...`,
reported as one `structure`/`added` and one `structure`/`removed`, plus `FileSwaps` pointer diffs on
`group_001_swaps.json`.

**If the diff does not show a `common/N` shift, STOP and report.** It means the ordering analysis in
§6.1 is wrong, and Tasks 3-4 would be built on a false premise. That is a genuine finding, not a
blocker to work around.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-synthetics/
git commit -m "test(synthetics): add the two-group file-swaps repro pack

Swaps in one option, the duplicate pair in another: UnpackPmpOption appends an
option's placeholders after that option's own Files (PMP.cs:1104-1137), so a
one-option pack burns its idx after every duplicate is numbered and shifts
nothing. That is why torn bassment glow.pmp shows no effect despite 6 valid swaps.

Observed /resave diff: <PASTE THE ACTUAL DIFF FROM STEP 4>"
```

---

### Task 2: Read a PMP archive as Penumbra's redirect table

**Files:**
- Create: `test/helpers/archive-redirects.ts`
- Create: `test/helpers/archive-redirects.test.ts`

**Interfaces:**
- Consumes: `readZip` from `../../src/zip/zip`; `looseKey`, `isManifest` — **these two are currently
  module-private in `upgrade-archive-diff.ts` and must be exported from it as part of this task.**
- Produces:
  - `export function packHasFileSwaps(members: Map<string, Uint8Array>): boolean`
  - `export function resolveRedirects(members: Map<string, Uint8Array>): Map<string, Uint8Array>`
  - `export function payloadMemberNames(members: Map<string, Uint8Array>): string[]`

**Why this is its own module.** `upgrade-archive-diff.ts` is already large and does one thing
(diffing). "Interpret an archive as a redirect table" is a separate responsibility with its own
tests, and Task 4 consumes it from two call sites.

**The authority.** Penumbra `SubMod.AddContainerTo` (`SubMod.cs:23-32`) reduces an option to
`redirections` + `manipulations`:

```csharp
foreach (var (path, file) in container.Files)     redirections.TryAdd(path, file);
foreach (var (path, file) in container.FileSwaps) redirections.TryAdd(path, file);
```

We resolve only `Files` here — a `FileSwap`'s value is a *game* path with no member bytes to
resolve, and its preservation is confirmed separately by Task 5.

- [ ] **Step 1: Export the two helpers this module needs**

In `test/helpers/upgrade-archive-diff.ts`, change `function looseKey(` to `export function looseKey(`
and `function isManifest(` to `export function isManifest(`. Leave their bodies and doc comments
untouched.

- [ ] **Step 2: Write the failing tests**

Create `test/helpers/archive-redirects.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  packHasFileSwaps,
  payloadMemberNames,
  resolveRedirects,
} from "./archive-redirects";

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const bytes = (...v: number[]) => new Uint8Array(v);

/** A minimal PMP member map: default_mod.json + one group + payload members. */
function pack(
  group: unknown,
  payload: Record<string, Uint8Array>,
): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  m.set("meta.json", enc({ FileVersion: 3, Name: "t" }));
  m.set("default_mod.json", enc({ Name: "", Files: {}, FileSwaps: {} }));
  m.set("group_001_g.json", enc(group));
  for (const [k, v] of Object.entries(payload)) m.set(k, v);
  return m;
}

describe("packHasFileSwaps", () => {
  it("is false when every option's FileSwaps is empty", () => {
    const m = pack(
      { Options: [{ Name: "On", Files: {}, FileSwaps: {} }] },
      {},
    );
    expect(packHasFileSwaps(m)).toBe(false);
  });

  it("is true when any option carries a swap", () => {
    const m = pack(
      {
        Options: [
          { Name: "A", Files: {}, FileSwaps: {} },
          { Name: "B", Files: {}, FileSwaps: { "chara/d.tex": "chara/s.tex" } },
        ],
      },
      {},
    );
    expect(packHasFileSwaps(m)).toBe(true);
  });

  it("sees a swap on default_mod.json (the document IS the option)", () => {
    const m = new Map<string, Uint8Array>();
    m.set(
      "default_mod.json",
      enc({ Name: "", Files: {}, FileSwaps: { "chara/d.tex": "chara/s.tex" } }),
    );
    expect(packHasFileSwaps(m)).toBe(true);
  });
});

describe("resolveRedirects", () => {
  it("maps each gamePath to its member bytes, independent of member NAME", () => {
    const m = pack(
      {
        Options: [
          {
            Name: "On",
            Files: { "chara/a.tex": "common\\1\\a.tex" },
            FileSwaps: {},
          },
        ],
      },
      { "common/1/a.tex": bytes(1, 2, 3) },
    );
    expect([...resolveRedirects(m)]).toEqual([["chara/a.tex", bytes(1, 2, 3)]]);
  });

  it("resolves a member name that differs only by case or a trailing dot (looseKey)", () => {
    const m = pack(
      {
        Options: [
          { Name: "On", Files: { "chara/a.tex": "G\\On\\A.TEX" }, FileSwaps: {} },
        ],
      },
      { "g/on/a.tex": bytes(4) },
    );
    expect(resolveRedirects(m).get("chara/a.tex")).toEqual(bytes(4));
  });

  it("omits a gamePath whose member is absent, rather than inventing bytes", () => {
    const m = pack(
      {
        Options: [
          { Name: "On", Files: { "chara/a.tex": "g\\on\\gone.tex" }, FileSwaps: {} },
        ],
      },
      {},
    );
    expect(resolveRedirects(m).has("chara/a.tex")).toBe(false);
  });

  it("does NOT resolve FileSwaps — a swap value is a game path, not a member", () => {
    const m = pack(
      {
        Options: [
          {
            Name: "On",
            Files: {},
            FileSwaps: { "chara/d.tex": "chara\\src.tex" },
          },
        ],
      },
      {},
    );
    expect(resolveRedirects(m).size).toBe(0);
  });
});

describe("payloadMemberNames", () => {
  it("excludes manifests and returns the rest", () => {
    const m = pack(
      { Options: [{ Name: "On", Files: {}, FileSwaps: {} }] },
      { "g/on/a.tex": bytes(1), "common/1/b.tex": bytes(2) },
    );
    expect(payloadMemberNames(m).sort()).toEqual(["common/1/b.tex", "g/on/a.tex"]);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run test/helpers/archive-redirects.test.ts`
Expected: FAIL — `Failed to resolve import "./archive-redirects"`.

- [ ] **Step 4: Implement**

Create `test/helpers/archive-redirects.ts`:

```typescript
// Reads a PMP archive the way Penumbra does: as a redirect table, not as a file layout.
//
// Penumbra's SubMod.AddContainerTo (Penumbra SubMod.cs:23-32) reduces an option to
// `redirections` + `manipulations`:
//
//     foreach (var (path, file) in container.Files)     redirections.TryAdd(path, file);
//     foreach (var (path, file) in container.FileSwaps) redirections.TryAdd(path, file);
//
// so the zip member NAME a payload happens to live under is plumbing, invisible to the game. That is
// what licenses the layout-equivalent comparison in upgrade-archive-diff.ts (see the spec, §5.2).
//
// FileSwaps are deliberately NOT resolved here: a swap's value is a base-game path with no member
// bytes behind it. Their preservation is confirmed separately, by the manifest carve-out.
import { isManifest, looseKey } from "./upgrade-archive-diff";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Every option document in the archive: each `group_NNN*.json`'s `Options` entries, plus
 *  `default_mod.json`, which IS a single option document (PMP.cs:1504-1517). */
function optionDocs(members: Map<string, Uint8Array>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const [name, raw] of members) {
    if (!/(^|\/)(group_\d+.*|default_mod)\.json$/i.test(name)) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      continue; // a malformed manifest is the JSON diff's problem to report, not ours
    }
    if (!isObj(doc)) continue;
    if (Array.isArray(doc.Options)) {
      for (const o of doc.Options) if (isObj(o)) out.push(o);
    } else {
      out.push(doc);
    }
  }
  return out;
}

/** True iff any option in the archive carries a non-empty `FileSwaps` map. This is the CAUSE gate
 *  for the layout-equivalent comparison: it is a property of the INPUT pack, known before any
 *  diffing, and it is exactly the condition under which TexTools' placeholder mechanism
 *  (PMP.cs:1104-1137) can burn an idx we do not. Gating on the cause rather than on the diff's
 *  SHAPE is what keeps every swap-free pack under full byte-and-name exactness. */
export function packHasFileSwaps(members: Map<string, Uint8Array>): boolean {
  return optionDocs(members).some(
    (o) => isObj(o.FileSwaps) && Object.keys(o.FileSwaps).length > 0,
  );
}

/** Non-manifest ("payload") member names of an archive. */
export function payloadMemberNames(members: Map<string, Uint8Array>): string[] {
  return [...members.keys()].filter((n) => !isManifest(n));
}

/** The archive's effective `gamePath -> content` mapping, resolved through every option's `Files`.
 *
 *  A gamePath whose member is absent is OMITTED rather than defaulted — an absent payload is a real
 *  state (PMP.cs:883-888 drops such a key on write) and inventing bytes for it would mask a genuinely
 *  lost member. `looseKey` matches the resolution the rest of the diff harness uses, so a member
 *  differing only by case or a stripped trailing dot still resolves. */
export function resolveRedirects(
  members: Map<string, Uint8Array>,
): Map<string, Uint8Array> {
  const byLooseName = new Map<string, Uint8Array>();
  for (const [name, bytes] of members) byLooseName.set(looseKey(name), bytes);

  const out = new Map<string, Uint8Array>();
  for (const o of optionDocs(members)) {
    if (!isObj(o.Files)) continue;
    for (const [gamePath, zipPath] of Object.entries(o.Files)) {
      if (typeof zipPath !== "string") continue;
      const bytes = byLooseName.get(looseKey(zipPath.replace(/\\/g, "/")));
      if (bytes === undefined) continue;
      out.set(gamePath, bytes);
    }
  }
  return out;
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run test/helpers/archive-redirects.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/archive-redirects.ts test/helpers/archive-redirects.test.ts test/helpers/upgrade-archive-diff.ts
git commit -m "test(harness): read a PMP archive as Penumbra's redirect table

Penumbra reduces an option to (redirections, manipulations) via
SubMod.AddContainerTo (SubMod.cs:23-32), so the zip member name a payload lives
under is invisible to the game. This module makes that view available to the diff
harness, and provides the cause gate (packHasFileSwaps) for it."
```

---

### Task 3: The layout-equivalent payload comparison

**Files:**
- Modify: `test/helpers/upgrade-archive-diff.ts`
- Modify: `test/helpers/upgrade-archive-diff.test.ts`

**Interfaces:**
- Consumes: `resolveRedirects`, `payloadMemberNames` from `./archive-redirects` (Task 2).
- Produces: `export function diffPayloadSemantic(ours, golden, confirmDivergence?): FileDiff[]`
  with the same `FileDiff[]` return shape as `diffPayloadMembers`.

**What must still be asserted (§5.2).** This is a *re-keying*, not a loosening — along the axis that
decides whether the mod works it is the stronger comparison. It must still fail on:
- a `gamePath` present on one side only;
- differing content for a shared `gamePath`;
- **any non-`common/` payload member name differing** — only renumbering *within* `common/N` is free,
  so a writer bug that dropped or misnamed an ordinary member is still caught.

- [ ] **Step 1: Write the failing tests**

Append to `test/helpers/upgrade-archive-diff.test.ts`:

```typescript
describe("diffPayloadSemantic (layout-equivalent payload comparison)", () => {
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  const b = (...v: number[]) => new Uint8Array(v);

  /** Members for a one-group pack whose single option maps `files` (gamePath -> member name). */
  function members(
    files: Record<string, string>,
    payload: Record<string, Uint8Array>,
  ): Map<string, Uint8Array> {
    const m = new Map<string, Uint8Array>();
    m.set("meta.json", enc({ FileVersion: 3, Name: "t" }));
    m.set(
      "group_001_g.json",
      enc({ Options: [{ Name: "On", Files: files, FileSwaps: {} }] }),
    );
    for (const [k, v] of Object.entries(payload)) m.set(k, v);
    return m;
  }

  it("accepts a common/N renumbering when the redirect table is identical", () => {
    const ours = members(
      { "chara/a.tex": "common\\1\\a.tex" },
      { "common/1/a.tex": b(1, 2) },
    );
    const golden = members(
      { "chara/a.tex": "common\\2\\a.tex" },
      { "common/2/a.tex": b(1, 2) },
    );
    expect(diffPayloadSemantic(ours, golden)).toEqual([]);
  });

  it("REJECTS differing content for a shared gamePath", () => {
    const ours = members(
      { "chara/a.tex": "common\\1\\a.tex" },
      { "common/1/a.tex": b(1, 2) },
    );
    const golden = members(
      { "chara/a.tex": "common\\2\\a.tex" },
      { "common/2/a.tex": b(9, 9) },
    );
    const d = diffPayloadSemantic(ours, golden);
    expect(d).toHaveLength(1);
    expect(d[0]!.status).toBe("mismatch");
    expect(d[0]!.gamePath).toBe("chara/a.tex");
  });

  it("REJECTS a gamePath the golden has and we do not", () => {
    const ours = members({}, {});
    const golden = members(
      { "chara/a.tex": "common\\2\\a.tex" },
      { "common/2/a.tex": b(1) },
    );
    const d = diffPayloadSemantic(ours, golden);
    expect(d).toHaveLength(1);
    expect(d[0]!.status).toBe("added");
  });

  it("REJECTS a NON-common member name differing, even when content matches", () => {
    // A writer bug that misnames an ordinary member must still be caught: only common/N
    // renumbering is free.
    const ours = members(
      { "chara/a.tex": "g\\on\\a.tex" },
      { "g/on/a.tex": b(1) },
    );
    const golden = members(
      { "chara/a.tex": "g\\off\\a.tex" },
      { "g/off/a.tex": b(1) },
    );
    const d = diffPayloadSemantic(ours, golden);
    expect(d.some((x) => x.status === "removed" && x.gamePath === "g/on/a.tex")).toBe(true);
    expect(d.some((x) => x.status === "added" && x.gamePath === "g/off/a.tex")).toBe(true);
  });

  it("consults confirmDivergence for a shared gamePath's content mismatch", () => {
    const ours = members(
      { "chara/a.tex": "common\\1\\a.tex" },
      { "common/1/a.tex": b(1) },
    );
    const golden = members(
      { "chara/a.tex": "common\\2\\a.tex" },
      { "common/2/a.tex": b(2) },
    );
    expect(diffPayloadSemantic(ours, golden, () => true)).toEqual([]);
  });
});
```

Add `diffPayloadSemantic` to the file's existing import from `./upgrade-archive-diff`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/helpers/upgrade-archive-diff.test.ts`
Expected: FAIL — `diffPayloadSemantic is not exported`.

- [ ] **Step 3: Implement**

Add to `test/helpers/upgrade-archive-diff.ts` (import `resolveRedirects` and `payloadMemberNames`
from `./archive-redirects` at the top):

```typescript
/** Payload comparison for a pack whose zip LAYOUT cannot match the golden's, but whose behaviour
 *  must (the spec, §5.2). Compares the redirect table (`gamePath -> content`, Penumbra
 *  SubMod.AddContainerTo, SubMod.cs:23-32) instead of the member-name multiset, because a preserved
 *  FileSwap means TexTools burned a dedup `idx` we did not (PMP.cs:1104-1137 ->
 *  PmpExtensions.cs:509-514), shifting every later `common/N`.
 *
 *  This is a RE-KEYING, not a tolerance. It still fails on a gamePath present on one side only, on
 *  differing content for a shared gamePath, and on ANY non-`common/` member name differing — only
 *  renumbering WITHIN the `common/N` dedup namespace is free. Callers must gate it on the input pack
 *  actually carrying FileSwaps (`packHasFileSwaps`); firing it on the diff's shape instead would
 *  silently absorb writer regressions in every other pack. */
export function diffPayloadSemantic(
  ours: Map<string, Uint8Array>,
  golden: Map<string, Uint8Array>,
  confirmDivergence?: (
    gamePath: string,
    ours: Uint8Array,
    golden: Uint8Array,
  ) => boolean,
): FileDiff[] {
  const diffs: FileDiff[] = [];

  // 1. The redirect tables must agree exactly — same gamePaths, same bytes.
  const o = resolveRedirects(ours);
  const g = resolveRedirects(golden);
  for (const gamePath of [...new Set([...o.keys(), ...g.keys()])].sort()) {
    const ob = o.get(gamePath);
    const gb = g.get(gamePath);
    if (ob === undefined) {
      diffs.push({ kind: "structure", gamePath, index: 0, status: "added" });
      continue;
    }
    if (gb === undefined) {
      diffs.push({ kind: "structure", gamePath, index: 0, status: "removed" });
      continue;
    }
    if (bytesEqual(ob, gb)) continue;
    if (confirmDivergence?.(gamePath, ob, gb)) continue;
    diffs.push({
      kind: "structure",
      gamePath,
      index: 0,
      status: "mismatch",
      detail: `${ob.length} vs ${gb.length} bytes`,
    });
  }

  // 2. Only the `common/N` dedup namespace may be renamed. Every OTHER payload member name must
  //    still match exactly, so a misnamed or dropped ordinary member is still caught here.
  const outside = (m: Map<string, Uint8Array>) =>
    payloadMemberNames(m)
      .filter((n) => !looseKey(n).startsWith("common/"))
      .map(looseKey)
      .sort();
  const oNames = outside(ours);
  const gNames = outside(golden);
  for (const n of gNames) {
    if (!oNames.includes(n))
      diffs.push({ kind: "structure", gamePath: n, index: 0, status: "added" });
  }
  for (const n of oNames) {
    if (!gNames.includes(n))
      diffs.push({ kind: "structure", gamePath: n, index: 0, status: "removed" });
  }
  return diffs;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/helpers/upgrade-archive-diff.test.ts`
Expected: PASS, all existing tests plus the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/upgrade-archive-diff.ts test/helpers/upgrade-archive-diff.test.ts
git commit -m "test(harness): layout-equivalent payload comparison for swap-carrying packs

Compares the redirect table (gamePath -> content) rather than the zip member-name
multiset, because a preserved FileSwap means TexTools burned a dedup idx we did not
and every later common/N shifts. A re-keying, not a tolerance: still fails on a
one-sided gamePath, on differing content, and on any non-common/ member name
differing."
```

---

### Task 4: Gate it on the input pack and wire the call sites

**Files:**
- Modify: `test/helpers/upgrade-archive-diff.ts` (`diffArchives` signature)
- Modify: `test/helpers/corpus-upgrade.ts`
- Modify: `test/helpers/corpus-resave.ts`
- Modify: `test/helpers/upgrade-archive-diff.test.ts`

**Interfaces:**
- Consumes: `diffPayloadSemantic` (Task 3), `packHasFileSwaps` (Task 2).
- Produces: `diffArchives(ours, golden, checkPayloadMembers?, confirmDivergence?, layoutEquivalent?)`.

**The gate must come from the INPUT pack**, not from `ours` or the golden — the golden has had its
swaps destroyed by `PopulatePmpStandardOption` (`PMP.cs:873-875`), so gating on it would never fire.

- [ ] **Step 1: Write the failing test**

Append to `test/helpers/upgrade-archive-diff.test.ts`:

```typescript
it("diffArchives uses member-name comparison by default and semantic only when asked", () => {
  const zipOf = (files: Record<string, string>, payload: Record<string, Uint8Array>) =>
    writeZipForTest({
      "meta.json": new TextEncoder().encode(JSON.stringify({ FileVersion: 3, Name: "t" })),
      "group_001_g.json": new TextEncoder().encode(
        JSON.stringify({ Options: [{ Name: "On", Files: files, FileSwaps: {} }] }),
      ),
      ...payload,
    });
  const ours = zipOf({ "chara/a.tex": "common\\1\\a.tex" }, { "common/1/a.tex": new Uint8Array([1]) });
  const golden = zipOf({ "chara/a.tex": "common\\2\\a.tex" }, { "common/2/a.tex": new Uint8Array([1]) });

  // Default: the member-name shift IS reported.
  const strict = diffArchives(ours, golden, true);
  expect(strict.some((d) => d.kind === "structure")).toBe(true);

  // layoutEquivalent: the same shift is accepted, because the redirect tables agree.
  const relaxed = diffArchives(ours, golden, true, undefined, true);
  expect(relaxed.filter((d) => d.kind === "structure")).toEqual([]);
});
```

Use the test file's existing zip-building helper; if none exists, add
`function writeZipForTest(members: Record<string, Uint8Array>): Uint8Array` using `zipSync` from
`fflate` with the same options `src/zip/zip.ts` uses to write.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/helpers/upgrade-archive-diff.test.ts`
Expected: FAIL — `diffArchives` takes 4 arguments.

- [ ] **Step 3: Add the parameter**

In `diffArchives`, add a fifth parameter and swap which payload comparison runs:

```typescript
  layoutEquivalent = false,
): FileDiff[] {
```

and replace the `if (checkPayloadMembers)` line at the end of the function body with:

```typescript
  if (checkPayloadMembers)
    diffs.push(
      ...(layoutEquivalent
        ? diffPayloadSemantic(om, gm, confirmDivergence)
        : diffPayloadMembers(om, gm, confirmDivergence)),
    );
```

Extend `diffArchives`' doc comment with:

```
 * `layoutEquivalent` swaps the payload comparison for `diffPayloadSemantic` — compare the redirect
 * table rather than the member-name multiset. Pass `true` ONLY when the INPUT pack carries FileSwaps
 * (`packHasFileSwaps`), never based on what the diff looks like: gating on the symptom would
 * silently absorb genuine writer regressions in every pack. See the spec, §5.2.
```

- [ ] **Step 4: Wire `corpus-resave.ts`**

Read the file first. Locate its `diffArchives(...)` call. Before it, derive the gate from the input
pack (the same `bytes` already used for `oracleKey(bytes)`):

```typescript
const layoutEquivalent = packHasFileSwaps(readZip(bytes));
if (layoutEquivalent) {
  console.log(
    `[resave] ${name}: input carries FileSwaps -> payload compared SEMANTICALLY ` +
      `(redirect table, not member names). See the FileSwap-preservation spec, §5.2.`,
  );
}
```

Pass `layoutEquivalent` as the new fifth argument. Import `packHasFileSwaps` from
`./archive-redirects` and `readZip` from `../../src/zip/zip` if not already imported.

- [ ] **Step 5: Wire `corpus-upgrade.ts` identically**

Same change, same log line with `[upgrade]` instead of `[resave]`. The mode must announce itself in
both harnesses (§5.2) — "this pack was compared semantically" is never invisible.

- [ ] **Step 6: Run the full suite**

Run: `npm run check; npm run typecheck; npm test`
Expected: `file-swaps.pmp`'s `resave` check now reports only the `FileSwaps` **manifest** diffs (Task
5's job) — the `common/N` structure diffs are gone. Every other pack is unchanged: confirm no
`compared SEMANTICALLY` line appears for any pack other than `file-swaps.pmp` and
`torn bassment glow.pmp`.

- [ ] **Step 7: Commit**

```bash
git add test/helpers/
git commit -m "test(harness): gate the semantic payload comparison on the input pack's FileSwaps

Gates on the CAUSE (the input pack carries a swap), not the symptom (the diff looks
like a common/N shift) -- a symptom gate would absorb writer regressions in every
pack. The input pack, not the golden: PopulatePmpStandardOption has already
destroyed the golden's swaps (PMP.cs:873-875), so gating on it would never fire.
Announces itself in test output."
```

---

### Task 5: Confirm the `FileSwaps` manifest divergence

**Files:**
- Modify: `test/helpers/upgrade-archive-diff.ts` (`dropConfirmedAbsentKeys`)
- Modify: `test/helpers/upgrade-archive-diff.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new export — extends the existing manifest confirmation.

**This replaces a baseline suppression with a confirmation** (AGENTS.md: a divergence recorded only
in a gitignored ratchet baseline is not documented). The rule must be tight: `golden.FileSwaps`
**empty** and `ours.FileSwaps` **non-empty** is the confirmed shape. Two non-empty maps that differ
is still a mismatch — that would mean we mangled the swaps, not preserved them.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("FileSwaps confirmation (TEXTOOLS_BUGS #10)", () => {
  const ours = { Name: "o", Files: {}, FileSwaps: { "chara/d.tex": "chara\\s.tex" } };

  it("confirms ours-populated against golden-empty", () => {
    const golden = { Name: "o", Files: {}, FileSwaps: {} };
    const pruned = dropConfirmedAbsentKeys(ours, golden, new Map()) as Record<string, unknown>;
    expect(jsonPointerDiff(ours, pruned)).toEqual([]);
  });

  it("still REJECTS two non-empty maps that differ (we mangled them, not preserved them)", () => {
    const golden = { Name: "o", Files: {}, FileSwaps: { "chara/d.tex": "chara\\OTHER.tex" } };
    const pruned = dropConfirmedAbsentKeys(ours, golden, new Map());
    expect(jsonPointerDiff(ours, pruned).length).toBeGreaterThan(0);
  });

  it("still REJECTS ours-empty against golden-populated (we LOST swaps)", () => {
    const oursEmpty = { Name: "o", Files: {}, FileSwaps: {} };
    const golden = { Name: "o", Files: {}, FileSwaps: { "chara/d.tex": "chara\\s.tex" } };
    const pruned = dropConfirmedAbsentKeys(oursEmpty, golden, new Map());
    expect(jsonPointerDiff(oursEmpty, pruned).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/helpers/upgrade-archive-diff.test.ts`
Expected: the first test FAILS (the diff reports a `FileSwaps` pointer difference); the other two
already pass and must keep passing.

- [ ] **Step 3: Implement**

In `dropConfirmedAbsentKeys`, extend the `option` closure:

```typescript
  const option = (oursOpt: unknown, goldenOpt: unknown): unknown => {
    if (!isObj(goldenOpt) || !isObj(oursOpt) || !isObj(goldenOpt.Files))
      return goldenOpt;
    const out: Record<string, unknown> = {
      ...goldenOpt,
      Files: confirmedFiles(oursOpt.Files, goldenOpt.Files),
    };
    // INTENTIONAL DIVERGENCE (spec §5.1). PopulatePmpStandardOption sets `opt.FileSwaps = new()`
    // and never repopulates it (PMP.cs:873-875), silently destroying every swap the pack carried --
    // docs/TEXTOOLS_BUGS.md #10, adjudicated a genuine defect. We preserve them instead, because a
    // swap is a live redirection in Penumbra (SubMod.AddContainerTo, SubMod.cs:23-32). So: an EMPTY
    // golden FileSwaps against a NON-EMPTY ours is the confirmed shape, and we adopt ours' value so
    // the pointer diff sees no difference.
    //
    // Deliberately tight, and NOT symmetric:
    //  - ours empty + golden populated means we LOST swaps -- still a mismatch;
    //  - both populated but differing means we MANGLED them -- still a mismatch.
    // Only "golden dropped everything, we kept something" is confirmed.
    const gSwaps = isObj(goldenOpt.FileSwaps) ? goldenOpt.FileSwaps : undefined;
    const oSwaps = isObj(oursOpt.FileSwaps) ? oursOpt.FileSwaps : undefined;
    if (
      gSwaps !== undefined &&
      oSwaps !== undefined &&
      Object.keys(gSwaps).length === 0 &&
      Object.keys(oSwaps).length > 0
    ) {
      out.FileSwaps = oSwaps;
    }
    return out;
  };
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/helpers/upgrade-archive-diff.test.ts`
Expected: PASS, all three.

- [ ] **Step 5: Full suite + re-bless**

The `torn bassment glow.pmp` resave baseline currently *suppresses* the six `FileSwaps` pointer
diffs; they are now *confirmed*, so the baseline should shrink.

Run:
```powershell
npm run check; npm run typecheck
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
npm test
```
Expected: green both times. Confirm the `torn bassment glow.pmp` resave baseline no longer lists any
`FileSwaps` entry:

```powershell
Get-ChildItem test/corpus/.resave-baseline -File | ForEach-Object { if ((Get-Content $_.FullName -Raw) -match "FileSwaps") { $_.Name } }
```
Expected: no output.

- [ ] **Step 6: Commit**

Note: `test/corpus/` is gitignored, so the re-blessed baselines are NOT committed — only the
harness change is.

```bash
git add test/helpers/
git commit -m "test(harness): confirm the FileSwaps divergence instead of baselining it

PopulatePmpStandardOption destroys FileSwaps on write (PMP.cs:873-875,
TEXTOOLS_BUGS #10); we preserve them. That divergence was suppressed by the resave
ratchet baseline, which AGENTS.md says does not count as documenting it. Now
confirmed explicitly: golden-empty against ours-populated is the accepted shape,
and ONLY that -- losing swaps or mangling them is still a mismatch."
```

---

### Task 6: Close out the docs

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md`
- Modify: `docs/BACKLOG.md`
- Delete: `docs/backlog/2026-07-13-pmp-write-fileswaps.md`
- Delete: `docs/superpowers/plans/2026-07-18-pmp-fileswap-preservation.md` (this file)

- [ ] **Step 1: Grep for references before deleting the backlog item**

Run: `Select-String -Path src,test,scripts,docs -Pattern "2026-07-13-pmp-write-fileswaps" -Recurse`
Expected: hits only in `docs/BACKLOG.md` and possibly the spec. **Every hit must be updated or
removed in this commit** — a dangling pointer to a deleted file is a documented failure mode
(AGENTS.md). If a `src/` file still cites it, that citation is stale: the code no longer waits on it.

- [ ] **Step 2: Update the spec's status header**

Replace the status block with:

```markdown
Filed 2026-07-18 · Status: **implemented**, except the in-game gate (§7), which is manual and
outstanding. The synthetic (§6.1), the semantic-comparison mode (§5.2) and the manifest carve-out
(§5.1) have landed.
```

Also update §5.2's "Not expressible by either confirmation site" paragraph: it is now expressible —
`diffPayloadSemantic` is a third confirmation site. State that, and note AGENTS.md's harness section
lists the two older ones.

- [ ] **Step 3: Remove the backlog item and its index entry**

Delete `docs/backlog/2026-07-13-pmp-write-fileswaps.md` and its bullet under "PMP write path" in
`docs/BACKLOG.md`.

- [ ] **Step 4: Delete this plan**

AGENTS.md: a plan is committed when written, then **deleted on the branch before the PR opens**, so
the PR under review carries only the durable spec and the shipped work.

- [ ] **Step 5: Full suite**

Run: `npm run check; npm run typecheck; npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: close out the FileSwap-preservation work

Spec marked implemented except the manual in-game gate; the backlog item it
superseded is deleted along with its index entry; the plan is deleted per AGENTS.md
so the PR carries only the durable spec and the shipped work."
```

---

### Task 7: The in-game verification gate (MANUAL — blocks merge)

**Files:** none — this is an operator action.

AGENTS.md's first principle requires, for any user-benefit divergence, that someone has **verified in
the real game** that our output is better. It is manual and cannot be skipped or inferred.

- [ ] **Step 1: Ask the operator to perform the check**

Post this verbatim and **wait**:

> The FileSwap work is code-complete but cannot merge until the in-game gate (spec §7) is done.
> Please:
> 1. Take a real mod carrying file swaps — `torn bassment glow.pmp` in `test/corpus/real/` is the
>    one we found (6 swaps onto base-game `e6120` textures).
> 2. Upgrade it with ConsoleTools `/upgrade`, and with ours.
> 3. Install both in Penumbra and confirm ConsoleTools' output has lost the swapped-file behaviour
>    while ours retains it.
>
> Tell me what you observe and I'll record it in the confirmation rule.

- [ ] **Step 2: Record the result at the confirmation site**

Add the operator's observation, with the date, to the `FileSwaps` carve-out comment in
`dropConfirmedAbsentKeys` (Task 5). AGENTS.md requires the evidence to live *with the enforcement*.

**If the operator reports our output is NOT better, STOP.** The divergence is unjustified under the
first principle and the whole change must be reconsidered, not merged.

- [ ] **Step 3: Commit and open the PR**

```bash
git add test/helpers/upgrade-archive-diff.ts
git commit -m "docs: record the in-game verification for the FileSwaps divergence"
git push -u origin feat/pmp-fileswap-preservation
gh pr create --title "Preserve PMP FileSwaps instead of failing loud" --body "<summary>"
```

## Self-Review

**Spec coverage:** §3 decision → already shipped (`resolve-duplicates.ts`, `pmp.ts`). §4 no-game-index
→ no code, recorded in the spec. §5.1 manifest divergence → Task 5. §5.2 semantic mode → Tasks 2-4.
§6 changes → shipped, plus Task 6's doc close-out. §6.1 synthetic → Task 1. §7 in-game gate → Task 7.
§8 out-of-scope → no tasks, correct.

**Placeholders:** none — every code step carries complete code; the only `<PASTE ...>` is Task 1's
commit message, which deliberately requires a measured value the implementer must observe.

**Type consistency:** `packHasFileSwaps`/`resolveRedirects`/`payloadMemberNames` (Task 2) are used
under those exact names in Tasks 3-4. `diffPayloadSemantic`'s signature matches `diffPayloadMembers`'
so Task 4's ternary type-checks. `FileDiff` fields match `upgrade-diff.ts` (`kind`, `gamePath`,
`index`, `status`, `detail?`).

**Known risk, flagged deliberately:** Task 1 Step 4 may reveal the predicted `common/N` shift does not
occur. The plan says STOP rather than work around it — Tasks 3-5 would then rest on a false premise.
