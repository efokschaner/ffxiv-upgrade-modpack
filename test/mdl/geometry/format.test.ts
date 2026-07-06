import { describe, expect, it } from "vitest";
import {
  dataTypeSize,
  VertexDataType,
  VertexUsageType,
} from "../../../src/mdl/geometry/format";

describe("vertex format", () => {
  it("enum numeric values equal the wire bytes", () => {
    expect(VertexUsageType.Position).toBe(0x0);
    expect(VertexUsageType.Color).toBe(0x7);
    expect(VertexDataType.Float3).toBe(0x2);
    expect(VertexDataType.Half4).toBe(0xe);
    expect(VertexDataType.UByte8).toBe(0x11);
  });

  it("dataTypeSize matches the SE size table", () => {
    expect(dataTypeSize(VertexDataType.Float2)).toBe(8);
    expect(dataTypeSize(VertexDataType.Float3)).toBe(12);
    expect(dataTypeSize(VertexDataType.Float4)).toBe(16);
    expect(dataTypeSize(VertexDataType.Ubyte4)).toBe(4);
    expect(dataTypeSize(VertexDataType.Ubyte4n)).toBe(4);
    expect(dataTypeSize(VertexDataType.Half2)).toBe(4);
    expect(dataTypeSize(VertexDataType.Half4)).toBe(8);
    expect(dataTypeSize(VertexDataType.UByte8)).toBe(8);
  });

  it("throws on an unknown data type", () => {
    expect(() => dataTypeSize(0x99 as VertexDataType)).toThrow();
  });
});
