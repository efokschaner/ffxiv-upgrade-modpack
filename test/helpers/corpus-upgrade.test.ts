import { describe, expect, it } from "vitest";
import { assertMatchedUpgradeFailure } from "./corpus-upgrade";

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

  it("fails when our upgrade SUCCEEDS where the oracle errored — divergence", () => {
    // expect.fail throws an assertion error, so the mismatch branch surfaces as a throw here.
    expect(() =>
      assertMatchedUpgradeFailure("m.pmp", "oracle: unresolveable", () => {
        /* our upgrade returns normally */
      }),
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
