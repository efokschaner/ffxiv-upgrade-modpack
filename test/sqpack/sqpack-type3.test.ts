import { describe, expect, it } from "vitest";
import { decodeType3, encodeType3 } from "../../src/sqpack/type3";

const MDL_HEADER = 68;

// Build a minimal but structurally valid uncompressed MDL runtime file.
// vertexInfo + modelData + per-LoD [vertex][index], with the 68-byte runtime header describing them.
function makeUncompressedMdl(): Uint8Array {
  const vInfo = 100,
    mData = 200;
  const vSizes = [300, 0, 0];
  const iSizes = [150, 0, 0];
  const contentEnd =
    MDL_HEADER +
    vInfo +
    mData +
    vSizes.reduce((a, b) => a + b, 0) +
    iSizes.reduce((a, b) => a + b, 0);
  // Dat.ReadSqPackType3 sizes its output buffer as `68 + decompressedSize`, and `decompressedSize`
  // (entry offset 8) itself already counts the 68-byte header — so a real decode output ends with 68
  // trailing zero bytes. The fixture must include them to be a fixed point of decode∘encode.
  const total = contentEnd + MDL_HEADER;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);

  // Layout the sections: [header][vInfo][mData][ vLoD0 ][ iLoD0 ] (LoD1/2 empty).
  const vInfoOff = MDL_HEADER;
  const mDataOff = vInfoOff + vInfo;
  const vOff0 = mDataOff + mData;
  const iOff0 = vOff0 + vSizes[0]!;
  // Dat.ReadSqPackType3 unconditionally sets each LoD's uncompressed offset to the
  // running decompression cursor (Dat.cs:825,835), even for zero-size LoD1/LoD2 —
  // it never special-cases empty segments back to 0. So a genuine decode output
  // (and thus a self-consistent round-trip fixture) has the empty LoDs' offsets
  // sitting at the tail of LoD0's data, not at 0.
  const tail = iOff0 + iSizes[0]!;

  dv.setUint32(0, 6 | (256 << 16), true); // signature: version 6, high word 256
  dv.setUint32(4, vInfo, true);
  dv.setUint32(8, mData, true);
  dv.setUint16(12, 2, true); // meshCount
  dv.setUint16(14, 1, true); // materialCount
  // vertex offsets ×3
  dv.setUint32(16, vOff0, true);
  dv.setUint32(20, tail, true);
  dv.setUint32(24, tail, true);
  // index offsets ×3
  dv.setUint32(28, iOff0, true);
  dv.setUint32(32, tail, true);
  dv.setUint32(36, tail, true);
  // vertex sizes ×3
  dv.setUint32(40, vSizes[0]!, true);
  dv.setUint32(44, 0, true);
  dv.setUint32(48, 0, true);
  // index sizes ×3
  dv.setUint32(52, iSizes[0]!, true);
  dv.setUint32(56, 0, true);
  dv.setUint32(60, 0, true);
  buf[64] = 1; // lodCount
  buf[65] = 0; // flags

  // Fill only the content region; leave the 68 trailing bytes as zeros (see `total` above).
  for (let i = MDL_HEADER; i < contentEnd; i++) buf[i] = (i * 13 + 5) & 0xff;
  return buf;
}

describe("type 3 codec", () => {
  it("round-trips a model runtime file", () => {
    const raw = makeUncompressedMdl();
    const entry = encodeType3(raw);
    expect(new DataView(entry.buffer, entry.byteOffset).getInt32(4, true)).toBe(
      3,
    );
    expect(decodeType3(entry)).toEqual(raw);
  });
});
