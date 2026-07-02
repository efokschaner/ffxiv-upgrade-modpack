import { describe, it, expect } from "vitest";
import { BinaryReader, ByteBuilder } from "../src/util/binary";
import { readDye, writeDye } from "../src/mtrl/dye";

function roundtrip(len: number): void {
  const dye = new Uint8Array(len).map((_, i) => (i * 5 + 1) & 0xff);
  const b = new ByteBuilder();
  writeDye(b, dye);
  const bytes = b.toUint8Array();
  expect(bytes.length).toBe(len);
  expect(readDye(new BinaryReader(bytes), len)).toEqual(dye);
}

describe("mtrl dye codec", () => {
  it("carries an Endwalker (32-byte) dye blob verbatim", () => roundtrip(32));
  it("carries a Dawntrail (128-byte) dye blob verbatim", () => roundtrip(128));
  it("carries a zero-length (no dye) blob verbatim", () => roundtrip(0));

  it("rejects an invalid read length", () => {
    expect(() => readDye(new BinaryReader(new Uint8Array(64)), 64)).toThrow(/invalid dye length/);
  });

  it("rejects an invalid write length", () => {
    expect(() => writeDye(new ByteBuilder(), new Uint8Array(16))).toThrow(/invalid dye length/);
  });
});
