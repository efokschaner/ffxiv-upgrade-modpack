// Vertex declaration enums, ported from xivModdingFramework Models/Enums.
// The enum numeric value IS the on-wire byte (SE's own translation table; Mdl.cs:5360-5391).

export enum VertexUsageType {
  Position = 0x0,
  BoneWeight = 0x1,
  BoneIndex = 0x2,
  Normal = 0x3,
  TextureCoordinate = 0x4,
  Flow = 0x5,
  Binormal = 0x6,
  Color = 0x7,
}

export enum VertexDataType {
  Float2 = 0x1,
  Float3 = 0x2,
  Float4 = 0x3,
  Ubyte4 = 0x5,
  Ubyte4n = 0x8,
  Half2 = 0xd,
  Half4 = 0xe,
  UByte8 = 0x11,
}

const SIZES: Partial<Record<VertexDataType, number>> = {
  [VertexDataType.Float2]: 8,
  [VertexDataType.Float3]: 12,
  [VertexDataType.Float4]: 16,
  [VertexDataType.Ubyte4]: 4,
  [VertexDataType.Ubyte4n]: 4,
  [VertexDataType.Half2]: 4,
  [VertexDataType.Half4]: 8,
  [VertexDataType.UByte8]: 8,
};

/** Byte size of one element of the given data type (VertexDataType.cs:47-63). */
export function dataTypeSize(t: VertexDataType): number {
  const s = SIZES[t];
  if (s === undefined)
    throw new Error(`unknown vertex data type 0x${t.toString(16)}`);
  return s;
}
