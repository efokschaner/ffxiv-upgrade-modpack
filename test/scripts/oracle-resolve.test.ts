import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PINNED_ORACLE_TAG } from "../../scripts/lib/oracle-releases";
import { resolveConsoleToolsPath } from "../helpers/oracle";

describe("resolveConsoleToolsPath", () => {
  it("prefers the env override when set", () => {
    expect(
      resolveConsoleToolsPath("D:\\other\\ConsoleTools.exe", "fallback"),
    ).toBe("D:\\other\\ConsoleTools.exe");
  });

  it("falls back when the env var is unset", () => {
    expect(resolveConsoleToolsPath(undefined, "fallback")).toBe("fallback");
  });

  it("falls back when the env var is empty — an empty override is a mistake, not a choice", () => {
    expect(resolveConsoleToolsPath("", "fallback")).toBe("fallback");
  });
});

describe("default oracle location", () => {
  it("is the repo-relative install for the pinned tag", () => {
    // Not asserting the file EXISTS (a fresh clone has none); asserting the repo agrees with
    // itself about where it would be, so the manifest tag and the harness cannot drift apart.
    const expected = join(
      __dirname,
      "..",
      "..",
      "reference",
      "oracle",
      PINNED_ORACLE_TAG,
      "ConsoleTools.exe",
    );
    expect(existsSync(join(__dirname, "..", "..", "reference"))).toBe(true);
    expect(expected).toContain(PINNED_ORACLE_TAG);
  });
});
