import { describe, expect, it } from "vitest";
import { BinaryReader, concatBytes, fnv1aKey } from "../src/util/binary";
import { readZip, writeZip } from "../src/zip/zip";

describe("zip wrapper", () => {
  it("round-trips entries", () => {
    const entries = new Map<string, Uint8Array>([
      ["a/b.txt", new TextEncoder().encode("hello")],
      ["TTMPD.mpd", new Uint8Array([1, 2, 3, 4])],
    ]);
    const zipped = writeZip(entries, { store: true });
    const back = readZip(zipped);
    expect([...back.keys()].sort()).toEqual(["TTMPD.mpd", "a/b.txt"]);
    expect(back.get("TTMPD.mpd")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(new TextDecoder().decode(back.get("a/b.txt"))).toBe("hello");
  });
});

describe("binary utils", () => {
  it("reads little-endian ints and slices", () => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setInt32(0, 305419896, true); // 0x12345678
    const r = new BinaryReader(buf);
    expect(r.readInt32()).toBe(305419896);
    r.seek(0);
    expect(r.slice(0, 2)).toEqual(buf.slice(0, 2));
  });

  it("concats and builds stable dedupe keys", () => {
    expect(concatBytes([new Uint8Array([1]), new Uint8Array([2, 3])])).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    const a = fnv1aKey(new Uint8Array([1, 2, 3]));
    const b = fnv1aKey(new Uint8Array([1, 2, 3]));
    const c = fnv1aKey(new Uint8Array([1, 2, 4]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
