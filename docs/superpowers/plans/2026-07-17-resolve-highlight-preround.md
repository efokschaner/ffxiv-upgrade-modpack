# Resolve-Highlight Pre-Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port TexTools' `ResolveHighlightOptionsAndMashupHair` highlight-resolution pre-round (cross-option hair normal/mask pointer stapling + fail-loud throws), wire it before round 1, and add the `/upgrade` expected-failure golden capability so a real throwing mod proves the throw against ConsoleTools.

**Architecture:** A new pure `src/upgrade/resolve-highlight.ts` mutates `ModpackData` in place, called first in `upgradeModpack`. A shared `dx11Path` moves to `src/mtrl/`. The `/upgrade` golden harness gains an `{ kind: "error" }` outcome mirroring the shipped `/resave` one, but with **match-failure = pass** semantics. Proof: unit tests for every branch, a synthetic golden for the clean staple (no real mod reaches it), and one real throwing mod.

**Tech Stack:** TypeScript (ESM), Vitest, `tsx` runner, `fflate` (zip), the repo's custom parallel test runner. Oracle: local `ConsoleTools.exe`.

## Global Constraints

- **Byte-parity is correctness.** Output must match ConsoleTools `/upgrade` byte-for-byte except documented divergences. Port behaviour from the C# symbol actually executed; reproduce quirks, don't fix them.
- **Every business-logic line cites TexTools provenance** as `file · symbol · lines` in a header/comment. Verify each citation against `reference/` (never port from memory).
- **Fail loud, never silently diverge.** An unported path throws.
- **Split, don't blend.** One TS module per C# symbol; don't merge logic from different C# files.
- **Mirror the C# data structure** (`Dictionary`→`Map`, `List`→array with dups) and **control flow** (fused loops, live mutation) exactly.
- **Reference C#:** `reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/Mods/ModpackUpgrader.cs`.
- **End-of-task gate (required, all green):** `npm run check`, `npm run typecheck`, `npm test`.
- **No per-file license headers.** Biome owns formatting (`npm run check`).
- Spec: `docs/superpowers/specs/2026-07-17-resolve-highlight-preround-design.md`.

---

## File Structure

**New source:**
- `src/mtrl/dx11-path.ts` — the `XivMtrl.Dx11Path` getter, extracted from `material.ts`.
- `src/upgrade/resolve-highlight.ts` — the pre-round transform.

**New tests:**
- `test/mtrl/dx11-path.test.ts` — unit test for the extracted getter.
- `test/upgrade/resolve-highlight.test.ts` — all pre-round branches.

**New scaffolding:**
- `scripts/generate-synthetics/build-synthetic-highlight.ts` — the clean-staple synthetic PMP.

**Modified:**
- `src/upgrade/material.ts` — import `dx11Path` instead of defining it.
- `src/upgrade/upgrade.ts` — call the pre-round in `upgradeModpack`.
- `test/helpers/upgrade-golden.ts` — add `{ kind: "error" }` + `.error` marker + guards.
- `test/helpers/upgrade-golden.test.ts` — **new file** (there is no existing one) mirroring `resave-golden.test.ts`.
- `test/helpers/corpus-upgrade.ts` — error-branch (match→pass / mismatch→fail).
- `scripts/generate-synthetics/build-all.ts` — register the new synthetic.
- `docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md` — narrow to `RepathHairMashups`.
- `docs/BACKLOG.md` — re-word item #1; drop the `2026-07-11` entry.

**Deleted:**
- `docs/backlog/2026-07-11-expected-failure-golden.md` (both halves done).

**Corpus (gitignored, local only):**
- `test/corpus/real/[Inako] Lilith Wish.pmp` — copied from the maintainer's library.

---

## Task 1: Extract `dx11Path` to `src/mtrl/`

**Files:**
- Create: `src/mtrl/dx11-path.ts`
- Create: `test/mtrl/dx11-path.test.ts`
- Modify: `src/upgrade/material.ts` (remove the private `dx11Path`, import the new one)

**Interfaces:**
- Produces: `dx11Path(tex: MtrlTexture): string` from `src/mtrl/dx11-path.ts`.

- [ ] **Step 1: Write the new module**

Create `src/mtrl/dx11-path.ts` — move the function verbatim from `material.ts:50-56`, keeping its doc comment (it cites `XivMtrl.cs:667-680`):

```ts
import type { MtrlTexture } from "./types";

/**
 * Dx11Path (XivMtrl.cs:667-680). The DX9 flag (0x8000) means the stored TexturePath lacks the
 * literal "--" hide-from-DX11 marker; Dx11Path is the path AS the DX11 client sees it, with that
 * marker spliced onto the filename. Our parser (src/mtrl/parse.ts) never manufactures or strips
 * "--", so this getter mirrors the C# one exactly, operating on the texture (path + flags).
 */
export function dx11Path(tex: MtrlTexture): string {
  if ((tex.flags & 0x8000) === 0) return tex.texturePath;
  const slash = tex.texturePath.lastIndexOf("/");
  const dir = slash >= 0 ? tex.texturePath.slice(0, slash) : "";
  const file = slash >= 0 ? tex.texturePath.slice(slash + 1) : tex.texturePath;
  return `${dir}/--${file}`;
}
```

- [ ] **Step 2: Write the unit test**

Create `test/mtrl/dx11-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dx11Path } from "../../src/mtrl/dx11-path";

describe("dx11Path", () => {
  it("returns the path unchanged when the DX9 flag (0x8000) is clear", () => {
    expect(
      dx11Path({ texturePath: "chara/a/b_n.tex", flags: 0 }),
    ).toBe("chara/a/b_n.tex");
  });

  it("splices the -- marker onto the filename when the DX9 flag is set", () => {
    expect(
      dx11Path({ texturePath: "chara/a/b_n.tex", flags: 0x8000 }),
    ).toBe("chara/a/--b_n.tex");
  });

  it("handles a path with no slash", () => {
    expect(dx11Path({ texturePath: "b_n.tex", flags: 0x8000 })).toBe("/--b_n.tex");
  });
});
```

- [ ] **Step 3: Update `material.ts`**

In `src/upgrade/material.ts`: delete the private `dx11Path` function (currently lines 41-56, including its doc comment) and add an import. Add to the existing import block near the top:

```ts
import { dx11Path } from "../mtrl/dx11-path";
```

Leave every existing `dx11Path(...)` call site unchanged.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/mtrl/dx11-path.test.ts test/upgrade/material.test.ts`
Expected: PASS (the extracted getter behaves identically; material tests confirm no regression).

- [ ] **Step 5: Gate + commit**

Run: `npm run check; npm run typecheck`
Expected: clean.

```powershell
git add src/mtrl/dx11-path.ts test/mtrl/dx11-path.test.ts src/upgrade/material.ts
git commit -m "refactor(mtrl): extract XivMtrl.Dx11Path getter to src/mtrl/dx11-path.ts"
```

---

## Task 2: Port the pre-round (`resolve-highlight.ts`)

**Files:**
- Create: `src/upgrade/resolve-highlight.ts`
- Create: `test/upgrade/resolve-highlight.test.ts`

**Interfaces:**
- Consumes: `dx11Path` (Task 1); `resolveFile` from `src/upgrade/upgrade.ts`; `parseMtrl` from `src/mtrl/mtrl`; `ESamplerId`, `SHPK_HAIR` from `src/mtrl/shader`; `ModpackData`, `ModpackOption` from `src/model/modpack`.
- Produces: `resolveHighlightOptionsAndMashupHair(data: ModpackData): void` (mutates in place).

- [ ] **Step 1: Write the failing tests**

Create `test/upgrade/resolve-highlight.test.ts`. These build minimal `ModpackData` directly. The Hair-mtrl bytes come from the bundled `_SampleHair` material (already used by `unclaimed-hair.ts`), whose normal/mask sampler Dx11 paths we read at test setup so the fixtures reference the real pair.

```ts
import { describe, expect, it } from "vitest";
import { SAMPLE_HAIR_MTRL_BASE64 } from "../../src/upgrade/reference/hair-materials";
import { dx11Path } from "../../src/mtrl/dx11-path";
import { parseMtrl } from "../../src/mtrl/mtrl";
import { ESamplerId } from "../../src/mtrl/shader";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../../src/model/modpack";
import { resolveHighlightOptionsAndMashupHair } from "../../src/upgrade/resolve-highlight";

const HAIR_MTRL_BYTES = new Uint8Array(Buffer.from(SAMPLE_HAIR_MTRL_BASE64, "base64"));
const HAIR_MTRL_PATH =
  "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl";

// Derive the real normal/mask Dx11 paths the sample material references.
const SAMPLE = parseMtrl(HAIR_MTRL_BYTES, HAIR_MTRL_PATH);
const N = dx11Path(
  SAMPLE.textures.find((t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerNormal)!,
);
const M = dx11Path(
  SAMPLE.textures.find((t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerMask)!,
);

function raw(bytes: Uint8Array): ModpackFile {
  return { data: bytes, storage: FileStorageType.RawUncompressed };
}
function tex(seed: number): ModpackFile {
  return raw(new Uint8Array([seed, seed + 1, seed + 2]));
}
function option(name: string, files: Array<[string, ModpackFile]>): ModpackOption {
  return {
    name,
    description: "",
    image: "",
    priority: 0,
    fileSwaps: {},
    manipulations: [],
    files: new Map(files),
  };
}
function pack(options: ModpackOption[]): ModpackData {
  const group: ModpackGroup = {
    name: "G",
    description: "",
    image: "",
    page: 0,
    priority: 0,
    selectionType: "Single",
    defaultSettings: 0,
    options,
  };
  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: {
      name: "M",
      author: "A",
      version: "1",
      description: "",
      url: "",
      image: "",
      tags: [],
      minimumFrameworkVersion: "1.0.0.0",
    },
    groups: [group],
  };
}

describe("resolveHighlightOptionsAndMashupHair", () => {
  it("no-ops when there are no hair materials", () => {
    const data = pack([option("O", [["chara/x/y.tex", tex(1)]])]);
    resolveHighlightOptionsAndMashupHair(data);
    expect([...data.groups[0]!.options[0]!.files.keys()]).toEqual(["chara/x/y.tex"]);
  });

  it("no-ops when every hair pair is complete in the option that holds either", () => {
    const data = pack([
      option("Both", [
        [HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)],
        [N, tex(1)],
        [M, tex(2)],
      ]),
    ]);
    resolveHighlightOptionsAndMashupHair(data);
    expect(data.groups[0]!.options[0]!.files.size).toBe(3);
  });

  it("staples the missing texture from the sole container into each split option", () => {
    const a = option("Has Normal", [
      [HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)],
      [N, tex(1)],
    ]);
    const b = option("Has Mask", [[M, tex(2)]]);
    const data = pack([a, b]);
    resolveHighlightOptionsAndMashupHair(data);
    // A gains M (from B), B gains N (from A); bytes shared with the source.
    expect(a.files.has(M)).toBe(true);
    expect(b.files.has(N)).toBe(true);
    expect(a.files.get(M)!.data).toBe(b.files.get(M)!.data); // wait: shares B's original buffer
  });

  it("throws InvalidDataException-style when the missing texture is in more than one container", () => {
    // Two options each hold N; a third split option's missing M is unique — but N's container
    // count is 2, so resolving the option missing N throws.
    const a = option("A", [
      [HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)],
      [N, tex(1)],
    ]);
    const b = option("B", [[N, tex(2)]]);
    const c = option("C", [[M, tex(3)]]);
    const data = pack([a, b, c]);
    expect(() => resolveHighlightOptionsAndMashupHair(data)).toThrow(/unresolveable/);
  });

  it("throws KeyNotFound-style when a split option's missing texture is in no container", () => {
    // One option holds only N; M lives nowhere in the pack.
    const a = option("A", [
      [HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)],
      [N, tex(1)],
    ]);
    const data = pack([a]);
    expect(() => resolveHighlightOptionsAndMashupHair(data)).toThrow(/no option|KeyNotFound/);
  });

  it("throws the deferred RepathHairMashups error for material-only mashup hair", () => {
    // Hair mtrl present, but neither N nor M appears as a file in any option -> badOptions empty
    // AND containers empty -> RepathHairMashups branch.
    const a = option("A", [[HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)]]);
    const data = pack([a]);
    expect(() => resolveHighlightOptionsAndMashupHair(data)).toThrow(/RepathHairMashups|mashup/);
  });

  it("skips a .mtrl that fails to parse", () => {
    const data = pack([
      option("O", [
        ["chara/x/bad.mtrl", raw(new Uint8Array([0, 0, 0, 0]))],
        [N, tex(1)],
      ]),
    ]);
    resolveHighlightOptionsAndMashupHair(data); // no throw; unparsable mtrl ignored
    expect(data.groups[0]!.options[0]!.files.has(N)).toBe(true);
  });
});
```

Note on the staple test's byte-sharing assertion: A gains `M` copied from B's file (`{ ...src }`), so `a.files.get(M)!.data === b.files.get(M)!.data`. Fix that line to compare against B's buffer:

```ts
    const bMaskData = b.files.get(M)!.data;
    resolveHighlightOptionsAndMashupHair(data);
    expect(a.files.get(M)!.data).toBe(bMaskData);
```
(Capture `bMaskData` before the call; keep the `a.files.has(M)` / `b.files.has(N)` assertions.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/upgrade/resolve-highlight.test.ts`
Expected: FAIL — `resolveHighlightOptionsAndMashupHair` is not defined.

- [ ] **Step 3: Implement the module**

Create `src/upgrade/resolve-highlight.ts`. **The stage-3 resolution loop has NO both/neither guard** (unlike stage 2) — this is faithful to `ModpackUpgrader.cs:358-376` and is why real multi-pair mods throw.

```ts
// Port of ModpackUpgrader.ResolveHighlightOptionsAndMashupHair, highlight-resolution half
// (reference/.../Mods/ModpackUpgrader.cs:267-377). A pre-round (run before round 1, ungated by
// includePartials — :83) that staples split Hair-shader normal/mask ("highlight/visibility")
// textures across options, or fails loud when it cannot. The RepathHairMashups half (:379-482)
// needs the live Dawntrail game index (rtx.FileExists) and is deferred, see
// docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md.
import type { ModpackData, ModpackOption } from "../model/modpack";
import { dx11Path } from "../mtrl/dx11-path";
import { parseMtrl } from "../mtrl/mtrl";
import { ESamplerId, SHPK_HAIR } from "../mtrl/shader";
import type { MtrlTexture, XivMtrl } from "../mtrl/types";
import { resolveFile } from "./upgrade";

/** g_SamplerNormal / g_SamplerMask lookup reproducing C#'s UNGUARDED `x.Sampler.SamplerId`
 * (ModpackUpgrader.cs:294-295): a texture that bound no sampler NREs when reached before a match,
 * which the caller's try/catch (:301-304) turns into "skip this .mtrl". Array.find stops at the
 * first match or first throw, matching FirstOrDefault's enumeration order (same pattern as
 * material.ts's findSpecDiffuse). */
function findSamplerUnguarded(mtrl: XivMtrl, samplerId: number): MtrlTexture | undefined {
  return mtrl.textures.find((t) => {
    if (!t.sampler) throw new Error("mtrl: texture bound no sampler");
    return t.sampler.samplerIdRaw === samplerId;
  });
}

interface HairPair {
  normal: string;
  mask: string;
}

export function resolveHighlightOptionsAndMashupHair(data: ModpackData): void {
  // Stage 1 — ForAllFiles (:275-311): rip every option's .mtrl, keep Hair-shader ones with a
  // normal AND mask sampler, collect their (normalDx11, maskDx11) pair. mData is an ordered List
  // (C# List<(Normal,Mask)>, :272) — duplicates are kept; the count drives the throw below.
  const mData: HairPair[] = [];
  for (const group of data.groups) {
    for (const option of group.options) {
      for (const [path, f] of option.files) {
        if (!path.endsWith(".mtrl")) continue;
        // GetUncompressedFile (:281). A resolve miss => C# outer catch => skip (:301-304).
        const resolved = resolveFile(f);
        if (!resolved) continue;
        let mtrl: XivMtrl;
        try {
          mtrl = parseMtrl(resolved.bytes, path); // GetXivMtrl inner try/catch (:283-290)
        } catch {
          continue;
        }
        if (mtrl.shaderPackRaw !== SHPK_HAIR) continue; // (:292)
        let norm: MtrlTexture | undefined;
        let mask: MtrlTexture | undefined;
        try {
          norm = findSamplerUnguarded(mtrl, ESamplerId.g_SamplerNormal); // (:294)
          mask = findSamplerUnguarded(mtrl, ESamplerId.g_SamplerMask); // (:295)
        } catch {
          continue; // null-sampler NRE => outer catch => skip file (:301-304)
        }
        if (!norm || !mask) continue; // (:297)
        // C# also adds f.Key to a `hairMaterials` HashSet (:298) that is never read again — dead; dropped.
        mData.push({ normal: dx11Path(norm), mask: dx11Path(mask) }); // (:299)
      }
    }
  }
  if (mData.length === 0) return; // (:308-311)

  // Stage 2 — ForAllOptions (:314-344): build `containers` (which options hold each texture path;
  // C# Dictionary<string, List<option>>, dups allowed) and `badOptions` (options holding exactly
  // one of a pair; C# List<option>, dups allowed). containers is populated for ALL options,
  // including those with both — the both/neither guard only gates the badOptions.Add.
  const containers = new Map<string, ModpackOption[]>();
  const badOptions: ModpackOption[] = [];
  const addContainer = (texPath: string, o: ModpackOption): void => {
    let list = containers.get(texPath);
    if (!list) {
      list = [];
      containers.set(texPath, list);
    }
    list.push(o);
  };
  for (const group of data.groups) {
    for (const option of group.options) {
      for (const pair of mData) {
        const hasMask = option.files.has(pair.mask);
        const hasNorm = option.files.has(pair.normal);
        if (hasNorm) addContainer(pair.normal, option); // (:323-330)
        if (hasMask) addContainer(pair.mask, option); // (:331-338)
        if (hasMask && hasNorm) continue; // (:340)
        if (!hasMask && !hasNorm) continue; // (:341)
        badOptions.push(option); // (:342)
      }
    }
  }

  // (:346-355)
  if (badOptions.length === 0) {
    if (containers.size === 0) {
      // Material-only Mashup hair (:348-353) -> RepathHairMashups. DEFERRED: needs the live DT
      // game index (rtx.FileExists). Fail loud.
      throw new Error(
        "resolve-highlight: material-only mashup hair (RepathHairMashups) is unported — it needs " +
          "the live Dawntrail game index; see " +
          "docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md",
      );
    }
    return; // (:354)
  }

  // Stage 3 — resolution (:358-376). NO both/neither guard here (unlike stage 2): every
  // (badOption, pair) is processed. o.files is read LIVE and mutated by the staple, so a later
  // pair sees an earlier staple.
  for (const o of badOptions) {
    for (const pair of mData) {
      const hasMask = o.files.has(pair.mask); // (:362)
      const missingTex = hasMask ? pair.normal : pair.mask; // (:365)
      const container = containers.get(missingTex);
      if (container === undefined) {
        // C# Dictionary indexer on an absent key throws KeyNotFoundException (:367): the missing
        // texture is in no option at all (e.g. a base-game texture) — unresolvable.
        throw new Error(
          `resolve-highlight: missing hair texture is in no option (KeyNotFound): ${missingTex}`,
        );
      }
      if (container.length !== 1) {
        throw new Error(
          // InvalidDataException (:369) — the case every real throwing corpus mod hits.
          "Cannot upgrade modpack - Highlight/Visibility options are unresolveable either due to " +
            "missing files or too much complexity.\nTry installing the modpack and creating an " +
            "updated pack from the desired options.",
        );
      }
      const src = container[0]!.files.get(missingTex)!; // Files[missingTex] indexer (:373)
      if (o.files.has(missingTex)) {
        // C# Dictionary.Add throws on a duplicate key (:374); Map.set would silently overwrite.
        throw new Error(`resolve-highlight: duplicate staple key: ${missingTex}`);
      }
      o.files.set(missingTex, { ...src }); // staple the pointer, sharing bytes (:374)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run test/upgrade/resolve-highlight.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Gate + commit**

Run: `npm run check; npm run typecheck`

```powershell
git add src/upgrade/resolve-highlight.ts test/upgrade/resolve-highlight.test.ts
git commit -m "feat(upgrade): port ResolveHighlightOptionsAndMashupHair highlight-resolution pre-round"
```

---

## Task 3: Wire the pre-round into `upgradeModpack`

**Files:**
- Modify: `src/upgrade/upgrade.ts` (import + one call after `cloneModpack`)

**Interfaces:**
- Consumes: `resolveHighlightOptionsAndMashupHair` (Task 2).

- [ ] **Step 1: Add the import**

In `src/upgrade/upgrade.ts`, add to the import block:

```ts
import { resolveHighlightOptionsAndMashupHair } from "./resolve-highlight";
```

- [ ] **Step 2: Call it in `upgradeModpack`**

In `upgradeModpack`, immediately after `const out = cloneModpack(data);` and before the pass-1 comment/loop, insert:

```ts
  // Pre-round (ModpackUpgrader.cs:83): resolve split Hair-shader highlight/visibility options
  // BEFORE round 1, ungated by includePartials. Its throws propagate out of upgradeModpack — the
  // C# pre-round sits outside the per-option try/catch that wraps round 1 (:97-116).
  resolveHighlightOptionsAndMashupHair(out);
```

- [ ] **Step 3: Add an end-to-end unit test**

Append to `test/upgrade/resolve-highlight.test.ts` a describe block driving `upgradeModpack` directly (import it from `../../src/index`) to prove the seam:

```ts
import { upgradeModpack } from "../../src/index";

describe("upgradeModpack pre-round wiring", () => {
  it("staples split hair textures during the pre-round before other rounds run", () => {
    const a = option("Has Normal", [
      [HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)],
      [N, tex(1)],
    ]);
    const b = option("Has Mask", [[M, tex(2)]]);
    const out = upgradeModpack(pack([a, b]));
    expect(out.groups[0]!.options[0]!.files.has(M)).toBe(true);
    expect(out.groups[0]!.options[1]!.files.has(N)).toBe(true);
  });
});
```

- [ ] **Step 4: Run the targeted test + the corpus upgrade suite for regressions**

Run: `npx vitest run test/upgrade/resolve-highlight.test.ts`
Expected: PASS.

Run the full suite to confirm the 3 corpus hair packs (`Misty_Hairstyle_Female`, `[DVNO] Desert Years`, `[Jaque] Marcellus`) still no-op through the pre-round and nothing regresses:

Run: `npm test`
Expected: PASS, no new `upgrade` regressions. (If a corpus pack newly throws, STOP — that is a reachability finding contradicting §1.1; investigate before proceeding.)

- [ ] **Step 5: Gate + commit**

Run: `npm run check; npm run typecheck`

```powershell
git add src/upgrade/upgrade.ts test/upgrade/resolve-highlight.test.ts
git commit -m "feat(upgrade): run the highlight-resolution pre-round before round 1"
```

---

## Task 4: Add `{ kind: "error" }` to the `/upgrade` golden cache

**Files:**
- Modify: `test/helpers/upgrade-golden.ts`
- Create: `test/helpers/upgrade-golden.test.ts`

**Interfaces:**
- Produces: `GoldenResult` gains `| { kind: "error"; message: string }`; `upgradeGoldenCached` catches a ConsoleTools process throw and caches a `<key>.error` marker.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/upgrade-golden.test.ts`, mirroring `resave-golden.test.ts` (the `produce` injection seam; never spawns ConsoleTools). Include the robustness guards the `/resave` side has: only a process-shaped error with non-empty output is cached; a plain error and an empty-output (lock-race) error both propagate.

```ts
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { oracleKey } from "./oracle";
import { upgradeGoldenCached } from "./upgrade-golden";

function processError(message: string, stderr = message): Error {
  return Object.assign(new Error(message), { status: -1, signal: null, stderr });
}

describe("upgradeGoldenCached — error marker", () => {
  it("caches a process throw with output as { kind: 'error' } and does not re-invoke the producer", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([1, 2, 3]);
    let calls = 0;
    const produce = (): Uint8Array | null => {
      calls++;
      throw processError("Highlight/Visibility options are unresolveable");
    };
    const first = upgradeGoldenCached("m.pmp", input, { dir, available: true, produce });
    expect(first?.kind).toBe("error");
    expect(first).toMatchObject({ message: expect.stringContaining("unresolveable") });
    expect(calls).toBe(1);
    const second = upgradeGoldenCached("m.pmp", input, { dir, available: true, produce });
    expect(second?.kind).toBe("error");
    expect(calls).toBe(1);
  });

  it("propagates a non-process error (no status/signal) instead of caching it", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([42]);
    const produce = (): Uint8Array | null => {
      throw new Error("ENOENT: our own bug");
    };
    expect(() =>
      upgradeGoldenCached("m.pmp", input, { dir, available: true, produce }),
    ).toThrow(/our own bug/);
    const key = oracleKey(input);
    expect(existsSync(join(dir, `${key}.error`))).toBe(false);
  });

  it("does not cache a process error with EMPTY output (lock-race signature) — propagates instead", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([7]);
    const produce = (): Uint8Array | null => {
      throw Object.assign(new Error("Command failed"), {
        status: -1,
        signal: null,
        stdout: "",
        stderr: "",
      });
    };
    expect(() =>
      upgradeGoldenCached("m.pmp", input, { dir, available: true, produce }),
    ).toThrow(/Command failed/);
    const key = oracleKey(input);
    expect(existsSync(join(dir, `${key}.error`))).toBe(false);
  });

  it("still returns pack / noop unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const noop = upgradeGoldenCached("m.pmp", new Uint8Array([9]), {
      dir,
      available: true,
      produce: () => null,
    });
    expect(noop?.kind).toBe("noop");
  });

  it("does not leave a .bin behind on the error path", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([1]);
    upgradeGoldenCached("m.pmp", input, {
      dir,
      available: true,
      produce: () => {
        throw processError("boom");
      },
    });
    const key = oracleKey(input);
    expect(readdirSync(dir).some((f) => f === `${key}.bin`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/helpers/upgrade-golden.test.ts`
Expected: FAIL — the error path is not implemented (a throw propagates; no marker).

- [ ] **Step 3: Implement the error kind + guards**

Edit `test/helpers/upgrade-golden.ts`. Copy the three helper functions `describeProduceError`, `processOutputText`, and `isConsoleToolsProcessError` **verbatim** from `test/helpers/resave-golden.ts:62-115` (they cite their own reasoning; keep the comments). Then:

Extend the result type:
```ts
export type GoldenResult =
  | { kind: "pack"; data: ModpackData; bytes: Uint8Array }
  | { kind: "noop" }
  | { kind: "error"; message: string };
```

Add an error-marker path helper next to `noopMarker`:
```ts
/** Marker recording that ConsoleTools /upgrade ERRORED on this input (content-addressed, like the
 * `.noop` marker). Stores the error text for later loud reporting. Mirrors resave-golden.ts. */
function errorMarker(key: string, dir: string): string {
  return join(dir, `${key}.error`);
}
```

In `upgradeGoldenCached`, at the top of the cache checks (before the `.noop` check), add:
```ts
  const errPath = errorMarker(key, dir);
  if (existsSync(errPath)) {
    return { kind: "error", message: readFileSync(errPath, "utf8") };
  }
```

Wrap the `produce` call in try/catch (replacing the current `const out = produce(name, bytes); if (out === null) {...}` block):
```ts
  const produce = opts.produce ?? upgradeViaConsoleTools;
  let out: Uint8Array | null;
  try {
    out = produce(name, bytes);
  } catch (err) {
    // Only a genuine ConsoleTools PROCESS failure (execFileSync's non-zero-exit / signal-kill
    // error) may be cached as "the oracle errors on this pack" — see isConsoleToolsProcessError.
    // Anything else is a bug in THIS harness and must propagate. An empty-output process error is
    // oracle.ts's residual lock-race signature; propagate and let a re-run clear it. (Mirrors
    // resave-golden.ts.)
    if (!isConsoleToolsProcessError(err)) throw err;
    if (processOutputText(err).trim().length === 0) throw err;
    const message = describeProduceError(err);
    mkdirSync(dir, { recursive: true });
    writeFileSync(errPath, message);
    return { kind: "error", message };
  }
  if (out === null) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(noopMarker(key, dir), new Uint8Array(0));
    return { kind: "noop" };
  }
```

Ensure `readFileSync` is imported (it already is). Add `mkdirSync` if not already imported (it is).

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run test/helpers/upgrade-golden.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

Run: `npm run check; npm run typecheck`

```powershell
git add test/helpers/upgrade-golden.ts test/helpers/upgrade-golden.test.ts
git commit -m "feat(test): cache ConsoleTools /upgrade oracle errors as { kind: 'error' } markers"
```

---

## Task 5: `corpus-upgrade.ts` error branch (match→pass / mismatch→fail)

**Files:**
- Modify: `test/helpers/corpus-upgrade.ts`

**Interfaces:**
- Consumes: `GoldenResult`'s `error` kind (Task 4).

- [ ] **Step 1: Restructure the check to fetch the golden before running our upgrade**

In `registerUpgradeCheck`'s `it(...)` body, replace lines 27-43 (the `const source = ...` through the `reference`/`goldenBytes` derivation) so the golden is fetched first and the error kind is handled before our upgrade runs. Replace:

```ts
      const bytes = new Uint8Array(readFileSync(pack));
      const source = loadModpack(name, bytes);
      const oursModel = upgradeModpack(source);
      const golden = upgradeGoldenCached(name, bytes);
      if (golden === null) {
        throw new Error(
          `No /upgrade golden for ${name}: uncached and no oracle (TexTools) available. ` +
            `Run with ConsoleTools installed to populate test/corpus/.upgrade-cache.`,
        );
      }
```

with:

```ts
      const bytes = new Uint8Array(readFileSync(pack));
      const source = loadModpack(name, bytes);
      const golden = upgradeGoldenCached(name, bytes);
      if (golden === null) {
        throw new Error(
          `No /upgrade golden for ${name}: uncached and no oracle (TexTools) available. ` +
            `Run with ConsoleTools installed to populate test/corpus/.upgrade-cache.`,
        );
      }
      // The oracle itself errored on this pack (e.g. ModpackUpgrader's Highlight/Visibility
      // "unresolveable" throw). A MATCHED failure is a PASS: our port must refuse exactly the packs
      // TexTools refuses. Our upgrade SUCCEEDING here is a divergence -> loud fail. (Deliberately
      // unlike corpus-resave.ts's loud-skip: a /resave oracle error is environmental — a TexTools
      // CMP-read crash unrelated to our port — whereas a /upgrade oracle error is transform logic
      // our port is expected to reproduce. See spec §3 + docs/backlog/2026-07-11-....)
      if (golden.kind === "error") {
        let ourError: unknown;
        try {
          upgradeModpack(source);
        } catch (e) {
          ourError = e;
        }
        if (ourError === undefined) {
          expect.fail(
            `${name}: ConsoleTools /upgrade errored but our upgrade SUCCEEDED — divergence.\n` +
              `Oracle error was:\n${golden.message}`,
          );
        }
        console.log(
          `[upgrade] ${name}: matched expected failure (oracle + our port both error).`,
        );
        return;
      }
      const oursModel = upgradeModpack(source);
```

Leave the rest (`reference`/`goldenBytes` derivation onward) unchanged — but note it now only runs for `pack` | `noop`, so the `golden.kind === "noop"` ternaries still type-check.

- [ ] **Step 2: Confirm the change type-checks and the existing corpus still passes**

Run: `npm run typecheck`
Expected: clean (the `error` kind is handled and returns before the `pack`/`noop`-only code).

Run: `npm test`
Expected: PASS. No corpus pack currently produces an oracle error (Task 7 adds the first), so behaviour is unchanged for every existing pack.

- [ ] **Step 3: Commit**

Run: `npm run check`

```powershell
git add test/helpers/corpus-upgrade.ts
git commit -m "feat(test): treat a matched /upgrade oracle failure as a pass, a mismatch as a fail"
```

---

## Task 6: Synthetic clean-staple golden

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-highlight.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`

**Interfaces:**
- Consumes: `writePmp`, `syntheticMeta`, `EMPTY_DEFAULT_MOD` from `pmp-builder.ts`; `PmpGroupJsonRaw` from `src/container/manifest-types`; the sample hair mtrl + `dx11Path`/`parseMtrl`/`ESamplerId`.

- [ ] **Step 1: Write the builder**

Create `scripts/generate-synthetics/build-synthetic-highlight.ts`. It emits a two-option Single-select group: option "With Highlights" holds the hair `.mtrl` + its normal texture; option "Base" holds only its mask texture. The pre-round staples each option's missing texture from the other. The mtrl is the bundled `_SampleHair` (already-Dawntrail: `doesMtrlNeedDawntrailUpdate` is false), so no later round touches the files and the golden is input-plus-staples.

```ts
// Builds test/corpus/synthetic/highlight.pmp: a wizard PMP with one Single-select group whose two
// options SPLIT a Hair-shader (hair.shpk) normal/mask pair — "With Highlights" carries the material
// + its normal texture, "Base" carries only the mask. This is the clean-staple case of
// ResolveHighlightOptionsAndMashupHair (ModpackUpgrader.cs:267-377): each option's missing texture
// is held by exactly one container, so the pre-round staples the copy in. No REAL corpus mod reaches
// a clean staple (all 18 that reach the branch throw — spec §1.1), so this synthetic is the only
// byte-exact AB-test of the happy path.
//
// The material is the bundled _SampleHair mtrl (src/upgrade/reference/hair-materials.ts), which is
// already-Dawntrail — doesMtrlNeedDawntrailUpdate is false — so the material/texture rounds leave it
// and the stapled textures untouched, isolating the golden to the staple. Gitignored like the real
// corpus; regenerate with `npm run synthetics` or
// `npx tsx scripts/generate-synthetics/build-synthetic-highlight.ts`.
import { buildCanonicalTexHeader } from "../../src/tex/header";
import { dx11Path } from "../../src/mtrl/dx11-path";
import { parseMtrl } from "../../src/mtrl/mtrl";
import { ESamplerId } from "../../src/mtrl/shader";
import { A8R8G8B8 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";
import { SAMPLE_HAIR_MTRL_BASE64 } from "../../src/upgrade/reference/hair-materials";
import type { PmpGroupJsonRaw } from "../../src/container/manifest-types";
import { EMPTY_DEFAULT_MOD, syntheticMeta, writePmp } from "./pmp-builder";

const MTRL_PATH =
  "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl";
const MTRL_BYTES = new Uint8Array(Buffer.from(SAMPLE_HAIR_MTRL_BASE64, "base64"));

// Derive the material's real normal/mask sampler paths so the split textures match what the
// pre-round rips from the mtrl.
const sample = parseMtrl(MTRL_BYTES, MTRL_PATH);
const normalTex = sample.textures.find(
  (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerNormal,
);
const maskTex = sample.textures.find(
  (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerMask,
);
if (!normalTex || !maskTex) {
  throw new Error("sample hair mtrl is missing a normal or mask sampler");
}
const N = dx11Path(normalTex);
const M = dx11Path(maskTex);

/** A valid 8x8 A8R8G8B8 single-mip .tex, distinct per seed. */
function tex(seed: number): Uint8Array {
  const header = buildCanonicalTexHeader(A8R8G8B8, 8, 8, 1);
  const pixels = new Uint8Array(8 * 8 * 4).map((_, i) => (i * 7 + seed) & 0xff);
  return concatBytes([header, pixels]);
}

// zip path (forward slash) -> bytes.
const files: Record<string, Uint8Array> = {
  "files/mtrl.mtrl": MTRL_BYTES,
  "files/normal.tex": tex(1),
  "files/mask.tex": tex(2),
};

const group: PmpGroupJsonRaw = {
  Version: 0,
  Name: "Highlights",
  Description: "",
  Image: "",
  Page: 0,
  Priority: 0,
  Type: "Single",
  DefaultSettings: 0,
  Options: [
    {
      Name: "With Highlights",
      Description: "",
      Image: "",
      Files: { [MTRL_PATH]: "files/mtrl.mtrl", [N]: "files/normal.tex" },
      FileSwaps: {},
      Manipulations: [],
    },
    {
      Name: "Base",
      Description: "",
      Image: "",
      Files: { [M]: "files/mask.tex" },
      FileSwaps: {},
      Manipulations: [],
    },
  ],
};

writePmp("highlight.pmp", {
  meta: syntheticMeta("Highlight Split Hair"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: { "group_001_highlights.json": group },
  files,
});
```

- [ ] **Step 2: Register in build-all**

Add to `scripts/generate-synthetics/build-all.ts` (after the `build-synthetic-eye-mask` import):

```ts
import "./build-synthetic-highlight";
```

- [ ] **Step 3: Build the synthetic and verify the pre-round staples it**

Run: `npx tsx scripts/generate-synthetics/build-synthetic-highlight.ts`
Expected: `wrote ...\test\corpus\synthetic\highlight.pmp`.

Verify our pipeline staples cleanly with a one-off check (scratchpad, delete after):

```powershell
npx tsx -e "import {readFileSync} from 'node:fs'; import {loadModpack, upgradeModpack} from './src/index.ts'; const p='test/corpus/synthetic/highlight.pmp'; const d=upgradeModpack(loadModpack(p,new Uint8Array(readFileSync(p)))); for(const o of d.groups[0].options){console.log(o.name,[...o.files.keys()].length,'files')}"
```
Expected: both options report the SAME file counts covering both textures (staple succeeded, no throw). If it throws, STOP — the sample mtrl assumptions are wrong; investigate before continuing.

- [ ] **Step 4: Run the corpus suite so ConsoleTools produces the golden and it matches**

Run: `npm test`
Expected: the new `upgrade golden: highlight.pmp` unit PASSES. First run spawns ConsoleTools once (populating `.upgrade-cache`); the byte diff must be empty (or, if a narrow divergence appears, it is a finding — investigate; the design targets byte-exact). If the pack has no baseline yet and does not fully match, bless is NOT the fix — understand the diff first.

- [ ] **Step 5: Commit**

Run: `npm run check; npm run typecheck`

```powershell
git add scripts/generate-synthetics/build-synthetic-highlight.ts scripts/generate-synthetics/build-all.ts
git commit -m "test(synthetic): add clean-staple highlight-split hair golden"
```

---

## Task 7: Add the real throwing mod + verify the matched failure

**Files:**
- Add (gitignored, local): `test/corpus/real/[Inako] Lilith Wish.pmp`

- [ ] **Step 1: Copy the mod into the corpus**

Run:
```powershell
Copy-Item "C:\Users\user\Documents\XIVModOriginals\[Inako] Lilith Wish\[Inako] Lilith Wish.pmp" "test\corpus\real\[Inako] Lilith Wish.pmp"
```

- [ ] **Step 2: Run the suite — verify the matched failure PASSES**

Run: `npm test`
Expected: the `upgrade golden: [Inako] Lilith Wish.pmp` unit PASSES with the log line
`matched expected failure (oracle + our port both error).` This requires:
- ConsoleTools `/upgrade` **errors** on the pack (cached as a `<sha>.error` marker), AND
- our `upgradeModpack` **throws** the `InvalidDataException`-style error.

**If ConsoleTools does NOT error** (produces a golden instead): the reachability replication mispredicted this pack. STOP and investigate — re-examine the stage-3 loop against `ModpackUpgrader.cs:358-376` and the pack's actual hair pairs; the fix may reshape the port. Do not force it.

**If ConsoleTools errors but our port SUCCEEDS:** the check fails loud (by design) — our stage-3 logic diverges from C#; debug against the reference before proceeding.

- [ ] **Step 3: Commit (source/tests only — the mod is gitignored)**

There is nothing to `git add` for the mod (it is under the gitignored `test/corpus/real/`). Confirm:

Run: `git status`
Expected: `test/corpus/real/[Inako] Lilith Wish.pmp` does NOT appear (gitignored). If it does, STOP — do not commit third-party mod bytes; verify `.gitignore` covers `test/corpus/real/`.

No commit in this task (proof-only; the harness caches the `.error` marker locally).

---

## Task 8: Backlog updates + final gate

**Files:**
- Modify: `docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md` (narrow to `RepathHairMashups`)
- Delete: `docs/backlog/2026-07-11-expected-failure-golden.md`
- Modify: `docs/BACKLOG.md` (re-word #1; drop the `2026-07-11` entry)

- [ ] **Step 1: Grep for references before touching the backlog files**

Run: `npx rg -n "2026-07-11-expected-failure-golden" src test scripts docs`
Expected: only `docs/BACKLOG.md` and the item file itself reference it. If a `resave-golden.ts` comment cites it, LEAVE that citation (the `/resave` half legitimately references the history) — re-point it to the spec if it would dangle. Confirm no source guard depends on it.

Run: `npx rg -n "2026-07-15-resolve-highlight-mashup-hair-preround" src test scripts docs`
Expected: `docs/BACKLOG.md`, the item file, plus the new `src/upgrade/resolve-highlight.ts` throw comment (which must survive — it points at the narrowed item).

- [ ] **Step 2: Narrow the `2026-07-15` item**

Rewrite `docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md` so it describes ONLY the deferred `RepathHairMashups` half: update the title (drop "Investigate & port"), state the highlight-resolution half shipped 2026-07-17 (cite the spec + `src/upgrade/resolve-highlight.ts`), and keep the `RepathHairMashups` description (`:379-482`), its live-game-index dependency, and "First steps" §3 as the remaining work. Remove the (now-done) §1-§2 "First steps" and the shipped-half description.

- [ ] **Step 3: Delete the `2026-07-11` item and its index entry**

Run: `git rm docs/backlog/2026-07-11-expected-failure-golden.md`

In `docs/BACKLOG.md`, remove the bullet under "Harness & housekeeping" linking `2026-07-11-expected-failure-golden.md`.

- [ ] **Step 4: Re-word BACKLOG.md item #1**

In the "Prioritized" section of `docs/BACKLOG.md`, rewrite item #1 so it reflects that the highlight-resolution half shipped and only `RepathHairMashups` remains (still needing the live DT index), still linking `backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md`.

- [ ] **Step 5: Full gate**

Run: `npm run check`
Run: `npm run typecheck`
Run: `npm test`
Expected: all green; `resolve-highlight.test.ts`, `dx11-path.test.ts`, `upgrade-golden.test.ts` pass; `highlight.pmp` golden matches byte-exact; `[Inako] Lilith Wish.pmp` reports a matched expected failure; no regressions.

- [ ] **Step 6: Commit**

```powershell
git add docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md docs/BACKLOG.md
git commit -m "docs(backlog): narrow the pre-round item to RepathHairMashups; retire the expected-failure-golden item"
```

---

## Task 9: Delete the plan, open the PR

- [ ] **Step 1: Delete this plan from the branch**

Per AGENTS.md, a completed plan is deleted on the branch before the PR (the durable spec stays).

Run: `git rm docs/superpowers/plans/2026-07-17-resolve-highlight-preround.md`
```powershell
git commit -m "chore: remove completed implementation plan"
```

- [ ] **Step 2: Push and open the PR**

Run: `git push -u origin <branch>` then open a PR to `main` summarizing: the pre-round port (highlight-resolution half; `RepathHairMashups` deferred), the `/upgrade` expected-failure golden capability with match-failure=pass semantics, the synthetic clean-staple golden, and the real throwing corpus mod. Link the spec.

---

## Self-Review

**Spec coverage:**
- §2.1 dx11Path extraction → Task 1. ✓
- §2.2 resolve-highlight module (3 stages) → Task 2. ✓
- §2.3 deferred RepathHairMashups throw → Task 2 (stage-3 branch). ✓
- §2.4 fidelity points (unguarded sampler, live mutation, two throws, Add-duplicate, dead set) → Task 2 code + comments. ✓
- §2.5 wiring → Task 3. ✓
- §3 Part B (error kind + marker + guards; corpus-upgrade match→pass/mismatch→fail; unit tests) → Tasks 4, 5. ✓
- §4 proof: unit tests (Tasks 2, 3), synthetic golden (Task 6), real corpus add (Task 7), no-regression (Tasks 3, 8). ✓
- §5 out-of-scope: RepathHairMashups deferred, one real mod only → Tasks 2, 7. ✓
- Backlog narrowing/deletion (§ header + §6) → Task 8. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command has an expected result. ✓

**Type consistency:** `resolveHighlightOptionsAndMashupHair(data: ModpackData): void` used identically in Tasks 2, 3. `GoldenResult` error kind added in Task 4, consumed in Task 5. `dx11Path(tex: MtrlTexture): string` produced in Task 1, consumed in Tasks 2, 6. `findSamplerUnguarded` returns `MtrlTexture | undefined`. ✓

**Note carried into execution:** Task 7's ConsoleTools verdict is the real check on the reachability replication (which used a guarded sampler lookup and a spurious stage-3 guard). A mismatch there is a finding, not a nuisance — handle per the STOP instructions.
