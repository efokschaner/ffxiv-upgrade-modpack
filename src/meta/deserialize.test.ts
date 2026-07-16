import { describe, expect, it } from "vitest";
import { deserializeMeta } from "./deserialize";

const TYPE_EQDP = 2;
const TYPE_EST = 4;

// Hand-built minimal v2 .meta with a single segment of the given type and raw data bytes.
// Layout per ItemMetadata.cs:503-660: version, path+NUL, header table (count/size/start),
// one (type,offset,size) header entry, then the segment's data bytes.
function buildSingleSegmentMeta(type: number, data: Uint8Array): Uint8Array {
  const path = "chara/equipment/e0001/e0001_top.meta";
  const enc = new TextEncoder().encode(path);
  const headerStart = 4 + enc.length + 1 + 12; // version + pathZ + (count,size,start)
  const dataOffset = headerStart + 12; // one 12-byte segment header
  const total = dataOffset + data.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 2, true);
  out.set(enc, 4);
  out[4 + enc.length] = 0;
  const p = 4 + enc.length + 1;
  dv.setUint32(p, 1, true); // header count
  dv.setUint32(p + 4, 12, true); // per-header size
  dv.setUint32(p + 8, headerStart, true); // header start
  dv.setUint32(headerStart, type, true);
  dv.setUint32(headerStart + 4, dataOffset, true);
  dv.setUint32(headerStart + 8, data.length, true);
  out.set(data, dataOffset);
  return out;
}

// A single EQDP segment; defaults to two races (101=3, 201=0).
function buildEqdpOnly(
  rows: { race: number; value: number }[] = [
    { race: 101, value: 3 },
    { race: 201, value: 0 },
  ],
): Uint8Array {
  const data = new Uint8Array(rows.length * 5);
  const dv = new DataView(data.buffer);
  rows.forEach((r, i) => {
    dv.setUint32(i * 5, r.race, true);
    dv.setUint8(i * 5 + 4, r.value);
  });
  return buildSingleSegmentMeta(TYPE_EQDP, data);
}

// A single EST segment.
function buildEstOnly(
  rows: { race: number; setId: number; skelId: number }[],
): Uint8Array {
  const data = new Uint8Array(rows.length * 6);
  const dv = new DataView(data.buffer);
  rows.forEach((r, i) => {
    dv.setUint16(i * 6, r.race, true);
    dv.setUint16(i * 6 + 2, r.setId, true);
    dv.setUint16(i * 6 + 4, r.skelId, true);
  });
  return buildSingleSegmentMeta(TYPE_EST, data);
}

describe("deserializeMeta", () => {
  it("parses version, path and an EQDP segment", () => {
    const m = deserializeMeta(buildEqdpOnly());
    expect(m.version).toBe(2);
    expect(m.path).toBe("chara/equipment/e0001/e0001_top.meta");
    expect(m.eqdp).toEqual(
      new Map([
        [101, 3],
        [201, 0],
      ]),
    );
    expect(m.est).toBeNull();
    expect(m.imc).toBeNull();
  });

  it("throws on a v1 metadata buffer (v1's EST/GMP default-injection needs base-game GMP data we don't have)", () => {
    // Same layout as buildEqdpOnly, but with version=1 instead of 2 (ItemMetadata.cs:490 is the
    // only current version we port; v1 predates EST/GMP, ItemMetadata.cs:490-494).
    const bytes = buildEqdpOnly();
    new DataView(bytes.buffer).setUint32(0, 1, true);
    expect(() => deserializeMeta(bytes)).toThrow(/version/i);
  });

  it("throws (rather than hangs) on a path with no NUL terminator", () => {
    // Valid version, then a handful of non-zero bytes with no terminating NUL: the C# reader
    // (ItemMetadata.cs:878, reader.ReadChar()) throws at end-of-stream, so our port must too
    // instead of looping forever indexing past the buffer.
    const bad = new Uint8Array(8);
    new DataView(bad.buffer).setUint32(0, 2, true);
    bad.set([0x61, 0x62, 0x63, 0x64], 4); // "abcd", never NUL-terminated
    expect(() => deserializeMeta(bad)).toThrow();
  });

  it("throws on a duplicate EQDP race (ItemMetadata.cs:773 Dictionary.Add)", () => {
    // C#'s ret.Add(race, entry) throws on a repeated key (ItemMetadata.cs:773); the old array
    // reader silently kept both rows.
    const buf = buildEqdpOnly([
      { race: 101, value: 3 },
      { race: 101, value: 5 },
    ]);
    expect(() => deserializeMeta(buf)).toThrow(/duplicate.*race/i);
  });

  it("throws on a duplicate EST race (ItemMetadata.cs:843 Dictionary.Add)", () => {
    const buf = buildEstOnly([
      { race: 101, setId: 1, skelId: 2 },
      { race: 101, setId: 1, skelId: 9 },
    ]);
    expect(() => deserializeMeta(buf)).toThrow(/duplicate.*race/i);
  });
});
