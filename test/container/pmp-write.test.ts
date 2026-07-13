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
import { makePmpZip } from "../helpers/make-packs";

const dec = new TextDecoder();
function parseEntry<T>(entries: Map<string, Uint8Array>, name: string): T {
  return JSON.parse(dec.decode(entries.get(name)!)) as T;
}

describe("writePmp round-trip", () => {
  it("preserves inner files byte-for-byte and re-reads structurally", () => {
    const pack = makePmpZip();
    const out = writePmp(readPmp(pack.bytes));
    const reread = readPmp(out);
    const byPath = new Map(allFiles(reread).map((f) => [f.gamePath, f.data]));
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
              files: [
                {
                  gamePath: "chara/equipment/foo.tex",
                  data: fooBytes,
                  storage: FileStorageType.RawUncompressed,
                },
              ],
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
              files: [
                {
                  gamePath: "chara/equipment/red.tex",
                  data: redBytes,
                  storage: FileStorageType.RawUncompressed,
                },
              ],
              // FileSwaps must stay empty here: resolveDuplicates fails loud on a non-empty
              // FileSwaps map (this port cannot reproduce TexTools' game-index-dependent
              // placeholder mechanics faithfully — see resolve-duplicates.ts / BACKLOG.md), and
              // that guard applies to every option writePmp actually assembles a prefix for.
              fileSwaps: {},
              manipulations: [{ Type: "Imc" }],
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
    // Manipulations regenerated per pmp-manipulation.ts: an unrecognized/opaque entry like this
    // one (no known Type-specific normalizer applies to a bare `{ Type: "Imc" }` with no
    // `Manipulation` payload) still gets typed for "Imc" -- normalizeImc defaults every field to
    // `undefined` when absent from the source, which JSON.stringify drops, leaving only the
    // (empty) Entry container.
    expect(opt.Manipulations).toEqual([
      { Type: "Imc", Manipulation: { Entry: {} } },
    ]);
  });

  it("round-trips the modeled file bytes back through readPmp", () => {
    const reread = readPmp(writePmp(modeledData()));
    const byPath = new Map(allFiles(reread).map((f) => [f.gamePath, f.data]));
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
    redOption.files.push({
      gamePath: "chara/equipment/missing.tex",
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
          files: [
            {
              gamePath,
              data,
              storage: FileStorageType.RawUncompressed,
            },
          ],
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
    // collapse as two DIFFERENT strings: resolveDuplicates (Task 7) already content-dedups equal
    // hashes onto one shared `common/{idx}/` path first, so both options resolve to the exact
    // same zip path before writePmp's own collapse loop ever runs. This still exercises that
    // loop (it sees the same key/path assigned twice) without tripping the throw.
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
          // FileSwaps must stay empty: resolveDuplicates fails loud on a non-empty FileSwaps map
          // for any option it assigns a prefix to (see resolve-duplicates.ts / BACKLOG.md).
          FileSwaps: {},
          Manipulations: [{ Type: "Imc" }],
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
    expect(optB!.Manipulations).toEqual([
      { Type: "Imc", Manipulation: { Entry: {} } },
    ]);
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
