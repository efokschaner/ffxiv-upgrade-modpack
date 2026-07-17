import { describe, expect, it } from "vitest";
import { base64ToBytes } from "../../src/util/base64";

describe("base64ToBytes", () => {
  it("decodes bytes round-tripped through Buffer", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 65, 66]);
    const b64 = Buffer.from(bytes).toString("base64");
    expect([...base64ToBytes(b64)]).toEqual([...bytes]);
  });
  it("decodes an empty string to an empty array", () => {
    expect(base64ToBytes("").length).toBe(0);
  });
});
