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

  it("8. ClearNulls' group-level pruning: a content-free group must not occupy a collision slot ahead of a later, data-carrying group of the same name", () => {
    // WizardData.cs:1246-1263: within a surviving page, ClearNulls also removes any group whose
    // HasData is false (WizardGroupEntry.HasData, WizardData.cs:621-627 — Options.Any(x => x.HasData)).
    // `emptyReal`'s only option carries no files/manipulations, so the group itself has no data and
    // must be pruned BEFORE MakeGroupPrefix ever runs over the page's groups. If it were left in
    // place, it would claim the "same/" folder first, pushing `realGroup` (which DOES carry data,
    // and collides on the same sanitized name) to "same (1)/" instead -- a member-name divergence
    // from TexTools, which never assembles the empty group into `p.Groups` in the first place.
    const defaultGroup = group("Default", 0, [emptyOption()]);
    const emptyReal = group("Same", 0, [option("Only", { files: [] })]);
    const realGroup = group("Same", 0, [option("Only")]);
    const d = data([defaultGroup, emptyReal, realGroup]);
    const prefixes = optionPrefixes(d);

    expect(prefixes.has(emptyReal.options[0]!)).toBe(false);
    expect(prefixes.get(realGroup.options[0]!)).toBe("same/");
  });

  it("9. non-empty default + a page-0 group + a page-1 group: the shift strands the LAST created page empty instead of merging page 0", () => {
    // WizardData.cs:1118-1158 + :1234-1244 (docs/TEXTOOLS_BUGS.md #7): with a non-empty Default AND
    // more than one real page, the raw-index bug still routes the page-0 group onto the Default
    // page (DataPages[0]), but the page-1 group lands on DataPages[1] -- the page CREATED for real
    // page 0 -- because the loop always writes DataPages[g.Page] regardless of the Default-page
    // shift. The page actually created for real page 1 (DataPages[2]) is left empty and pruned by
    // ClearNulls. Net effect: two pages survive (not three), so the pN/ prefix DOES turn on, but
    // the page-0 group merges onto the Default page's folder while the page-1 group gets bumped
    // into the slot meant for page 0.
    const defaultGroup = group("Default", 0, [option("Default")]);
    const g0 = group("Everything", 0, [option("A")]);
    const g1 = group("Beta", 1, [option("Only")]);
    const d = data([defaultGroup, g0, g1]);
    const prefixes = optionPrefixes(d);

    expect(prefixes.get(defaultGroup.options[0]!)).toBe("p1/default/");
    expect(prefixes.get(g0.options[0]!)).toBe("p1/everything/");
    expect(prefixes.get(g1.options[0]!)).toBe("p2/beta/");
  });

  it("10. safeName's invalid-character substitution on an OPTION name, exercised through the multi-option branch (which actually appends oName to the path)", () => {
    // Case 7 above only exercises safeName() on a GROUP name; its group has a single option, so
    // MakeOptionPrefix's `group.options.length > 1` branch -- the one that actually appends `oName`
    // to the path -- never runs there (the single-option branch discards `oName` and returns
    // `groupFolderPath` verbatim, WizardData.cs:1443-1446). Use a multi-option group so the
    // sanitized option-name segment is actually visible in the result.
    const defaultGroup = group("Default", 0, [emptyOption()]);
    const g = group("Group", 0, [option("X<Y>Z"), option("Normal")]);
    const d = data([defaultGroup, g]);
    const prefixes = optionPrefixes(d);

    expect(prefixes.get(g.options[0]!)).toBe("group/x_y_z/");
    expect(prefixes.get(g.options[1]!)).toBe("group/normal/");
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
