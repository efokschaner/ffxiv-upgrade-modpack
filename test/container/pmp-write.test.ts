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
          page: 1,
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
              fileSwaps: { "chara/a.mdl": "chara/b.mdl" },
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
    // Files value uses backslashes in the JSON (zip path is forward-slashed on disk).
    expect(def.Files).toEqual({
      "chara/equipment/foo.tex": "chara\\equipment\\foo.tex",
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
    expect(grp.Page).toBe(1);
    expect(grp.Priority).toBe(5);
    expect(grp.DefaultSettings).toBe(0);
    expect(grp.Options).toHaveLength(1);
    // includeMeta=true for group options -> Name/Description/Image present.
    const opt = grp.Options?.[0] as PmpOptionJson;
    expect(opt.Name).toBe("Red");
    expect(opt.Description).toBe("the red one");
    expect(opt.Image).toBe("red.png");
    expect(opt.Files).toEqual({
      "chara/equipment/red.tex": "chara\\equipment\\red.tex",
    });
    expect(opt.FileSwaps).toEqual({ "chara/a.mdl": "chara/b.mdl" });
    expect(opt.Manipulations).toEqual([{ Type: "Imc" }]);
  });

  it("round-trips the modeled file bytes back through readPmp", () => {
    const reread = readPmp(writePmp(modeledData()));
    const byPath = new Map(allFiles(reread).map((f) => [f.gamePath, f.data]));
    expect(byPath.get("chara/equipment/foo.tex")).toEqual(fooBytes);
    expect(byPath.get("chara/equipment/red.tex")).toEqual(redBytes);
  });
});

describe("writePmp absent-file drop (PMP.cs:883-888)", () => {
  // TexTools' writer skips a file whose RealPath does not exist, which bypasses BOTH the payload
  // write (:910) and opt.Files.Add (:914). The written pack therefore has neither.
  const enc = new TextEncoder();
  function buildPmpWithAbsent(): Uint8Array {
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
    const out = writePmp(readPmp(buildPmpWithAbsent()));
    const members = readZip(out);
    const present = "chara/equipment/e0001/model/c0101e0001_top.mdl";
    const absent = "chara/equipment/e0002/model/c0101e0002_top.mdl";

    expect([...members.keys()]).toContain(`on/${present}`);
    expect([...members.keys()]).not.toContain(`on/${absent}`);

    const dm = parseEntry<PmpOptionJson>(members, "default_mod.json");
    expect(Object.keys(dm.Files)).toEqual([present]);
  });

  it("leaves an all-present option's manifest byte-for-byte verbatim", () => {
    // The prune must be inert when nothing is absent: `raw` is re-emitted unchanged.
    const src = buildPmpWithAbsent();
    const srcMembers = readZip(src);
    const noAbsent = new Map(srcMembers);
    const dm = parseEntry<PmpOptionJson>(srcMembers, "default_mod.json");
    const absent = "chara/equipment/e0002/model/c0101e0002_top.mdl";
    noAbsent.set(`on/${absent}`, new Uint8Array([9, 9]));
    const out = writePmp(readPmp(writeZip(noAbsent)));
    const written = parseEntry<PmpOptionJson>(readZip(out), "default_mod.json");
    expect(written.Files).toEqual(dm.Files);
  });
});
