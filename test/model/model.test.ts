import { describe, expect, it } from "vitest";
import {
  allFiles,
  emptyMeta,
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../../src/model/modpack";
import { filesMap } from "../helpers/make-packs";

describe("model", () => {
  it("emptyMeta has all string fields blank and tags empty", () => {
    const m = emptyMeta();
    expect(m.name).toBe("");
    expect(m.tags).toEqual([]);
    expect(m.minimumFrameworkVersion).toBe("1.0.0.0");
  });

  it("allFiles flattens every option's files", () => {
    const data: ModpackData = {
      sourceFormat: ModpackFormat.Ttmp2,
      isSimple: true,
      meta: emptyMeta(),
      groups: [
        {
          name: "g",
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: "o1",
              description: "",
              image: "",
              priority: 0,
              selected: false,
              fileSwaps: {},
              manipulations: [],
              files: filesMap([
                [
                  "a.mdl",
                  {
                    data: new Uint8Array([1]),
                    storage: FileStorageType.SqPackCompressed,
                  },
                ],
              ]),
            },
            {
              name: "o2",
              description: "",
              image: "",
              priority: 0,
              selected: false,
              fileSwaps: {},
              manipulations: [],
              files: filesMap([
                [
                  "b.mtrl",
                  {
                    data: new Uint8Array([2]),
                    storage: FileStorageType.SqPackCompressed,
                  },
                ],
              ]),
            },
          ],
        },
      ],
    };
    expect(allFiles(data).map((f) => f.gamePath)).toEqual(["a.mdl", "b.mtrl"]);
  });
});
