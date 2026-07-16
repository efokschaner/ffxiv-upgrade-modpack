import { describe, expect, it } from "vitest";
import { upgradeModpack } from "../../src/index";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackOption,
} from "../../src/model/modpack";
import { updateSkinPaths } from "../../src/upgrade/upgrade";
import { filesMap } from "../helpers/make-packs";

function option(files: Array<[string, ModpackFile]>): ModpackOption {
  return {
    name: "O",
    description: "",
    image: "",
    priority: 0,
    fileSwaps: {},
    manipulations: [],
    files: filesMap(files),
  };
}

const OLD = "chara/bibo/midlander_d.tex";
const NEW = "chara/bibo_mid_base.tex";

describe("updateSkinPaths", () => {
  it("aliases a matching file to its DT path, sharing the same bytes and storage", () => {
    const data = new Uint8Array([9, 8, 7]);
    const o = option([
      [OLD, { data, storage: FileStorageType.RawUncompressed }],
    ]);
    updateSkinPaths(o);
    expect([...o.files.keys()]).toEqual([OLD, NEW]);
    const aliased = o.files.get(NEW)!;
    expect(aliased.storage).toBe(FileStorageType.RawUncompressed);
    // Pointer duplication: shares the same underlying buffer reference.
    expect(aliased.data).toBe(data);
  });

  it("does nothing when the target path is already present", () => {
    const o = option([
      [
        OLD,
        { data: new Uint8Array([1]), storage: FileStorageType.RawUncompressed },
      ],
      [
        NEW,
        { data: new Uint8Array([2]), storage: FileStorageType.RawUncompressed },
      ],
    ]);
    updateSkinPaths(o);
    expect(o.files.size).toBe(2);
    // Pre-existing target untouched (not overwritten by the alias).
    expect(Array.from(o.files.get(NEW)!.data!)).toEqual([2]);
  });

  it("adds one alias per matching key when several are present", () => {
    const o = option([
      [
        OLD,
        { data: new Uint8Array([1]), storage: FileStorageType.RawUncompressed },
      ],
      [
        "chara/bibo/raen_d.tex",
        { data: new Uint8Array([2]), storage: FileStorageType.RawUncompressed },
      ],
    ]);
    updateSkinPaths(o);
    expect(new Set(o.files.keys())).toEqual(
      new Set([OLD, "chara/bibo/raen_d.tex", NEW, "chara/bibo_raen_base.tex"]),
    );
  });

  it("leaves a non-matching file untouched", () => {
    const o = option([
      [
        "chara/unrelated/foo.tex",
        { data: new Uint8Array([1]), storage: FileStorageType.RawUncompressed },
      ],
    ]);
    updateSkinPaths(o);
    expect([...o.files.keys()]).toEqual(["chara/unrelated/foo.tex"]);
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
            [gamePath, { data, storage: FileStorageType.RawUncompressed }],
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
    expect(files.has(NEW)).toBe(true);
  });
});
