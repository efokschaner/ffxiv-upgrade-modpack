import { describe, expect, it } from "vitest";
import {
  ORACLE_RELEASES,
  PINNED_ORACLE_TAG,
} from "../../scripts/lib/oracle-releases";

describe("ORACLE_RELEASES", () => {
  it("has an entry for the pinned tag", () => {
    expect(ORACLE_RELEASES[PINNED_ORACLE_TAG]).toBeDefined();
  });

  it("pins v3.1.1.4 to the verified asset", () => {
    const r = ORACLE_RELEASES["v3.1.1.4"];
    expect(r).toBeDefined();
    expect(r?.sha256).toBe(
      "6add67cb87c8b123ade5f9b4172571d24adcaca3072475af3c7ee5f1907e86a2",
    );
    expect(r?.size).toBe(35_120_324);
    expect(r?.asset).toBe("FFXIV_TexTools_v3.1.1.4b.zip");
  });

  it("every entry is self-consistent and safely formed", () => {
    for (const [key, r] of Object.entries(ORACLE_RELEASES)) {
      expect(r.tag).toBe(key);
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.size).toBeGreaterThan(0);
      // https only, and pointing at the repo we actually vendor from.
      expect(
        r.url.startsWith("https://github.com/TexTools/FFXIV_TexTools_UI/"),
      ).toBe(true);
      expect(r.url.endsWith(r.asset)).toBe(true);
    }
  });
});
