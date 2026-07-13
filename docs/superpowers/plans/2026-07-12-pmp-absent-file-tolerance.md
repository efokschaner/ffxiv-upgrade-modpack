# PMP absent-file tolerance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load a PMP whose `Files` map names a payload the archive never contained, the way TexTools
does — keep the entry with no bytes, skip or throw at each read seam exactly as the C# call site
does, and drop the file from both the zip and the `Files` map on write.

**Architecture:** `ModpackFile.data` becomes optional — an absent entry is the analogue of a
`FileStorageInformation` whose `RealPath` points nowhere (`PMP.cs:1071-1102`). `uncompressedBytes`
becomes the port of `EndwalkerUpgrade.ResolveFile` (`:1758`), returning `null`; each round then
mirrors its own C# call site, including two that throw. `writePmp` ports the writer's drop
(`PMP.cs:883-888`). The golden harness gains one tightly-scoped manifest confirmation so a noop
pack — whose reference is its own input, which still lists the dangling key — still compares.

**Tech Stack:** TypeScript (strict), Vitest via a custom parallel runner, Biome, fflate.

**Spec:** `docs/superpowers/specs/2026-07-12-pmp-absent-file-tolerance-design.md` — read it first;
its §2 table is the behavioural spec and is reproduced in Task 2.

## Global Constraints

- **Byte-parity with ConsoleTools `/upgrade` is the definition of correct.** Reproduce TexTools'
  behaviour, including its bugs. Do not "fix" anything.
- **Every line of business logic cites its C# provenance** (`file · symbol · lines`) in a comment.
  `reference/` is read-only.
- **Fail loud over silently diverging.** A path we cannot reproduce faithfully throws.
- **Formatting is mechanical** — Biome owns it. Run `npm run check`; never hand-format.
- **End-of-task ritual (required, every task):** `npm run check`, `npm run typecheck`, `npm test` —
  all green before the task is done.
- Single test file while iterating: `npx vitest run <path>`. Full suite: `npm test`.
- `test/corpus/**` and `local-notes/**` are gitignored; never `git add -f` them.

---

### Task 1: Model + loader tolerance + writer drop

Makes `data` optional, stops `readPmp` throwing, and ports the writer's drop. The upgrade rounds
still fail loud on an absent file at this point (Task 2 replaces that with the per-seam table) — a
deliberate intermediate: the load is tolerant, the pipeline is not yet.

**Files:**
- Modify: `src/model/modpack.ts:23-29` (the `ModpackFile` interface)
- Modify: `src/container/pmp.ts:36-42` (export `windowsPathKey`), `:44-77` (`optionFromJson`),
  `:195-216` (`optionToJson`), `:274-277` (payload emit)
- Modify: `src/upgrade/upgrade.ts:66-72` (`uncompressedBytes`)
- Modify: `src/upgrade/texfix.ts:64-74` (compile guard)
- Modify: `src/container/ttmp2.ts:135-146` (`buildBlob` fail-loud)
- Test: `test/container/pmp-read.test.ts`, `test/container/pmp-write.test.ts` (new)

**Interfaces:**
- Produces: `ModpackFile.data?: Uint8Array` — absent ⇒ the archive had no such member.
- Produces: `export function windowsPathKey(path: string): string` from `src/container/pmp.ts`
  (Task 3 imports it).
- Produces: `uncompressedBytes(f: ModpackFile): Decoded` still — unchanged signature this task; it
  throws on an absent file. Task 2 changes it to return `Decoded | null`.

- [ ] **Step 1: Write the failing loader test**

Append to `test/container/pmp-read.test.ts`. Note it **replaces** the existing
`"throws when no archive entry matches under any casing"` test (`:86-114`) — that assertion is the
behaviour we are deliberately retiring; delete it and put this in its place, inside the same
`describe("readPmp case-insensitive Files resolution")` block:

```ts
  // A Files value naming a path the archive genuinely does not contain (under ANY Windows
  // normalization) is TOLERATED, not fatal: LoadPMP does no existence check (PMP.cs:124) and
  // UnpackPmpOption builds a FileStorageInformation whose RealPath simply does not exist
  // (PMP.cs:1071-1102). The entry STAYS in the option — the upgrade rounds gate on
  // files.ContainsKey (EndwalkerUpgrade.cs:1840/:1852/:1867), which is true for it.
  it("tolerates a Files value absent from the archive: entry kept, no bytes", () => {
    const gamePath =
      "chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl";
    const meta = {
      FileVersion: 3,
      Name: "Absent",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    // Files references files/missing.mtrl, which is present under NO casing.
    const defaultMod = {
      Version: 0,
      Files: { [gamePath]: "files\\missing.mtrl" },
      FileSwaps: {},
      Manipulations: [],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
    ]);

    const data = readPmp(writeZip(entries));
    const f = allFiles(data).find((x) => x.gamePath === gamePath);
    expect(f).toBeDefined();
    expect(f!.data).toBeUndefined();
    expect(f!.pmpPath).toBe("files/missing.mtrl");
    expect(f!.storage).toBe(FileStorageType.RawUncompressed);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/container/pmp-read.test.ts`
Expected: FAIL — `pmp: missing file entry files/missing.mtrl` is thrown from `readPmp`.

- [ ] **Step 3: Make `data` optional**

In `src/model/modpack.ts`, change the `data` field of `ModpackFile`:

```ts
export interface ModpackFile {
  gamePath: string; // internal game path, forward slashes
  /** OPAQUE payload: an SQPack blob (ttmp) or a raw file (pmp).
   *  ABSENT (undefined) when the PMP's `Files` map named a zip member the archive does not
   *  contain — TexTools' analogue is a FileStorageInformation whose RealPath does not exist
   *  (PMP.cs:1071-1102, after a LoadPMP that never checks existence, PMP.cs:124). The entry is
   *  still a member of the option: the upgrade rounds gate on files.ContainsKey
   *  (EndwalkerUpgrade.cs:1840/:1852/:1867), which is true for it. We do NOT substitute empty
   *  bytes — an empty buffer would decode-fail inside a codec instead of being skipped. */
  data?: Uint8Array;
  storage: FileStorageType;
  ttmp?: TtmpFileMeta; // present iff sourced from a TTMP container
  pmpPath?: string; // original PMP zip path (forward slashes) iff sourced from PMP
}
```

- [ ] **Step 4: Tolerate the absent entry in `readPmp`, and export the key function**

In `src/container/pmp.ts`, export `windowsPathKey` (add the `export` keyword to the existing
declaration at `:36` — leave its comment intact, it already carries the provenance):

```ts
export function windowsPathKey(path: string): string {
```

Then replace the throw in `optionFromJson` (`:56-57`):

```ts
    // Windows-filesystem-equivalent resolution. Penumbra lowercases the Files value and may keep a
    // trailing dot/space on a folder segment that the archive/NTFS name drops; TexTools reads
    // Path.Combine(unzipPath, file.Value) from the unzipped folder (PMP.cs:1080) after a LoadPMP
    // that never verifies existence (PMP.cs:124). Look up the windowsPathKey; pmpPath keeps the
    // manifest value verbatim so the writer/golden are unaffected.
    //
    // A miss is NOT an error: the file is genuinely not packed. TexTools tolerates that at load —
    // UnpackPmpOption still adds the entry, with a RealPath that does not exist (PMP.cs:1071-1102)
    // — and defers the consequences to each read seam (ResolveFile, EndwalkerUpgrade.cs:1758) and
    // to the writer, which drops it (PMP.cs:883-888). So we emit the file with NO bytes.
    const data = filesByKey.get(windowsPathKey(zipPath));
    return {
      gamePath,
      data,
      storage: FileStorageType.RawUncompressed,
      pmpPath: zipPath,
    };
```

- [ ] **Step 5: Run the loader test**

Run: `npx vitest run test/container/pmp-read.test.ts`
Expected: PASS (all cases in the file).

`npm run typecheck` will now FAIL in four places — that is the point of the optional type. Steps 6-8
resolve each one with its faithful behaviour.

- [ ] **Step 6: Fail loud in the two consumers that can never legitimately see an absent file**

`src/upgrade/upgrade.ts` — `uncompressedBytes` (`:66-72`). This is a temporary throw; Task 2 turns
it into the `ResolveFile` port. Keep the signature:

```ts
export function uncompressedBytes(f: ModpackFile): Decoded {
  if (!f.data) {
    // TODO(Task 2): port ResolveFile (EndwalkerUpgrade.cs:1758) — return null and let each round
    // skip or throw per its own C# call site. Throwing here is the interim fail-loud state.
    throw new Error(`upgrade: file has no bytes: ${f.gamePath}`);
  }
  if (f.storage === FileStorageType.SqPackCompressed) {
    const d = decodeSqPackFile(f.data);
    return { bytes: d.data, type: d.type };
  }
  return { bytes: f.data };
}
```

`src/container/ttmp2.ts` — in `buildBlob`, before the dedup key is taken (currently `:137`), add:

```ts
    if (!f.data) {
      // Unreachable: absent files are PMP-only (they come from a PMP `Files` value with no zip
      // member) and /upgrade never converts formats. TTMP's own importer skips such files
      // (TTMP.cs:1067), but we have no golden for a TTMP *write* of one, so we fail loud rather
      // than guess. See the absent-file design spec §3.4.
      throw new Error(
        `ttmp2: cannot write a file with no bytes: ${f.gamePath}`,
      );
    }
```

- [ ] **Step 7: Guard `texFixRound`**

`src/upgrade/texfix.ts`, inside the `option.files.filter` (after the existing storage check at
`:67`):

```ts
        if (f.storage !== FileStorageType.SqPackCompressed) return true;
        // Absent files are PMP-only and PMP never needs the tex fix (needsTexFix), so the storage
        // gate above already excludes them; this keeps the types honest without inventing bytes.
        if (!f.data) return true;
```

- [ ] **Step 8: Port the writer's drop (`PMP.cs:883-888`)**

`src/container/pmp.ts`. First, the payload emit loop (`:274-277`):

```ts
  for (const f of allFiles(data)) {
    if (!f.data) continue; // absent: no member AND no Files key (PMP.cs:883-888) — see optionToJson
    const zipPath = (f.pmpPath ?? f.gamePath).replace(/\\/g, "/");
    if (!entries.has(zipPath)) entries.set(zipPath, f.data);
  }
```

Then the manifest half. Add above `optionToJson` (`:195`):

```ts
/** Port of the absent-file drop in PopulatePmpStandardOption (PMP.cs:883-888): a file whose
 *  RealPath does not exist is skipped by `continue`, which bypasses BOTH File.WriteAllBytes (:910)
 *  AND opt.Files.Add (:914) — so the written pack carries neither the payload member nor the
 *  `Files` key. ("Sometimes poorly behaved penumbra folders don't actually have the files they
 *  claim they do. Remove them in this case.") We re-emit the source option JSON verbatim, so the
 *  key has to be pruned out of a COPY of it; the map is keyed by gamePath, so the pruning is exact.
 *  Returns `raw` itself when nothing is absent, keeping the common path byte-for-byte verbatim. */
function pruneAbsentFiles(
  o: ModpackOption,
  raw: PmpOptionJsonRaw,
): PmpOptionJsonRaw {
  const absent = new Set(
    o.files.filter((f) => !f.data).map((f) => f.gamePath),
  );
  if (absent.size === 0) return raw;
  const files = raw.Files;
  if (!isObj(files)) return raw;
  return {
    ...raw,
    // Object.entries preserves insertion order, so the surviving keys keep their original
    // order — the emitted JSON bytes are unchanged apart from the dropped keys.
    Files: Object.fromEntries(
      Object.entries(files).filter(([gamePath]) => !absent.has(gamePath)),
    ),
  };
}
```

and use it in both branches of `optionToJson`:

```ts
function optionToJson(
  o: ModpackOption,
  includeMeta: boolean,
): PmpOptionJsonRaw {
  if (isObj(o.raw)) return pruneAbsentFiles(o, o.raw as PmpOptionJsonRaw);
  const Files: Record<string, string> = {};
  for (const f of o.files) {
    if (!f.data) continue; // absent -> no Files key (PMP.cs:883-888)
    const zip = f.pmpPath ?? f.gamePath; // forward slashes (zip entry name)
    Files[f.gamePath] = zip.replace(/\//g, "\\"); // backslashes in JSON value
  }
  // ... rest unchanged
```

Note `PmpOptionJsonRaw` declares `Files?: Record<string, string>` — if `isObj(files)` narrows
awkwardly, cast at the `Object.entries` call rather than loosening the type.

- [ ] **Step 9: Write the writer test**

Create `test/container/pmp-write.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readPmp, writePmp } from "../../src/container/pmp";
import { readZip, writeZip } from "../../src/zip/zip";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("writePmp absent-file drop (PMP.cs:883-888)", () => {
  // TexTools' writer skips a file whose RealPath does not exist, which bypasses BOTH the payload
  // write (:910) and opt.Files.Add (:914). The written pack therefore has neither.
  function buildPmp(): Uint8Array {
    const present = "chara/equipment/e0001/model/c0101e0001_top.mdl";
    const absent = "chara/equipment/e0002/model/c0101e0002_top.mdl";
    const meta = {
      FileVersion: 3,
      Name: "Drop",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = {
      Version: 0,
      Files: {
        [present]: `on\\${present.replace(/\//g, "\\")}`,
        [absent]: `on\\${absent.replace(/\//g, "\\")}`,
      },
      FileSwaps: {},
      Manipulations: [],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
      [`on/${present}`, new Uint8Array([1, 2, 3, 4])],
      // NOTE: no member for `absent` — that is the whole point.
    ]);
    return writeZip(entries);
  }

  it("emits neither the zip member nor the Files key for an absent file", () => {
    const out = writePmp(readPmp(buildPmp()));
    const members = readZip(out);
    const present = "chara/equipment/e0001/model/c0101e0001_top.mdl";
    const absent = "chara/equipment/e0002/model/c0101e0002_top.mdl";

    expect([...members.keys()]).toContain(`on/${present}`);
    expect([...members.keys()]).not.toContain(`on/${absent}`);

    const dm = JSON.parse(dec.decode(members.get("default_mod.json")!)) as {
      Files: Record<string, string>;
    };
    expect(Object.keys(dm.Files)).toEqual([present]);
  });

  it("leaves an all-present option's manifest byte-for-byte verbatim", () => {
    // The prune must be inert when nothing is absent: `raw` is re-emitted unchanged.
    const src = buildPmp();
    const srcMembers = readZip(src);
    const noAbsent = new Map(srcMembers);
    const dm = JSON.parse(dec.decode(srcMembers.get("default_mod.json")!)) as {
      Files: Record<string, string>;
    };
    const absent = "chara/equipment/e0002/model/c0101e0002_top.mdl";
    noAbsent.set(`on/${absent}`, new Uint8Array([9, 9]));
    const out = writePmp(readPmp(writeZip(noAbsent)));
    const written = JSON.parse(
      dec.decode(readZip(out).get("default_mod.json")!),
    ) as { Files: Record<string, string> };
    expect(written.Files).toEqual(dm.Files);
  });
});
```

- [ ] **Step 10: Run the writer test, then the full gate**

Run: `npx vitest run test/container/pmp-write.test.ts`
Expected: PASS (both cases).

Then: `npm run check` && `npm run typecheck` && `npm test`
Expected: all green. The corpus `upgrade` checks still pass — no corpus pack contains an absent file
yet (Task 5 adds them).

- [ ] **Step 11: Commit**

```bash
git add src/model/modpack.ts src/container/pmp.ts src/container/ttmp2.ts src/upgrade/upgrade.ts src/upgrade/texfix.ts test/container/pmp-read.test.ts test/container/pmp-write.test.ts
git commit -m "feat(pmp): tolerate genuinely-absent Files entries at load; drop them on write"
```

---

### Task 2: Port `ResolveFile` and the per-seam skip/throw table

**Files:**
- Modify: `src/upgrade/upgrade.ts:66-72` (`uncompressedBytes`), `:98-121` (`materialRound`),
  `:131-142` (`modelRound`), `:151-160` (`metadataRound`)
- Modify: `src/upgrade/texture.ts:144-185` (`upgradeRemainingTextures`)
- Test: `test/upgrade/absent-file-rounds.test.ts` (new)

**Interfaces:**
- Consumes: `ModpackFile.data?: Uint8Array` (Task 1).
- Produces: `uncompressedBytes(f: ModpackFile): Decoded | null` — **signature change**; `null` ⇔ the
  file has no bytes. This is the port of `EndwalkerUpgrade.ResolveFile` (`:1758-1783`).

**The behavioural spec** — `EndwalkerUpgrade.cs`, reproduced from the design spec §2. Every row is a
distinct C# call site and they do **not** agree with each other:

| Round | C# | Absent behaviour |
|---|---|---|
| material scan | `:495` `if (file == null) continue;` | **skip**, file untouched |
| model | `:252` `if (uncomp == null) return;` | **skip** |
| `IndexMaps` | `:1840` `ContainsKey` → `CreateIndexFromNormal` null data (`:1087`) → `:1843` `continue` | **skip** |
| `GearMaskLegacy` | `:1879` `ContainsKey` → `:1883` null-checked | **skip** |
| `GearMaskNew` | `:1867` `ContainsKey` → `:1870` passes null into `UpgradeMaskTex` → NRE | **throw** |
| `HairMaps` | `:1852` both keys `ContainsKey` → `:1187` `throw new FileNotFoundException` | **throw** |

`GearMaskNew` throwing is a TexTools **bug** (`docs/TEXTOOLS_BUGS.md` §1) — its sibling
`GearMaskLegacy` null-checks the identical value three lines later. Reproduce it; do not "fix" it.
Both throw cases fail the whole `/upgrade` in TexTools too (`ModpackUpgrader.cs:137-141`).

- [ ] **Step 1: Write the failing round tests**

Create `test/upgrade/absent-file-rounds.test.ts`. It drives the rounds through the public
`upgradeModpack` where it can, and `upgradeRemainingTextures` directly for the texture branches
(which need a pre-built `targets` map):

```ts
import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
  type ModpackOption,
} from "../../src/model/modpack";
import { upgradeModpack } from "../../src/upgrade/upgrade";
import { upgradeRemainingTextures } from "../../src/upgrade/texture";
import {
  EUpgradeTextureUsage,
  type UpgradeInfo,
} from "../../src/upgrade/upgrade-info";

/** A file the archive did not contain: present in the option, no bytes (PMP.cs:1071-1102). */
function absent(gamePath: string) {
  return {
    gamePath,
    storage: FileStorageType.RawUncompressed,
    pmpPath: gamePath,
  };
}
function present(gamePath: string, data: Uint8Array) {
  return {
    gamePath,
    data,
    storage: FileStorageType.RawUncompressed,
    pmpPath: gamePath,
  };
}
function optionOf(files: ModpackOption["files"]): ModpackOption {
  return {
    name: "On",
    description: "",
    image: "",
    priority: 0,
    files,
    fileSwaps: {},
    manipulations: [],
  };
}
function packOf(option: ModpackOption): ModpackData {
  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: {
      name: "t",
      author: "t",
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
        selectionType: "Single",
        defaultSettings: 0,
        options: [option],
      },
    ],
  };
}

describe("upgrade rounds vs an absent file (ResolveFile, EndwalkerUpgrade.cs:1758)", () => {
  it("material round skips it, leaving the entry untouched (:495 continue)", () => {
    const data = packOf(
      optionOf([
        absent("chara/equipment/e0001/material/v0001/mt_c0101e0001_top_a.mtrl"),
      ]),
    );
    const out = upgradeModpack(data);
    const f = out.groups[0]!.options[0]!.files[0]!;
    expect(f.data).toBeUndefined();
    expect(f.gamePath).toBe(
      "chara/equipment/e0001/material/v0001/mt_c0101e0001_top_a.mtrl",
    );
  });

  it("model round skips it (:252 return)", () => {
    const data = packOf(
      optionOf([absent("chara/equipment/e0001/model/c0101e0001_top.mdl")]),
    );
    const out = upgradeModpack(data);
    expect(out.groups[0]!.options[0]!.files[0]!.data).toBeUndefined();
  });

  it("IndexMaps skips an absent normal (:1087 null -> :1843 continue)", () => {
    const normal = "chara/equipment/e0001/texture/v01_c0101e0001_top_n.tex";
    const index = "chara/equipment/e0001/texture/v01_c0101e0001_top_id.tex";
    const option = optionOf([absent(normal)]);
    const targets = new Map<string, UpgradeInfo>([
      [
        index,
        {
          usage: EUpgradeTextureUsage.IndexMaps,
          files: { normal, index },
        } as UpgradeInfo,
      ],
    ]);
    upgradeRemainingTextures(option, targets);
    expect(option.files).toHaveLength(1);
    expect(option.files[0]!.data).toBeUndefined();
  });

  it("GearMaskLegacy skips an absent mask (:1883 null-checked)", () => {
    const maskOld = "chara/equipment/e0001/texture/v01_c0101e0001_top_m.tex";
    const maskNew = "chara/equipment/e0001/texture/v01_c0101e0001_top_mask.tex";
    const option = optionOf([absent(maskOld)]);
    const targets = new Map<string, UpgradeInfo>([
      [
        maskOld,
        {
          usage: EUpgradeTextureUsage.GearMaskLegacy,
          files: { mask_old: maskOld, mask_new: maskNew },
        } as UpgradeInfo,
      ],
    ]);
    upgradeRemainingTextures(option, targets);
    expect(option.files).toHaveLength(1);
  });

  it("GearMaskNew THROWS on an absent mask — C# derefs null (:1870, TEXTOOLS_BUGS §1)", () => {
    const maskOld = "chara/equipment/e0001/texture/v01_c0101e0001_top_m.tex";
    const maskNew = "chara/equipment/e0001/texture/v01_c0101e0001_top_mask.tex";
    const option = optionOf([absent(maskOld)]);
    const targets = new Map<string, UpgradeInfo>([
      [
        maskOld,
        {
          usage: EUpgradeTextureUsage.GearMaskNew,
          files: { mask_old: maskOld, mask_new: maskNew },
        } as UpgradeInfo,
      ],
    ]);
    expect(() => upgradeRemainingTextures(option, targets)).toThrow(
      /no bytes/,
    );
  });

  it("HairMaps THROWS when a key-present normal has no bytes (:1187)", () => {
    const normal = "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
    const mask = "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_m.tex";
    // Both keys are present in the option — C#'s ContainsKey guard (:1852) passes — but the
    // normal has no bytes, so UpdateEndwalkerHairTextures throws FileNotFoundException (:1187).
    const option = optionOf([
      absent(normal),
      present(mask, new Uint8Array([0, 1, 2, 3])),
    ]);
    const targets = new Map<string, UpgradeInfo>([
      [
        normal,
        {
          usage: EUpgradeTextureUsage.HairMaps,
          files: { normal, mask },
        } as UpgradeInfo,
      ],
    ]);
    expect(() => upgradeRemainingTextures(option, targets)).toThrow(
      /no bytes/,
    );
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/upgrade/absent-file-rounds.test.ts`
Expected: FAIL — the skip cases throw `upgrade: file has no bytes` (Task 1's interim throw).

- [ ] **Step 3: Port `ResolveFile`**

`src/upgrade/upgrade.ts` — replace `uncompressedBytes` (`:65-72`):

```ts
/**
 * Port of EndwalkerUpgrade.ResolveFile (EndwalkerUpgrade.cs:1758-1783). Returns the file's
 * uncompressed bytes for a codec to read, carrying the source SqPack entry type — or NULL when the
 * file has no bytes, mirroring C#'s `if (RealPath == null || !File.Exists(RealPath)) return null;`
 * (:1765) for a PMP `Files` entry the archive never contained.
 *
 * Callers must NOT treat null uniformly: each C# call site decides for itself, and they disagree.
 * See the per-seam table in docs/superpowers/specs/2026-07-12-pmp-absent-file-tolerance-design.md §2.
 */
export function uncompressedBytes(f: ModpackFile): Decoded | null {
  if (!f.data) return null;
  if (f.storage === FileStorageType.SqPackCompressed) {
    const d = decodeSqPackFile(f.data);
    return { bytes: d.data, type: d.type };
  }
  return { bytes: f.data };
}

/** ResolveFile + the dereference C# performs unguarded at a given call site: throws when the file
 *  has no bytes. Use ONLY where the C# call site does not null-check (see the §2 table). */
export function requireBytes(f: ModpackFile): Decoded {
  const d = uncompressedBytes(f);
  if (!d) throw new Error(`upgrade: file has no bytes: ${f.gamePath}`);
  return d;
}
```

- [ ] **Step 4: Handle null at each round in `upgrade.ts`**

`materialRound` (`:100-103`) — C# `:495` `continue`:

```ts
  option.files = option.files.map((f) => {
    if (!IS_CHARA_MTRL.test(f.gamePath)) return f;
    try {
      const resolved = uncompressedBytes(f);
      // ResolveFile returned null -> UpdateEndwalkerMaterials `continue`s past this material
      // (EndwalkerUpgrade.cs:495-499), leaving the entry untouched.
      if (!resolved) return f;
      const { bytes, type } = resolved;
      const mtrl = parseMtrl(bytes, f.gamePath);
```

`modelRound` (`:133-141`) — C# `:252` `return`:

```ts
  option.files = option.files.map((f) => {
    if (!IS_MDL.test(f.gamePath)) return f;
    const resolved = uncompressedBytes(f);
    // ResolveFile null -> UpdateEndwalkerModel returns immediately (EndwalkerUpgrade.cs:252-256).
    if (!resolved) return f;
    const { bytes, type } = resolved;
    return restore(
      f,
      normalizeModel(bytes, f.gamePath),
      type ?? SqPackType.Model,
    );
  });
```

`metadataRound` (`:152-159`) — no C# analogue (a PMP `.meta` comes from manipulations, never a zip
member, so it cannot be absent); keep it fail-loud with `requireBytes`:

```ts
  option.files = option.files.map((f) => {
    if (!IS_META.test(f.gamePath)) return f;
    // No absent-file analogue: PMP .meta files are materialized from manipulations (PMP.cs:1160),
    // never read from a zip member, so a .meta with no bytes is unreachable. Fail loud.
    const { bytes, type } = requireBytes(f);
```

- [ ] **Step 5: Handle null at each branch of `upgradeRemainingTextures`**

`src/upgrade/texture.ts` — import `requireBytes` alongside `uncompressedBytes`, then per branch:

```ts
      if (info.usage === EUpgradeTextureUsage.IndexMaps) {
        const normal = findFile(option, info.files.normal!);
        if (!normal) continue;
        // C# gates on files.ContainsKey (:1840) — true for an absent-on-disk file — then
        // CreateIndexFromNormal's ResolveFile returns null (:1087) and the caller `continue`s
        // (:1843). So a key-present, byte-absent normal is SKIPPED, not an error.
        const src = uncompressedBytes(normal);
        if (!src) continue;
        const idx = createIndexFromNormal(src.bytes);
        writeGeneratedTex(option, info.files.index!, idx, normal);
      } else if (info.usage === EUpgradeTextureUsage.HairMaps) {
        const normal = findFile(option, info.files.normal!);
        const mask = findFile(option, info.files.mask!);
        if (normal && mask) {
          // Both keys present (C#'s ContainsKey guard, :1852) — but if either resolves to null,
          // UpdateEndwalkerHairTextures throws FileNotFoundException (:1184-1188). requireBytes
          // reproduces that: an absent normal/mask fails the pack, exactly as in TexTools.
          const res = updateEndwalkerHairTextures(
            requireBytes(normal).bytes,
            requireBytes(mask).bytes,
          );
          writeGeneratedTex(option, info.files.normal!, res.normal, normal);
          writeGeneratedTex(option, info.files.mask!, res.mask, mask);
        } else if (normal || mask) {
          throw new Error(
            `hair: Normal and Mask must be in the same option (EndwalkerUpgrade.cs:1862): ${info.files.normal} / ${info.files.mask}`,
          );
        }
      } else if (
        info.usage === EUpgradeTextureUsage.GearMaskNew ||
        info.usage === EUpgradeTextureUsage.GearMaskLegacy
      ) {
        const old = findFile(option, info.files.mask_old!);
        if (!old) continue;
        const legacy = info.usage === EUpgradeTextureUsage.GearMaskLegacy;
        // QUIRK (upstream bug — docs/TEXTOOLS_BUGS.md §1): the two branches disagree on null.
        // GearMaskLegacy null-checks ResolveFile's result and skips (:1882-1887); GearMaskNew
        // passes it STRAIGHT INTO UpgradeMaskTex (:1870), which NREs on null — its own null check
        // (:1871) comes one line too late. So an absent mask_old is a no-op for Legacy and fails
        // the pack for New. Reproduce, do not fix.
        const src = legacy ? uncompressedBytes(old) : requireBytes(old);
        if (!src) continue;
        const data = upgradeMaskTex(src.bytes, legacy);
        writeGeneratedTex(option, info.files.mask_new!, data, old);
      }
```

**Careful:** the `catch (e)` at `:180-183` swallows only `TextureResizeUnsupported`; both new throws
are plain `Error`s and must keep propagating. Do not widen that catch.

- [ ] **Step 6: Run the round tests**

Run: `npx vitest run test/upgrade/absent-file-rounds.test.ts`
Expected: PASS — 4 skips, 2 throws.

- [ ] **Step 7: Full gate**

Run: `npm run check` && `npm run typecheck` && `npm test`
Expected: all green (no corpus pack has an absent file yet).

- [ ] **Step 8: Commit**

```bash
git add src/upgrade/upgrade.ts src/upgrade/texture.ts test/upgrade/absent-file-rounds.test.ts
git commit -m "feat(upgrade): port ResolveFile null semantics; skip or throw per C# call site"
```

---

### Task 3: Harness — payload multiset + the manifest carve-out

**Files:**
- Modify: `test/helpers/upgrade-diff.ts:25-39` (`uncompressed`, `byGamePath`)
- Modify: `test/helpers/upgrade-archive-diff.ts:61-108`
- Test: `test/helpers/upgrade-archive-diff.test.ts` (extend)

**Interfaces:**
- Consumes: `windowsPathKey` from `src/container/pmp.ts` (Task 1); `ModpackFile.data?`.
- Produces: `diffArchives(ours, golden)` — unchanged signature, one new confirmation inside.

**Why:** on a noop, ConsoleTools writes nothing, so the harness's reference archive is the **input
pack** (`corpus-upgrade.ts:37-39`), which still lists the dangling `Files` key our writer now drops
(Task 1). The inputs stay untouched; the comparison gains a confirmation, in the spirit of
`DivergenceRule.confirm` (`upgrade-compare.ts:10-14`: *"NOT a blanket tolerance: `confirm` must be
tight enough that any OTHER difference still fails"*).

**The rule:** a `Files` key may be missing from **ours** iff the golden's value for that key names a
zip path that **does not resolve as a member of the golden's own archive**, under the same
`windowsPathKey` normalization the reader uses. Everything else must still deep-equal.

- [ ] **Step 1: Write the failing carve-out tests**

Append to `test/helpers/upgrade-archive-diff.test.ts` (match the file's existing helpers for
building zips; if it has none, use `writeZip` from `src/zip/zip` as `pmp-write.test.ts` does):

```ts
describe("diffArchives absent-file drop (PMP.cs:883-888)", () => {
  const enc = new TextEncoder();
  const PRESENT = "chara/equipment/e0001/model/c0101e0001_top.mdl";
  const ABSENT = "chara/equipment/e0002/model/c0101e0002_top.mdl";

  /** `files` is the option's Files map; `members` the payload members actually in the archive. */
  function archive(
    files: Record<string, string>,
    members: Record<string, Uint8Array>,
  ): Uint8Array {
    const meta = { FileVersion: 3, Name: "A", Author: "t", ModTags: [] };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      [
        "default_mod.json",
        enc.encode(
          JSON.stringify({
            Version: 0,
            Files: files,
            FileSwaps: {},
            Manipulations: [],
          }),
        ),
      ],
    ]);
    for (const [name, bytes] of Object.entries(members)) entries.set(name, bytes);
    return writeZip(entries);
  }

  const payload = new Uint8Array([1, 2, 3]);
  const bothKeys = {
    [PRESENT]: `on\\${PRESENT.replace(/\//g, "\\")}`,
    [ABSENT]: `on\\${ABSENT.replace(/\//g, "\\")}`,
  };
  const oneKey = { [PRESENT]: `on\\${PRESENT.replace(/\//g, "\\")}` };

  it("confirms a dropped key whose payload is genuinely absent from the golden", () => {
    // Golden = the noop reference (the input pack): lists ABSENT but never contained its member.
    const golden = archive(bothKeys, { [`on/${PRESENT}`]: payload });
    const ours = archive(oneKey, { [`on/${PRESENT}`]: payload });
    expect(diffArchives(ours, golden)).toEqual([]);
  });

  it("REJECTS a dropped key whose payload IS present in the golden", () => {
    const golden = archive(bothKeys, {
      [`on/${PRESENT}`]: payload,
      [`on/${ABSENT}`]: payload,
    });
    const ours = archive(oneKey, { [`on/${PRESENT}`]: payload });
    expect(diffArchives(ours, golden)).toHaveLength(1);
  });

  it("REJECTS a dropped key that only LOOKS absent (resolves under windowsPathKey)", () => {
    // The member is stored with display case + a trailing dot stripped — the reader resolves it,
    // so it is NOT absent and dropping it is a real bug, not the PMP.cs:883 drop.
    const value = `On.\\${ABSENT.replace(/\//g, "\\")}`;
    const golden = archive(
      { ...oneKey, [ABSENT]: value },
      { [`on/${PRESENT}`]: payload, [`On/${ABSENT}`]: payload },
    );
    const ours = archive(oneKey, { [`on/${PRESENT}`]: payload });
    expect(diffArchives(ours, golden)).toHaveLength(1);
  });

  it("REJECTS a changed value even when another key is a confirmed drop", () => {
    const golden = archive(bothKeys, { [`on/${PRESENT}`]: payload });
    const ours = archive(
      { [PRESENT]: "somewhere\\else.mdl" },
      { [`on/${PRESENT}`]: payload },
    );
    expect(diffArchives(ours, golden)).toHaveLength(1);
  });

  it("REJECTS an unrelated field difference alongside a confirmed drop", () => {
    const golden = archive(bothKeys, { [`on/${PRESENT}`]: payload });
    const ours = readZip(archive(oneKey, { [`on/${PRESENT}`]: payload }));
    ours.set(
      "default_mod.json",
      enc.encode(
        JSON.stringify({
          Version: 1, // <- differs
          Files: oneKey,
          FileSwaps: {},
          Manipulations: [],
        }),
      ),
    );
    expect(diffArchives(writeZip(ours), golden)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run test/helpers/upgrade-archive-diff.test.ts`
Expected: the first case FAILs (reports a `manifest` mismatch); the four REJECT cases pass already
(they are the status quo) — they are the regression net for the carve-out's tightness.

- [ ] **Step 3: Implement the carve-out**

`test/helpers/upgrade-archive-diff.ts` — add the import and the confirmation, then wire it into the
comparison:

```ts
import { windowsPathKey } from "../../src/container/pmp";
```

Place all of the following **above** `diffArchives`, and note `isObj` must come first (Biome's
`noInvalidUseBeforeDeclaration` will reject a const arrow referenced above its declaration):

```ts
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The set of member names an archive actually contains, keyed the way the PMP reader resolves a
 *  `Files` value (case-fold + trailing dot/space strip per segment — src/container/pmp.ts). */
function memberKeys(members: Map<string, Uint8Array>): Set<string> {
  return new Set([...members.keys()].map((n) => windowsPathKey(n)));
}

/** CONFIRMATION (not a tolerance) of the ONE manifest difference we intend: TexTools' writer drops
 *  a file whose payload does not exist from both the zip and the option's `Files` map
 *  (PopulatePmpStandardOption, PMP.cs:883-888), and our writer now does too. On a NO-OP upgrade
 *  ConsoleTools writes nothing, so the harness's reference is the INPUT pack — which still carries
 *  the dangling key. So: a `Files` key missing from OURS is allowed iff the golden's value for it
 *  names a zip path that does not resolve as a member of the GOLDEN's own archive.
 *
 *  Deliberately tight, in the spirit of DivergenceRule.confirm (upgrade-compare.ts):
 *   - resolution uses the reader's own windowsPathKey, so a merely case-mismatched or
 *     trailing-dotted key RESOLVES and is NOT covered — the two normalization fixes stay under test;
 *   - only a key MISSING from ours is covered; a changed value is still a mismatch;
 *   - every other field is still deep-equal'd.
 *  It is inert whenever ConsoleTools actually wrote the golden: TexTools dropped the key there too,
 *  so both sides agree and this never runs. See the absent-file design spec §4.1. */
function dropConfirmedAbsentKeys(
  ours: unknown,
  golden: unknown,
  present: Set<string>,
): unknown {
  const confirmedFiles = (
    oursFiles: unknown,
    goldenFiles: Record<string, unknown>,
  ): Record<string, unknown> => {
    const o = (oursFiles ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [gamePath, value] of Object.entries(goldenFiles)) {
      const missingFromOurs = !Object.hasOwn(o, gamePath);
      const zipPath =
        typeof value === "string" ? value.replace(/\\/g, "/") : "";
      const absent = zipPath !== "" && !present.has(windowsPathKey(zipPath));
      if (missingFromOurs && absent) continue; // the PMP.cs:883 drop — confirmed
      out[gamePath] = value;
    }
    return out;
  };

  const option = (o: unknown, g: unknown): unknown => {
    if (!isObj(g) || !isObj(o) || !isObj(g.Files)) return g;
    return { ...g, Files: confirmedFiles(o.Files, g.Files) };
  };

  if (!isObj(golden) || !isObj(ours)) return golden;
  // group_NNN.json: prune inside each option, pairing by index (order is part of the compare).
  if (Array.isArray(golden.Options) && Array.isArray(ours.Options)) {
    return {
      ...golden,
      Options: golden.Options.map((g, i) =>
        option(g, (ours.Options as unknown[])[i]),
      ),
    };
  }
  // default_mod.json: the document IS the option.
  return option(ours, golden);
}
```

Then in `diffArchives`, replace the `else if (!deepEqual(...))` branch (`:95-105`):

```ts
    } else {
      const o = parse(name, om.get(name)!);
      const g = parse(name, gm.get(name)!);
      // Straight deep-equal first; only a failure is offered to the confirmation.
      if (!deepEqual(o, dropConfirmedAbsentKeys(o, g, memberKeys(gm)))) {
        diffs.push({
          kind: "manifest",
          gamePath: name,
          index: 0,
          status: "mismatch",
          detail: undefined,
        });
      }
    }
```

Hoist `memberKeys(gm)` out of the loop into a `const goldenMembers = memberKeys(gm);` above it.

- [ ] **Step 4: Exclude absent files from the payload multiset**

`test/helpers/upgrade-diff.ts` — an absent file has no payload, so it is in neither side's multiset.
Replace `uncompressed` / `byGamePath` (`:25-39`):

```ts
/** Uncompressed payload bytes, or null when the file has no bytes (a PMP `Files` entry the archive
 *  never contained — src/model/modpack.ts). Such a file has NO payload to compare: TexTools' writer
 *  drops it (PMP.cs:883-888), so it is absent from a real golden, and on a noop both sides load it
 *  absent. Excluding it from the multiset is the definition of the set, not a tolerance — the
 *  MANIFEST side of the drop is still checked, by diffArchives. */
function uncompressed(f: ModpackFile): Uint8Array | null {
  if (!f.data) return null;
  return f.storage === FileStorageType.SqPackCompressed
    ? decodeSqPackFile(f.data).data
    : f.data;
}

function byGamePath(d: ModpackData): Map<string, Uint8Array[]> {
  const m = new Map<string, Uint8Array[]>();
  for (const f of allFiles(d)) {
    const bytes = uncompressed(f);
    if (!bytes) continue;
    const list = m.get(f.gamePath) ?? [];
    list.push(bytes);
    m.set(f.gamePath, list);
  }
  return m;
}
```

- [ ] **Step 5: Run the harness tests**

Run: `npx vitest run test/helpers/upgrade-archive-diff.test.ts test/upgrade-harness.test.ts`
Expected: PASS — including the four REJECT cases (the carve-out did not widen).

- [ ] **Step 6: Full gate**

Run: `npm run check` && `npm run typecheck` && `npm test`
Expected: all green; every existing corpus pack still matches its baseline (the carve-out is inert
for packs with no absent files).

- [ ] **Step 7: Commit**

```bash
git add test/helpers/upgrade-diff.ts test/helpers/upgrade-archive-diff.ts test/helpers/upgrade-archive-diff.test.ts
git commit -m "test(harness): confirm the absent-file Files-key drop in the manifest diff"
```

---

### Task 4: Synthetic noop pack

**Files:**
- Create: `scripts/generate-synthetics/build-synthetic-absent-file.ts`
- Modify: `scripts/generate-synthetics/build-all.ts`

**Interfaces:**
- Consumes: `pmp-builder.ts`'s `DUMMY_PAYLOAD`, `EMPTY_DEFAULT_MOD`, `singleOptionGroup`,
  `syntheticMeta`, `writePmp` (note: this `writePmp` is the *builder's* zip emitter, not
  `src/container/pmp.ts`'s).
- Produces: gitignored `test/corpus/synthetic/absent-file.pmp`, picked up automatically by
  `corpusPacks()` → the `upgrade` unit.

- [ ] **Step 1: Write the builder**

Create `scripts/generate-synthetics/build-synthetic-absent-file.ts`:

```ts
// Builds test/corpus/synthetic/absent-file.pmp: a PMP whose option Files map names a zip path the
// archive genuinely does not contain — not a resolution bug (no casing or trailing-dot form of it
// is packed either), the payload was simply never included. TexTools tolerates this: LoadPMP does
// no existence check (PMP.cs:124), UnpackPmpOption builds a FileStorageInformation whose RealPath
// does not exist (PMP.cs:1071-1102), every read seam null-guards it (ResolveFile,
// EndwalkerUpgrade.cs:1758), and the writer drops it (PMP.cs:883-888). Pre-fix, readPmp threw
// `pmp: missing file entry`.
//
// Both gamePaths are ones /upgrade ignores, so ConsoleTools no-ops and the golden harness compares
// our output against the input — which still lists the dangling key, so this pack also exercises the
// manifest carve-out in test/helpers/upgrade-archive-diff.ts. See
// docs/superpowers/specs/2026-07-12-pmp-absent-file-tolerance-design.md.
// The .pmp is gitignored; regenerate locally with `npm run synthetics`.

import {
  DUMMY_PAYLOAD,
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

// A gamePath /upgrade ignores, whose payload IS packed — so the pack is not degenerate and the
// surviving Files key proves the drop is scoped to the absent one.
const presentGamePath = "chara/dummy/absent_file_present.bin";
const presentZipPath = "Absent Options/On/files/absent_file_present.bin";

// A gamePath /upgrade ignores, whose payload is NOT packed. No entry of any casing exists.
const absentGamePath = "chara/dummy/absent_file_missing.bin";
const absentFilesValue =
  "absent options\\on\\files\\absent_file_missing.bin";

writePmp("absent-file.pmp", {
  meta: syntheticMeta("Absent File Repro"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_absent options.json": singleOptionGroup("Absent Options", {
      [presentGamePath]: presentZipPath.toLowerCase().replace(/\//g, "\\"),
      [absentGamePath]: absentFilesValue,
    }),
  },
  files: { [presentZipPath]: DUMMY_PAYLOAD },
});
```

- [ ] **Step 2: Register it**

`scripts/generate-synthetics/build-all.ts` — append:

```ts
import "./build-synthetic-absent-file";
```

- [ ] **Step 3: Build the pack**

Run: `npm run synthetics`
Expected: `wrote …\test\corpus\synthetic\absent-file.pmp` (plus the three existing packs; their
bytes are pinned, so their cached goldens survive).

- [ ] **Step 4: Run the suite — this is the AB test**

Run: `npm test`

Expected: green, including a new `upgrade golden: absent-file.pmp` unit reporting `0 diffs`.

**If ConsoleTools fails or the unit reports diffs, STOP and report** — do not bless a baseline. A new
pack is expected to match fully. Two known hazards:
- The first run is a **cold golden cache**, which spawns ConsoleTools; it is not concurrency-safe
  (`BACKLOG.md`). If several units fail together with `Command failed: ConsoleTools.exe`, re-run the
  single unit serially to warm the cache (`$env:CORPUS_UNIT=<i>; npm test`), then re-run `npm test`.
- A `structure`/`manifest` diff here means the carve-out (Task 3) is not firing — investigate, do not
  widen the rule.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-synthetics/build-synthetic-absent-file.ts scripts/generate-synthetics/build-all.ts
git commit -m "test(synthetics): add the absent-Files-entry repro pack"
```

---

### Task 5: Real corpus packs + the `/resave` probe

Requires the operator's local packs; the agent executing this task must **ask for them** rather than
inventing a substitute.

**Files:**
- Create: `local-notes/probe-resave-absent.ts` (gitignored)
- Modify: `BACKLOG.md`, `docs/TEXTOOLS_BUGS.md`, the spec's Status line

- [ ] **Step 1: Add the real packs**

Ask the operator to copy into `test/corpus/real/` (gitignored):
- `[Shy] Tactical Hoodie [DT].pmp` (1.8 MB — missing `chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl`)
- `[Nyameru]Cute Loop.pmp` (15.7 MB — missing `chara/cuteloop2.pap`)

Their locations are listed in `local-notes/failed-to-load-modpacks.md`.

- [ ] **Step 2: Run the suite against them**

Run: `npm test`
Expected: two new `upgrade golden:` units, both green with `0 diffs`. Both `/upgrade` to a **noop**
(verified previously against ConsoleTools), so each is compared against its own input and exercises
the Task 3 carve-out on a real pack.

If either reports diffs: it is a real finding. Report it; do not bless.

- [ ] **Step 3: Write the `/resave` probe**

The one piece of the port with no `/upgrade` golden behind it is the writer's drop (`PMP.cs:883`) —
none of the five real packs reaches a write, because all five noop. `/resave` (`Program.cs:191-221`)
is `WizardData.FromModpack` → `WriteModpack` with no upgrade and no change check, so it drives the
same `PopulatePmpStandardOption`. Confirm the drop empirically.

Create `local-notes/probe-resave-absent.ts` (gitignored, like `probe-v1-meta.ts`):

```ts
// One-off probe: does TexTools' PMP writer really drop an absent file's `Files` key (PMP.cs:883-888)?
// Runs ConsoleTools /resave (load -> write, no upgrade) on a pack with a genuinely-absent entry and
// prints whether the key survives. /resave is NOT usable as a harness oracle — it renames every
// payload entry to <optionPrefix><gamePath> and re-serializes every JSON (see BACKLOG.md) — so this
// is corroboration, not a golden.
// Run: npx tsx local-notes/probe-resave-absent.ts "<path to .pmp>"
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readZip } from "../src/zip/zip";

const CONSOLE_TOOLS =
  "C:\\Program Files\\FFXIV TexTools\\FFXIV_TexTools\\ConsoleTools.exe";
const src = process.argv[2];
if (!src) throw new Error("usage: probe-resave-absent.ts <pack.pmp>");

const dec = new TextDecoder();
const dest = join(mkdtempSync(join(tmpdir(), "resave-")), "out.pmp");
execFileSync(CONSOLE_TOOLS, ["/resave", src, dest], { stdio: "inherit" });

const filesOf = (bytes: Uint8Array) => {
  const out: Record<string, string> = {};
  for (const [name, data] of readZip(bytes)) {
    if (!/^(default_mod|group_\d+.*)\.json$/i.test(name)) continue;
    const j = JSON.parse(dec.decode(data)) as {
      Files?: Record<string, string>;
      Options?: { Files?: Record<string, string> }[];
    };
    for (const [k, v] of Object.entries(j.Files ?? {})) out[k] = v;
    for (const o of j.Options ?? [])
      for (const [k, v] of Object.entries(o.Files ?? {})) out[k] = v;
  }
  return out;
};

const before = filesOf(new Uint8Array(readFileSync(src)));
const after = filesOf(new Uint8Array(readFileSync(dest)));
const dropped = Object.keys(before).filter((k) => !(k in after));
console.log(`Files keys: ${Object.keys(before).length} in -> ${Object.keys(after).length} out`);
console.log("DROPPED BY TEXTOOLS:", dropped.length ? dropped : "(none)");
```

- [ ] **Step 4: Run the probe**

Run: `npx tsx local-notes/probe-resave-absent.ts "<path to [Shy] Tactical Hoodie [DT].pmp>"`
Expected: `DROPPED BY TEXTOOLS: [ 'chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl' ]`
— i.e. exactly the absent entry, and nothing else.

**If the key survives**, `PMP.cs:883` is not doing what we read it to do: STOP, report, and expect
Task 1's writer change to need revisiting.

Record the observed output in the spec (§4.3) as the empirical result.

- [ ] **Step 5: Retire the backlog item and update the register**

`BACKLOG.md` — delete the whole **"PMP load-tolerance for genuinely-absent `Files` entries"** item
(the one beginning "After the case-insensitive … 5 packs still fail loud"). It is done. Leave the two
items added alongside the spec (the audit sweep; the `writePmp` zip-name regeneration) — both are
still open.

`docs/TEXTOOLS_BUGS.md` §1 — change the status line from
`**Status:** reproduced (planned — PMP absent-file work)` to `**Status:** reproduced`, and add the
citation of where: `src/upgrade/texture.ts` (`upgradeRemainingTextures`, the `GearMaskNew` branch).

The spec's header — change `**Status:** Design — approved, pending implementation plan` to
`**Status:** Implemented`.

- [ ] **Step 6: Full gate + commit**

Run: `npm run check` && `npm run typecheck` && `npm test`
Expected: all green, including the two new real-corpus units.

```bash
git add BACKLOG.md docs/TEXTOOLS_BUGS.md docs/superpowers/specs/2026-07-12-pmp-absent-file-tolerance-design.md
git commit -m "docs(pmp): retire the absent-file backlog item; record the /resave probe result"
```

---

### Task 6 (conditional): Synthetic non-noop pack — a golden for the writer's drop

**Only attempt this after Task 5.** Its purpose is to replace the `/resave` probe's corroboration with
a real `/upgrade` golden: a pack that contains an absent file **and** a payload that genuinely
upgrades, so ConsoleTools actually *writes* — and the golden then shows, byte-for-byte, whether the
absent `Files` key survived.

**This task is a spike and is allowed to fail.** If it cannot be made to work, say so, delete the
builder, and record in the spec (§4.2) that the write-side rests on the `writePmp` unit test
(Task 1) plus the `/resave` probe (Task 5). Two known hazards, both fatal to the approach:

1. **Zip layout.** TexTools' writer regenerates every payload entry name as `<optionPrefix><gamePath>`
   (`PmpExtensions.cs:534`), while ours reuses the source name — a pre-existing divergence
   (`BACKLOG.md`) that is invisible only because Penumbra's layout coincides. The synthetic **must**
   conform, or it trips over that instead: for a **single-option** group, `MakeOptionPrefix`
   (`WizardData.cs:1419`) collapses to the group folder, so with one page and a group named
   `Absent` the prefix is `absent/` and each payload entry must be named `absent/<gamePath>`.
2. **The material must actually upgrade.** Use an EW 256-entry colorset `.mtrl`
   (`doesMtrlNeedDawntrailUpdate`, `EndwalkerUpgrade.cs:550`) — `test/mtrl/make-mtrl.ts`'s
   `buildMinimalMtrl` is one, but its texture path (`test.tex`) is not a real game path. C#
   dereferences the resolved Normal texture unguarded (`EndwalkerUpgrade.cs:912-921`,
   `docs/TEXTOOLS_BUGS.md` §2), so if the path does not resolve, C# NREs, the per-material
   `try/catch` (`:522-539`) abandons the material **byte-untouched**, and the pack is a noop again —
   defeating the purpose. Author the mtrl with a realistic normal path
   (e.g. `chara/equipment/e9999/texture/v01_c0101e9999_top_n.tex`) and do **not** pack that texture
   (so round 2's `files.ContainsKey` misses and no texture is generated).

- [ ] **Step 1: Verify the premise before building the harness pack**

Write a throwaway builder that emits a candidate pack to a temp path, run ConsoleTools directly, and
check that it *wrote a file at all*:

```
npx tsx <your builder>            # emits the candidate .pmp
& "C:\Program Files\FFXIV TexTools\FFXIV_TexTools\ConsoleTools.exe" /upgrade <candidate.pmp> <out.pmp>
Test-Path <out.pmp>
```

Expected: `True`. `/upgrade` writes nothing when nothing changed (`ModpackUpgrader.cs:216`) and still
exits 0 (`docs/TEXTOOLS_BUGS.md` §8) — so `Test-Path` is the real signal, not the exit code.

If `False`, the material did not upgrade: iterate on the mtrl, or abandon per the note above.

- [ ] **Step 2: Inspect the golden for the drop**

Unzip `<out.pmp>` and read its `group_001_*.json`. Expected: the absent file's `Files` key is **gone**
and the present file's key remains. That is the oracle confirming `PMP.cs:883`.

- [ ] **Step 3: Promote to a committed builder**

Only if steps 1-2 both held. Create
`scripts/generate-synthetics/build-synthetic-absent-file-upgraded.ts` on the same pattern as
Task 4's builder (a header comment citing what it proves and why the layout must conform), register
it in `build-all.ts`, run `npm run synthetics`, then `npm test`.

Expected: a new `upgrade golden: absent-file-upgraded.pmp` unit, green with `0 diffs` — our writer's
drop and our material upgrade both match a real ConsoleTools-written pack.

If it reports diffs, they are a real finding: report them. A payload diff on the `.mtrl` is a
material-round divergence surfaced by a new golden (worth its own investigation); a manifest diff
means the drop does not match.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-synthetics/build-synthetic-absent-file-upgraded.ts scripts/generate-synthetics/build-all.ts docs/superpowers/specs/2026-07-12-pmp-absent-file-tolerance-design.md
git commit -m "test(synthetics): golden-prove the absent-file Files-key drop on a written pack"
```
