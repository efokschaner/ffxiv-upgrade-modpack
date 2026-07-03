import { describe, expect, it } from "vitest";
import { decodeType2, encodeType2 } from "../src/sqpack/type2";

function sample(n: number): Uint8Array {
  return new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
}

describe("type 2 codec", () => {
  it("round-trips small binary data", () => {
    const raw = sample(500);
    const entry = encodeType2(raw);
    // Valid entry header: fileType int32 at offset 4 is 2.
    expect(new DataView(entry.buffer, entry.byteOffset).getInt32(4, true)).toBe(
      2,
    );
    expect(decodeType2(entry)).toEqual(raw);
  });

  it("round-trips multi-block data (> 16000 bytes)", () => {
    const raw = sample(50000);
    expect(decodeType2(encodeType2(raw))).toEqual(raw);
  });

  it("round-trips empty data", () => {
    const raw = new Uint8Array(0);
    expect(decodeType2(encodeType2(raw))).toEqual(raw);
  });
});
