import { describe, expect, it } from "vitest";
import { assertMatchedUpgradeFailure } from "./corpus-upgrade";

describe("assertMatchedUpgradeFailure", () => {
  it("passes (does not throw) when our upgrade also throws — matched failure", () => {
    expect(() =>
      assertMatchedUpgradeFailure("m.pmp", "oracle: unresolveable", () => {
        throw new Error("ours: unresolveable");
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
});
