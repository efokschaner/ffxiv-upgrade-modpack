import { describe, expect, it } from "vitest";
import {
  confirmNondeterministicMetaFields,
  DOTNET_ROUND_TRIP_RE,
  GOLDEN_GUID_RE,
  OURS_GUID_RE,
} from "./pmp-v4-nondeterminism";

// OURS_* are v5-SHAPED (version nibble `5`) — the shape `pmpIdentifier` derives. GOLD_* are v4
// (nibble `4`) — the shape `Guid.NewGuid()` mints. The rule pins each side to its own producer's
// shape, so a fixture using the wrong nibble on the wrong side is NOT interchangeable here.
const OURS_GUID = "11111111-2222-5333-8444-555555555555";
const OURS_GUID_2 = "22222222-3333-5444-9555-666666666666";
// Contains a-f digits, unlike OURS_GUID's all-numeric ones, so `.toUpperCase()` on it is not a
// silent no-op — the case-sensitivity test below depends on that.
const OURS_GUID_LETTERS = "5ffd6e85-ae4c-5446-8ed3-ca556ad6bcf3";
const GOLD_GUID = "5ffd6e85-ae4c-4446-8ed3-ca556ad6bcf3";
const GOLD_GUID_2 = "6ffd6e85-ae4c-4446-8ed3-ca556ad6bcf4";
const OURS_TIME = "2026-08-06T09:00:00.0000000+01:00";
const GOLD_TIME = "2026-08-06T04:41:11.0160172-07:00";

const meta = (over: Record<string, unknown>): Record<string, unknown> => ({
  FileVersion: 4,
  Identifier: GOLD_GUID,
  LastWrite: GOLD_TIME,
  Groups: [{ Name: "G", Identifier: GOLD_GUID }],
  ...over,
});

describe("confirmNondeterministicMetaFields", () => {
  it("adopts ours' Identifier/LastWrite/group Identifier when both sides are well-formed", () => {
    // Identifier and the group Identifier use DISTINCT values deliberately — a real write mints a
    // fresh GUID per slot, and this suite separately pins that a REUSED value is refused (see the
    // "refuses adoption ..." cases below), so this fixture must not accidentally collide.
    const out = confirmNondeterministicMetaFields(
      meta({
        Identifier: OURS_GUID,
        LastWrite: OURS_TIME,
        Groups: [{ Name: "G", Identifier: OURS_GUID_2 }],
      }),
      meta({}),
    );
    expect(out.Identifier).toBe(OURS_GUID);
    expect(out.LastWrite).toBe(OURS_TIME);
    expect((out.Groups as Array<{ Identifier: string }>)[0]!.Identifier).toBe(
      OURS_GUID_2,
    );
  });

  it("does NOT adopt a malformed Identifier — a writer emitting junk must still fail", () => {
    expect(
      confirmNondeterministicMetaFields(
        meta({ Identifier: "not-a-guid" }),
        meta({}),
      ).Identifier,
    ).toBe(GOLD_GUID);
  });

  it("does NOT adopt an absent Identifier — a writer dropping the key must still fail", () => {
    const ours = meta({});
    delete ours.Identifier;
    expect(confirmNondeterministicMetaFields(ours, meta({})).Identifier).toBe(
      GOLD_GUID,
    );
  });

  it("does NOT adopt a null or empty-string Identifier", () => {
    expect(
      confirmNondeterministicMetaFields(meta({ Identifier: null }), meta({}))
        .Identifier,
    ).toBe(GOLD_GUID);
    expect(
      confirmNondeterministicMetaFields(meta({ Identifier: "" }), meta({}))
        .Identifier,
    ).toBe(GOLD_GUID);
  });

  it("does NOT adopt a LastWrite in the wrong shape (millisecond precision, no offset)", () => {
    expect(
      confirmNondeterministicMetaFields(
        meta({ LastWrite: "2026-08-06T09:00:00.000Z" }),
        meta({}),
      ).LastWrite,
    ).toBe(GOLD_TIME);
  });

  it("leaves an Imc group's OBJECT Identifier alone on both sides (PMP.cs:1538 hides the base Guid)", () => {
    const imcId = { ObjectType: "Equipment", PrimaryId: 6047 };
    const g = (id: unknown) => ({ Groups: [{ Name: "Imc", Identifier: id }] });
    const out = confirmNondeterministicMetaFields(
      meta(g(imcId)),
      meta(g(imcId)),
    );
    expect(
      (out.Groups as Array<{ Identifier: unknown }>)[0]!.Identifier,
    ).toEqual(imcId);
  });

  it("does NOT adopt when ours emitted a GUID where the golden has an Imc Identifier object", () => {
    const out = confirmNondeterministicMetaFields(
      meta({ Groups: [{ Name: "Imc", Identifier: OURS_GUID }] }),
      meta({
        Groups: [{ Name: "Imc", Identifier: { ObjectType: "Equipment" } }],
      }),
    );
    expect(
      (out.Groups as Array<{ Identifier: unknown }>)[0]!.Identifier,
    ).toEqual({ ObjectType: "Equipment" });
  });

  it("does not adopt across a group-count mismatch (a lost or extra group must still report)", () => {
    expect(
      (
        confirmNondeterministicMetaFields(meta({ Groups: [] }), meta({}))
          .Groups as Array<{ Identifier: string }>
      )[0]!.Identifier,
    ).toBe(GOLD_GUID);
  });

  it("does NOT adopt the nil GUID — Guid.NewGuid() can never emit it", () => {
    expect(
      confirmNondeterministicMetaFields(
        meta({ Identifier: "00000000-0000-0000-0000-000000000000" }),
        meta({}),
      ).Identifier,
    ).toBe(GOLD_GUID);
  });

  it("does NOT adopt a GUID with an out-of-range version/variant nibble", () => {
    // version nibble '1' (neither '4' nor '5'), variant nibble 'c' (not in [89ab]) — 32 lowercase
    // hex digits in the right places, but a shape NEITHER producer can emit.
    expect(
      confirmNondeterministicMetaFields(
        meta({ Identifier: "11111111-2222-1333-c444-555555555555" }),
        meta({}),
      ).Identifier,
    ).toBe(GOLD_GUID);
  });

  it("does NOT adopt a v4 GUID on OUR side — pmpIdentifier only ever derives v5", () => {
    // A well-formed GUID of the shape the GOLDEN's producer mints, arriving on our side. Something
    // other than `pmpIdentifier` produced it (a random GUID leaking in, or the golden's own value
    // echoed back), which is a writer bug this rule must report rather than confirm.
    expect(
      confirmNondeterministicMetaFields(
        meta({ Identifier: GOLD_GUID_2 }),
        meta({}),
      ).Identifier,
    ).toBe(GOLD_GUID);
  });

  it("does NOT adopt when the GOLDEN's value is v5 — Guid.NewGuid() only ever mints v4", () => {
    // Both sides well-formed for the OTHER side's producer. A v5 golden means the cached golden did
    // not come from `Guid.NewGuid()` at all, so nothing about it may be adopted away.
    expect(
      confirmNondeterministicMetaFields(
        meta({ Identifier: OURS_GUID }),
        meta({ Identifier: OURS_GUID_2 }),
      ).Identifier,
    ).toBe(OURS_GUID_2);
  });

  it("does NOT adopt an uppercase GUID", () => {
    // OURS_GUID_LETTERS (not OURS_GUID) deliberately — OURS_GUID's hex digits are all-numeric, so
    // `.toUpperCase()` on it would be a silent no-op and this test would pass for the wrong reason.
    expect(
      confirmNondeterministicMetaFields(
        meta({ Identifier: OURS_GUID_LETTERS.toUpperCase() }),
        meta({}),
      ).Identifier,
    ).toBe(GOLD_GUID);
  });

  it("does NOT adopt a LastWrite with an out-of-range month/hour", () => {
    expect(
      confirmNondeterministicMetaFields(
        meta({ LastWrite: "2026-99-99T99:99:99.0000000Z" }),
        meta({}),
      ).LastWrite,
    ).toBe(GOLD_TIME);
  });

  it("does NOT adopt a LastWrite with an out-of-range offset", () => {
    expect(
      confirmNondeterministicMetaFields(
        meta({ LastWrite: "2026-08-06T09:00:00.0000000+99:99" }),
        meta({}),
      ).LastWrite,
    ).toBe(GOLD_TIME);
  });

  it("does NOT adopt when ours.Groups is present but not an array", () => {
    expect(
      (
        confirmNondeterministicMetaFields(
          meta({ Groups: "not-an-array" }),
          meta({}),
        ).Groups as Array<{ Identifier: string }>
      )[0]!.Identifier,
    ).toBe(GOLD_GUID);
  });

  it("does NOT adopt when a same-length ours group element is not an object", () => {
    expect(
      (
        confirmNondeterministicMetaFields(meta({ Groups: [null] }), meta({}))
          .Groups as Array<{ Identifier: string }>
      )[0]!.Identifier,
    ).toBe(GOLD_GUID);
  });

  it("adopts distinct per-group GUIDs when every candidate value differs", () => {
    const out = confirmNondeterministicMetaFields(
      meta({
        Identifier: OURS_GUID,
        Groups: [
          { Name: "A", Identifier: OURS_GUID_2 },
          { Name: "B", Identifier: "33333333-4444-5555-a666-777777777777" },
        ],
      }),
      meta({
        Groups: [
          { Name: "A", Identifier: GOLD_GUID },
          { Name: "B", Identifier: GOLD_GUID_2 },
        ],
      }),
    );
    expect(out.Identifier).toBe(OURS_GUID);
    const groups = out.Groups as Array<{ Identifier: string }>;
    expect(groups[0]!.Identifier).toBe(OURS_GUID_2);
    expect(groups[1]!.Identifier).toBe("33333333-4444-5555-a666-777777777777");
  });

  it("refuses adoption for every slot sharing a GUID ours reused across two groups", () => {
    const out = confirmNondeterministicMetaFields(
      meta({
        Identifier: OURS_GUID,
        Groups: [
          { Name: "A", Identifier: OURS_GUID_2 },
          { Name: "B", Identifier: OURS_GUID_2 }, // reused — must sink BOTH slots
        ],
      }),
      meta({
        Groups: [
          { Name: "A", Identifier: GOLD_GUID },
          { Name: "B", Identifier: GOLD_GUID_2 },
        ],
      }),
    );
    // The un-duplicated top-level Identifier still adopts normally.
    expect(out.Identifier).toBe(OURS_GUID);
    const groups = out.Groups as Array<{ Identifier: string }>;
    expect(groups[0]!.Identifier).toBe(GOLD_GUID);
    expect(groups[1]!.Identifier).toBe(GOLD_GUID_2);
  });

  // --- referenceIsOurs: the ours-vs-ours pairing confirmOracleErrorDivergence performs -------------
  // The reference archive there is OUR writer's output, so its identifiers are v5, not v4. These
  // three cases pin that the flag is what makes the confirmation fire at all, that leaving it off is
  // exactly the inert-rule bug it was added to fix, and that it re-aims the assertion rather than
  // relaxing it.
  it("referenceIsOurs: adopts when BOTH sides carry a v5 identifier", () => {
    const out = confirmNondeterministicMetaFields(
      meta({
        Identifier: OURS_GUID,
        LastWrite: OURS_TIME,
        Groups: [{ Name: "G", Identifier: OURS_GUID_2 }],
      }),
      meta({
        // A different pack (the declared sibling), so a DIFFERENT derived value on the reference
        // side — the general case. Value equality is not what this rule asserts.
        Identifier: OURS_GUID_LETTERS,
        Groups: [
          { Name: "G", Identifier: "33333333-4444-5555-a666-777777777777" },
        ],
      }),
      true,
    );
    expect(out.Identifier).toBe(OURS_GUID);
    expect(out.LastWrite).toBe(OURS_TIME);
    expect((out.Groups as Array<{ Identifier: string }>)[0]!.Identifier).toBe(
      OURS_GUID_2,
    );
  });

  it("WITHOUT referenceIsOurs, an ours-vs-ours pair confirms NOTHING (the inert-rule bug)", () => {
    // Same fixture as above minus the flag: the reference's v5 value fails GOLDEN_GUID_RE, so
    // `confirmedString` returns undefined and the reference's own values survive untouched. If this
    // ever starts adopting, the two regexes have been collapsed into one and the split — the whole
    // reason each side is pinned to its own producer — is gone.
    const referenceIds = {
      Identifier: OURS_GUID_LETTERS,
      Groups: [
        { Name: "G", Identifier: "33333333-4444-5555-a666-777777777777" },
      ],
    };
    const out = confirmNondeterministicMetaFields(
      meta({
        Identifier: OURS_GUID,
        Groups: [{ Name: "G", Identifier: OURS_GUID_2 }],
      }),
      meta(referenceIds),
    );
    expect(out.Identifier).toBe(OURS_GUID_LETTERS);
    expect((out.Groups as Array<{ Identifier: string }>)[0]!.Identifier).toBe(
      "33333333-4444-5555-a666-777777777777",
    );
  });

  it("referenceIsOurs still REJECTS a v4 identifier on the reference side", () => {
    // The flag re-aims the assertion at our producer; it does not widen it. A v4 value arriving from
    // an archive our own writer supposedly produced means something other than `pmpIdentifier` made
    // it, which is precisely the writer bug this rule must report.
    const out = confirmNondeterministicMetaFields(
      meta({ Identifier: OURS_GUID }),
      meta({ Identifier: GOLD_GUID_2 }),
      true,
    );
    expect(out.Identifier).toBe(GOLD_GUID_2);
  });

  it("refuses adoption when ours reuses meta.Identifier as a group Identifier", () => {
    const out = confirmNondeterministicMetaFields(
      meta({
        Identifier: OURS_GUID,
        Groups: [{ Name: "A", Identifier: OURS_GUID }], // same value as meta.Identifier
      }),
      meta({ Groups: [{ Name: "A", Identifier: GOLD_GUID }] }),
    );
    expect(out.Identifier).toBe(GOLD_GUID);
    expect((out.Groups as Array<{ Identifier: string }>)[0]!.Identifier).toBe(
      GOLD_GUID,
    );
  });
});

describe("GOLDEN_GUID_RE / OURS_GUID_RE", () => {
  it("each matches its OWN producer's shape and rejects the other's", () => {
    expect(GOLDEN_GUID_RE.test(GOLD_GUID)).toBe(true);
    expect(OURS_GUID_RE.test(OURS_GUID)).toBe(true);
    // The split is the whole point: neither regex is the union of the two.
    expect(GOLDEN_GUID_RE.test(OURS_GUID)).toBe(false);
    expect(OURS_GUID_RE.test(GOLD_GUID)).toBe(false);
  });

  it("both reject the nil GUID", () => {
    const nil = "00000000-0000-0000-0000-000000000000";
    expect(GOLDEN_GUID_RE.test(nil)).toBe(false);
    expect(OURS_GUID_RE.test(nil)).toBe(false);
  });

  it("both reject an out-of-range version/variant nibble", () => {
    const bad = "11111111-2222-1333-c444-555555555555";
    expect(GOLDEN_GUID_RE.test(bad)).toBe(false);
    expect(OURS_GUID_RE.test(bad)).toBe(false);
  });

  it("both reject uppercase", () => {
    // Values with a-f digits, so `.toUpperCase()` is not a silent no-op.
    expect(GOLDEN_GUID_RE.test(GOLD_GUID.toUpperCase())).toBe(false);
    expect(OURS_GUID_RE.test(OURS_GUID_LETTERS.toUpperCase())).toBe(false);
  });
});

describe("DOTNET_ROUND_TRIP_RE", () => {
  it("matches a well-formed offset timestamp and a well-formed Z timestamp", () => {
    expect(DOTNET_ROUND_TRIP_RE.test(OURS_TIME)).toBe(true);
    expect(DOTNET_ROUND_TRIP_RE.test(GOLD_TIME)).toBe(true);
    expect(DOTNET_ROUND_TRIP_RE.test("2026-08-06T09:00:00.0000000Z")).toBe(
      true,
    );
  });

  it("rejects an out-of-range month/hour", () => {
    expect(DOTNET_ROUND_TRIP_RE.test("2026-99-99T99:99:99.0000000Z")).toBe(
      false,
    );
  });

  it("rejects an out-of-range offset", () => {
    expect(DOTNET_ROUND_TRIP_RE.test("2026-08-06T09:00:00.0000000+99:99")).toBe(
      false,
    );
  });

  it("rejects millisecond precision (wrong fraction width)", () => {
    expect(DOTNET_ROUND_TRIP_RE.test("2026-08-06T09:00:00.000Z")).toBe(false);
  });
});
