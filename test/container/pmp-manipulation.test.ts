import { describe, expect, it } from "vitest";
import {
  normalizeImcEntry,
  normalizeManipulations,
} from "../../src/container/pmp-manipulation";

// A COMPLETE Imc manipulation payload: every field PMPImcManipulationJson/PMPImcEntry declare
// (PmpManipulation.cs:309-353), plus the [JsonIgnore] AttributeAndSound (:318) and a numeric-string
// SetId-style field to exercise Newtonsoft's coercion (module header, point 2).
function completeImcManipulation(): Record<string, unknown> {
  return {
    Type: "Imc",
    Manipulation: {
      Entry: {
        MaterialId: 1,
        DecalId: 2,
        VfxId: 3,
        MaterialAnimationId: 4,
        AttributeAndSound: 999, // [JsonIgnore] -- PmpManipulation.cs:318
        AttributeMask: "5", // numeric string -> coerced to a JSON number on write
        SoundId: 6,
      },
      ObjectType: "Equipment",
      PrimaryId: 100,
      SecondaryId: 0,
      Variant: 1,
      EquipSlot: "Body",
      BodySlot: "Unknown",
    },
  };
}

describe("normalizeManipulations", () => {
  it("drops Imc's [JsonIgnore] AttributeAndSound and coerces a numeric-string field", () => {
    expect(normalizeManipulations([completeImcManipulation()])).toEqual([
      {
        Type: "Imc",
        Manipulation: {
          Entry: {
            MaterialId: 1,
            DecalId: 2,
            VfxId: 3,
            MaterialAnimationId: 4,
            AttributeMask: 5,
            SoundId: 6,
          },
          ObjectType: "Equipment",
          PrimaryId: 100,
          SecondaryId: 0,
          Variant: 1,
          EquipSlot: "Body",
          BodySlot: "Unknown",
        },
      },
    ]);
  });

  it("drops Eqdp's [JsonIgnore] ShiftedEntry (PmpManipulation.cs:427-473)", () => {
    const raw = [
      {
        Type: "Eqdp",
        Manipulation: {
          Entry: "3", // numeric string -> coerced
          Gender: "Male",
          Race: "Hyur",
          SetId: 42,
          Slot: "Body",
          ShiftedEntry: 999, // [JsonIgnore]
        },
      },
    ];
    expect(normalizeManipulations(raw)).toEqual([
      {
        Type: "Eqdp",
        Manipulation: {
          Entry: 3,
          Gender: "Male",
          Race: "Hyur",
          SetId: 42,
          Slot: "Body",
        },
      },
    ]);
  });

  it("passes an unrecognized Type through unchanged (Newtonsoft's untyped fallback subtype)", () => {
    const raw = [{ Type: "Rsp", Manipulation: { Foo: "bar" } }];
    expect(normalizeManipulations(raw)).toEqual(raw);
  });

  it("passes a non-object / Type-less entry through unchanged", () => {
    const raw = [null, 42, "x", { Manipulation: {} }];
    expect(normalizeManipulations(raw)).toEqual(raw);
  });

  // Finding: each typed field of a known subtype is a non-nullable C# value type, so a source
  // document that OMITS a field is not "absent from the golden" -- the typed round-trip serializes
  // the C# type's own default (0/false/enum-default). We do not know every field's exact
  // enum-default spelling and no real corpus manipulation omits a field to pin one against, so a
  // missing field fails loud instead of inventing a value nothing has proven. This also covers the
  // `{ Type: "Imc" }`-with-no-`Manipulation`-key shape that pmp-write.test.ts used to pin as
  // producing `{ Entry: {} }` -- that was the invented-defaults bug this test locks shut.
  for (const type of ["Imc", "Est", "Eqp", "Eqdp", "Gmp"]) {
    it(`throws when a ${type} manipulation is missing a required field`, () => {
      expect(() =>
        normalizeManipulations([{ Type: type, Manipulation: {} }]),
      ).toThrow(/missing required field/);
    });

    it(`throws when a ${type} manipulation has no "Manipulation" object at all`, () => {
      expect(() => normalizeManipulations([{ Type: type }])).toThrow(
        /missing required field/,
      );
    });
  }

  it("throws naming the specific missing field", () => {
    const raw = [
      {
        Type: "Eqp",
        Manipulation: { Entry: 1, SetId: 2 /* Slot missing */ },
      },
    ];
    expect(() => normalizeManipulations(raw)).toThrow(/"Slot"/);
  });
});

describe("normalizeImcEntry", () => {
  // PMPImcGroupJson.DefaultEntry (PMP.cs:1429) is the SAME PMPImcEntry struct as a manipulation's
  // own `Entry` (PmpManipulation.cs:311-321) -- src/container/pmp.ts reuses this function to
  // normalize it at the group level too.
  it("drops AttributeAndSound and keeps every other field", () => {
    const entry = {
      MaterialId: 1,
      DecalId: 2,
      VfxId: 3,
      MaterialAnimationId: 4,
      AttributeAndSound: 999,
      AttributeMask: 5,
      SoundId: 6,
    };
    expect(normalizeImcEntry(entry, "test")).toEqual({
      MaterialId: 1,
      DecalId: 2,
      VfxId: 3,
      MaterialAnimationId: 4,
      AttributeMask: 5,
      SoundId: 6,
    });
  });

  it("throws when a required field is missing", () => {
    expect(() => normalizeImcEntry({ MaterialId: 1 }, "test")).toThrow(
      /missing required field/,
    );
  });
});
