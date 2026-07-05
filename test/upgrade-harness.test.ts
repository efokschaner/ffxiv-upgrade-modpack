import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeTtmp2 } from "../src/container/ttmp2";
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../src/model/modpack";
import { encodeSqPackFile, SqPackType } from "../src/sqpack/sqpack";
import {
  compareToBaseline,
  loadBaseline,
  saveBaseline,
} from "./helpers/upgrade-baseline";
import {
  confirmDivergence,
  DIVERGENCE_RULES,
  type DivergenceRule,
} from "./helpers/upgrade-compare";
import type { FileDiff } from "./helpers/upgrade-diff";
import { diffUpgrade } from "./helpers/upgrade-diff";
import { upgradeGoldenCached } from "./helpers/upgrade-golden";

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

  it("matches same gamePath with two identical payloads on each side", () => {
    const ours = rawPack({ "dup.mtrl": new Uint8Array([1]) });
    ours.groups[0]!.options[0]!.files.push({
      gamePath: "dup.mtrl",
      data: new Uint8Array([2]),
      storage: FileStorageType.RawUncompressed,
    });
    const golden = rawPack({ "dup.mtrl": new Uint8Array([1]) });
    golden.groups[0]!.options[0]!.files.push({
      gamePath: "dup.mtrl",
      data: new Uint8Array([2]),
      storage: FileStorageType.RawUncompressed,
    });
    const d = diffUpgrade("p", ours, golden, never);
    expect(d.matched).toBe(2);
    expect(d.files).toEqual([]);
  });

  it("detects extra payload when ours has two and golden has one", () => {
    const ours = rawPack({ "dup.mtrl": new Uint8Array([1]) });
    ours.groups[0]!.options[0]!.files.push({
      gamePath: "dup.mtrl",
      data: new Uint8Array([9]),
      storage: FileStorageType.RawUncompressed,
    });
    const golden = rawPack({ "dup.mtrl": new Uint8Array([1]) });
    const d = diffUpgrade("p", ours, golden, never);
    expect(d.matched).toBe(1);
    expect(d.files).toHaveLength(1);
    expect(d.files[0]!.gamePath).toBe("dup.mtrl");
    expect(d.files[0]!.status).toBe("removed");
  });

  it("under-matches (greedy, not maximum) when a path's confirmable pairings are ambiguous", () => {
    // Two distinct payloads per side, none byte-equal, so phase 1 (exact) finds nothing
    // and everything falls to the phase-2 confirm pairing.
    const ours = rawPack({ "g.tex": new Uint8Array([1]) });
    ours.groups[0]!.options[0]!.files.push({
      gamePath: "g.tex",
      data: new Uint8Array([2]),
      storage: FileStorageType.RawUncompressed,
    });
    const golden = rawPack({ "g.tex": new Uint8Array([3]) });
    golden.groups[0]!.options[0]!.files.push({
      gamePath: "g.tex",
      data: new Uint8Array([4]),
      storage: FileStorageType.RawUncompressed,
    });
    // Everything confirms EXCEPT ours [2] vs golden [4]. The MAXIMUM matching pairs
    // ours [1]<->golden [4] and ours [2]<->golden [3] (both confirm) => 2 matched, 0 leftover.
    // Greedy instead takes ours [1] <-> the FIRST confirmable golden ([3]), stranding ours [2]
    // with only [4], which does not confirm => 1 matched + 1 mismatch. This pins the documented
    // greedy (non-maximum-bipartite) limitation of the confirm phase (see upgrade-diff.ts).
    const confirm = (_p: string, o: Uint8Array, g: Uint8Array) =>
      !(o[0] === 2 && g[0] === 4);
    const d = diffUpgrade("p", ours, golden, confirm);
    expect(d.matched).toBe(1);
    expect(d.files).toHaveLength(1);
    expect(d.files[0]!.status).toBe("mismatch");
  });
});

describe("upgradeGoldenCached", () => {
  it("returns null on a miss when no oracle is available", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    expect(
      upgradeGoldenCached("m.ttmp2", new Uint8Array([1, 2, 3]), {
        dir,
        available: false,
      }),
    ).toBeNull();
  });

  it("produces once on miss, then serves the parsed pack from cache", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([5, 5, 5]);
    // A real ttmp2 blob to hand back as the "golden".
    const golden = writeTtmp2(rawPackTtmp2());
    let calls = 0;
    const produce = () => {
      calls++;
      return golden;
    };

    const first = upgradeGoldenCached("m.ttmp2", input, {
      dir,
      available: true,
      produce,
    });
    expect(first?.kind).toBe("pack");
    expect(calls).toBe(1);

    const second = upgradeGoldenCached("m.ttmp2", input, {
      dir,
      available: true,
      produce,
    });
    expect(second?.kind).toBe("pack");
    expect(calls).toBe(1); // served from cache, producer not re-run
  });

  it("caches a no-op (producer returns null) and serves it as noop", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([7, 7]);
    let calls = 0;
    const produce = () => {
      calls++;
      return null;
    };
    expect(
      upgradeGoldenCached("m.ttmp2", input, { dir, available: true, produce })
        ?.kind,
    ).toBe("noop");
    expect(
      upgradeGoldenCached("m.ttmp2", input, { dir, available: true, produce })
        ?.kind,
    ).toBe("noop");
    expect(calls).toBe(1);
  });
});

// A minimal valid ttmp2 for the cache test's "golden".
function rawPackTtmp2(): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: true,
    meta: {
      name: "g",
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
        name: "Default",
        description: "",
        image: "",
        page: 0,
        priority: 0,
        selectionType: "Single",
        defaultSettings: 0,
        options: [
          {
            name: "Default",
            description: "",
            image: "",
            priority: 0,
            fileSwaps: {},
            manipulations: [],
            files: [
              {
                gamePath: "a/b.mtrl",
                data: new Uint8Array([1, 2, 3, 4]),
                storage: FileStorageType.SqPackCompressed,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("baseline ratchet", () => {
  const diff = (
    gamePath: string,
    index: number,
    status: FileDiff["status"],
  ): FileDiff => ({ gamePath, index, status });

  it("save then load round-trips entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "ub-"));
    expect(loadBaseline("k", dir)).toBeNull();
    const entries = [diff("a.mtrl", 0, "mismatch")];
    saveBaseline("k", entries, dir);
    expect(loadBaseline("k", dir)).toEqual(entries);
  });

  it("passes when actual is a subset of baseline", () => {
    const baseline = [diff("a", 0, "mismatch"), diff("b", 0, "added")];
    const actual = [diff("a", 0, "mismatch")];
    expect(compareToBaseline(actual, baseline).ok).toBe(true);
  });

  it("flags a regression not present in the baseline", () => {
    const baseline = [diff("a", 0, "mismatch")];
    const actual = [diff("a", 0, "mismatch"), diff("c", 0, "removed")];
    const { ok, regressions } = compareToBaseline(actual, baseline);
    expect(ok).toBe(false);
    expect(regressions).toEqual([diff("c", 0, "removed")]);
  });

  it("treats a status change on the same file as a regression", () => {
    const baseline = [diff("a", 0, "added")];
    const actual = [diff("a", 0, "mismatch")];
    expect(compareToBaseline(actual, baseline).ok).toBe(false);
  });

  it("empty baseline: any diff is a regression", () => {
    expect(compareToBaseline([diff("a", 0, "mismatch")], []).ok).toBe(false);
    expect(compareToBaseline([], []).ok).toBe(true);
  });
});
