import { describe, expect, it } from "vitest";
import { optionPrefixes } from "../../src/container/option-prefix";
import { resolveDuplicates } from "../../src/container/resolve-duplicates";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../../src/model/modpack";
import { filesMap } from "../helpers/make-packs";

// Minimal builders local to this test file. `resolveDuplicates` only reads gamePath/data off
// ModpackFile and files/name off ModpackOption; `data.groups` is used only for the
// prefixes<->data cross-check (see the "mismatched data/prefixes" test below), so these builders
// don't need option-prefix.test.ts's Default-group scaffolding.

// resolveDuplicates' returned Map is keyed on ModpackFile IDENTITY, and most cases below assert
// against it via `result.get(f1)` for an `f1` obtained from `file(...)` -- so `file` must keep
// returning the SAME object `option` inserts into its Map, with the gamePath threaded back in
// alongside it here rather than carried on the object itself (ModpackFile has no gamePath field).
const fileGamePaths = new Map<ModpackFile, string>();

function file(gamePath: string, data?: Uint8Array): ModpackFile {
  const f: ModpackFile = { data, storage: FileStorageType.RawUncompressed };
  fileGamePaths.set(f, gamePath);
  return f;
}

function option(
  name: string,
  files: ModpackFile[],
  fileSwaps: Record<string, string> = {},
): ModpackOption {
  return {
    name,
    description: "",
    image: "",
    priority: 0,
    files: filesMap(files.map((f) => [fileGamePaths.get(f)!, f])),
    fileSwaps,
    manipulations: [],
  };
}

function group(name: string, options: ModpackOption[]): ModpackGroup {
  return {
    name,
    description: "",
    image: "",
    page: 0,
    priority: 0,
    selectionType: options.length > 1 ? "Multi" : "Single",
    defaultSettings: 0,
    options,
  };
}

function pack(groups: ModpackGroup[]): ModpackData {
  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: {
      name: "Test",
      author: "",
      version: "1.0",
      description: "",
      url: "",
      image: "",
      tags: [],
      minimumFrameworkVersion: "1.0.0.0",
    },
    groups,
  };
}

const bytes = (...b: number[]) => new Uint8Array(b);

describe("resolveDuplicates", () => {
  it("1. a file used once keeps <optionPrefix><gamePath>", () => {
    const f = file("chara/a.tex", bytes(1, 2, 3));
    const opt = option("Opt", [f]);
    const prefixes = new Map([[opt, "group/opt/"]]);
    const d = pack([group("Group", [opt])]);

    const result = resolveDuplicates(d, prefixes);

    expect(result.get(f)).toBe("group/opt/chara/a.tex");
    expect(result.size).toBe(1);
  });

  it("2. content that repeats across DIFFERENT options moves BOTH occurrences to common/{idx}/{basename}", () => {
    const content = bytes(1, 2, 3);
    const f1 = file("chara/a.tex", content);
    const f2 = file("other/b.tex", new Uint8Array(content)); // same bytes, different array instance
    const opt1 = option("Opt1", [f1]);
    const opt2 = option("Opt2", [f2]);
    const prefixes = new Map([
      [opt1, "g/opt1/"],
      [opt2, "g/opt2/"],
    ]);
    const d = pack([group("G", [opt1, opt2])]);

    const result = resolveDuplicates(d, prefixes);

    // basename comes from the FIRST occurrence's already-assigned pmpPath ("g/opt1/chara/a.tex"),
    // i.e. "a.tex" -- NOT from the second occurrence's "other/b.tex".
    expect(result.get(f1)).toBe("common/1/a.tex");
    expect(result.get(f2)).toBe("common/1/a.tex");
  });

  it("3. idx starts at 1 and increments once per distinct duplicated content, in FILE ORDER", () => {
    const contentX = bytes(0xaa);
    const contentY = bytes(0xbb);
    const fx1 = file("x1.tex", contentX);
    const fy1 = file("y1.tex", contentY);
    const fx2 = file("x2.tex", new Uint8Array(contentX));
    const fy2 = file("y2.tex", new Uint8Array(contentY));
    // File order: optA's files (fx1, fy1) precede optB's files (fx2, fy2) -- prefixes preserves
    // that as its own Map insertion order.
    const optA = option("A", [fx1, fy1]);
    const optB = option("B", [fx2, fy2]);
    const prefixes = new Map([
      [optA, "a/"],
      [optB, "b/"],
    ]);
    const d = pack([group("G", [optA, optB])]);

    const result = resolveDuplicates(d, prefixes);

    // The X duplicate is DISCOVERED first (fx2, the 3rd entry in file order) -> idx 1.
    // The Y duplicate is discovered second (fy2, the 4th entry) -> idx 2.
    expect(result.get(fx1)).toBe("common/1/x1.tex");
    expect(result.get(fx2)).toBe("common/1/x1.tex");
    expect(result.get(fy1)).toBe("common/2/y1.tex");
    expect(result.get(fy2)).toBe("common/2/y1.tex");
  });

  it("4. {basename} is Path.GetFileName of the FIRST occurrence's already-assigned pmpPath", () => {
    const content = bytes(7);
    const f1 = file("chara/human/f0001/obj/body/b0001/texture/a.tex", content);
    const f2 = file("completely/different/name.tex", new Uint8Array(content));
    const opt1 = option("Opt1", [f1]);
    const opt2 = option("Opt2", [f2]);
    const prefixes = new Map([
      [opt1, "g1/"],
      [opt2, "g2/"],
    ]);
    const d = pack([group("G", [opt1, opt2])]);

    const result = resolveDuplicates(d, prefixes);

    // basename is "a.tex" (from f1's pmpPath), never "name.tex" (from f2's).
    expect(result.get(f1)).toBe("common/1/a.tex");
    expect(result.get(f2)).toBe("common/1/a.tex");
  });

  it("5. three copies of the same content still yield ONE common/{idx} entry", () => {
    const content = bytes(9);
    const f1 = file("a.tex", content);
    const f2 = file("b.tex", new Uint8Array(content));
    const f3 = file("c.tex", new Uint8Array(content));
    const opt1 = option("Opt", [f1, f2, f3]);
    // A second, later duplicate pair proves idx was NOT burned a second/third time by the extra
    // copy above -- PmpExtensions.cs:540: the third occurrence finds a path already starting with
    // "common/" and leaves it alone, so it must not increment idx.
    const laterContent = bytes(11);
    const g1 = file("d1.tex", laterContent);
    const g2 = file("d2.tex", new Uint8Array(laterContent));
    const opt2 = option("Opt2", [g1, g2]);
    const prefixes = new Map([
      [opt1, "g/"],
      [opt2, "g2/"],
    ]);
    const d = pack([group("G", [opt1, opt2])]);

    const result = resolveDuplicates(d, prefixes);

    expect(result.get(f1)).toBe("common/1/a.tex");
    expect(result.get(f2)).toBe("common/1/a.tex");
    expect(result.get(f3)).toBe("common/1/a.tex");
    expect(result.get(g1)).toBe("common/2/d1.tex");
    expect(result.get(g2)).toBe("common/2/d1.tex");
  });

  it("6. ZERO-HASH BUG: two absent files dedupe against each other and BURN an idx, shifting a later real duplicate's numbering (docs/TEXTOOLS_BUGS.md #8)", () => {
    const absent1 = file("missing1.tex", undefined);
    const absent2 = file("missing2.tex", undefined);
    const dupContent = bytes(42);
    const real1 = file("r1.tex", dupContent);
    const real2 = file("r2.tex", new Uint8Array(dupContent));
    const opt = option("Opt", [absent1, absent2, real1, real2]);
    const prefixes = new Map([[opt, "g/"]]);
    const d = pack([group("G", [opt])]);

    const result = resolveDuplicates(d, prefixes);

    // The two absent files collide on the all-zero hash and consume idx=1 (even though neither
    // ends up in the returned map -- see case 7). The genuine duplicate pair therefore lands on
    // common/2, NOT common/1.
    expect(result.get(real1)).toBe("common/2/r1.tex");
    expect(result.get(real2)).toBe("common/2/r1.tex");
  });

  it("7. absent files are excluded from the returned map entirely (no member, no Files key)", () => {
    const absent1 = file("missing1.tex", undefined);
    const absent2 = file("missing2.tex", undefined);
    const solo = file("solo.tex", undefined);
    const opt = option("Opt", [absent1, absent2]);
    const soloOpt = option("Solo", [solo]);
    const prefixes = new Map([
      [opt, "g/"],
      [soloOpt, "g2/"],
    ]);
    const d = pack([group("G", [opt, soloOpt])]);

    const result = resolveDuplicates(d, prefixes);

    expect(result.has(absent1)).toBe(false);
    expect(result.has(absent2)).toBe(false);
    expect(result.has(solo)).toBe(false);
    expect(result.size).toBe(0);
  });

  it("throws if prefixes references an option absent from data.groups (mismatched data/prefixes)", () => {
    const opt = option("Opt", [file("a.tex", bytes(1))]);
    const prefixes = new Map([[opt, "g/"]]);
    const d = pack([]); // opt is reachable from nowhere in d.groups

    expect(() => resolveDuplicates(d, prefixes)).toThrow(/prefixes/);
  });

  // INTENTIONAL DIVERGENCE (docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md):
  // TexTools merges FileSwaps into Files as dataless placeholders (PMP.cs:1104-1137) which burn an
  // idx on the zero-hash path once two of them collide, then destroys the swaps on write
  // (PMP.cs:873-875, docs/TEXTOOLS_BUGS.md #10). We preserve the swaps instead, so they never reach
  // this function's dedup at all. These two tests pin that -- swaps contribute NO entries and burn
  // NO idx -- and replace two earlier tests that pinned the old fail-loud throw.
  it("ignores FileSwaps entirely: they contribute no entries and burn no idx", () => {
    const a = file("a.tex", bytes(1));
    const dupA = file("b.tex", bytes(1)); // same content as `a` -> the pack's ONE real duplicate
    const opt = option("Opt", [a, dupA], {
      "chara/dest1.tex": "chara/src1.tex",
      "chara/dest2.tex": "chara/src2.tex", // >=2 swaps: TexTools WOULD burn idx 1 here
    });
    const prefixes = new Map([[opt, "g/"]]);
    const d = pack([group("G", [opt])]);

    const result = resolveDuplicates(d, prefixes);

    // Only the two real files are placed; neither swap appears.
    expect(result.size).toBe(2);
    // The duplicate claims common/1 -- NOT common/2. In TexTools the two placeholders would have
    // collided on ZERO_HASH first and taken idx 1, pushing this to common/2.
    expect(result.get(a)).toBe("common/1/a.tex");
    expect(result.get(dupA)).toBe("common/1/a.tex");
  });

  it("ignores FileSwaps on an option that buildPages PRUNED (no `prefixes` entry) without throwing", () => {
    const opt = option("Opt", [], {
      "chara/dest.tex": "chara/src.tex",
    });
    // `prefixes` has NO entry for `opt` at all -- simulating a group/option that buildPages
    // pruned out of the surviving pages. `data.groups` still carries it, though.
    const prefixes = new Map<ModpackOption, string>();
    const d = pack([group("G", [opt])]);

    expect(resolveDuplicates(d, prefixes).size).toBe(0);
  });

  it("8. composes with the real optionPrefixes(): a content duplicate across two DIFFERENT options dedupes globally, matching the observed corpus shape ([Jaque] Romeo & Juliet: one common/N/ shared by paths from two options)", () => {
    const emptyDefault = option("", []);
    const defaultGroup: ModpackGroup = {
      name: "Default",
      description: "",
      image: "",
      page: 0,
      priority: 0,
      selectionType: "Single",
      defaultSettings: 0,
      options: [emptyDefault],
    };
    const content = bytes(5, 6, 7);
    const fA = file("chara/shared.tex", content);
    const fB = file("chara/shared.tex", new Uint8Array(content));
    const optA = option("Option A", [fA]);
    const optB = option("Option B", [fB]);
    const g = group("Group", [optA, optB]);
    const d = pack([defaultGroup, g]);

    const prefixes = optionPrefixes(d);
    const result = resolveDuplicates(d, prefixes);

    expect(prefixes.get(optA)).toBe("group/option a/");
    expect(prefixes.get(optB)).toBe("group/option b/");
    expect(result.get(fA)).toBe("common/1/shared.tex");
    expect(result.get(fB)).toBe("common/1/shared.tex");
  });
});
