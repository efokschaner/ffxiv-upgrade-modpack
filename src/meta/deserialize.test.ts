import { describe, expect, it } from "vitest";
import { deserializeMeta } from "./deserialize";

// Hand-built minimal v2 .meta with a single EQDP segment of two races (101=3, 201=0).
// Layout per ItemMetadata.cs:503-660.
function buildEqdpOnly(): Uint8Array {
  const path = "chara/equipment/e0001/e0001_top.meta";
  const enc = new TextEncoder().encode(path);
  const headerStart = 4 + enc.length + 1 + 12; // version + pathZ + (count,size,start)
  const eqdpBytes = new Uint8Array(2 * 5);
  const dv0 = new DataView(eqdpBytes.buffer);
  dv0.setUint32(0, 101, true);
  dv0.setUint8(4, 3);
  dv0.setUint32(5, 201, true);
  dv0.setUint8(9, 0);
  const dataOffset = headerStart + 12; // one 12-byte segment header
  const total = dataOffset + eqdpBytes.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 2, true);
  out.set(enc, 4);
  out[4 + enc.length] = 0;
  const p = 4 + enc.length + 1;
  dv.setUint32(p, 1, true); // header count
  dv.setUint32(p + 4, 12, true); // per-header size
  dv.setUint32(p + 8, headerStart, true); // header start
  dv.setUint32(headerStart, 2, true); // type Eqdp
  dv.setUint32(headerStart + 4, dataOffset, true);
  dv.setUint32(headerStart + 8, eqdpBytes.length, true);
  out.set(eqdpBytes, dataOffset);
  return out;
}

describe("deserializeMeta", () => {
  it("parses version, path and an EQDP segment", () => {
    const m = deserializeMeta(buildEqdpOnly());
    expect(m.version).toBe(2);
    expect(m.path).toBe("chara/equipment/e0001/e0001_top.meta");
    expect(m.eqdp).toEqual([
      { race: 101, value: 3 },
      { race: 201, value: 0 },
    ]);
    expect(m.est).toBeNull();
    expect(m.imc).toBeNull();
  });

  it("throws on a v1 metadata buffer (v1's EST/GMP default-injection needs base-game GMP data we don't have; see BACKLOG.md)", () => {
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
});
