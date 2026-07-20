import { describe, expect, it } from "vitest";
import {
  emptyMeta,
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../src/model/modpack";
import {
  compareInnerFilesByteIdentical,
  structurallyEqual,
} from "./helpers/compare";
import { filesMap } from "./helpers/make-packs";
import { corpusInputs, oracleAvailable } from "./helpers/oracle";

function oneFilePack(path: string, bytes: Uint8Array): ModpackData {
  return {
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
            name: "o",
            description: "",
            image: "",
            priority: 0,
            selected: false,
            fileSwaps: {},
            manipulations: [],
            files: filesMap([
              [
                path,
                { data: bytes, storage: FileStorageType.SqPackCompressed },
              ],
            ]),
          },
        ],
      },
    ],
  };
}

describe("structurallyEqual", () => {
  it("ignores key order and null-vs-absent", () => {
    expect(structurallyEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(structurallyEqual({ a: 1, c: null }, { a: 1 })).toBe(true);
    expect(structurallyEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(structurallyEqual([1, 2], [1, 2])).toBe(true);
  });
});

describe("compareInnerFilesByteIdentical", () => {
  it("passes on identical inner files and flags differences", () => {
    const a = oneFilePack("x.mdl", new Uint8Array([1, 2, 3]));
    const b = oneFilePack("x.mdl", new Uint8Array([1, 2, 3]));
    expect(compareInnerFilesByteIdentical(a, b).ok).toBe(true);
    const c = oneFilePack("x.mdl", new Uint8Array([1, 2, 4]));
    expect(compareInnerFilesByteIdentical(a, c).ok).toBe(false);
  });

  it("detects multi-option payload mismatch and order-independent match for shared gamePath", () => {
    function twoOptionPack(
      bytes1: Uint8Array,
      bytes2: Uint8Array,
    ): ModpackData {
      return {
        sourceFormat: ModpackFormat.Ttmp2,
        isSimple: false,
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
                name: "opt1",
                description: "",
                image: "",
                priority: 0,
                selected: false,
                fileSwaps: {},
                manipulations: [],
                files: filesMap([
                  [
                    "shared.mtrl",
                    { data: bytes1, storage: FileStorageType.SqPackCompressed },
                  ],
                ]),
              },
              {
                name: "opt2",
                description: "",
                image: "",
                priority: 0,
                selected: false,
                fileSwaps: {},
                manipulations: [],
                files: filesMap([
                  [
                    "shared.mtrl",
                    { data: bytes2, storage: FileStorageType.SqPackCompressed },
                  ],
                ]),
              },
            ],
          },
        ],
      };
    }
    // one side's second-option bytes differ → mismatch
    const a = twoOptionPack(
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
    );
    const bDiff = twoOptionPack(
      new Uint8Array([1, 2, 3]),
      new Uint8Array([7, 8, 9]),
    );
    expect(compareInnerFilesByteIdentical(a, bDiff).ok).toBe(false);
    // reversed option order = same multiset → match
    const bMatch = twoOptionPack(
      new Uint8Array([4, 5, 6]),
      new Uint8Array([1, 2, 3]),
    );
    expect(compareInnerFilesByteIdentical(a, bMatch).ok).toBe(true);
  });
});

describe("oracle wiring", () => {
  it("never throws when probing availability/corpus", () => {
    expect(typeof oracleAvailable()).toBe("boolean");
    expect(Array.isArray(corpusInputs())).toBe(true);
  });
});
