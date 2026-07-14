import { describe, expect, it } from "vitest";
import { enumerateUnits } from "./helpers/corpus-units";
import { corpusInputs } from "./helpers/oracle";

describe("enumerateUnits", () => {
  const units = enumerateUnits();
  const packs = corpusInputs();

  it("emits assets+golden+upgrade+resave for every pack", () => {
    expect(units.length).toBe(packs.length * 4);
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
    // per pack, the checks appear in [assets, golden, upgrade, resave] order
    for (const pack of packOrder) {
      const checks = units.filter((u) => u.pack === pack).map((u) => u.check);
      expect(checks).toEqual(["assets", "golden", "upgrade", "resave"]);
    }
  });

  it("covers every pack exactly once for the assets check", () => {
    const assetPacks = units
      .filter((u) => u.check === "assets")
      .map((u) => u.pack);
    expect(new Set(assetPacks)).toEqual(new Set(packs));
    expect(assetPacks.length).toBe(packs.length);
  });
});
