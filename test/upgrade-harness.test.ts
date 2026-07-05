import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../src/model/modpack";
import { encodeSqPackFile, SqPackType } from "../src/sqpack/sqpack";
import {
  confirmDivergence,
  DIVERGENCE_RULES,
  type DivergenceRule,
} from "./helpers/upgrade-compare";
import { diffUpgrade } from "./helpers/upgrade-diff";

describe("confirmDivergence", () => {
  it("returns false with the empty live registry", () => {
    expect(DIVERGENCE_RULES).toEqual([]);
    expect(
      confirmDivergence("a/b_id.tex", new Uint8Array([1]), new Uint8Array([2])),
    ).toBe(false);
  });

  it("confirms only when a matching rule's confirm holds", () => {
    const rules: DivergenceRule[] = [
      {
        reason: "test: same length is the intended difference",
        predicate: (p) => p.endsWith("_id.tex"),
        confirm: (o, g) => o.length === g.length,
      },
    ];
    // predicate matches AND confirm holds -> accepted divergence
    expect(
      confirmDivergence(
        "x/y_id.tex",
        new Uint8Array([1, 2]),
        new Uint8Array([3, 4]),
        rules,
      ),
    ).toBe(true);
    // predicate matches but confirm fails (unexpected divergence) -> not accepted
    expect(
      confirmDivergence(
        "x/y_id.tex",
        new Uint8Array([1, 2]),
        new Uint8Array([3]),
        rules,
      ),
    ).toBe(false);
    // predicate does not match -> not accepted
    expect(
      confirmDivergence(
        "x/y_n.tex",
        new Uint8Array([1, 2]),
        new Uint8Array([3, 4]),
        rules,
      ),
    ).toBe(false);
  });
});

// Build a one-option pack from gamePath -> uncompressed bytes (RawUncompressed storage).
function rawPack(files: Record<string, Uint8Array>): ModpackData {
  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: {
      name: "",
      author: "",
      version: "",
      description: "",
      url: "",
      image: "",
      tags: [],
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
            files: Object.entries(files).map(([gamePath, data]) => ({
              gamePath,
              data,
              storage: FileStorageType.RawUncompressed,
            })),
          },
        ],
      },
    ],
  };
}

const never = () => false;

describe("diffUpgrade", () => {
  it("reports all-matched for identical packs", () => {
    const a = rawPack({ "f.mtrl": new Uint8Array([1, 2, 3]) });
    const b = rawPack({ "f.mtrl": new Uint8Array([1, 2, 3]) });
    const d = diffUpgrade("p", a, b, never);
    expect(d.matched).toBe(1);
    expect(d.files).toEqual([]);
  });

  it("classifies mismatch, added, and removed", () => {
    const ours = rawPack({
      "same.mtrl": new Uint8Array([1]),
      "changed.mtrl": new Uint8Array([2]),
      "ours-only.tex": new Uint8Array([9]),
    });
    const golden = rawPack({
      "same.mtrl": new Uint8Array([1]),
      "changed.mtrl": new Uint8Array([2, 2]),
      "golden-only.tex": new Uint8Array([8]),
    });
    const d = diffUpgrade("p", ours, golden, never);
    expect(d.matched).toBe(1); // same.mtrl
    const byPath = Object.fromEntries(
      d.files.map((f) => [f.gamePath, f.status]),
    );
    expect(byPath["changed.mtrl"]).toBe("mismatch");
    expect(byPath["golden-only.tex"]).toBe("added");
    expect(byPath["ours-only.tex"]).toBe("removed");
  });

  it("counts a confirmed divergence as matched, not a mismatch", () => {
    const ours = rawPack({ "g_id.tex": new Uint8Array([1, 1]) });
    const golden = rawPack({ "g_id.tex": new Uint8Array([2, 2]) });
    const confirm = (p: string, o: Uint8Array, g: Uint8Array) =>
      p.endsWith("_id.tex") && o.length === g.length;
    const d = diffUpgrade("p", ours, golden, confirm);
    expect(d.matched).toBe(1);
    expect(d.files).toEqual([]);
  });

  it("decodes SqPackCompressed storage before comparing", () => {
    const raw = new Uint8Array([7, 7, 7, 7]);
    const entry = encodeSqPackFile(raw, SqPackType.Standard);
    const ours = rawPack({}); // start empty, then inject a compressed file
    ours.groups[0]!.options[0]!.files.push({
      gamePath: "c.mtrl",
      data: entry,
      storage: FileStorageType.SqPackCompressed,
    });
    const golden = rawPack({ "c.mtrl": raw }); // same content, uncompressed
    const d = diffUpgrade("p", ours, golden, never);
    expect(d.matched).toBe(1);
    expect(d.files).toEqual([]);
  });
});
