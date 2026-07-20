import { describe, expect, it } from "vitest";
import { reformatDotnetVersion } from "../../src/util/dotnet-version";

describe("reformatDotnetVersion", () => {
  it("keeps a parseable version's component count", () => {
    expect(reformatDotnetVersion("1.2")).toBe("1.2");
    expect(reformatDotnetVersion("1.2.3")).toBe("1.2.3");
    expect(reformatDotnetVersion("1.2.3.4")).toBe("1.2.3.4");
  });

  it("falls back to 1.0 for anything TryParse rejects", () => {
    // .NET Version.TryParse requires at least major.minor, so a bare "1" fails.
    expect(reformatDotnetVersion("1")).toBe("1.0");
    expect(reformatDotnetVersion("")).toBe("1.0");
    expect(reformatDotnetVersion("v1.2")).toBe("1.0");
    expect(reformatDotnetVersion("not a version")).toBe("1.0");
    expect(reformatDotnetVersion("1.-2")).toBe("1.0");
  });
});
