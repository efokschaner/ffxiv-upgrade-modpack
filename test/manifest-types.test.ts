import { describe, it, expect } from "vitest";
import { makeTtmp2Simple, makeLegacyTtmp, makePmpZip } from "./helpers/make-packs";

describe("synthetic pack builders", () => {
  it("produce non-empty byte buffers with known files", () => {
    for (const make of [makeTtmp2Simple, makeLegacyTtmp, makePmpZip]) {
      const pack = make();
      expect(pack.bytes.length).toBeGreaterThan(0);
      expect(Object.keys(pack.expectedFiles).length).toBeGreaterThan(0);
    }
  });
});
