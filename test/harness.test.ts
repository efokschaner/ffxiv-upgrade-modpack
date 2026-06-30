import { describe, it, expect } from "vitest";
import { structurallyEqual, compareInnerFilesByteIdentical } from "./helpers/compare";
import { oracleAvailable, corpusInputs } from "./helpers/oracle";
import { ModpackFormat, FileStorageType, emptyMeta, type ModpackData } from "../src/model/modpack";

function oneFilePack(path: string, bytes: Uint8Array): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2, isSimple: true, meta: emptyMeta(),
    groups: [{
      name: "g", description: "", image: "", page: 0, priority: 0, selectionType: "Single", defaultSettings: 0,
      options: [{ name: "o", description: "", image: "", priority: 0, fileSwaps: {}, manipulations: [],
        files: [{ gamePath: path, data: bytes, storage: FileStorageType.SqPackCompressed }] }],
    }],
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
});

describe("oracle wiring", () => {
  it("never throws when probing availability/corpus", () => {
    expect(typeof oracleAvailable()).toBe("boolean");
    expect(Array.isArray(corpusInputs())).toBe(true);
  });
});
