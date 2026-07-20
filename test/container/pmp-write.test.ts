import { describe, expect, it } from "vitest";
import type {
  PmpGroupJson,
  PmpMetaJson,
  PmpOptionJson,
} from "../../src/container/manifest-types";
import { readPmp, writePmp } from "../../src/container/pmp";
import {
  allFiles,
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../../src/model/modpack";
import { readZip, writeZip } from "../../src/zip/zip";
import { filesMap, makePmpZip } from "../helpers/make-packs";
import { pmpSelfConsistency } from "../helpers/pmp-self-consistency";

const dec = new TextDecoder();
function parseEntry<T>(entries: Map<string, Uint8Array>, name: string): T {
  return JSON.parse(dec.decode(entries.get(name)!)) as T;
}

// A COMPLETE Imc manipulation: every field PMPImcManipulationJson/PMPImcEntry declare (minus the
// [JsonIgnore] AttributeAndSound — see pmp-manipulation.ts) present. normalizeManipulations THROWS
// on a manipulation missing a required field (pmp-manipulation.test.ts pins that); these fixtures
// only need a manipulation that round-trips unchanged, not to exercise normalization itself.
const IMC_MANIPULATION = {
  Type: "Imc",
  Manipulation: {
    Entry: {
      MaterialId: 1,
      DecalId: 0,
      VfxId: 0,
      MaterialAnimationId: 0,
      AttributeMask: 0,
      SoundId: 0,
    },
    ObjectType: "Equipment",
    PrimaryId: 1,
    SecondaryId: 0,
    Variant: 1,
    EquipSlot: "Body",
    BodySlot: "Unknown",
  },
};

describe("writePmp round-trip", () => {
  it("preserves inner files byte-for-byte and re-reads structurally", () => {
    const pack = makePmpZip();
    const out = writePmp(readPmp(pack.bytes));
    const reread = readPmp(out);
    const byPath = new Map(
      allFiles(reread).map(({ gamePath, file }) => [gamePath, file.data]),
    );
    for (const [path, bytes] of Object.entries(pack.expectedFiles)) {
      expect(byPath.get(path)).toEqual(bytes);
    }
  });

  it("emits meta.json, default_mod.json and a numbered group file", () => {
    const out = writePmp(readPmp(makePmpZip().bytes));
    const names = [...readZip(out).keys()];
    expect(names).toContain("meta.json");
    expect(names).toContain("default_mod.json");
    expect(names.some((n) => /^group_001_.*\.json$/.test(n))).toBe(true);
  });

  // A non-empty FileSwaps map is preserved verbatim through a read -> write round trip: this is
  // distinct from (and not covered by) the golden-harness carve-out in upgrade-archive-diff.ts,
  // which only confirms "golden empty, ours non-empty" -- TexTools always writes `{}`
  // (PopulatePmpStandardOption, PMP.cs:873-875), so the golden carries zero signal on whether the
  // VALUE we emit is the source's own swaps or something invented. This asserts the exact
  // key/value pairs -- including the backslashed value form Penumbra writes -- survive unchanged,
  // for both an `optionToJson` call site that includes meta (a group option) and one that doesn't
  // (default_mod.json, PMP.cs:1499-1501). See
  // docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md §3 and
  // src/container/pmp.ts:437 (`base.FileSwaps = o.fileSwaps`).
  it("carries a non-empty FileSwaps map through read -> write unchanged", () => {
    const enc = new TextEncoder();
    const defaultFile = "chara/equipment/default_holder.tex";
    const groupFile = "chara/equipment/group_holder.tex";
    const defaultSwaps = {
      "chara/dummy/swap_dest_1.tex":
        "chara\\equipment\\e6120\\texture\\v01_c0101e6120_top_n.tex",
      "chara/dummy/swap_dest_2.tex":
        "chara\\equipment\\e6120\\texture\\v01_c0101e6120_top_m.tex",
    };
    const groupSwaps = {
      "chara/dummy/swap_dest_3.tex":
        "chara\\equipment\\e6120\\texture\\v01_c0101e6120_dif.tex",
    };
    const meta = {
      FileVersion: 3,
      Name: "Swap Test",
      Author: "test",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = {
      Version: 0,
      Files: { [defaultFile]: defaultFile.replace(/\//g, "\\") },
      FileSwaps: defaultSwaps,
      Manipulations: [],
    };
    const group = {
      Version: 0,
      Name: "Choice",
      Description: "",
      Type: "Single",
      Priority: 0,
      DefaultSettings: 0,
      Options: [
        {
          Name: "A",
          Description: "",
          Image: "",
          Files: { [groupFile]: groupFile.replace(/\//g, "\\") },
          FileSwaps: groupSwaps,
          Manipulations: [],
        },
      ],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta, null, 2))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod, null, 2))],
      ["group_001_Choice.json", enc.encode(JSON.stringify(group, null, 2))],
      [defaultFile.replace(/\//g, "\\"), new Uint8Array([1, 2, 3])],
      [groupFile.replace(/\//g, "\\"), new Uint8Array([4, 5, 6])],
    ]);
    const out = writePmp(readPmp(writeZip(entries)));
    const written = readZip(out);
    const writtenDefault = parseEntry<{ FileSwaps: Record<string, string> }>(
      written,
      "default_mod.json",
    );
    const writtenGroup = parseEntry<{
      Options: Array<{ FileSwaps: Record<string, string> }>;
    }>(written, "group_001_choice.json");
    expect(writtenDefault.FileSwaps).toEqual(defaultSwaps);
    expect(writtenGroup.Options[0]!.FileSwaps).toEqual(groupSwaps);
  });
});

// The corpus only holds real PMPs, so writePmp's carry-through path (raw !== undefined)
// is well covered but the model-building fallback — used when a non-PMP source (e.g. a
// ttmp2 converted to the model) has no raw JSON to re-emit — is not. These build a
// ModpackData with no `raw` anywhere and assert writePmp synthesizes the PMP JSON from
// the modeled fields.
describe("writePmp model-building fallback (no raw)", () => {
  const fooBytes = new Uint8Array([1, 2, 3, 4]);
  const redBytes = new Uint8Array([9, 9]);

  // Both groups sit on page 0: the Default group and "Color Options" are then merged onto the
  // same (page-index-bug-affected) page, so option-prefix.ts assigns "default/" and
  // "color options/" respectively (option-prefix.test.ts case 6) rather than pulling in a "pN/"
  // segment — keeping this fixture's expected paths independent of the page-numbering quirks
  // that module already pins on its own.
  function modeledData(): ModpackData {
    return {
      sourceFormat: ModpackFormat.Ttmp2, // non-PMP source -> nothing carries `raw`
      isSimple: false,
      meta: {
        name: "Modeled Mod",
        author: "Tester",
        version: "1.2.3",
        description: "built from the model, no raw",
        url: "https://example.invalid",
        image: "preview.png",
        tags: ["tagA", "tagB"],
        minimumFrameworkVersion: "1.0.0.0",
      },
      groups: [
        {
          name: "Default",
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: "",
              description: "",
              image: "",
              priority: 0,
              selected: false,
              files: filesMap([
                [
                  "chara/equipment/foo.tex",
                  { data: fooBytes, storage: FileStorageType.RawUncompressed },
                ],
              ]),
              fileSwaps: {},
              manipulations: [],
            },
          ],
        },
        {
          name: "Color Options",
          description: "pick one",
          image: "grp.png",
          page: 0,
          priority: 5,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: "Red",
              description: "the red one",
              image: "red.png",
              priority: 2,
              selected: false,
              files: filesMap([
                [
                  "chara/equipment/red.tex",
                  { data: redBytes, storage: FileStorageType.RawUncompressed },
                ],
              ]),
              // FileSwaps left empty here -- this fixture isn't exercising FileSwap
              // preservation (a non-empty map is deliberately carried through unchanged, not
              // rejected -- see the round-trip test above and
              // docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md).
              fileSwaps: {},
              // Every field a real PMPImcManipulationJson declares must be present: a document
              // omitting one is NOT modeled as "absent from the output" (a bare `{ Type: "Imc" }`
              // used to be pinned here, silently inventing that shape — see
              // pmp-manipulation.test.ts and
              // docs/backlog/2026-07-13-pmp-manipulation-field-defaults.md).
              manipulations: [IMC_MANIPULATION],
            },
          ],
        },
      ],
    };
  }

  it("synthesizes meta.json from the modeled meta fields", () => {
    const entries = readZip(writePmp(modeledData()));
    const meta = parseEntry<PmpMetaJson>(entries, "meta.json");
    expect(meta.FileVersion).toBe(3);
    expect(meta.Name).toBe("Modeled Mod");
    expect(meta.Author).toBe("Tester");
    expect(meta.Version).toBe("1.2.3");
    expect(meta.Description).toBe("built from the model, no raw");
    expect(meta.Website).toBe("https://example.invalid");
    expect(meta.Image).toBe("preview.png");
    expect(meta.ModTags).toEqual(["tagA", "tagB"]);
  });

  it("builds default_mod.json from the default option without option-meta fields", () => {
    const entries = readZip(writePmp(modeledData()));
    const def = parseEntry<PmpOptionJson>(entries, "default_mod.json");
    // includeMeta=false for the default option -> no Name/Description/Image.
    expect(def.Name).toBeUndefined();
    expect(def.Description).toBeUndefined();
    expect(def.Image).toBeUndefined();
    // Files value uses backslashes in the JSON; the zip path is regenerated as
    // optionPrefix + gamePath ("default/" for the lone Default-group option, option-prefix.ts).
    expect(def.Files).toEqual({
      "chara/equipment/foo.tex": "default\\chara\\equipment\\foo.tex",
    });
    expect(def.FileSwaps).toEqual({});
    expect(def.Manipulations).toEqual([]);
  });

  it("builds a numbered group file from the modeled group and its options", () => {
    const entries = readZip(writePmp(modeledData()));
    const groupName = [...entries.keys()].find((n) =>
      /^group_001_.*\.json$/.test(n),
    );
    expect(groupName).toBeDefined();
    const grp = parseEntry<PmpGroupJson>(entries, groupName as string);
    expect(grp.Name).toBe("Color Options");
    expect(grp.Type).toBe("Single");
    expect(grp.Description).toBe("pick one");
    expect(grp.Image).toBe("grp.png");
    expect(grp.Page).toBe(0);
    expect(grp.Priority).toBe(5);
    expect(grp.DefaultSettings).toBe(0);
    expect(grp.Options).toHaveLength(1);
    // includeMeta=true for group options -> Name/Description/Image present.
    const opt = grp.Options?.[0] as PmpOptionJson;
    expect(opt.Name).toBe("Red");
    expect(opt.Description).toBe("the red one");
    expect(opt.Image).toBe("red.png");
    // "Color Options" has one option -> group.options.length === 1 -> no extra option segment
    // (makeOptionPrefix, option-prefix.ts); prefix is just the group's own "color options/".
    expect(opt.Files).toEqual({
      "chara/equipment/red.tex": "color options\\chara\\equipment\\red.tex",
    });
    expect(opt.FileSwaps).toEqual({});
    // Manipulations regenerated per pmp-manipulation.ts: a fully-spelled Imc manipulation
    // round-trips unchanged (no [JsonIgnore] field present to drop, no numeric-string field to
    // coerce) -- see pmp-manipulation.test.ts for those behaviours in isolation.
    expect(opt.Manipulations).toEqual([IMC_MANIPULATION]);
  });

  it("round-trips the modeled file bytes back through readPmp", () => {
    const reread = readPmp(writePmp(modeledData()));
    const byPath = new Map(
      allFiles(reread).map(({ gamePath, file }) => [gamePath, file.data]),
    );
    expect(byPath.get("chara/equipment/foo.tex")).toEqual(fooBytes);
    expect(byPath.get("chara/equipment/red.tex")).toEqual(redBytes);
  });

  // Covers the absent-file skip in optionToJson's Files-building loop (pmp.ts, PMP.cs:883-888) on
  // the model-building (non-`raw`) branch — every other absent-file test in this file goes through
  // the `raw`-carry branch instead, because a PMP source (unlike this modeled, no-`raw` data)
  // always has one.
  it("drops an absent file from Files in the model-building branch, keeping present ones", () => {
    const data = modeledData();
    const redOption = data.groups[1]!.options[0]!;
    redOption.files.set("chara/equipment/missing.tex", {
      storage: FileStorageType.RawUncompressed,
      // no `data` -> absent (PMP.cs:883-888)
    });

    const entries = readZip(writePmp(data));
    const groupName = [...entries.keys()].find((n) =>
      /^group_001_.*\.json$/.test(n),
    );
    expect(groupName).toBeDefined();
    const grp = parseEntry<PmpGroupJson>(entries, groupName as string);
    const opt = grp.Options?.[0] as PmpOptionJson;
    expect(opt.Files).toEqual({
      "chara/equipment/red.tex": "color options\\chara\\equipment\\red.tex",
    });
    expect(Object.keys(opt.Files)).not.toContain("chara/equipment/missing.tex");
  });
});

// Port of WizardData.WritePmp's ExtraFiles copy-back (WizardData.cs:1477-1488), the write side of
// the readPmp ExtraFiles scan (PMP.cs:213-215) tested in pmp-read.test.ts.
describe("writePmp ExtraFiles (WizardData.cs:1477-1488)", () => {
  const enc = new TextEncoder();
  const gamePath = "chara/equipment/e0001/model/c0101e0001_top.mdl";
  // The lone Default-group option's regenerated zip path ("default/" + gamePath, option-prefix.ts).
  const payloadZipPath = `default/${gamePath}`;
  const filePayload = new Uint8Array([1, 2, 3, 4]);
  const extraPayload = new Uint8Array([9, 9, 9]);

  function buildEntries(): Map<string, Uint8Array> {
    const meta = {
      FileVersion: 3,
      Name: "Extras",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = {
      Version: 0,
      Files: { [gamePath]: gamePath.replace(/\//g, "\\") },
      FileSwaps: {},
      Manipulations: [],
    };
    return new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
      [gamePath, filePayload],
      ["images/preview.png", extraPayload],
    ]);
  }

  it("round-trips an unreferenced member as a written zip member", () => {
    const out = writePmp(readPmp(writeZip(buildEntries())));
    const members = readZip(out);
    expect(members.get("images/preview.png")).toEqual(extraPayload);
    expect(members.get(payloadZipPath)).toEqual(filePayload);
  });

  it("does not duplicate/collide a payload member with an extra of the same name", () => {
    // Construct a ModpackData directly: an extra whose key collides with the real payload
    // member's REGENERATED zip path. readPmp can never actually produce this (a referenced
    // member is never an extra — see pmp-read.test.ts), so this exercises writePmp's own
    // defensive `!entries.has()` guard.
    const data = readPmp(writeZip(buildEntries()));
    data.extraFiles = new Map([[payloadZipPath, extraPayload]]);

    const out = writePmp(data);
    const members = readZip(out);
    // The payload write happens first, so it must win over the colliding extra.
    expect(members.get(payloadZipPath)).toEqual(filePayload);
  });
});

describe("writePmp payload naming collision guard (PMP.cs:908-910 / :864-868)", () => {
  // Regenerated names should only ever collide (after windowsPathKey's NTFS-equivalent
  // normalization) for IDENTICAL content — resolveDuplicates content-dedups identical bytes onto
  // one shared path already, so two DIFFERENT zip-path strings colliding via windowsPathKey
  // normalization (not by being the same string) can only happen for genuinely different
  // content, which means the naming scheme itself produced a bad collision. Two group names
  // "Choice" and "Choice." both safeName to distinct strings ("choice"/"choice.", safeName does
  // not strip a non-"."/".." name's interior/trailing dots) — MakeGroupPrefix therefore does NOT
  // treat them as colliding and assigns each its own folder — but windowsPathKey DOES trim a
  // trailing dot per path segment (the NTFS-equivalent normalization the WRITER's own directory
  // write applies, matching the reader), so "choice./..." and "choice/..." collapse to the same
  // on-disk entry once actually written.
  function buildData(secondBytes: Uint8Array): ModpackData {
    const gamePath = "chara/x.mdl";
    const group = (name: string, data: Uint8Array) => ({
      name,
      description: "",
      image: "",
      page: 0,
      priority: 0,
      selectionType: "Single",
      defaultSettings: 0,
      options: [
        {
          name: "Only",
          description: "",
          image: "",
          priority: 0,
          selected: false,
          files: filesMap([
            [gamePath, { data, storage: FileStorageType.RawUncompressed }],
          ]),
          fileSwaps: {},
          manipulations: [],
        },
      ],
    });
    return {
      sourceFormat: ModpackFormat.Ttmp2,
      isSimple: false,
      meta: {
        name: "Collision",
        author: "",
        version: "",
        description: "",
        url: "",
        image: "",
        tags: [],
        minimumFrameworkVersion: "1.0.0.0",
      },
      groups: [
        {
          name: "Default",
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [],
        },
        group("Choice", new Uint8Array([1, 2, 3])),
        group("Choice.", secondBytes),
      ],
    };
  }

  it("collapses to one member when the colliding names carry IDENTICAL bytes", () => {
    // IDENTICAL bytes across "Choice" and "Choice." never actually reach the windowsPathKey
    // collapse as two DIFFERENT strings: resolveDuplicates already content-dedups equal hashes
    // onto one shared `common/{idx}/` path first, so both options resolve to the exact same zip
    // path before writePmp's own collapse loop ever runs. This still exercises that loop (it sees
    // the same key/path assigned twice) without tripping the throw.
    const out = writePmp(buildData(new Uint8Array([1, 2, 3])));
    const members = readZip(out);
    expect(members.has("common/1/x.mdl")).toBe(true);
    expect(members.has("choice/chara/x.mdl")).toBe(false);
    expect(members.has("choice./chara/x.mdl")).toBe(false);
    expect(members.get("common/1/x.mdl")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("throws when the colliding names carry DIFFERENT bytes", () => {
    expect(() => writePmp(buildData(new Uint8Array([9, 9, 9])))).toThrow(
      /collapsed onto the same zip member/,
    );
  });
});

describe("writePmp default-mod absorption searches DataPages order, not just the real groups (WizardData.cs:1118-1138/:1553-1578)", () => {
  // The absorption search must consider the SYNTHESIZED Default group (data.groups[0], built from
  // default_mod.json) ahead of any REAL group, because FromPmp unshifts it onto the FRONT of
  // DataPages whenever default_mod.json is non-empty and hardcodes its Name/Options[0].Name to the
  // literal "Default" (WizardData.cs:1118-1138) -- so it ALWAYS wins the search whenever it
  // survives. A pack with BOTH a non-empty default_mod.json AND a real "Default" group (one option,
  // named "Default") used to search only the real groups, absorbing the REAL group's data into
  // default_mod.json while the synthesized Default option's own (already-written) payload member
  // was named by no `Files` key anywhere -- an orphan member, the exact defect class the writer
  // regeneration exists to prevent.
  const enc = new TextEncoder();
  const defaultGamePath = "chara/default.tex";
  const realGamePath = "chara/other.tex";

  function buildFixture(): Uint8Array {
    const meta = {
      FileVersion: 3,
      Name: "Absorb",
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
        [defaultGamePath]: `on\\${defaultGamePath.replace(/\//g, "\\")}`,
      },
      FileSwaps: {},
      Manipulations: [],
    };
    const group = {
      Version: 0,
      Name: "Default",
      Description: "",
      Image: "",
      Page: 0,
      Priority: 0,
      Type: "Single",
      DefaultSettings: 0,
      Options: [
        {
          Name: "Default",
          Description: "",
          Image: "",
          Files: {
            [realGamePath]: `grp\\${realGamePath.replace(/\//g, "\\")}`,
          },
          FileSwaps: {},
          Manipulations: [],
        },
      ],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta, null, 2))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod, null, 2))],
      ["group_001_Default.json", enc.encode(JSON.stringify(group, null, 2))],
      [`on/${defaultGamePath}`, new Uint8Array([1, 2, 3])],
      [`grp/${realGamePath}`, new Uint8Array([4, 5, 6])],
    ]);
    return writeZip(entries);
  }

  it("absorbs the SYNTHESIZED default group's own data, leaves the real 'Default' group its own group_NNN.json, and produces no orphan/dangling member", () => {
    const out = writePmp(readPmp(buildFixture()));
    const members = readZip(out);

    const dm = parseEntry<PmpOptionJson>(members, "default_mod.json");
    // Regression pin: default_mod.json must carry the SOURCE default_mod's own file, not the real
    // "Default" group's.
    expect(Object.keys(dm.Files)).toEqual([defaultGamePath]);
    expect(dm.Files[defaultGamePath]).toBe(
      `default\\${defaultGamePath.replace(/\//g, "\\")}`,
    );

    // The real "Default" group must still be written as its own group_NNN.json (NOT absorbed).
    const groupNames = [...members.keys()].filter((n) =>
      /^group_\d+.*\.json$/i.test(n),
    );
    expect(groupNames).toHaveLength(1);
    const grp = parseEntry<PmpGroupJson>(members, groupNames[0]!);
    const opt = grp.Options![0] as PmpOptionJson;
    expect(Object.keys(opt.Files)).toEqual([realGamePath]);

    // The property that actually matters: every payload member is named by some `Files`/`Image`
    // key, and every `Files` value names a real member -- no orphans, no dangling references.
    expect(pmpSelfConsistency(out, new Set())).toEqual([]);
  });
});

describe("writePmp trims group/option names (WizardData.cs:1510/:946/:928)", () => {
  // WritePmp trims THREE places: `g.Name = g.Name.Trim();` (:1510, mutating every group in place,
  // in the SAME loop that builds `allFiles`/`identifiers` -- BEFORE the default-mod absorption
  // search runs, :1553-1578), then `pg.Name = (Name ?? "").Trim();` (:946) and
  // `option.Name = option.Name.Trim();` (:928), both inside ToPmpGroup. Because :1510 mutates the
  // group's Name in place ACROSS ALL groups before the absorption search ever looks at it, the
  // search's `g.Name == "Default"` comparison sees the TRIMMED name -- so a real group literally
  // named "Default " (trailing space) IS absorbed into default_mod.json, a structural (not just
  // cosmetic) consequence. `option.Name`'s trim, by contrast, only ever happens inside ToPmpGroup,
  // which the absorption search calls AFTER its own name comparison already matched/failed -- so
  // the search's OWN `Options[0].Name == "Default"` check compares the UNTRIMMED option name; only
  // the emitted `Name` value downstream is affected.
  function modeledGroup(name: string, optionName: string): ModpackData {
    return {
      sourceFormat: ModpackFormat.Ttmp2,
      isSimple: false,
      meta: {
        name: "Trim",
        author: "",
        version: "",
        description: "",
        url: "",
        image: "",
        tags: [],
        minimumFrameworkVersion: "1.0.0.0",
      },
      groups: [
        {
          name: "Default",
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: "",
              description: "",
              image: "",
              priority: 0,
              selected: false,
              files: filesMap([]), // empty -> IsEmptyOption -> no synthesized Default page at all
              fileSwaps: {},
              manipulations: [],
            },
          ],
        },
        {
          name,
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: optionName,
              description: "",
              image: "",
              priority: 0,
              selected: false,
              files: filesMap([
                [
                  "chara/x.tex",
                  {
                    data: new Uint8Array([1, 2, 3]),
                    storage: FileStorageType.RawUncompressed,
                  },
                ],
              ]),
              fileSwaps: {},
              manipulations: [],
            },
          ],
        },
      ],
    };
  }

  it("absorbs a group literally named 'Default ' (trailing space) into default_mod.json -- the trimmed name matches the absorption predicate", () => {
    const out = readZip(writePmp(modeledGroup("Default ", "Default")));

    const groupNames = [...out.keys()].filter((n) =>
      /^group_\d+.*\.json$/i.test(n),
    );
    expect(groupNames).toHaveLength(0); // absorbed -- no group_NNN.json at all

    const dm = parseEntry<PmpOptionJson>(out, "default_mod.json");
    expect(dm.Files).toEqual({ "chara/x.tex": "default\\chara\\x.tex" });
  });

  it("trims leading/trailing whitespace off the emitted group Name and option Name (WizardData.cs:946/928)", () => {
    // "  Hair  " does not match "Default"/"Default Group" even trimmed, so it is written as its own
    // group_NNN.json rather than absorbed -- exercising the emitted-Name trim in isolation.
    const out = readZip(writePmp(modeledGroup("  Hair  ", "  Red  ")));

    const groupName = [...out.keys()].find((n) =>
      /^group_\d+.*\.json$/i.test(n),
    );
    expect(groupName).toBeDefined();
    const grp = parseEntry<PmpGroupJson>(out, groupName as string);
    expect(grp.Name).toBe("Hair");
    const opt = grp.Options?.[0] as PmpOptionJson;
    expect(opt.Name).toBe("Red");
  });
});

describe("writePmp regenerates DefaultSettings from Selection (WizardData.cs:578-604)", () => {
  // TexTools never carries a source DefaultSettings value through verbatim: ToPmpGroup writes
  // `pg.DefaultSettings = Selection` (:949), and `Selection` is a GETTER recomputed from each
  // option's `Selected` flag. These cases drive that getter directly off the model's `selected`
  // flags; the READ-side derivation that populates them (FromPMPGroup :805-813 plus the "none
  // selected" backstop :857-860) is pinned separately by pmp-selected.test.ts.
  function modeledGroup(
    selectionType: "Single" | "Multi",
    selected: boolean[],
    defaultSettings = 0,
  ): ModpackData {
    const optionCount = selected.length;
    const options = Array.from({ length: optionCount }, (_, i) => ({
      name: `Opt${i}`,
      description: "",
      image: "",
      priority: 0,
      selected: selected[i] ?? false,
      files: filesMap([
        [
          `chara/${i}.tex`,
          {
            data: new Uint8Array([i]),
            storage: FileStorageType.RawUncompressed as const,
          },
        ],
      ]),
      fileSwaps: {},
      manipulations: [],
    }));
    return {
      sourceFormat: ModpackFormat.Ttmp2,
      isSimple: false,
      meta: {
        name: "Selection",
        author: "",
        version: "",
        description: "",
        url: "",
        image: "",
        tags: [],
        minimumFrameworkVersion: "1.0.0.0",
      },
      groups: [
        {
          name: "Default",
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: "",
              description: "",
              image: "",
              priority: 0,
              selected: false,
              files: filesMap([]),
              fileSwaps: {},
              manipulations: [],
            },
          ],
        },
        {
          name: "Choice",
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType,
          defaultSettings,
          options,
        },
      ],
    };
  }

  function readGroupDefaultSettings(out: Uint8Array): number {
    const entries = readZip(out);
    const groupName = [...entries.keys()].find((n) =>
      /^group_\d+.*\.json$/i.test(n),
    );
    if (!groupName) throw new Error("no group_NNN.json in output");
    return parseEntry<PmpGroupJson>(entries, groupName).DefaultSettings;
  }

  it("Single -> the index of the selected option (:589 `Options.IndexOf(op)`)", () => {
    const out = writePmp(modeledGroup("Single", [false, false, true]));
    expect(readGroupDefaultSettings(out)).toBe(2);
  });

  it("Single with nothing selected -> 0 (:585-588 `FirstOrDefault` == null)", () => {
    // Neither reader can normally leave a Single group in this state (both apply the "none
    // selected" backstop), but the getter's own null branch returns 0 regardless.
    const out = writePmp(modeledGroup("Single", [false, false]));
    expect(readGroupDefaultSettings(out)).toBe(0);
  });

  it("Single with several selected -> the FIRST one wins; the getter does not clamp (:584)", () => {
    const out = writePmp(modeledGroup("Single", [false, true, true]));
    expect(readGroupDefaultSettings(out)).toBe(1);
  });

  it("Multi -> a bitmask ORing bit i per selected option (:593-602)", () => {
    const out = writePmp(modeledGroup("Multi", [true, false, true, true]));
    expect(readGroupDefaultSettings(out)).toBe(0b1101);
  });

  it("Multi with nothing selected -> 0, with no backstop", () => {
    const out = writePmp(modeledGroup("Multi", [false, false, false]));
    expect(readGroupDefaultSettings(out)).toBe(0);
  });

  it("the source group's own defaultSettings is ignored -- Selection is regenerated from the flags", () => {
    // ToPmpGroup assigns `pg.DefaultSettings = Selection` (:949), never the value it read. A legacy
    // `-1` source (CustomUInt64Converter's ulong.MaxValue shim, PMP.cs:1558-1571) must not survive.
    const out = writePmp(modeledGroup("Multi", [false, true, false], -1));
    expect(readGroupDefaultSettings(out)).toBe(0b010);
  });
});

describe("writePmp regenerates Page from ClearNulls-pruned pages (WizardData.cs:1246-1263/:1583-1600)", () => {
  // ClearNulls' group-level prune (WizardData.cs:1246-1263, `if (g == null || !g.HasData)`) reduces
  // to a purely STRUCTURAL check on our load paths -- WizardOptionEntry.HasData's Read-mode
  // short-circuit (WizardData.cs:257-266) means a group with content-FREE options still survives (see
  // option-prefix.ts's module header comment and option-prefix.test.ts case 8); only a group with
  // literally ZERO options is ever pruned. "Empty" (page 1) models that: an authored group with no
  // options at all. Since it was the only occupant of page 1, the whole page is pruned too
  // (WizardData.cs:1234-1244), leaving 2 surviving pages (0 and 2's content). WritePmp's own `Page`
  // counter only increments per DataPages entry that contributed a WRITTEN group
  // (WizardData.cs:1583-1600), so "Gamma" (source page 2) must be renumbered to Page 1, not 2, and
  // "Empty" (zero options -> pruned) must never become a group_NNN.json.
  function buildData(): ModpackData {
    const group = (
      name: string,
      page: number,
      files: { gamePath: string; data: Uint8Array }[],
    ) => ({
      name,
      description: "",
      image: "",
      page,
      priority: 0,
      selectionType: "Single" as const,
      defaultSettings: 0,
      options: [
        {
          name: "Only",
          description: "",
          image: "",
          priority: 0,
          selected: false,
          files: filesMap(
            files.map((f) => [
              f.gamePath,
              { data: f.data, storage: FileStorageType.RawUncompressed },
            ]),
          ),
          fileSwaps: {},
          manipulations: [],
        },
      ],
    });
    return {
      sourceFormat: ModpackFormat.Ttmp2,
      isSimple: false,
      meta: {
        name: "Prune",
        author: "",
        version: "",
        description: "",
        url: "",
        image: "",
        tags: [],
        minimumFrameworkVersion: "1.0.0.0",
      },
      groups: [
        group("Default", 0, []), // empty -> IsEmptyOption -> no synthesized Default page at all
        group("Alpha", 0, [
          { gamePath: "chara/a.tex", data: new Uint8Array([1]) },
        ]),
        {
          name: "Empty",
          description: "",
          image: "",
          page: 1,
          priority: 0,
          selectionType: "Single" as const,
          defaultSettings: 0,
          options: [], // zero options -> groupHasData false (option-prefix.ts) -> pruned entirely
        },
        group("Gamma", 2, [
          { gamePath: "chara/g.tex", data: new Uint8Array([2]) },
        ]),
      ],
    };
  }

  it("omits 'Empty's group_NNN.json and renumbers 'Gamma's Page across only the 2 surviving pages", () => {
    const out = readZip(writePmp(buildData()));
    const groupNames = [...out.keys()]
      .filter((n) => /^group_\d+.*\.json$/i.test(n))
      .sort();
    expect(groupNames).toHaveLength(2); // NOT 3 -- "Empty" never becomes a group_NNN.json
    const g1 = parseEntry<PmpGroupJson>(out, groupNames[0]!);
    const g2 = parseEntry<PmpGroupJson>(out, groupNames[1]!);
    expect(g1.Name).toBe("Alpha");
    expect(g1.Page).toBe(0);
    expect(g2.Name).toBe("Gamma");
    expect(g2.Page).toBe(1); // NOT 2 (the source g.page) -- recomputed over surviving pages only
  });
});

describe("writePmp keeps a content-free group (WizardOptionEntry.HasData Read-mode short-circuit, WizardData.cs:257-266)", () => {
  // A group whose lone option carries no files/fileSwaps/manipulations at all (e.g. because EVERY
  // one of its raw Files entries was canImport-rejected) is NOT pruned by TexTools: it is written as
  // its own group_NNN.json with an empty "Files": {}. Pruning it would port WizardOptionEntry.
  // HasData's content check — a branch that is dead code on every load path this port reaches, since
  // ModOption is always set there (see option-prefix.ts's header comment).
  function buildData(): ModpackData {
    return {
      sourceFormat: ModpackFormat.Ttmp2,
      isSimple: false,
      meta: {
        name: "Keep",
        author: "",
        version: "",
        description: "",
        url: "",
        image: "",
        tags: [],
        minimumFrameworkVersion: "1.0.0.0",
      },
      groups: [
        {
          name: "Default",
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: "",
              description: "",
              image: "",
              priority: 0,
              selected: false,
              files: filesMap([]),
              fileSwaps: {},
              manipulations: [],
            },
          ],
        },
        {
          name: "Empty",
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: "Only",
              description: "",
              image: "",
              priority: 0,
              selected: false,
              files: filesMap([]), // content-free, but the group still has >0 OPTIONS -> kept
              fileSwaps: {},
              manipulations: [],
            },
          ],
        },
      ],
    };
  }

  it("writes a group_NNN.json with empty Files for a content-free group", () => {
    const out = readZip(writePmp(buildData()));
    const groupName = [...out.keys()].find((n) =>
      /^group_\d+.*\.json$/i.test(n),
    );
    expect(groupName).toBeDefined();
    const grp = parseEntry<PmpGroupJson>(out, groupName as string);
    expect(grp.Name).toBe("Empty");
    expect(grp.Options).toHaveLength(1);
    expect((grp.Options![0] as PmpOptionJson).Files).toEqual({});
  });
});

describe("writePmp absent-file drop (PMP.cs:883-888)", () => {
  // TexTools' writer skips a file whose RealPath does not exist, which bypasses BOTH the payload
  // write (:910) and opt.Files.Add (:914). The written pack therefore has neither.
  const enc = new TextEncoder();
  const present = "chara/equipment/e0001/model/c0101e0001_top.mdl";
  const second = "chara/equipment/e0002/model/c0101e0002_top.mdl";
  // Both live in the lone Default-group option -> regenerated prefix "default/" (option-prefix.ts).
  const presentZipPath = `default/${present}`;

  // `secondMemberPresent` toggles whether `second`'s zip member is written: false reproduces the
  // absent-file case (PMP.cs:883-888), true is the all-present control. The source Files values
  // use an arbitrary "on/..." prefix to prove the WRITER no longer reads it (the regenerated
  // output uses "default/...", not "on/...").
  function buildPmpFixture(secondMemberPresent: boolean): Uint8Array {
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
        [second]: `on\\${second.replace(/\//g, "\\")}`,
      },
      FileSwaps: {},
      Manipulations: [],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta, null, 2))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod, null, 2))],
      [`on/${present}`, new Uint8Array([1, 2, 3, 4])],
    ]);
    if (secondMemberPresent) {
      entries.set(`on/${second}`, new Uint8Array([9, 9]));
    }
    // NOTE: when secondMemberPresent is false there is no member for `second` — that's the point.
    return writeZip(entries);
  }

  it("emits neither the zip member nor the Files key for an absent file", () => {
    const out = writePmp(readPmp(buildPmpFixture(false)));
    const members = readZip(out);

    expect([...members.keys()]).toContain(presentZipPath);
    expect([...members.keys()]).not.toContain(`default/${second}`);

    const dm = parseEntry<PmpOptionJson>(members, "default_mod.json");
    expect(Object.keys(dm.Files)).toEqual([present]);
    expect(dm.Files[present]).toBe(`default\\${present.replace(/\//g, "\\")}`);
  });

  it("regenerates an all-present default_mod.json with both Files keys, byte-for-byte-equal payload", () => {
    const src = buildPmpFixture(true);
    const out = writePmp(readPmp(src));
    const members = readZip(out);

    const dm = parseEntry<PmpOptionJson>(members, "default_mod.json");
    expect(Object.keys(dm.Files)).toEqual([present, second]);
    expect(members.get(presentZipPath)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(members.get(`default/${second}`)).toEqual(new Uint8Array([9, 9]));
  });

  it("drops only the absent file's Files key inside a group option, leaving the sibling option and every other key untouched", () => {
    // Covers the prune firing on a group_*.json option (the tests above only exercise the
    // default_mod.json path) — a multi-option group where only ONE option holds an absent file
    // (PMP.cs:883-888).
    const optAFile = "chara/equipment/e0003/model/c0101e0003_top.mdl";
    const optBPresentFile = "chara/equipment/e0004/model/c0101e0004_top.mdl";
    const optBAbsentFile = "chara/equipment/e0005/model/c0101e0005_top.mdl";
    const toZipValue = (p: string) => `on\\${p.replace(/\//g, "\\")}`;
    const meta = {
      FileVersion: 3,
      Name: "Drop2",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = {
      Version: 0,
      Files: {},
      FileSwaps: {},
      Manipulations: [],
    };
    const group = {
      Version: 0,
      Name: "Choice",
      Description: "group desc",
      Image: "grp.png",
      Page: 0,
      Priority: 3,
      Type: "Single",
      DefaultSettings: 0,
      Options: [
        {
          Name: "OptA",
          Description: "a desc",
          Image: "a.png",
          Files: { [optAFile]: toZipValue(optAFile) },
          FileSwaps: {},
          Manipulations: [],
        },
        {
          Name: "OptB",
          Description: "b desc",
          Image: "b.png",
          Files: {
            [optBPresentFile]: toZipValue(optBPresentFile),
            [optBAbsentFile]: toZipValue(optBAbsentFile),
          },
          // FileSwaps left empty: this fixture isn't exercising FileSwap preservation (a
          // non-empty map is deliberately carried through unchanged, not rejected -- see the
          // round-trip test in the "writePmp round-trip" describe block above and
          // docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md).
          FileSwaps: {},
          // A COMPLETE Imc manipulation -- normalizeManipulations throws on one missing a required
          // field (pmp-manipulation.test.ts), so this fixture needs every field spelled to prove
          // the OTHER thing this test is about (the absent-file drop) without tripping that.
          Manipulations: [IMC_MANIPULATION],
        },
      ],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta, null, 2))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod, null, 2))],
      ["group_001_Choice.json", enc.encode(JSON.stringify(group, null, 2))],
      [`on/${optAFile}`, new Uint8Array([5, 6])],
      [`on/${optBPresentFile}`, new Uint8Array([7, 8])],
      // NOTE: no member for optBAbsentFile — that is the whole point.
    ]);
    const src = writeZip(entries);

    const out = writePmp(readPmp(src));
    const members = readZip(out);
    const groupName = [...members.keys()].find((n) =>
      /^group_001_.*\.json$/.test(n),
    );
    expect(groupName).toBeDefined();
    const grp = parseEntry<PmpGroupJson>(members, groupName as string);

    expect(grp.Options).toHaveLength(2);
    const [optA, optB] = grp.Options as PmpOptionJson[];
    // "Choice" has 2 options -> each gets its own option segment (makeOptionPrefix).
    // Sibling option (no absent file): untouched content, regenerated path.
    expect(optA!.Files).toEqual({
      [optAFile]: `choice\\opta\\${optAFile.replace(/\//g, "\\")}`,
    });
    // Affected option: only the absent key is dropped.
    expect(optB!.Files).toEqual({
      [optBPresentFile]: `choice\\optb\\${optBPresentFile.replace(/\//g, "\\")}`,
    });
    // Every other key on the affected option survives.
    expect(optB!.Name).toBe("OptB");
    expect(optB!.Description).toBe("b desc");
    expect(optB!.Image).toBe("b.png");
    expect(optB!.FileSwaps).toEqual({});
    expect(optB!.Manipulations).toEqual([IMC_MANIPULATION]);
    // Group-level keys survive too.
    expect(grp.Name).toBe("Choice");
    expect(grp.Description).toBe("group desc");
    expect(grp.Image).toBe("grp.png");
    expect(grp.Priority).toBe(3);

    expect([...members.keys()]).toContain(`choice/opta/${optAFile}`);
    expect([...members.keys()]).toContain(`choice/optb/${optBPresentFile}`);
    expect([...members.keys()]).not.toContain(`choice/optb/${optBAbsentFile}`);
  });
});

describe("writePmp IsMetaInternalFile drop (PMP.cs:901-905 -> IOUtil.cs:577-592)", () => {
  // A raw .cmp/.eqp/.eqdp/.gmp/.est/.imc file gets neither a payload member nor a Files key --
  // PopulatePmpStandardOption's third skip, after the absent-file and .meta/.rgsp branches. Unlike
  // an absent file, this one DOES have real bytes and IS accepted by canImport (its game path starts
  // with a recognized folder prefix), so it must still be hashed/claim a zip path in
  // resolveDuplicates -- only the emission (Files key + payload member) is skipped.
  const enc = new TextEncoder();
  const normal = "chara/equipment/e0001/model/c0101e0001_top.mdl";
  const imcFile = "chara/equipment/e0001/e0001.imc"; // canImport-accepted (starts with "chara/")
  const normalZipPath = `default/${normal}`;

  function buildPmpFixture(): Uint8Array {
    const meta = {
      FileVersion: 3,
      Name: "MetaInternal",
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
        [normal]: `on\\${normal.replace(/\//g, "\\")}`,
        [imcFile]: `on\\${imcFile.replace(/\//g, "\\")}`,
      },
      FileSwaps: {},
      Manipulations: [],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta, null, 2))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod, null, 2))],
      [`on/${normal}`, new Uint8Array([1, 2, 3, 4])],
      [`on/${imcFile}`, new Uint8Array([5, 6, 7])],
    ]);
    return writeZip(entries);
  }

  it("emits neither the zip member nor the Files key for a raw .imc file, keeping the sibling file untouched", () => {
    const out = writePmp(readPmp(buildPmpFixture()));
    const members = readZip(out);

    expect([...members.keys()]).toContain(normalZipPath);
    expect([...members.keys()]).not.toContain(`default/${imcFile}`);
    // Not deduped into common/ either -- the file was hashed/claimed a path, then dropped at
    // emission, so no member anywhere carries its bytes.
    expect(
      [...members.values()].some(
        (v) => v.length === 3 && v[0] === 5 && v[1] === 6 && v[2] === 7,
      ),
    ).toBe(false);

    const dm = parseEntry<PmpOptionJson>(members, "default_mod.json");
    expect(Object.keys(dm.Files)).toEqual([normal]);
    expect(dm.Files[normal]).toBe(`default\\${normal.replace(/\//g, "\\")}`);
  });
});

describe("writePmp blank-name guard (WizardData.cs:1520-1523)", () => {
  // WritePmp's own assembly loop throws BEFORE any prefix is put to use when a Standard-type
  // option's name, or its owning group's name, is blank/whitespace-only -- but only for an option
  // that SURVIVES pruning (has a data-carrying group; the synthesized Default group is exempt, see
  // this guard's own comment in pmp.ts).
  function modeledData(groupName: string, optionName: string): ModpackData {
    return {
      sourceFormat: ModpackFormat.Ttmp2,
      isSimple: false,
      meta: {
        name: "Blank",
        author: "",
        version: "",
        description: "",
        url: "",
        image: "",
        tags: [],
        minimumFrameworkVersion: "1.0.0.0",
      },
      groups: [
        {
          name: "Default",
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: "",
              description: "",
              image: "",
              priority: 0,
              selected: false,
              files: filesMap([]), // empty -> IsEmptyOption -> no synthesized Default page at all
              fileSwaps: {},
              manipulations: [],
            },
          ],
        },
        {
          name: groupName,
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: optionName,
              description: "",
              image: "",
              priority: 0,
              selected: false,
              files: filesMap([
                [
                  "chara/x.tex",
                  {
                    data: new Uint8Array([1]),
                    storage: FileStorageType.RawUncompressed,
                  },
                ],
              ]),
              fileSwaps: {},
              manipulations: [],
            },
          ],
        },
      ],
    };
  }

  it("throws when a Standard-type option's name is blank", () => {
    expect(() => writePmp(modeledData("Choice", "  "))).toThrow(
      /PMP Files must have valid group and option names \(WizardData\.cs:1520-1523\)/,
    );
  });

  it("throws when a Standard-type group's name is blank", () => {
    expect(() => writePmp(modeledData("  ", "Only"))).toThrow(
      /PMP Files must have valid group and option names \(WizardData\.cs:1520-1523\)/,
    );
  });
});

describe("writePmp .meta/.rgsp write guard (PMP.cs:891-900)", () => {
  // PopulatePmpStandardOption converts a .meta/.rgsp file to Manipulations instead of writing it as
  // a zip member (PMP.cs:891-900 -> PMPExtensions.MetadataToManipulations/RgspToManipulations) --
  // unported (see pmp.ts's own comment on this guard /
  // docs/backlog/2026-07-13-pmp-write-meta-rgsp-manipulations.md), so writePmp fails loud instead
  // of silently emitting a member TexTools would never write.
  function modeledData(gamePath: string): ModpackData {
    return {
      sourceFormat: ModpackFormat.Ttmp2,
      isSimple: false,
      meta: {
        name: "MetaRgsp",
        author: "",
        version: "",
        description: "",
        url: "",
        image: "",
        tags: [],
        minimumFrameworkVersion: "1.0.0.0",
      },
      groups: [
        {
          name: "Default",
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: "",
              description: "",
              image: "",
              priority: 0,
              selected: false,
              files: filesMap([]), // empty -> IsEmptyOption -> no synthesized Default page at all
              fileSwaps: {},
              manipulations: [],
            },
          ],
        },
        {
          name: "Choice",
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: "Only",
              description: "",
              image: "",
              priority: 0,
              selected: false,
              files: filesMap([
                [
                  gamePath,
                  {
                    data: new Uint8Array([1, 2]),
                    storage: FileStorageType.RawUncompressed,
                  },
                ],
              ]),
              fileSwaps: {},
              manipulations: [],
            },
          ],
        },
      ],
    };
  }

  it("throws when writing a .meta file into a PMP", () => {
    expect(() => writePmp(modeledData("chara/foo.meta"))).toThrow(
      /unported \(PMP\.cs:891-900 converts it to Manipulations\): chara\/foo\.meta/,
    );
  });

  it("throws when writing a .rgsp file into a PMP", () => {
    expect(() => writePmp(modeledData("chara/foo.rgsp"))).toThrow(
      /unported \(PMP\.cs:891-900 converts it to Manipulations\): chara\/foo\.rgsp/,
    );
  });
});
