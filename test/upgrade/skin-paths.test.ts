import { describe, expect, it } from "vitest";
import { upgradeModpack } from "../../src/index";
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
  type ModpackOption,
} from "../../src/model/modpack";
import { updateSkinPaths } from "../../src/upgrade/upgrade";

function option(files: ModpackOption["files"]): ModpackOption {
  return {
    name: "O",
    description: "",
    image: "",
    priority: 0,
    fileSwaps: {},
    manipulations: [],
    files,
  };
}

const OLD = "chara/bibo/midlander_d.tex";
const NEW = "chara/bibo_mid_base.tex";

describe("updateSkinPaths", () => {
  it("aliases a matching file to its DT path, sharing the same bytes and storage", () => {
    const data = new Uint8Array([9, 8, 7]);
    const o = option([
      { gamePath: OLD, data, storage: FileStorageType.RawUncompressed },
    ]);
    updateSkinPaths(o);
    expect(o.files.map((f) => f.gamePath)).toEqual([OLD, NEW]);
    const aliased = o.files.find((f) => f.gamePath === NEW)!;
    expect(aliased.storage).toBe(FileStorageType.RawUncompressed);
    // Pointer duplication: shares the same underlying buffer reference.
    expect(aliased.data).toBe(data);
  });

  it("does nothing when the target path is already present", () => {
    const o = option([
      {
        gamePath: OLD,
        data: new Uint8Array([1]),
        storage: FileStorageType.RawUncompressed,
      },
      {
        gamePath: NEW,
        data: new Uint8Array([2]),
        storage: FileStorageType.RawUncompressed,
      },
    ]);
    updateSkinPaths(o);
    expect(o.files.length).toBe(2);
    // Pre-existing target untouched (not overwritten by the alias).
    expect(Array.from(o.files.find((f) => f.gamePath === NEW)!.data!)).toEqual([
      2,
    ]);
  });

  it("adds one alias per matching key when several are present", () => {
    const o = option([
      {
        gamePath: OLD,
        data: new Uint8Array([1]),
        storage: FileStorageType.RawUncompressed,
      },
      {
        gamePath: "chara/bibo/raen_d.tex",
        data: new Uint8Array([2]),
        storage: FileStorageType.RawUncompressed,
      },
    ]);
    updateSkinPaths(o);
    expect(new Set(o.files.map((f) => f.gamePath))).toEqual(
      new Set([OLD, "chara/bibo/raen_d.tex", NEW, "chara/bibo_raen_base.tex"]),
    );
  });

  it("leaves a non-matching file untouched", () => {
    const o = option([
      {
        gamePath: "chara/unrelated/foo.tex",
        data: new Uint8Array([1]),
        storage: FileStorageType.RawUncompressed,
      },
    ]);
    updateSkinPaths(o);
    expect(o.files.map((f) => f.gamePath)).toEqual(["chara/unrelated/foo.tex"]);
  });
});

function packWith(gamePath: string, data: Uint8Array): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: false,
    meta: {
      name: "M",
      author: "A",
      version: "1",
      description: "",
      url: "",
      image: "",
      tags: ["t"],
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
        options: [
          option([
            { gamePath, data, storage: FileStorageType.RawUncompressed },
          ]),
        ],
      },
    ],
  };
}

describe("upgradeModpack partials (skin repath e2e)", () => {
  it("aliases a skin diffuse texture during the partials round", () => {
    const bytes = new Uint8Array([4, 2]);
    const out = upgradeModpack(packWith(OLD, bytes));
    const files = out.groups[0]!.options[0]!.files;
    expect(files.some((f) => f.gamePath === NEW)).toBe(true);
  });
});
