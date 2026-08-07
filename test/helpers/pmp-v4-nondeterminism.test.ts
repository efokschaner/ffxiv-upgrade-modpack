import { describe, expect, it } from "vitest";
import {
  confirmNondeterministicMetaFields,
  DOTNET_ROUND_TRIP_RE,
  GUID_RE,
} from "./pmp-v4-nondeterminism";

const OURS_GUID = "11111111-2222-4333-8444-555555555555";
const OURS_GUID_2 = "22222222-3333-4444-9555-666666666666";
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

  it("does NOT adopt a GUID with a non-v4 version/variant nibble", () => {
    // version nibble '1' (not '4'), variant nibble 'c' (not in [89ab]) — 32 lowercase hex digits
    // in the right places, but not a shape Guid.NewGuid() can produce.
    expect(
      confirmNondeterministicMetaFields(
        meta({ Identifier: "11111111-2222-1333-c444-555555555555" }),
        meta({}),
      ).Identifier,
    ).toBe(GOLD_GUID);
  });

  it("does NOT adopt an uppercase GUID", () => {
    // GOLD_GUID (not OURS_GUID) deliberately — OURS_GUID's hex digits happen to be all-numeric,
    // so `.toUpperCase()` on it would be a silent no-op and this test would pass for the wrong
    // reason. GOLD_GUID contains letters (a-f) that case-folding actually changes.
    expect(
      confirmNondeterministicMetaFields(
        meta({ Identifier: GOLD_GUID.toUpperCase() }),
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
          { Name: "B", Identifier: "33333333-4444-4555-a666-777777777777" },
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
    expect(groups[1]!.Identifier).toBe("33333333-4444-4555-a666-777777777777");
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

describe("GUID_RE", () => {
  it("matches a well-formed v4 GUID", () => {
    expect(GUID_RE.test(OURS_GUID)).toBe(true);
    expect(GUID_RE.test(GOLD_GUID)).toBe(true);
  });

  it("rejects the nil GUID", () => {
    expect(GUID_RE.test("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("rejects a non-v4 version/variant nibble", () => {
    expect(GUID_RE.test("11111111-2222-1333-c444-555555555555")).toBe(false);
  });

  it("rejects uppercase", () => {
    // GOLD_GUID, not OURS_GUID: OURS_GUID's hex digits are all-numeric, so `.toUpperCase()` would
    // be a no-op and this assertion would pass without exercising case-sensitivity at all.
    expect(GUID_RE.test(GOLD_GUID.toUpperCase())).toBe(false);
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
