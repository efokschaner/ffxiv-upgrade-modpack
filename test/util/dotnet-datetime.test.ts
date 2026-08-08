import { describe, expect, it } from "vitest";
import { dotnetRoundTripLocal } from "../../src/util/dotnet-datetime";

describe('dotnetRoundTripLocal (PMP.cs:941 — DateTime.Now.ToString("O", Invariant))', () => {
  it("matches the .NET round-trip shape a real v4 golden carries", () => {
    // Observed golden value: "2026-08-06T04:41:11.0160172-07:00".
    expect(dotnetRoundTripLocal(new Date())).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}[+-]\d{2}:\d{2}$/,
    );
  });

  it("zero-pads every component and renders the LOCAL wall-clock reading", () => {
    const d = new Date(2026, 0, 2, 3, 4, 5, 6); // local-time constructor, deliberately
    const s = dotnetRoundTripLocal(d);
    expect(s.slice(0, 23)).toBe("2026-01-02T03:04:05.006");
    // JS Date resolves to milliseconds; the last four .NET tick digits are always zero.
    expect(s.slice(23, 27)).toBe("0000");
  });
});
