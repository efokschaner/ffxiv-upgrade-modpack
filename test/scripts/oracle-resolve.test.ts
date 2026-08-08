import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PINNED_ORACLE_TAG } from "../../scripts/lib/oracle-releases";
import {
  DEFAULT_CONSOLE_TOOLS,
  resolveConsoleToolsPath,
} from "../helpers/oracle";

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
    // Independently reconstructs the expected path from PINNED_ORACLE_TAG and compares it
    // against oracle.ts's own exported DEFAULT_CONSOLE_TOOLS, so a wrong `..` count or a
    // swapped path segment in oracle.ts's join(...) actually fails this test.
    const expected = join(
      __dirname,
      "..",
      "..",
      "reference",
      "oracle",
      PINNED_ORACLE_TAG,
      "ConsoleTools.exe",
    );
    expect(DEFAULT_CONSOLE_TOOLS).toBe(expected);
  });
});
