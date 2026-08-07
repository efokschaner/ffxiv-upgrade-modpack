import { describe, expect, it } from "vitest";
import { makeV4ExtraFileDuplicateConfirmation } from "./pmp-v4-extrafile-divergence";

const enc = (v: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(v));

const PAYLOAD = new Uint8Array([1, 2, 3]);
const OTHER = new Uint8Array([9, 9, 9]);

/** A v4 INPUT pack: meta.json with an inline group, payload at a name unlike the regenerated one. */
function v4Input(): Map<string, Uint8Array> {
  return new Map<string, Uint8Array>([
    [
      "meta.json",
      enc({
        FileVersion: 4,
        Name: "in",
        ModTags: [],
        Groups: [
          {
            Name: "G",
            Type: "Single",
            Options: [{ Name: "On", Files: { "chara/a.bin": "files\\a.bin" } }],
          },
        ],
        DefaultData: { Version: 0 },
      }),
    ],
    ["files/a.bin", PAYLOAD],
  ]);
}

const oursMembers = new Map<string, Uint8Array>([
  ["meta.json", enc({ FileVersion: 4 })],
  ["g/chara/a.bin", PAYLOAD],
]);

describe("makeV4ExtraFileDuplicateConfirmation", () => {
  it("is undefined for a v3 input — the divergence cannot arise, so the arm must not exist", () => {
    const v3 = new Map<string, Uint8Array>([
      ["meta.json", enc({ FileVersion: 3, Name: "in" })],
      ["default_mod.json", enc({ Version: 0 })],
      ["files/a.bin", PAYLOAD],
    ]);
    expect(makeV4ExtraFileDuplicateConfirmation(v3)).toBeUndefined();
  });

  it("is undefined for a v4-numbered input with no inline groups (nothing to misclassify)", () => {
    const m = v4Input();
    m.set(
      "meta.json",
      enc({ FileVersion: 4, Name: "in", Groups: [], DefaultData: null }),
    );
    expect(makeV4ExtraFileDuplicateConfirmation(m)).toBeUndefined();
  });

  it("confirms a golden-only member that is a verbatim duplicate of an input member we also emit", () => {
    const confirm = makeV4ExtraFileDuplicateConfirmation(v4Input())!;
    expect(confirm("files/a.bin", PAYLOAD, oursMembers)).toBe(true);
  });

  it("REJECTS a golden-only member whose bytes are nowhere in OUR archive — that is a lost file, not a duplicate", () => {
    const confirm = makeV4ExtraFileDuplicateConfirmation(v4Input())!;
    const oursWithout = new Map<string, Uint8Array>([
      ["meta.json", enc({ FileVersion: 4 })],
    ]);
    expect(confirm("files/a.bin", PAYLOAD, oursWithout)).toBe(false);
  });

  it("REJECTS a golden-only member that does not exist in the INPUT pack", () => {
    const confirm = makeV4ExtraFileDuplicateConfirmation(v4Input())!;
    expect(confirm("invented/b.bin", PAYLOAD, oursMembers)).toBe(false);
  });

  it("REJECTS a golden-only member whose bytes differ from the input member of that name", () => {
    const confirm = makeV4ExtraFileDuplicateConfirmation(v4Input())!;
    expect(confirm("files/a.bin", OTHER, oursMembers)).toBe(false);
  });
});
