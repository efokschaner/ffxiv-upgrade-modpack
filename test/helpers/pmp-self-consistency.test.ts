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

  it("gives distinct ids to two different Files keys that dangle against the SAME zip path", () => {
    // TexTools content-dedupes shared payloads into common/N/... — several option `Files`
    // values can legitimately point at one zip member. Here two different options both
    // reference "common/0/file.tex", and that member is absent, so both dangle. The ratchet
    // identity is (gamePath, index, status); with a fixed index: 0 these would collide onto
    // ONE slot and a future regression on the second reference would go unflagged.
    const a = archive({
      "meta.json": META,
      "default_mod.json": j({
        Files: { "chara/a.tex": "common/0/file.tex" },
      }),
      "group_001_g.json": j({
        Name: "G",
        Options: [{ Name: "O", Files: { "chara/b.tex": "common/0/file.tex" } }],
      }),
    });
    const diffs = pmpSelfConsistency(a, new Set());
    expect(diffs).toHaveLength(2);
    for (const d of diffs) {
      expect(d.gamePath).toBe("self:dangling:common/0/file.tex");
      expect(d.status).toBe("removed");
      expect(d.kind).toBe("structure");
    }
    const ids = new Set(diffs.map((d) => `${d.gamePath}#${d.index}`));
    expect(ids.size).toBe(2);
    const details = new Set(diffs.map((d) => d.detail));
    expect(details).toEqual(new Set(["chara/a.tex", "chara/b.tex"]));
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
