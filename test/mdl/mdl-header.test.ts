import { describe, expect, it } from "vitest";
import { parseMdlHeader, serializeMdlHeader } from "../../src/mdl/header";

describe("mdl header codec", () => {
  it("parses the field-of-interest offsets and round-trips the 68 bytes", () => {
    const buf = new Uint8Array(80); // header + a couple trailing bytes to prove we only take 68
    const dv = new DataView(buf.buffer);
    dv.setUint16(0, 5, true); // version
    dv.setUint32(4, 136, true); // vertexInfoSize
    dv.setUint32(8, 673, true); // modelDataSize
    dv.setUint16(12, 1, true); // meshCount
    buf[64] = 3; // lodCount
    buf[65] = 0x02; // flags
    for (let i = 66; i < 80; i++) buf[i] = i; // distinctive trailing bytes

    const h = parseMdlHeader(buf);
    expect(h.version).toBe(5);
    expect(h.vertexInfoSize).toBe(136);
    expect(h.modelDataSize).toBe(673);
    expect(h.meshCount).toBe(1);
    expect(h.lodCount).toBe(3);
    expect(h.flags).toBe(0x02);
    expect(h.bytes).toHaveLength(68);

    // serialize replays exactly the first 68 bytes (not the trailing two).
    expect(serializeMdlHeader(h)).toEqual(buf.slice(0, 68));
  });
});
