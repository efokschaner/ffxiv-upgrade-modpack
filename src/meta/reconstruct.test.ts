import { describe, expect, it } from "vitest";
import { reconstructMeta } from "./reconstruct";
import type { ItemMeta } from "./types";

describe("reconstructMeta EQDP expansion", () => {
  it("expands EQDP to canonical 18 races, mod value or 0, dropping mod order", () => {
    // Mod meta: 17 races missing 1601, with Viera in old order (1801 before 1701).
    const eqdp = [
      { race: 101, value: 3 },
      { race: 201, value: 2 },
      { race: 301, value: 0 },
      { race: 401, value: 0 },
      { race: 501, value: 0 },
      { race: 601, value: 0 },
      { race: 701, value: 0 },
      { race: 801, value: 0 },
      { race: 901, value: 2 },
      { race: 1001, value: 0 },
      { race: 1101, value: 2 },
      { race: 1201, value: 3 },
      { race: 1301, value: 0 },
      { race: 1401, value: 0 },
      { race: 1501, value: 0 },
      { race: 1801, value: 0 },
      { race: 1701, value: 0 },
    ];
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
    expect(out.eqdp!.map((e) => e.race)).toEqual([
      101, 201, 301, 401, 501, 601, 701, 801, 901, 1001, 1101, 1201, 1301, 1401,
      1501, 1601, 1701, 1801,
    ]);
    expect(out.eqdp!.find((e) => e.race === 1601)).toEqual({
      race: 1601,
      value: 0,
    });
    expect(out.eqdp!.find((e) => e.race === 101)!.value).toBe(3);
  });

  it("leaves a meta with no EQDP segment untouched in EQDP", () => {
    const mod: ItemMeta = {
      version: 2,
      path: "chara/human/c0201/obj/hair/h0135/c0201h0135_hir.meta",
      imc: null,
      eqp: null,
      eqdp: null,
      est: [{ race: 201, setId: 135, skelId: 136 }],
      gmp: null,
    };
    expect(reconstructMeta(mod, mod.path).eqdp).toBeNull();
  });
});
