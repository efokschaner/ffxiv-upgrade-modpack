import { describe, expect, it } from "vitest";
import {
  type PmpMetaJsonRaw,
  parsePmpGroup,
  parsePmpMeta,
} from "../../src/container/manifest-types";
import {
  makeLegacyTtmp,
  makePmpZip,
  makeTtmp2Simple,
} from "../helpers/make-packs";

// The corpus pins this end to end (test/corpus/upgrade-error/pmp-group-type-{unknown,absent}.pmp,
// via the expected-failure /upgrade check), but the corpus is gitignored — these keep the behaviour
// covered on a fresh clone, and fail at the seam rather than as a whole-pack error.
describe("parsePmpGroup group Type resolution", () => {
  const group = (type?: string) => ({
    Name: "Probe",
    ...(type === undefined ? {} : { Type: type }),
    Options: [],
  });

  it("accepts every Type JsonSubtypes resolves to a subtype (PMP.cs:1384-1386)", () => {
    for (const type of ["Single", "Multi", "Imc"]) {
      expect(parsePmpGroup(group(type)).Type).toBe(type);
    }
  });

  // Matches C#'s message exactly: assertMatchedUpgradeFailure substring-matches our thrown message
  // against the oracle's trace, so any drift here breaks the corpus check above.
  it("throws PMPGroupJson.Options' message for an unrecognized Type (PMP.cs:1407)", () => {
    expect(() => parsePmpGroup(group("Not A Real Type"))).toThrow(
      "Unimplemented PMP group type: Not A Real Type",
    );
  });

  // Not a separate branch in the C#: the field initializes to `""` (PMP.cs:1397) and an absent key
  // never overwrites it, so the same interpolation yields the trailing-colon-and-nothing message.
  it("throws the same, with an empty Type, when the key is absent", () => {
    expect(() => parsePmpGroup(group())).toThrow(
      "Unimplemented PMP group type: ",
    );
  });
});

describe("parsePmpMeta v4 fields (PMP.cs · PMPMetaJson · 1467-1488)", () => {
  it("defaults the four v4 fields when the document omits them (a v3 meta.json)", () => {
    const parsed = parsePmpMeta({ FileVersion: 3, Name: "V3" });
    expect(parsed.Identifier).toBe("");
    expect(parsed.LastWrite).toBe("");
    expect(parsed.Groups).toBeNull();
    expect(parsed.DefaultData).toBeNull();
  });

  it("carries a v4 document's Identifier/LastWrite/Groups/DefaultData through verbatim", () => {
    const raw: PmpMetaJsonRaw = {
      FileVersion: 4,
      Name: "V4",
      Identifier: "5ffd6e85-ae4c-4446-8ed3-ca556ad6bcf3",
      LastWrite: "2026-08-06T04:41:11.0160172-07:00",
      Groups: [{ Type: "Single", Name: "G", Options: [{ Name: "On" }] }],
      DefaultData: { Version: 0 },
    };
    const parsed = parsePmpMeta(raw);
    expect(parsed.Identifier).toBe("5ffd6e85-ae4c-4446-8ed3-ca556ad6bcf3");
    expect(parsed.LastWrite).toBe("2026-08-06T04:41:11.0160172-07:00");
    expect(parsed.Groups).toHaveLength(1);
    expect(parsed.DefaultData).toEqual({ Version: 0 });
  });
});

describe("synthetic pack builders", () => {
  it("produce non-empty byte buffers with known files", () => {
    for (const make of [makeTtmp2Simple, makeLegacyTtmp, makePmpZip]) {
      const pack = make();
      expect(pack.bytes.length).toBeGreaterThan(0);
      expect(Object.keys(pack.expectedFiles).length).toBeGreaterThan(0);
    }
  });
});
