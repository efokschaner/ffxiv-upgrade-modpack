import { describe, expect, it } from "vitest";
import { readColorset, writeColorset } from "../../src/mtrl/colorset";
import { BinaryReader, ByteBuilder } from "../../src/util/binary";

function roundtrip(colorDataSize: number): void {
  const values: number[] = [];
  for (let i = 0; i < colorDataSize / 2; i++)
    values.push((i * 37 + 11) & 0xffff);
  const b = new ByteBuilder();
  writeColorset(b, values);
  const bytes = b.toUint8Array();
  expect(bytes.length).toBe(colorDataSize);
  const out = readColorset(new BinaryReader(bytes), colorDataSize);
  expect(out).toEqual(values);
}

describe("mtrl colorset codec", () => {
  it("round-trips a 512-byte (EW) colorset byte-exact", () => roundtrip(512));
  it("round-trips a 2048-byte (DT) colorset byte-exact", () => roundtrip(2048));
});
