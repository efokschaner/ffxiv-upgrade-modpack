import { describe, expect, it } from "vitest";
import { readPmp } from "../../src/container/pmp";
import { makePmpWithGroup } from "../helpers/make-packs";

describe("readPmp selected", () => {
  // WizardData.cs:805-808 — Single reads DefaultSettings as an INDEX.
  it("Single: DefaultSettings is an index", () => {
    const data = readPmp(
      makePmpWithGroup({ Type: "Single", DefaultSettings: 1, optionCount: 3 }),
    );
    expect(data.groups[1]!.options.map((o) => o.selected)).toEqual([
      false,
      true,
      false,
    ]);
  });

  // WizardData.cs:857-860 — out of range selects nothing, so the backstop takes option 0.
  it("Single: out-of-range DefaultSettings backstops to option 0", () => {
    const data = readPmp(
      makePmpWithGroup({ Type: "Single", DefaultSettings: 9, optionCount: 3 }),
    );
    expect(data.groups[1]!.options.map((o) => o.selected)).toEqual([
      true,
      false,
      false,
    ]);
  });

  // WizardData.cs:809-813 — Multi reads it as a bitmask, and has NO backstop (Single only).
  it("Multi: DefaultSettings is a bitmask", () => {
    const data = readPmp(
      makePmpWithGroup({
        Type: "Multi",
        DefaultSettings: 0b101,
        optionCount: 3,
      }),
    );
    expect(data.groups[1]!.options.map((o) => o.selected)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("Multi: zero selects nothing and is NOT backstopped", () => {
    const data = readPmp(
      makePmpWithGroup({ Type: "Multi", DefaultSettings: 0, optionCount: 3 }),
    );
    expect(data.groups[1]!.options.map((o) => o.selected)).toEqual([
      false,
      false,
      false,
    ]);
  });

  // CustomUInt64Converter (PMP.cs:1558-1571) reinterprets a negative JSON number as its 64-bit
  // two's-complement UNSIGNED value, so -1 is 2^64-1: every Multi bit set.
  it("Multi: a negative DefaultSettings is reinterpreted as unsigned", () => {
    const data = readPmp(
      makePmpWithGroup({ Type: "Multi", DefaultSettings: -1, optionCount: 3 }),
    );
    expect(data.groups[1]!.options.map((o) => o.selected)).toEqual([
      true,
      true,
      true,
    ]);
  });

  // WizardData.cs:1118-1138 — FromPmp's synthesized Default group is Type "Single" with one
  // option and DefaultSettings at its 0 default, so FromPMPGroup's index match (:807) selects it.
  it("selects the synthesized Default group's sole option", () => {
    const data = readPmp(
      makePmpWithGroup({ Type: "Single", DefaultSettings: 0, optionCount: 1 }),
    );
    expect(data.groups[0]!.options.map((o) => o.selected)).toEqual([true]);
  });
});
