import { describe, expect, it } from "vitest";
import {
  DiagnosticCode,
  type ModpackData,
  type UpgradeResult,
} from "../../src/index";
import { assertMatchedUpgradeFailure } from "./corpus-upgrade";

const okResult = (): UpgradeResult<ModpackData> => ({
  ok: true,
  data: {} as ModpackData,
  diagnostics: [],
});
const failedWith = (message: string): UpgradeResult<ModpackData> => ({
  ok: false,
  data: null,
  diagnostics: [
    {
      severity: "error",
      code: DiagnosticCode.UpgradeFailed,
      message,
      provenance: "test",
    },
  ],
});

describe("assertMatchedUpgradeFailure", () => {
  it("passes (does not throw) when our error is the SAME reason as the oracle's", () => {
    const oracleMessage =
      "System.IO.InvalidDataException: Cannot upgrade modpack - Highlight/Visibility options are " +
      "unresolveable either due to missing files or too much complexity.\nTry installing the modpack " +
      "and creating an updated pack from the desired options.";
    expect(() =>
      assertMatchedUpgradeFailure("m.pmp", oracleMessage, () => {
        throw new Error(
          "Highlight/Visibility options are unresolveable either due to missing files or too much complexity.",
        );
      }),
    ).not.toThrow();
  });

  it("passes when our upgrade returns ok:false whose fatal diagnostic matches the oracle", () => {
    const oracleMessage =
      "System.IO.InvalidDataException: Cannot upgrade modpack - Highlight/Visibility options are " +
      "unresolveable either due to missing files or too much complexity.";
    expect(() =>
      assertMatchedUpgradeFailure("m.pmp", oracleMessage, () =>
        failedWith(
          "Highlight/Visibility options are unresolveable either due to missing files or too much complexity.",
        ),
      ),
    ).not.toThrow();
  });

  it("fails when our upgrade SUCCEEDS where the oracle errored — divergence", () => {
    // expect.fail throws an assertion error, so the mismatch branch surfaces as a throw here.
    expect(() =>
      assertMatchedUpgradeFailure("m.pmp", "oracle: unresolveable", () =>
        okResult(),
      ),
    ).toThrow(/errored but our upgrade SUCCEEDED/);
  });

  it("fails when our upgrade throws an UNRELATED error not present in the oracle message", () => {
    expect(() =>
      assertMatchedUpgradeFailure("m.pmp", "oracle: unresolveable", () => {
        throw new Error("totally different failure reason");
      }),
    ).toThrow(/does not match the oracle/);
  });
});
