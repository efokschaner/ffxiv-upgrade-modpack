// Geometry decoder: verbatim port of xivModdingFramework MdlVertexReader.cs (GPL-3.0).
// Reads a mesh's block0/block1 vertex streams and its u16 index buffer into SoA VertexData.

import { halfToFloat } from "../../util/half";
import type { VertexElement } from "./declaration";
import { VertexDataType, VertexUsageType } from "./format";
import type { MeshGeometryInfo } from "./offsets";
import {
  emptyVertexData,
  type Rgba,
  type Vec2,
  type Vec3,
  type VertexData,
} from "./vertex-data";

class Cursor {
  constructor(
    private readonly bytes: Uint8Array,
    private readonly dv: DataView,
    public pos: number,
  ) {}
  u8(): number {
    return this.bytes[this.pos++]!;
  }
  u16(): number {
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  f32(): number {
    const v = this.dv.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
}

function readVector3(c: Cursor, type: VertexDataType): Vec3 {
  let v: Vec3;
  if (type === VertexDataType.Half4) {
    const x = halfToFloat(c.u16());
    const y = halfToFloat(c.u16());
    const z = halfToFloat(c.u16());
    c.u16(); // w, consumed and discarded
    v = [x, y, z];
  } else {
    v = [c.f32(), c.f32(), c.f32()];
  }
  if (
    !Number.isFinite(v[0]) ||
    !Number.isFinite(v[1]) ||
    !Number.isFinite(v[2])
  ) {
    return [0, 0, 0];
  }
  return v;
}

function readByteVector(c: Cursor): { vector: Vec3; handedness: number } {
  const x = (c.u8() * 2) / 255 - 1;
  const y = (c.u8() * 2) / 255 - 1;
  const z = (c.u8() * 2) / 255 - 1;
  const w = c.u8();
  return { vector: [x, y, z], handedness: w };
}

function readColor(c: Cursor): Rgba {
  return [c.u8(), c.u8(), c.u8(), c.u8()];
}

function readDoubleVector(
  c: Cursor,
  type: VertexDataType,
): { vec0: Vec2; vec1: Vec2 } {
  if (type === VertexDataType.Half4) {
    return {
      vec0: [halfToFloat(c.u16()), halfToFloat(c.u16())],
      vec1: [halfToFloat(c.u16()), halfToFloat(c.u16())],
    };
  }
  if (type === VertexDataType.Half2) {
    return { vec0: [halfToFloat(c.u16()), halfToFloat(c.u16())], vec1: [0, 0] };
  }
  if (type === VertexDataType.Float2) {
    return { vec0: [c.f32(), c.f32()], vec1: [0, 0] };
  }
  if (type === VertexDataType.Float4) {
    return { vec0: [c.f32(), c.f32()], vec1: [c.f32(), c.f32()] };
  }
  return { vec0: [0, 0], vec1: [0, 0] };
}

function readByteOrFloatArray(
  c: Cursor,
  type: VertexDataType,
  asFloat: boolean,
): number[] {
  const raw = new Array<number>(type === VertexDataType.UByte8 ? 8 : 4);
  if (type === VertexDataType.UByte8) {
    // Silly low => high format (MdlVertexReader.cs:117-128).
    raw[0] = c.u8();
    raw[4] = c.u8();
    raw[1] = c.u8();
    raw[5] = c.u8();
    raw[2] = c.u8();
    raw[6] = c.u8();
    raw[3] = c.u8();
    raw[7] = c.u8();
  } else {
    for (let z = 0; z < raw.length; z++) raw[z] = c.u8();
  }
  return asFloat ? raw.map((b) => b / 255) : raw;
}

function readData(vd: VertexData, c: Cursor, e: VertexElement): void {
  switch (e.usage) {
    case VertexUsageType.TextureCoordinate: {
      const r = readDoubleVector(c, e.type);
      if (e.count === 0) {
        vd.textureCoordinates0.push(r.vec0);
        vd.textureCoordinates1.push(r.vec1);
      } else {
        vd.textureCoordinates2.push(r.vec0);
      }
      break;
    }
    case VertexUsageType.Binormal: {
      const r = readByteVector(c);
      vd.biNormals.push(r.vector);
      vd.biNormalHandedness.push(r.handedness);
      break;
    }
    case VertexUsageType.Flow: {
      const r = readByteVector(c);
      vd.flowDirections.push(r.vector);
      vd.flowHandedness.push(r.handedness);
      break;
    }
    case VertexUsageType.Normal:
      vd.normals.push(readVector3(c, e.type));
      break;
    case VertexUsageType.Position:
      vd.positions.push(readVector3(c, e.type));
      break;
    case VertexUsageType.Color:
      (e.count === 0 ? vd.colors : vd.colors2).push(readColor(c));
      break;
    case VertexUsageType.BoneWeight:
      vd.boneWeights.push(readByteOrFloatArray(c, e.type, true));
      break;
    case VertexUsageType.BoneIndex:
      vd.boneIndices.push(readByteOrFloatArray(c, e.type, false));
      break;
  }
}

/** Decode one mesh's vertex + index buffers (MdlVertexReader.ReadVertexData). */
export function decodeVertexData(
  mdl: Uint8Array,
  mesh: MeshGeometryInfo,
  elements: VertexElement[],
  lodVertexOffset: number,
  lodIndexOffset: number,
): VertexData {
  const vd = emptyVertexData();
  const dv = new DataView(mdl.buffer, mdl.byteOffset, mdl.byteLength);
  const block0 = elements
    .filter((e) => e.stream === 0)
    .sort((a, b) => a.offset - b.offset);
  const block1 = elements
    .filter((e) => e.stream === 1)
    .sort((a, b) => a.offset - b.offset);

  const block0Offset = mesh.vertexDataOffset0 + lodVertexOffset;
  const c0 = new Cursor(mdl, dv, block0Offset);
  for (let i = 0; i < mesh.vertexCount; i++)
    for (const e of block0) readData(vd, c0, e);
  const end0 = block0Offset + mesh.vertexCount * mesh.vertexDataEntrySize0;
  if (c0.pos !== end0)
    throw new Error(`mdl: stream0 not fully consumed (${c0.pos} != ${end0})`);

  const block1Offset = mesh.vertexDataOffset1 + lodVertexOffset;
  const c1 = new Cursor(mdl, dv, block1Offset);
  for (let i = 0; i < mesh.vertexCount; i++)
    for (const e of block1) readData(vd, c1, e);
  const end1 = block1Offset + mesh.vertexCount * mesh.vertexDataEntrySize1;
  if (c1.pos !== end1)
    throw new Error(`mdl: stream1 not fully consumed (${c1.pos} != ${end1})`);

  const indexOffset = mesh.indexDataOffset * 2 + lodIndexOffset;
  for (let i = 0; i < mesh.indexCount; i++)
    vd.indices.push(dv.getUint16(indexOffset + i * 2, true));

  return vd;
}
