import { describe, expect, it } from "vitest";
import type { VertexElement } from "../../../src/mdl/geometry/declaration";
import {
  encodeIndices,
  encodeVertexData,
} from "../../../src/mdl/geometry/encode";
import {
  VertexDataType,
  VertexUsageType,
} from "../../../src/mdl/geometry/format";
import type { TtVertex } from "../../../src/mdl/geometry/vertex-data";
import { floatToHalf } from "../../../src/util/half-float";

function vertex(over: Partial<TtVertex>): TtVertex {
  return {
    position: [0, 0, 0],
    normal: [0, 0, 0],
    binormal: [0, 0, 0],
    handedness: true,
    flowDirection: [0, 0, 0],
    vertexColor: [0, 0, 0, 0],
    vertexColor2: [0, 0, 0, 0],
    uv1: [0, 0],
    uv2: [0, 0],
    uv3: [0, 0],
    boneIds: new Uint8Array(8),
    weights: new Uint8Array(8),
    ...over,
  };
}

describe("encodeVertexData", () => {
  it("encodes Half4 position with wDefault=1 in stream0", () => {
    const elements: VertexElement[] = [
      {
        stream: 0,
        offset: 0,
        type: VertexDataType.Half4,
        usage: VertexUsageType.Position,
        count: 0,
      },
    ];
    const { stream0, stream1 } = encodeVertexData(
      [vertex({ position: [1, 0, 0] })],
      elements,
    );
    const dv = new DataView(stream0.buffer);
    expect(dv.getUint16(0, true)).toBe(floatToHalf(1));
    expect(dv.getUint16(2, true)).toBe(floatToHalf(0));
    expect(dv.getUint16(4, true)).toBe(floatToHalf(0));
    expect(dv.getUint16(6, true)).toBe(floatToHalf(1)); // W = wDefault(Position) = 1
    expect(stream1).toHaveLength(0);
  });

  it("encodes the Ubyte4n binormal quantizer + handedness byte", () => {
    const elements: VertexElement[] = [
      {
        stream: 1,
        offset: 0,
        type: VertexDataType.Ubyte4n,
        usage: VertexUsageType.Binormal,
        count: 0,
      },
    ];
    // [-1,0,1] -> round((v+1)*127.5) = [0,128,255]; handedness true -> byte 255.
    const { stream1 } = encodeVertexData(
      [vertex({ binormal: [-1, 0, 1], handedness: true })],
      elements,
    );
    expect(Array.from(stream1)).toEqual([0, 128, 255, 255]);
    // handedness false -> byte 0.
    const b = encodeVertexData(
      [vertex({ binormal: [-1, 0, 1], handedness: false })],
      elements,
    );
    expect(Array.from(b.stream1)).toEqual([0, 128, 255, 0]);
  });

  it("writes bone weights/ids with the UByte8 low->high interleave", () => {
    const elements: VertexElement[] = [
      {
        stream: 0,
        offset: 0,
        type: VertexDataType.UByte8,
        usage: VertexUsageType.BoneWeight,
        count: 0,
      },
      {
        stream: 0,
        offset: 8,
        type: VertexDataType.UByte8,
        usage: VertexUsageType.BoneIndex,
        count: 0,
      },
    ];
    const weights = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]);
    const boneIds = new Uint8Array([20, 21, 22, 23, 24, 25, 26, 27]);
    const { stream0 } = encodeVertexData(
      [vertex({ weights, boneIds })],
      elements,
    );
    // low=>high: [0,4,1,5,2,6,3,7]
    expect(Array.from(stream0.slice(0, 8))).toEqual([
      10, 14, 11, 15, 12, 16, 13, 17,
    ]);
    expect(Array.from(stream0.slice(8, 16))).toEqual([
      20, 24, 21, 25, 22, 26, 23, 27,
    ]);
  });
});

describe("encodeIndices", () => {
  it("pads the u16 index block to a multiple of 16 bytes with zeros", () => {
    const out = encodeIndices([1, 2, 3]); // 6 bytes -> padded to 16
    expect(out).toHaveLength(16);
    const dv = new DataView(out.buffer);
    expect([
      dv.getUint16(0, true),
      dv.getUint16(2, true),
      dv.getUint16(4, true),
    ]).toEqual([1, 2, 3]);
    expect(Array.from(out.slice(6))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("adds no padding when already aligned", () => {
    expect(encodeIndices([1, 2, 3, 4, 5, 6, 7, 8])).toHaveLength(16); // 16 bytes exactly
  });
});
