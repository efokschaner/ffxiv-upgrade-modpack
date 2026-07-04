import { describe, expect, it } from "vitest";
import { enumerateUnits } from "./helpers/corpus-units";
import { corpusInputs } from "./helpers/oracle";

describe("enumerateUnits", () => {
  const units = enumerateUnits();
  const packs = corpusInputs();

  it("emits sqpack+golden+mtrl+tex+mdl for every pack, plus pmp for .pmp packs", () => {
    const pmpCount = packs.filter((p) =>
      p.toLowerCase().endsWith(".pmp"),
    ).length;
    expect(units.length).toBe(packs.length * 5 + pmpCount);
  });

  it("is deterministic and sorted by pack path, fixed check order per pack", () => {
    expect(enumerateUnits()).toEqual(units); // stable across calls
    // pack paths appear in ascending sorted order
    const firstIdxOfPack = new Map<string, number>();
    units.forEach((u, i) => {
      if (!firstIdxOfPack.has(u.pack)) firstIdxOfPack.set(u.pack, i);
    });
    const packOrder = [...firstIdxOfPack.keys()];
    expect(packOrder).toEqual([...packOrder].sort());
    // per pack, the checks appear in [sqpack, golden, mtrl, tex, mdl, (pmp)] order
    for (const pack of packOrder) {
      const checks = units.filter((u) => u.pack === pack).map((u) => u.check);
      const expected = pack.toLowerCase().endsWith(".pmp")
        ? ["sqpack", "golden", "mtrl", "tex", "mdl", "pmp"]
        : ["sqpack", "golden", "mtrl", "tex", "mdl"];
      expect(checks).toEqual(expected);
    }
  });

  it("covers every pack exactly once for the sqpack check", () => {
    const sqpackPacks = units
      .filter((u) => u.check === "sqpack")
      .map((u) => u.pack);
    expect(new Set(sqpackPacks)).toEqual(new Set(packs));
    expect(sqpackPacks.length).toBe(packs.length);
  });
});
