import { describe, expect, it } from "vitest";
import { upgradeModpack } from "../../src/index";
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../../src/model/modpack";

function sampleData(): ModpackData {
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
          {
            name: "O",
            description: "",
            image: "",
            priority: 0,
            fileSwaps: {},
            manipulations: [],
            files: [
              {
                gamePath: "a/b.mtrl",
                data: new Uint8Array([1, 2, 3]),
                storage: FileStorageType.SqPackCompressed,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("upgradeModpack (skeleton)", () => {
  it("returns content-equal data", () => {
    const input = sampleData();
    const out = upgradeModpack(input);
    expect(out.meta.name).toBe("M");
    expect(out.groups[0]!.options[0]!.files[0]!.gamePath).toBe("a/b.mtrl");
    expect(Array.from(out.groups[0]!.options[0]!.files[0]!.data)).toEqual([
      1, 2, 3,
    ]);
  });

  it("does not mutate the input when the output is edited (fresh containers)", () => {
    const input = sampleData();
    const out = upgradeModpack(input);
    expect(out).not.toBe(input);
    expect(out.groups).not.toBe(input.groups);
    expect(out.groups[0]!.options[0]!.files).not.toBe(
      input.groups[0]!.options[0]!.files,
    );
    out.groups[0]!.options[0]!.files.push({
      gamePath: "x.tex",
      data: new Uint8Array(),
      storage: FileStorageType.RawUncompressed,
    });
    expect(input.groups[0]!.options[0]!.files.length).toBe(1);
  });
});
