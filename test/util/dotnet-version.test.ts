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
    expect(reformatDotnetVersion("-1.2")).toBe("1.0");
    // More than 4 components, or an empty one.
    expect(reformatDotnetVersion("1.2.3.4.5")).toBe("1.0");
    expect(reformatDotnetVersion("1.")).toBe("1.0");
    expect(reformatDotnetVersion(".2")).toBe("1.0");
    // AllowLeadingSign only — a TRAILING sign is not in NumberStyles.Integer.
    expect(reformatDotnetVersion("1+.2")).toBe("1.0");
    // NumberStyles.Integer permits no decimal separator inside a component.
    expect(reformatDotnetVersion("1,000.2")).toBe("1.0");
    // Non-ASCII digits are not digits to .NET's number parser (Arabic-Indic one and two).
    expect(reformatDotnetVersion("١.٢")).toBe("1.0");
  });

  // Version.ToString() renders each component as a plain integer, discarding its original spelling.
  it("normalizes a component's spelling rather than echoing it", () => {
    expect(reformatDotnetVersion("01.2")).toBe("1.2");
    expect(reformatDotnetVersion("1.02.0003")).toBe("1.2.3");
    expect(reformatDotnetVersion("0000000001.0")).toBe("1.0");
    expect(reformatDotnetVersion("00.00")).toBe("0.0");
  });

  // int.TryParse FAILS outside Int32, which fails the whole TryParse — not a pass-through.
  it("falls back when a component overflows Int32", () => {
    expect(reformatDotnetVersion("1234567890123.2")).toBe("1.0");
    expect(reformatDotnetVersion("2147483648.2")).toBe("1.0");
    expect(reformatDotnetVersion("2147483647.2")).toBe("2147483647.2");
  });

  // NumberStyles.Integer = AllowLeadingWhite | AllowTrailingWhite | AllowLeadingSign, applied
  // PER COMPONENT (Version splits on '.' first, then int.TryParse's each piece).
  it("accepts a leading sign and per-component whitespace", () => {
    expect(reformatDotnetVersion("+1.2")).toBe("1.2");
    expect(reformatDotnetVersion("1 . 2")).toBe("1.2");
    expect(reformatDotnetVersion(" 1.2 ")).toBe("1.2");
    expect(reformatDotnetVersion("\t1.\r\n2\f")).toBe("1.2");
    // Whitespace is allowed between the sign and the digits as well.
    expect(reformatDotnetVersion("+ 1.2")).toBe("1.2");
    // "-0" parses to 0, which is not `< 0`, so Version accepts it.
    expect(reformatDotnetVersion("-0.2")).toBe("0.2");
  });

  // .NET's Number.IsWhite is 0x20 plus 0x09..0x0D — narrower than JS's `\s`, which additionally
  // matches NBSP, the Unicode space separators and the BOM. Those must NOT be trimmed.
  it("does not treat non-.NET whitespace as whitespace", () => {
    expect(reformatDotnetVersion(" 1.2")).toBe("1.0"); // NBSP
    expect(reformatDotnetVersion("1.2 ")).toBe("1.0"); // EM SPACE
    expect(reformatDotnetVersion("﻿1.2")).toBe("1.0"); // BOM / ZWNBSP
  });
});
