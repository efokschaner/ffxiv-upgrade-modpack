import { describe, expect, it } from "vitest";
import { jsonPointerDiff } from "./json-diff";

describe("jsonPointerDiff", () => {
  it("returns nothing for deep-equal documents", () => {
    expect(jsonPointerDiff({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual(
      [],
    );
  });

  it("reports a golden-only key as added and an ours-only key as removed", () => {
    expect(jsonPointerDiff({ b: 2 }, { a: 1 })).toEqual([
      { pointer: "/a", status: "added" },
      { pointer: "/b", status: "removed" },
    ]);
  });

  it("reports an unequal leaf as a mismatch at its pointer", () => {
    expect(jsonPointerDiff({ a: { b: 1 } }, { a: { b: 2 } })).toEqual([
      { pointer: "/a/b", status: "mismatch" },
    ]);
  });

  it("escapes ~ and / in keys per RFC 6901", () => {
    expect(jsonPointerDiff({}, { "chara/x~y.mtrl": "v" })).toEqual([
      { pointer: "/chara~1x~0y.mtrl", status: "added" },
    ]);
  });

  it("indexes into arrays and reports length differences per index", () => {
    expect(jsonPointerDiff({ m: [1] }, { m: [1, 2] })).toEqual([
      { pointer: "/m/1", status: "added" },
    ]);
  });

  it("reports a type change at the node itself, not its children", () => {
    expect(jsonPointerDiff({ a: [1] }, { a: { b: 1 } })).toEqual([
      { pointer: "/a", status: "mismatch" },
    ]);
  });

  it("sorts by pointer so ratchet ids are stable", () => {
    const d = jsonPointerDiff({ z: 1, a: 1 }, { z: 2, a: 2 });
    expect(d.map((x) => x.pointer)).toEqual(["/a", "/z"]);
  });
});
