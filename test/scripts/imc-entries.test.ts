import { describe, expect, it } from "vitest";
import {
  IMC_TYPE_NONSET,
  IMC_TYPE_SET,
  imcEntryOffsets,
  rawImcFilePath,
  readImcEntries,
} from "../../scripts/lib/imc-entries";

/** Builds a well-formed .imc: 4-byte header then (1 + subsetCount) subsets of
 *  `slotsPerSubset` 6-byte entries. Entry bytes are [s, i, 0, 0, 0, 0] so every
 *  entry is identifiable by (subset, slotIndex). */
function buildImc(
  identifier: number,
  subsetCount: number,
  slotsPerSubset: number,
): Uint8Array {
  const total = 4 + 6 * slotsPerSubset * (1 + subsetCount);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setInt16(0, subsetCount, true);
  view.setInt16(2, identifier, true);
  let o = 4;
  for (let s = 0; s <= subsetCount; s++) {
    for (let i = 0; i < slotsPerSubset; i++) {
      out[o] = s;
      out[o + 1] = i;
      o += 6;
    }
  }
  return out;
}

describe("rawImcFilePath (XivDependencyRoot.cs · GetRawImcFilePath · 1093-1126)", () => {
  it("resolves a weapon from its secondary type/id", () => {
    expect(
      rawImcFilePath({
        primaryType: "weapon",
        primaryId: 2021,
        secondaryType: "body",
        secondaryId: 1,
        slot: null,
      }),
    ).toBe("chara/weapon/w2021/obj/body/b0001/b0001.imc");
  });

  it("resolves a demihuman from its secondary type/id", () => {
    expect(
      rawImcFilePath({
        primaryType: "demihuman",
        primaryId: 1001,
        secondaryType: "equipment",
        secondaryId: 1,
        slot: "top",
      }),
    ).toBe("chara/demihuman/d1001/obj/equipment/e0001/e0001.imc");
  });

  it("resolves equipment from its primary type/id (SecondaryType == null)", () => {
    expect(
      rawImcFilePath({
        primaryType: "equipment",
        primaryId: 6137,
        secondaryType: null,
        secondaryId: null,
        slot: "top",
      }),
    ).toBe("chara/equipment/e6137/e6137.imc");
  });

  // Imc.ImcSharingWeaponTypes (Imc.cs:53-59) + XivItemType.cs:184-253 GetWeaponType.
  // An offhand weapon reads the MAINHAND's .imc: PrimaryId -= 50.
  it("redirects an ImcSharing offhand weapon to PrimaryId - 50", () => {
    expect(
      rawImcFilePath({
        primaryType: "weapon",
        primaryId: 3060, // 3050 < id <= 3100 -> TwinfangsOff
        secondaryType: "body",
        secondaryId: 1,
        slot: null,
      }),
    ).toBe("chara/weapon/w3010/obj/body/b0001/b0001.imc");
  });

  it("does not redirect a mainhand weapon in an adjacent range", () => {
    expect(
      rawImcFilePath({
        primaryType: "weapon",
        primaryId: 3010, // 3000 < id <= 3050 -> Twinfangs (mainhand)
        secondaryType: "body",
        secondaryId: 1,
        slot: null,
      }),
    ).toBe("chara/weapon/w3010/obj/body/b0001/b0001.imc");
  });
});

describe("imcEntryOffsets (XivDependencyRoot.cs · GetImcEntryPaths · 1184-1199)", () => {
  it("strides by 6 for NonSet with no slot", () => {
    expect(
      imcEntryOffsets({ subsetCount: 1, identifier: IMC_TYPE_NONSET }, null),
    ).toEqual([4, 10]);
  });

  it("strides by 30 for Set and offsets by the slot column", () => {
    // SlotOffsetDictionary top == 1, so subOffset == 6 (Imc.cs:547-559).
    expect(
      imcEntryOffsets({ subsetCount: 2, identifier: IMC_TYPE_SET }, "top"),
    ).toEqual([10, 40, 70]);
  });

  it("treats an unknown slot as offset 0 (the ContainsKey guard at :1188)", () => {
    expect(
      imcEntryOffsets({ subsetCount: 0, identifier: IMC_TYPE_SET }, "zzz"),
    ).toEqual([4]);
  });
});

describe("readImcEntries (Imc.cs · GetEntries · 189-238)", () => {
  it("reads default + every subset for a NonSet file", () => {
    const entries = readImcEntries(buildImc(IMC_TYPE_NONSET, 1, 1), null);
    expect(entries).toEqual([
      [0, 0, 0, 0, 0, 0],
      [1, 0, 0, 0, 0, 0],
    ]);
  });

  it("reads the slot's column across default + every subset for a Set file", () => {
    const entries = readImcEntries(buildImc(IMC_TYPE_SET, 2, 5), "glv");
    // glv == column 2; subsets 0..2.
    expect(entries).toEqual([
      [0, 2, 0, 0, 0, 0],
      [1, 2, 0, 0, 0, 0],
      [2, 2, 0, 0, 0, 0],
    ]);
  });

  // Spec §3.4.2: the EOF guard's margin is exactly zero on a well-formed file,
  // for the highest slot column and both identifiers. Nothing may be dropped.
  it("drops nothing at the exact EOF boundary (highest slot column)", () => {
    const entries = readImcEntries(buildImc(IMC_TYPE_SET, 3, 5), "sho");
    expect(entries).toHaveLength(4);
    expect(entries[3]).toEqual([3, 4, 0, 0, 0, 0]);
  });

  // The guard (Imc.cs:217 `if (offset > imcByteData.Length - entrySize) continue;`)
  // fires only on a malformed/truncated file, and yields a SHORT list, not a throw.
  it("drops entries that would run past the end of a truncated file", () => {
    const full = buildImc(IMC_TYPE_NONSET, 3, 1); // 4 + 6*4 == 28 bytes
    const truncated = full.slice(0, 22); // loses the last entry
    expect(readImcEntries(truncated, null)).toHaveLength(3);
  });

  // XivDependencyRoot.cs:1179-1182: ImcType.Unknown returns no entry paths at all.
  it("returns no entries for ImcType.Unknown", () => {
    expect(readImcEntries(buildImc(0, 2, 5), "top")).toEqual([]);
  });
});
