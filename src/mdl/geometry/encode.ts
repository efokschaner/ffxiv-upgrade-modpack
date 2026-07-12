// Geometry encoder: declaration-driven, over verbatim per-element encoders ported from
// xivModdingFramework Mdl.cs WriteVertex/WriteVectorData/ConvertVectorBinormalToBytes.
// Iterating the declaration in sorted-offset order reproduces WriteVertex byte-for-byte on a
// canonical declaration, and is byte-exact by construction for any decodable source.

// TexTools' vertex writer packs Half4/Half2 via SharpDX `new Half()`, which truncates
// toward zero (Mdl.cs:4121-4154 WriteVectorData); use floatToHalfTruncate, not the RTNE
// floatToHalf.
import { floatToHalfTruncate } from "../../util/float16";
import type { VertexElement } from "./declaration";
import { VertexDataType, VertexUsageType } from "./format";
import type { TtVertex, Vec2, Vec3 } from "./vertex-data";

const scratch = new DataView(new ArrayBuffer(4));

function pushU16(out: number[], v: number): void {
  out.push(v & 0xff, (v >>> 8) & 0xff);
}
function pushF32(out: number[], v: number): void {
  scratch.setFloat32(0, v, true);
  out.push(
    scratch.getUint8(0),
    scratch.getUint8(1),
    scratch.getUint8(2),
    scratch.getUint8(3),
  );
}

/** ConvertVectorBinormalToBytes (Mdl.cs:4032-4079). handednessInt = handedness ? -1 : 1. */
function pushBinormalBytes(
  out: number[],
  v: Vec3,
  handednessInt: number,
): void {
  out.push(Math.round((v[0] + 1) * (255 / 2)) & 0xff);
  out.push(Math.round((v[1] + 1) * (255 / 2)) & 0xff);
  out.push(Math.round((v[2] + 1) * (255 / 2)) & 0xff);
  out.push(handednessInt > 0 ? 0 : 255);
}

/** WriteVectorData (Mdl.cs:4121-4154) for Position/Normal/Binormal/Flow. */
function pushVectorData(
  out: number[],
  type: VertexDataType,
  data: Vec3,
  handedness: boolean,
  wDefault: number,
): void {
  if (type === VertexDataType.Half4) {
    pushU16(out, floatToHalfTruncate(data[0]));
    pushU16(out, floatToHalfTruncate(data[1]));
    pushU16(out, floatToHalfTruncate(data[2]));
    pushU16(out, floatToHalfTruncate(wDefault));
  } else if (type === VertexDataType.Float3) {
    pushF32(out, data[0]);
    pushF32(out, data[1]);
    pushF32(out, data[2]);
  } else if (type === VertexDataType.Ubyte4n) {
    // Ubyte4n-only is deliberate fidelity to a reference typo (Mdl.cs:4147: `Ubyte4n ||
    // Ubyte4n`, meant to be `Ubyte4`); a Ubyte4 binormal/flow would fail loud below (stream
    // size mismatch), not silently.
    pushBinormalBytes(out, data, handedness ? -1 : 1);
  }
}

function pushUv(out: number[], type: VertexDataType, a: Vec2, b: Vec2): void {
  if (type === VertexDataType.Float2 || type === VertexDataType.Float4) {
    pushF32(out, a[0]);
    pushF32(out, a[1]);
    if (type === VertexDataType.Float4) {
      pushF32(out, b[0]);
      pushF32(out, b[1]);
    }
  } else if (type === VertexDataType.Half2 || type === VertexDataType.Half4) {
    pushU16(out, floatToHalfTruncate(a[0]));
    pushU16(out, floatToHalfTruncate(a[1]));
    if (type === VertexDataType.Half4) {
      pushU16(out, floatToHalfTruncate(b[0]));
      pushU16(out, floatToHalfTruncate(b[1]));
    }
  }
}

/** Weights/bone-ids: 4 bytes for Ubyte4/Ubyte4n, 8 with low->high interleave for UByte8. */
function pushBoneArray(
  out: number[],
  src: Uint8Array,
  type: VertexDataType,
): void {
  if (type === VertexDataType.UByte8) {
    out.push(
      src[0]!,
      src[4]!,
      src[1]!,
      src[5]!,
      src[2]!,
      src[6]!,
      src[3]!,
      src[7]!,
    );
  } else {
    out.push(src[0]!, src[1]!, src[2]!, src[3]!);
  }
}

function encodeElement(out: number[], e: VertexElement, v: TtVertex): void {
  switch (e.usage) {
    case VertexUsageType.Position:
      pushVectorData(out, e.type, v.position, true, 1);
      break;
    case VertexUsageType.Normal:
      pushVectorData(out, e.type, v.normal, true, 0);
      break;
    case VertexUsageType.Binormal:
      pushVectorData(out, e.type, v.binormal, v.handedness, 0);
      break;
    case VertexUsageType.Flow:
      pushVectorData(out, e.type, v.flowDirection, true, 0);
      break;
    case VertexUsageType.Color:
      out.push(...(e.count === 0 ? v.vertexColor : v.vertexColor2));
      break;
    case VertexUsageType.TextureCoordinate:
      if (e.count === 0) pushUv(out, e.type, v.uv1, v.uv2);
      // Intentionally more permissive than the reference writer here, which only ever
      // emits Float2/Half2 for the count!=0 texcoord (Mdl.cs:4260-4273); harmless since
      // decode now guards the unmodeled non-zero second pair a Half4/Float4 would imply.
      else pushUv(out, e.type, v.uv3, [0, 0]);
      break;
    case VertexUsageType.BoneWeight:
      pushBoneArray(out, v.weights, e.type);
      break;
    case VertexUsageType.BoneIndex:
      pushBoneArray(out, v.boneIds, e.type);
      break;
  }
}

/** Encode `vertices` against `elements` into the two vertex streams (WriteVertex). */
export function encodeVertexData(
  vertices: TtVertex[],
  elements: VertexElement[],
): { stream0: Uint8Array; stream1: Uint8Array } {
  const block0 = elements
    .filter((e) => e.stream === 0)
    .sort((a, b) => a.offset - b.offset);
  const block1 = elements
    .filter((e) => e.stream === 1)
    .sort((a, b) => a.offset - b.offset);
  const out0: number[] = [];
  const out1: number[] = [];
  for (const v of vertices) {
    for (const e of block0) encodeElement(out0, e, v);
    for (const e of block1) encodeElement(out1, e, v);
  }
  return { stream0: new Uint8Array(out0), stream1: new Uint8Array(out1) };
}

/** Encode u16 indices, zero-padded so the block length is a multiple of 16 bytes. */
export function encodeIndices(indices: number[]): Uint8Array {
  const bytes = indices.length * 2;
  const padded = Math.ceil(bytes / 16) * 16;
  const out = new Uint8Array(padded);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < indices.length; i++)
    dv.setUint16(i * 2, indices[i]!, true);
  return out;
}
