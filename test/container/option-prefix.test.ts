import { describe, expect, it } from "vitest";
import { optionPrefixes } from "../../src/container/option-prefix";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../../src/model/modpack";

// Minimal builders local to this test file. `optionPrefixes` only reads name/page/selectionType/
// options and (for HasData / IsEmptyOption purposes) files/fileSwaps/manipulations, so these
// builders fill in only what's needed to drive those checks.

function file(gamePath = "a.tex"): ModpackFile {
  return {
    gamePath,
    data: new Uint8Array([1]),
    storage: FileStorageType.RawUncompressed,
  };
}

function option(
  name: string,
  opts: { files?: ModpackFile[]; fileSwaps?: Record<string, string> } = {},
): ModpackOption {
  return {
    name,
    description: "",
    image: "",
    priority: 0,
    files: opts.files ?? [file()],
    fileSwaps: opts.fileSwaps ?? {},
    manipulations: [],
  };
}

/** An empty (IsEmptyOption-true) option, for a Default group that should NOT get its own page. */
function emptyOption(name = ""): ModpackOption {
  return option(name, { files: [] });
}

function group(
  name: string,
  page: number,
  options: ModpackOption[],
): ModpackGroup {
  return {
    name,
    description: "",
    image: "",
    page,
    priority: 0,
    selectionType: options.length > 1 ? "Multi" : "Single",
    defaultSettings: 0,
    options,
  };
}

function data(groups: ModpackGroup[]): ModpackData {
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

describe("optionPrefixes", () => {
  it("1. empty default + one single-option group: default gets no entry, group collapses to '<group>/'", () => {
    const defaultGroup = group("Default", 0, [emptyOption()]);
    const g = group("Black Veil", 0, [option("Black Veil")]);
    const d = data([defaultGroup, g]);
    const prefixes = optionPrefixes(d);

    expect(prefixes.has(defaultGroup.options[0]!)).toBe(false);
    expect(prefixes.get(g.options[0]!)).toBe("black veil/");
  });

  it("2. multi-option group -> '<group>/<option>/'", () => {
    const defaultGroup = group("Default", 0, [emptyOption()]);
    const g = group("Other Group", 0, [option("Option A"), option("Option B")]);
    const d = data([defaultGroup, g]);
    const prefixes = optionPrefixes(d);

    expect(prefixes.get(g.options[0]!)).toBe("other group/option a/");
    expect(prefixes.get(g.options[1]!)).toBe("other group/option b/");
  });

  it("3. two real groups on separate pages (no default): pN/ turns on, single-option groups get no option segment", () => {
    const defaultGroup = group("Default", 0, [emptyOption()]);
    const g0 = group("Alpha", 0, [option("Only")]);
    const g1 = group("Beta", 1, [option("Only")]);
    const d = data([defaultGroup, g0, g1]);
    const prefixes = optionPrefixes(d);

    expect(prefixes.get(g0.options[0]!)).toBe("p1/alpha/");
    expect(prefixes.get(g1.options[0]!)).toBe("p2/beta/");
  });

  it("4. duplicate option names within one group -> the uniquifying suffix", () => {
    const defaultGroup = group("Default", 0, [emptyOption()]);
    const g = group("Colors", 0, [option("Red"), option("Red")]);
    const d = data([defaultGroup, g]);
    const prefixes = optionPrefixes(d);

    expect(prefixes.get(g.options[0]!)).toBe("colors/red/");
    expect(prefixes.get(g.options[1]!)).toBe("colors/red (1)/");
  });

  it("4b. a third identical option name increments past (1) -> (2) (MakeOptionPrefix's loop DOES increment)", () => {
    const defaultGroup = group("Default", 0, [emptyOption()]);
    const g = group("Colors", 0, [option("Red"), option("Red"), option("Red")]);
    const d = data([defaultGroup, g]);
    const prefixes = optionPrefixes(d);

    expect(prefixes.get(g.options[0]!)).toBe("colors/red/");
    expect(prefixes.get(g.options[1]!)).toBe("colors/red (1)/");
    expect(prefixes.get(g.options[2]!)).toBe("colors/red (2)/");
  });

  it("5. blank group/option names substitute the capitalized literal, NOT re-path-safed", () => {
    const defaultGroup = group("Default", 0, [emptyOption()]);
    const g = group("", 0, [option(""), option("Foo")]);
    const d = data([defaultGroup, g]);
    const prefixes = optionPrefixes(d);

    expect(prefixes.get(g.options[0]!)).toBe("Blank Group/Blank Option/");
    expect(prefixes.get(g.options[1]!)).toBe("Blank Group/foo/");
  });

  it("6. non-empty default + a page-0 group: FromPmp's page-index bug merges the group onto the Default page (no pN/)", () => {
    // WizardData.cs:1118-1158: the Default page is unshifted onto DataPages[0]; the page created
    // for the real group's page 0 is then assigned via DataPages[g.Page] === DataPages[0], i.e. the
    // Default page, not the page created for it. ClearNulls (WizardData.cs:1234-1244) then drops
    // the now-empty created page, leaving DataPages.Count === 1: no pN/ prefix at all, and the real
    // group's files merge directly under the (still page-less) Default page instead of getting
    // their own page. See docs/TEXTOOLS_BUGS.md #1.
    const defaultGroup = group("Default", 0, [option("Default")]);
    const g = group("Everything", 0, [option("A"), option("B")]);
    const d = data([defaultGroup, g]);
    const prefixes = optionPrefixes(d);

    expect(prefixes.get(defaultGroup.options[0]!)).toBe("default/");
    expect(prefixes.get(g.options[0]!)).toBe("everything/a/");
    expect(prefixes.get(g.options[1]!)).toBe("everything/b/");
  });

  it("7. names are lowercased and path-safed via safeName (invalid Windows filename chars)", () => {
    const defaultGroup = group("Default", 0, [emptyOption()]);
    const g = group("A:B*C?", 0, [option("X<Y>Z")]);
    const d = data([defaultGroup, g]);
    const prefixes = optionPrefixes(d);

    // safeName lowercases and replaces invalid chars with '_' (PMP.cs:1316-1326 -> IOUtil.cs).
    expect(prefixes.get(g.options[0]!)).toBe("a_b_c_/");
  });

  it("MakeGroupPrefix's non-incrementing collision loop throws rather than hanging on a 3-way collision", () => {
    // Three groups that all sanitize to the same folder name: the first claims "same/", the second
    // claims "same (1)/" (one retry succeeds), and the third would ALSO need "same (1)/" since the
    // C#'s loop counter never increments past 1 -- an infinite loop in the original. We throw
    // instead (docs/TEXTOOLS_BUGS.md #6).
    const defaultGroup = group("Default", 0, [emptyOption()]);
    const g0 = group("Same", 0, [option("Only")]);
    const g1 = group("Same", 0, [option("Only")]);
    const g2 = group("Same", 0, [option("Only")]);
    const d = data([defaultGroup, g0, g1, g2]);

    expect(() => optionPrefixes(d)).toThrow(/WizardData\.cs:1406-1409/);
  });
});
