import { describe, expect, it } from "vitest";
import { isUpgradeErrorPack } from "./helpers/corpus-roots";
import { enumerateUnits } from "./helpers/corpus-units";
import { corpusInputs } from "./helpers/oracle";

describe("enumerateUnits", () => {
  const units = enumerateUnits();
  const packs = corpusInputs();
  // upgrade-error packs (see corpus-roots.ts) are scoped to the `upgrade` check only, so they
  // contribute 1 unit each instead of the usual 4 (assets, golden, upgrade, resave).
  const [upgradeErrorPacks, ordinaryPacks] = [
    packs.filter(isUpgradeErrorPack),
    packs.filter((p) => !isUpgradeErrorPack(p)),
  ];

  it("emits assets+golden+upgrade+resave for every ordinary pack, and upgrade-only for upgrade-error packs", () => {
    expect(units.length).toBe(
      ordinaryPacks.length * 4 + upgradeErrorPacks.length,
    );
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
    // per pack, the checks appear in [assets, golden, upgrade, resave] order — except an
    // upgrade-error pack, which appears as [upgrade] only.
    for (const pack of packOrder) {
      const checks = units.filter((u) => u.pack === pack).map((u) => u.check);
      expect(checks).toEqual(
        isUpgradeErrorPack(pack)
          ? ["upgrade"]
          : ["assets", "golden", "upgrade", "resave"],
      );
    }
  });

  it("covers every ordinary pack exactly once for the assets check, and no upgrade-error pack", () => {
    const assetPacks = units
      .filter((u) => u.check === "assets")
      .map((u) => u.pack);
    expect(new Set(assetPacks)).toEqual(new Set(ordinaryPacks));
    expect(assetPacks.length).toBe(ordinaryPacks.length);
  });

  it("covers every pack exactly once for the upgrade check", () => {
    const upgradePacks = units
      .filter((u) => u.check === "upgrade")
      .map((u) => u.pack);
    expect(new Set(upgradePacks)).toEqual(new Set(packs));
    expect(upgradePacks.length).toBe(packs.length);
  });
});
