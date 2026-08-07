import { describe, expect, it } from "vitest";
import { pmpIdentifier } from "../../src/container/pmp-identifier";

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("pmpIdentifier (our deterministic stand-in for Guid.NewGuid(), PMP.cs:1476/:1514)", () => {
  it("emits Newtonsoft's lowercase hyphenated Guid form", () => {
    expect(pmpIdentifier("meta:Test Pack")).toMatch(GUID_RE);
  });

  it("is deterministic for a given seed", () => {
    expect(pmpIdentifier("meta:Test Pack")).toBe(
      pmpIdentifier("meta:Test Pack"),
    );
  });

  it("is distinct for distinct seeds", () => {
    expect(pmpIdentifier("meta:A")).not.toBe(pmpIdentifier("meta:B"));
    expect(pmpIdentifier("group:0:G")).not.toBe(pmpIdentifier("group:1:G"));
  });

  // Shape, not conformance: the output is v5-SHAPED but is not a conformant RFC 4122 §4.3 UUID (the
  // namespace input is an ASCII string, not a namespace UUID's 16 bytes). See pmp-identifier.ts.
  it("sets the version-5 nibble and the variant bits", () => {
    const id = pmpIdentifier("anything");
    expect(id[14]).toBe("5"); // version nibble
    expect("89ab").toContain(id[19]!); // variant 0b10xx
  });

  it("is never Guid.Empty — Penumbra rejects the all-zero GUID as a StableIdentifier", () => {
    expect(pmpIdentifier("")).not.toBe("00000000-0000-0000-0000-000000000000");
  });
});
