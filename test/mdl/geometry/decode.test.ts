import { describe, expect, it } from "vitest";
import type { VertexElement } from "../../../src/mdl/geometry/declaration";
import { decodeVertexData } from "../../../src/mdl/geometry/decode";
import {
  VertexDataType,
  VertexUsageType,
} from "../../../src/mdl/geometry/format";
import type { MeshGeometryInfo } from "../../../src/mdl/geometry/offsets";
import { floatToHalf } from "../../../src/util/half";

// One vertex: stream0 = Position Half4 (8 B); stream1 = Binormal Ubyte4n (4) + Color (4).
const elements: VertexElement[] = [
  {
    stream: 0,
    offset: 0,
    type: VertexDataType.Half4,
    usage: VertexUsageType.Position,
    count: 0,
  },
  {
    stream: 1,
    offset: 0,
    type: VertexDataType.Ubyte4n,
    usage: VertexUsageType.Binormal,
    count: 0,
  },
  {
    stream: 1,
    offset: 4,
    type: VertexDataType.Ubyte4,
    usage: VertexUsageType.Color,
    count: 0,
  },
];

const mesh: MeshGeometryInfo = {
  vertexCount: 1,
  indexCount: 3,
  meshPartIndex: 0,
  meshPartCount: 1,
  indexDataOffset: 0, // *2 -> byte 0 within index region
  vertexDataOffset0: 0,
  vertexDataOffset1: 8,
  vertexDataEntrySize0: 8,
  vertexDataEntrySize1: 8,
};

function buildFile(): Uint8Array {
  // Layout: [stream0 @0..8][stream1 @8..16][indices @16..22]
  const bytes = new Uint8Array(32);
  const dv = new DataView(bytes.buffer);
  // Position Half4 = (1.0, -2.0, 0.0, w=1)
  dv.setUint16(0, floatToHalf(1), true);
  dv.setUint16(2, floatToHalf(-2), true);
  dv.setUint16(4, floatToHalf(0), true);
  dv.setUint16(6, floatToHalf(1), true);
  // Binormal Ubyte4n bytes [255, 0, 128, 255]
  bytes.set([255, 0, 128, 255], 8);
  // Color [10, 20, 30, 40]
  bytes.set([10, 20, 30, 40], 12);
  // Indices [0, 1, 2] as u16 at byte 16
  dv.setUint16(16, 0, true);
  dv.setUint16(18, 1, true);
  dv.setUint16(20, 2, true);
  return bytes;
}

describe("decodeVertexData", () => {
  it("decodes a Half4 position, Ubyte4n binormal, color, and indices", () => {
    const vd = decodeVertexData(buildFile(), mesh, elements, 0, 16);
    expect(vd.positions[0]).toEqual([1, -2, 0]);
    // Binormal: b*2/255 - 1. 255 -> 1, 0 -> -1, 128 -> 1/255. Handedness byte = 255.
    expect(vd.biNormals[0]![0]).toBe(1);
    expect(vd.biNormals[0]![1]).toBe(-1);
    expect(vd.biNormalHandedness[0]).toBe(255);
    expect(vd.colors[0]).toEqual([10, 20, 30, 40]);
    expect(vd.indices).toEqual([0, 1, 2]);
  });

  it("clamps NaN/Inf positions to zero (ReadVector3)", () => {
    const bytes = buildFile();
    new DataView(bytes.buffer).setUint16(0, 0x7e00, true); // NaN half in X
    const vd = decodeVertexData(bytes, mesh, elements, 0, 16);
    expect(vd.positions[0]).toEqual([0, 0, 0]);
  });

  it("throws when a stream is not fully consumed", () => {
    const badMesh = { ...mesh, vertexDataEntrySize0: 12 }; // claims 12 but only 8 read
    expect(() =>
      decodeVertexData(buildFile(), badMesh, elements, 0, 16),
    ).toThrow();
  });
});
