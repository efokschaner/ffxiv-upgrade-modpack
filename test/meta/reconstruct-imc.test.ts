import { describe, expect, it } from "vitest";
import { reconstructMeta } from "../../src/meta/reconstruct";
import { IMC_TABLE } from "../../src/meta/reference/imc-table";
import type { ItemMeta } from "../../src/meta/types";

function metaWithImc(path: string, imc: Uint8Array[]): ItemMeta {
  return {
    version: 2,
    path,
    imc,
    eqp: null,
    eqdp: null,
    est: null,
    gmp: null,
  };
}

const WEAPON = "chara/weapon/w2021/obj/body/b0001/w2021b0001.meta";

describe("reconstructMeta IMC seeding (spec §3.2)", () => {
  it("keys the table on the .meta gamePath", () => {
    expect(IMC_TABLE[WEAPON]).toBeDefined();
  });

  // The case the backlog item was filed for: a weapon .meta with a SHORT imc must grow to the
  // base file's entry count, not pass through. ItemMetadata.cs · CreateFromRaw · 238-241.
  it("grows a short weapon IMC to the base entry count", () => {
    const base = IMC_TABLE[WEAPON]!;
    expect(base.length).toBeGreaterThan(1); // fixture precondition
    const mod = [new Uint8Array([9, 9, 9, 9, 9, 9])];
    const out = reconstructMeta(metaWithImc(WEAPON, mod), WEAPON);
    expect(out.imc).toHaveLength(base.length);
    expect(Array.from(out.imc![0]!)).toEqual([9, 9, 9, 9, 9, 9]); // mod wins where both exist
    expect(Array.from(out.imc![1]!)).toEqual(base[1]); // base fills the tail
  });

  it("leaves a mod IMC longer than the base untouched", () => {
    const long = Array.from(
      { length: 20 },
      (_, i) => new Uint8Array([i, 0, 0, 0, 0, 0]),
    );
    const out = reconstructMeta(metaWithImc(WEAPON, long), WEAPON);
    expect(out.imc).toHaveLength(20);
  });

  // parseMetaRoot's regexes are lowercase-only, so a mixed-case gamePath can never actually reach
  // the IMC_TABLE lookup -- reconstruct.ts's `gamePath.toLowerCase()` is defensive, not load-bearing.
  // What makes that lowercasing correct is this table-wide invariant: every key is already its own
  // lowercase form, so lowercasing a lookup key can only ever match an entry that is genuinely there.
  it("every IMC_TABLE key is already lowercase", () => {
    for (const key of Object.keys(IMC_TABLE)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  // Spec §3.2 row 3: a root the table has no data for cannot be seeded faithfully.
  it("throws on a root absent from the table", () => {
    const unknown = "chara/weapon/w9999/obj/body/b0001/w9999b0001.meta";
    expect(() =>
      reconstructMeta(metaWithImc(unknown, [new Uint8Array(6)]), unknown),
    ).toThrow(/no IMC_TABLE entry/);
  });
});
