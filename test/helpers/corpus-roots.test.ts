import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isUpgradeErrorPack } from "./corpus-roots";

describe("isUpgradeErrorPack", () => {
  const base = join(__dirname, "..", "corpus");
  it("is true for a pack directly in the upgrade-error root", () => {
    expect(isUpgradeErrorPack(join(base, "upgrade-error", "x.pmp"))).toBe(true);
  });
  it("is false for a pack in real/", () => {
    expect(isUpgradeErrorPack(join(base, "real", "x.pmp"))).toBe(false);
  });
  it("is false for a pack in synthetic/", () => {
    expect(isUpgradeErrorPack(join(base, "synthetic", "x.pmp"))).toBe(false);
  });
});
