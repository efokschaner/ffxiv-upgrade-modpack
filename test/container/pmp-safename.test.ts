import { describe, expect, it } from "vitest";
import { safeName } from "../../src/container/pmp";

// Fixtures derived by reading PMP.MakePMPPathSafe (PMP.cs:1316) -> IOUtil.MakePathSafe
// (IOUtil.cs:738): NFKC-normalize, replace only Path.GetInvalidFileNameChars() (Windows set) with
// '_', lowercase the rest, Trim(). "." -> "_", ".." -> "__". Cannot run TexTools per-unit, so these
// are reasoned from the C# (AGENTS.md synthetic-test rule).
describe("safeName (port of PMP.MakePMPPathSafe)", () => {
  it("keeps spaces and lowercases (the F1 case)", () => {
    expect(safeName("Weareable Ears Options")).toBe("weareable ears options");
  });
  it("replaces only OS-invalid chars with underscore", () => {
    expect(safeName("a/b:c*d")).toBe("a_b_c_d");
  });
  it("special-cases . and ..", () => {
    expect(safeName(".")).toBe("_");
    expect(safeName("..")).toBe("__");
  });
  it("trims outer whitespace but keeps inner", () => {
    expect(safeName("  Trim Me  ")).toBe("trim me");
  });
  it("NFKC-normalizes before sanitizing", () => {
    expect(safeName("Ａ")).toBe("a"); // fullwidth A -> "A" -> lowercase "a"
  });
  it("does not fall back to _ for empty input (C# has no fallback)", () => {
    expect(safeName("")).toBe("");
  });
});
