import { describe, expect, it } from "vitest";
import { PLAYABLE_RACES } from "./playable-races";
import { reconstructMeta } from "./reconstruct";
import { EST_TABLE } from "./reference/est-table";
import { IMC_TABLE } from "./reference/imc-table";
import type { EstEntry, ItemMeta } from "./types";

describe("reconstructMeta EQDP expansion", () => {
  it("expands EQDP to canonical 18 races, mod value or 0, dropping mod order", () => {
    // Mod meta: 17 races missing 1601, with Viera in old order (1801 before 1701).
    const eqdp = new Map([
      [101, 3],
      [201, 2],
      [301, 0],
      [401, 0],
      [501, 0],
      [601, 0],
      [701, 0],
      [801, 0],
      [901, 2],
      [1001, 0],
      [1101, 2],
      [1201, 3],
      [1301, 0],
      [1401, 0],
      [1501, 0],
      [1801, 0],
      [1701, 0],
    ]);
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e0256/e0256_top.meta",
      imc: null,
      eqp: null,
      eqdp,
      est: null,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect([...out.eqdp!.keys()]).toEqual([
      101, 201, 301, 401, 501, 601, 701, 801, 901, 1001, 1101, 1201, 1301, 1401,
      1501, 1601, 1701, 1801,
    ]);
    expect(out.eqdp!.get(1601)).toBe(0);
    expect(out.eqdp!.get(101)).toBe(3);
  });

  it("leaves a meta with no EQDP segment untouched in EQDP", () => {
    const mod: ItemMeta = {
      version: 2,
      path: "chara/human/c0201/obj/hair/h0135/c0201h0135_hir.meta",
      imc: null,
      eqp: null,
      eqdp: null,
      est: new Map([[201, { race: 201, setId: 135, skelId: 136 }]]),
      gmp: null,
    };
    expect(reconstructMeta(mod, mod.path).eqdp).toBeNull();
  });

  it("fails loud on an EQDP entry for a non-playable race (C# retains it, ItemMetadata.cs:773; unsupported here)", () => {
    const eqdp = new Map([
      [101, 1],
      [9999, 2], // not in PLAYABLE_RACES
    ]);
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e0256/e0256_top.meta",
      imc: null,
      eqp: null,
      eqdp,
      est: null,
      gmp: null,
    };
    expect(() => reconstructMeta(mod, mod.path)).toThrow(/non-playable race/);
  });
});

describe("reconstructMeta EST reconstruction", () => {
  // e5035_met (Purrfection ears): base Head est has a self-mapping identity entry for race 1601
  // (Hrothgar female, added in Dawntrail) — EST_TABLE.Head[1601][5035] === 5035 — which the mod,
  // authored before Dawntrail added the race, never covered. Confirm the real reference table has
  // this shape so the fixture below is not made up.
  const HEAD_SET_ID = 5035;
  const HEAD_BASE_SKEL_ID = EST_TABLE.Head[1601]![HEAD_SET_ID];

  function preDawntrailEst(
    setId: number,
    skelIdFor: (race: number) => number,
  ): Map<number, EstEntry> {
    return new Map(
      PLAYABLE_RACES.filter((race) => race !== 1601).map((race) => [
        race,
        { race, setId, skelId: skelIdFor(race) },
      ]),
    );
  }

  it("adds a race missing from the mod using the base table's skelId (Est.GetExtraSkeletonEntries port)", () => {
    expect(HEAD_BASE_SKEL_ID).toBe(5035);
    const est = preDawntrailEst(HEAD_SET_ID, (race) => race);
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e5035/e5035_met.meta",
      imc: null,
      eqp: null,
      eqdp: null,
      est,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect([...out.est!.keys()]).toEqual(PLAYABLE_RACES);
    // Every mod-supplied race is untouched.
    for (const e of est.values()) {
      expect(out.est!.get(e.race)).toEqual(e);
    }
    // The race the mod never covered is filled from the base table, not defaulted to 0.
    expect(out.est!.get(1601)).toEqual({
      race: 1601,
      setId: HEAD_SET_ID,
      skelId: HEAD_BASE_SKEL_ID,
    });
  });

  it("a mod EST value for a present race overrides the base seed", () => {
    const est = preDawntrailEst(HEAD_SET_ID, (race) => race);
    est.set(1601, { race: 1601, setId: HEAD_SET_ID, skelId: 42 });
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e5035/e5035_met.meta",
      imc: null,
      eqp: null,
      eqdp: null,
      est,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    // Mod's explicit 1601 entry wins over the base table's skelId (5035).
    expect(out.est!.get(1601)).toEqual({
      race: 1601,
      setId: HEAD_SET_ID,
      skelId: 42,
    });
  });

  it("a mod EST entry with a mismatched setId only overrides skelId; setId stays the seed's root.primaryId (PmpManipulation.cs:275-279 SkelId-only assignment)", () => {
    // Deliberately mismatched setId (9999) on the mod's 1601 entry: only skelId should win, setId
    // must stay HEAD_SET_ID (the seed's, i.e. root.primaryId parsed from e5035_met.meta) rather
    // than being taken from the mod entry.
    const est = preDawntrailEst(HEAD_SET_ID, (race) => race);
    est.set(1601, { race: 1601, setId: 9999, skelId: 42 });
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e5035/e5035_met.meta",
      imc: null,
      eqp: null,
      eqdp: null,
      est,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect(out.est!.get(1601)).toEqual({
      race: 1601,
      setId: HEAD_SET_ID,
      skelId: 42,
    });
  });

  it("hair EST seeds a single entry for the root's own race, then the mod's matching-race entry overrides skelId (Est.cs:259-291 Hair/Face trim)", () => {
    // Corpus case (Misty_Hairstyle_Female.ttmp2, chara/human/c0201/obj/hair/h0170/
    // c0201h0170_hir.meta): the mod's EST supplies only race 201 (matching the root's own c0201
    // character race), so the faithful single-race base-seed + override still lands on exactly
    // the mod's entry — byte-identical to the prior pass-through, but now via the real mechanism
    // (Est.cs:268-288) rather than an itemType heuristic.
    const hairId = 170;
    expect(EST_TABLE.Hair[1601]?.[hairId]).toBe(171); // sibling races' base data must NOT leak in
    const est: Map<number, EstEntry> = new Map([
      [201, { race: 201, setId: hairId, skelId: 113 }],
    ]);
    const mod: ItemMeta = {
      version: 2,
      path: "chara/human/c0201/obj/hair/h0170/c0201h0170_hir.meta",
      imc: null,
      eqp: null,
      eqdp: null,
      est,
      gmp: null,
    };
    expect(reconstructMeta(mod, mod.path).est).toEqual(est);
  });

  it("hair EST base-seeds from EST_TABLE for the root's race when the mod supplies no EST segment at all is not applicable — but a mod entry for the root's race still overrides the base skelId", () => {
    // Root race 1601 (c1601), hair id 170: base table has skelId 171 for this race/setId. The
    // mod's own entry for the same race (1601) must win over that base value.
    const hairId = 170;
    expect(EST_TABLE.Hair[1601]?.[hairId]).toBe(171);
    const est: Map<number, EstEntry> = new Map([
      [1601, { race: 1601, setId: hairId, skelId: 999 }],
    ]);
    const mod: ItemMeta = {
      version: 2,
      path: "chara/human/c1601/obj/hair/h0170/c1601h0170_hir.meta",
      imc: null,
      eqp: null,
      eqdp: null,
      est,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect(out.est).toEqual(
      new Map([[1601, { race: 1601, setId: hairId, skelId: 999 }]]),
    );
  });

  it("hair EST with a mismatched setId only overrides skelId; setId stays the seed's hairId (PmpManipulation.cs:275-279 SkelId-only assignment)", () => {
    // Deliberately mismatched setId (777) on the mod's matching-race entry: only skelId should
    // win, setId must stay hairId (the seed's, i.e. root.primaryId parsed from h0170).
    const hairId = 170;
    const est: Map<number, EstEntry> = new Map([
      [1601, { race: 1601, setId: 777, skelId: 999 }],
    ]);
    const mod: ItemMeta = {
      version: 2,
      path: "chara/human/c1601/obj/hair/h0170/c1601h0170_hir.meta",
      imc: null,
      eqp: null,
      eqdp: null,
      est,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect(out.est).toEqual(
      new Map([[1601, { race: 1601, setId: hairId, skelId: 999 }]]),
    );
  });

  it("hair EST for a root race absent from the mod's entries fails loud (KeyNotFoundException equivalent, PmpManipulation.cs:275)", () => {
    // Root is race 201 (c0201), but the .meta's EST entry is for a different race (301) — mirrors
    // applying a manipulation to a dict keyed only on the seeded root race.
    const hairId = 170;
    const est: Map<number, EstEntry> = new Map([
      [301, { race: 301, setId: hairId, skelId: 113 }],
    ]);
    const mod: ItemMeta = {
      version: 2,
      path: "chara/human/c0201/obj/hair/h0170/c0201h0170_hir.meta",
      imc: null,
      eqp: null,
      eqdp: null,
      est,
      gmp: null,
    };
    expect(() => reconstructMeta(mod, mod.path)).toThrow();
  });

  it("Body EST for a mod race the base est file has no table for at all fails loud (KeyNotFoundException equivalent, PmpManipulation.cs:275)", () => {
    // The real corpus-scoped Body table happens to carry all 18 PLAYABLE_RACES (this scenario is
    // latent today, per the task brief), so there's no naturally-occurring race gap to exercise
    // this branch. Simulate the C# condition that DOES exist in principle -- a base est file
    // that never carried a given race's table at all -- by removing one race's entry from the
    // real table for the duration of this test, then restoring it.
    const race = 1701;
    expect(EST_TABLE.Body[race]).toBeDefined(); // sanity: the fixture below actually removes something
    const saved = EST_TABLE.Body[race];
    delete (EST_TABLE.Body as Record<number, unknown>)[race];
    try {
      const setId = 256;
      const est: Map<number, EstEntry> = new Map([
        [race, { race, setId, skelId: 13 }],
      ]);
      const mod: ItemMeta = {
        version: 2,
        path: "chara/equipment/e0256/e0256_top.meta",
        imc: null,
        eqp: null,
        eqdp: null,
        est,
        gmp: null,
      };
      expect(() => reconstructMeta(mod, mod.path)).toThrow();
    } finally {
      EST_TABLE.Body[race] = saved!;
    }
  });

  it("fails loud on an equipment EST entry for a non-playable race (KeyNotFoundException equivalent, PmpManipulation.cs:275; unsupported here)", () => {
    const est = preDawntrailEst(HEAD_SET_ID, (race) => race);
    est.set(9999, { race: 9999, setId: HEAD_SET_ID, skelId: 42 }); // not in PLAYABLE_RACES
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e5035/e5035_met.meta",
      imc: null,
      eqp: null,
      eqdp: null,
      est,
      gmp: null,
    };
    expect(() => reconstructMeta(mod, mod.path)).toThrow(/non-playable race/);
  });

  it("leaves a meta with no EST segment untouched in EST", () => {
    const eqdp = new Map([[101, 1]]);
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e0256/e0256_top.meta",
      imc: null,
      eqp: null,
      eqdp,
      est: null,
      gmp: null,
    };
    expect(reconstructMeta(mod, mod.path).est).toBeNull();
  });
});

describe("reconstructMeta IMC reconstruction", () => {
  it("grows the mod's IMC to the base game's variant count, mod entries kept and base filling the extra (e6137_top: mod 2 + base variant 2 = 3)", () => {
    const base = IMC_TABLE["chara/equipment/e6137/e6137_top.meta"]!;
    expect(base.length).toBe(3); // real reference-table fact asserted, not assumed
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e6137/e6137_top.meta",
      imc: [
        new Uint8Array([9, 0, 255, 3, 0, 0]),
        new Uint8Array([9, 0, 255, 7, 0, 0]),
      ],
      eqp: null,
      eqdp: null,
      est: null,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect(out.imc).toHaveLength(3);
    // The mod's own two variants are kept verbatim (not overwritten by the base seed).
    expect(out.imc![0]).toEqual(mod.imc![0]);
    expect(out.imc![1]).toEqual(mod.imc![1]);
    // The base game's third variant fills the slot the mod didn't supply.
    expect(out.imc![2]).toEqual(new Uint8Array(base[2]!));
  });

  it("grows the mod's IMC to the base game's variant count (e0724_top: mod 4 + base variants 4-6 = 7)", () => {
    const base = IMC_TABLE["chara/equipment/e0724/e0724_top.meta"]!;
    expect(base.length).toBe(7); // real reference-table fact asserted, not assumed
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e0724/e0724_top.meta",
      imc: [
        new Uint8Array([9, 0, 255, 3, 0, 0]),
        new Uint8Array([9, 0, 255, 7, 0, 0]),
        new Uint8Array([9, 0, 255, 7, 0, 0]),
        new Uint8Array([9, 0, 255, 7, 0, 0]),
      ],
      eqp: null,
      eqdp: null,
      est: null,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect(out.imc).toHaveLength(7);
    for (let i = 0; i < 4; i++) {
      expect(out.imc![i]).toEqual(mod.imc![i]);
    }
    for (let i = 4; i < 7; i++) {
      expect(out.imc![i]).toEqual(new Uint8Array(base[i]!));
    }
  });

  it("a mod IMC variant at an index the base also carries overrides the base seed (mod wins)", () => {
    const base = IMC_TABLE["chara/equipment/e6137/e6137_top.meta"]!;
    const overriding = new Uint8Array([42, 42, 42, 42, 42, 42]);
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e6137/e6137_top.meta",
      imc: [
        new Uint8Array([9, 0, 255, 3, 0, 0]),
        new Uint8Array([9, 0, 255, 7, 0, 0]),
        overriding, // covers the same index (2) the base seed would otherwise fill
      ],
      eqp: null,
      eqdp: null,
      est: null,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect(out.imc).toHaveLength(3);
    expect(out.imc![2]).toEqual(overriding);
    expect(out.imc![2]).not.toEqual(new Uint8Array(base[2]!));
  });

  it("fails loud on an equipment IMC segment when IMC_TABLE has no entry for the key (out-of-corpus Set item -- base seed can't be reproduced, ItemMetadata.cs:238-241)", () => {
    expect(
      IMC_TABLE["chara/equipment/e999999/e999999_top.meta"],
    ).toBeUndefined();
    const imc = [new Uint8Array([1, 2, 3, 4, 5, 6])];
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e999999/e999999_top.meta",
      imc,
      eqp: null,
      eqdp: null,
      est: null,
      gmp: null,
    };
    expect(() => reconstructMeta(mod, mod.path)).toThrow(/IMC_TABLE/);
  });

  it("fails loud on an accessory IMC segment when IMC_TABLE has no entry for the key (out-of-corpus Set item)", () => {
    expect(
      IMC_TABLE["chara/accessory/a999999/a999999_ear.meta"],
    ).toBeUndefined();
    const imc = [new Uint8Array([1, 2, 3, 4, 5, 6])];
    const mod: ItemMeta = {
      version: 2,
      path: "chara/accessory/a999999/a999999_ear.meta",
      imc,
      eqp: null,
      eqdp: null,
      est: null,
      gmp: null,
    };
    expect(() => reconstructMeta(mod, mod.path)).toThrow(/IMC_TABLE/);
  });

  // NonSet roots (weapon/monster/demihuman) are seeded from IMC_TABLE exactly like Set roots:
  // Imc.UsesImc accepts them (Imc.cs · UsesImc · 74-85) and the table is keyed on the .meta root
  // path, so they grow to the base entry count rather than passing through.
  it("grows a weapon's IMC segment from the base seed (NonSet root, keyed on the .meta path)", () => {
    const key = "chara/weapon/w2021/obj/body/b0001/w2021b0001.meta";
    const base = IMC_TABLE[key]!;
    expect(base.length).toBeGreaterThan(1);
    const imc = [new Uint8Array([1, 0, 0, 0, 0, 0])];
    const mod: ItemMeta = {
      version: 2,
      path: key,
      imc,
      eqp: null,
      eqdp: null,
      est: null,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect(out.imc).toHaveLength(base.length);
    expect(out.imc![0]).toEqual(imc[0]);
    expect(out.imc![1]).toEqual(new Uint8Array(base[1]!));
    expect(out.eqdp).toBeNull();
    expect(out.est).toBeNull();
  });

  it("grows a monster's IMC segment from the base seed (NonSet root)", () => {
    const key = "chara/monster/m8045/obj/body/b0001/m8045b0001.meta";
    const base = IMC_TABLE[key]!;
    const imc = [new Uint8Array([2, 0, 0, 0, 0, 0])];
    const mod: ItemMeta = {
      version: 2,
      path: key,
      imc,
      eqp: null,
      eqdp: null,
      est: null,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect(out.imc).toHaveLength(Math.max(1, base.length));
    expect(out.imc![0]).toEqual(imc[0]);
  });

  it("leaves a meta with no IMC segment untouched", () => {
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e6137/e6137_top.meta",
      imc: null,
      eqp: null,
      eqdp: null,
      est: null,
      gmp: null,
    };
    expect(reconstructMeta(mod, mod.path).imc).toBeNull();
  });
});

describe("reconstructMeta equipment set-0 EQP exclusion (ItemMetadata.cs:522-528)", () => {
  it("drops the EQP segment for an equipment set-0 (e0000) meta even though one is present", () => {
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e0000/e0000_top.meta",
      imc: null,
      eqp: new Uint8Array([1, 2, 3, 4]),
      eqdp: null,
      est: null,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect(out.eqp).toBeNull();
  });

  it("leaves the EQP segment untouched for a non-zero equipment set", () => {
    const mod: ItemMeta = {
      version: 2,
      path: "chara/equipment/e0256/e0256_top.meta",
      imc: null,
      eqp: new Uint8Array([1, 2, 3, 4]),
      eqdp: null,
      est: null,
      gmp: null,
    };
    const out = reconstructMeta(mod, mod.path);
    expect(out.eqp).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});

describe("reconstructMeta unconditional root validation (Task 8b gate drop)", () => {
  it("fails loud on a genuinely-unrecognized root even when no EQDP/EST/IMC segment is present", () => {
    // Prior to Task 8b, parseMetaRoot only ran when mod.eqdp || mod.est was truthy, so a
    // segment-free (or IMC-only) meta on an unhandled root type would silently no-op instead of
    // throwing. Confirms that scaffold is gone.
    const mod: ItemMeta = {
      version: 2,
      path: "chara/human/c0201/obj/tail/t0001/c0201t0001_til.meta",
      imc: null,
      eqp: null,
      eqdp: null,
      est: null,
      gmp: null,
    };
    expect(() => reconstructMeta(mod, mod.path)).toThrow();
  });
});
