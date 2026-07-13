import { describe, expect, it } from "vitest";
import { writeZip } from "../../src/zip/zip";
import { pmpSelfConsistency } from "./pmp-self-consistency";

const enc = new TextEncoder();
const j = (v: unknown) => enc.encode(JSON.stringify(v));
const bytes = (n: number) => new Uint8Array([n]);

function archive(members: Record<string, Uint8Array>): Uint8Array {
  return writeZip(new Map(Object.entries(members)), { store: false });
}

const META = j({ Name: "t", Image: "" });

describe("pmpSelfConsistency", () => {
  it("passes a pack whose Files keys and members agree", () => {
    const a = archive({
      "meta.json": META,
      "default_mod.json": j({
        Files: { "chara/a.tex": "default\\chara\\a.tex" },
      }),
      "default/chara/a.tex": bytes(1),
    });
    expect(pmpSelfConsistency(a, new Set())).toEqual([]);
  });

  it("flags a Files key whose member is absent (dangling)", () => {
    const a = archive({
      "meta.json": META,
      "default_mod.json": j({
        Files: { "chara/a.tex": "default\\chara\\a.tex" },
      }),
    });
    expect(pmpSelfConsistency(a, new Set())).toEqual([
      {
        kind: "structure",
        gamePath: "self:dangling:default/chara/a.tex",
        index: 0,
        status: "removed",
        detail: "chara/a.tex",
      },
    ]);
  });

  it("flags a member no Files key names (orphan)", () => {
    const a = archive({
      "meta.json": META,
      "default_mod.json": j({ Files: {} }),
      "default/chara/a.tex": bytes(1),
    });
    expect(pmpSelfConsistency(a, new Set())).toEqual([
      {
        kind: "structure",
        gamePath: "self:orphan:default/chara/a.tex",
        index: 0,
        status: "added",
        detail: undefined,
      },
    ]);
  });

  it("does not flag a member that was already an ExtraFile of the source", () => {
    const a = archive({
      "meta.json": META,
      "default_mod.json": j({ Files: {} }),
      "readme.txt": bytes(1),
    });
    expect(pmpSelfConsistency(a, new Set(["readme.txt"]))).toEqual([]);
  });

  it("does not flag an image a manifest references", () => {
    const a = archive({
      "meta.json": j({ Name: "t", Image: "images/cover.png" }),
      "default_mod.json": j({ Files: {} }),
      "images/cover.png": bytes(1),
    });
    expect(pmpSelfConsistency(a, new Set())).toEqual([]);
  });

  it("finds keys and members inside group_NNN options too", () => {
    const a = archive({
      "meta.json": META,
      "default_mod.json": j({ Files: {} }),
      "group_001_g.json": j({
        Name: "G",
        Options: [
          { Name: "O", Files: { "chara/b.tex": "g\\o\\chara\\b.tex" } },
        ],
      }),
    });
    expect(pmpSelfConsistency(a, new Set())).toEqual([
      {
        kind: "structure",
        gamePath: "self:dangling:g/o/chara/b.tex",
        index: 0,
        status: "removed",
        detail: "chara/b.tex",
      },
    ]);
  });
});
