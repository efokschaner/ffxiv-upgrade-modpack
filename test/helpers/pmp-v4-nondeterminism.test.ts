import { describe, expect, it } from "vitest";
import { confirmNondeterministicMetaFields } from "./pmp-v4-nondeterminism";

const OURS_GUID = "11111111-2222-4333-8444-555555555555";
const GOLD_GUID = "5ffd6e85-ae4c-4446-8ed3-ca556ad6bcf3";
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
    const out = confirmNondeterministicMetaFields(
      meta({
        Identifier: OURS_GUID,
        LastWrite: OURS_TIME,
        Groups: [{ Name: "G", Identifier: OURS_GUID }],
      }),
      meta({}),
    );
    expect(out.Identifier).toBe(OURS_GUID);
    expect(out.LastWrite).toBe(OURS_TIME);
    expect((out.Groups as Array<{ Identifier: string }>)[0]!.Identifier).toBe(
      OURS_GUID,
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
});
