import { describe, expect, it } from "vitest";
import { parseGeometryLayout } from "../../../src/mdl/geometry/offsets";
import type { XivMdl } from "../../../src/mdl/types";

function lodHeaders(): Uint8Array {
  const b = new Uint8Array(180); // 3 x 60
  const dv = new DataView(b.buffer);
  // LoD0: 1 standard mesh, vertexDataSize=100, vertexDataOffset=1000, indexDataOffset=2000
  dv.setUint16(2, 1, true); // StandardMeshCount
  dv.setInt32(44, 100, true); // VertexDataSize
  dv.setInt32(52, 1000, true); // VertexDataOffset
  dv.setInt32(56, 2000, true); // IndexDataOffset
  return b;
}

function meshHeaders(): Uint8Array {
  const b = new Uint8Array(36);
  const dv = new DataView(b.buffer);
  dv.setInt32(0, 4, true); // VertexCount
  dv.setInt32(4, 6, true); // IndexCount
  dv.setInt16(10, 0, true); // MeshPartIndex
  dv.setInt16(12, 1, true); // MeshPartCount
  dv.setInt32(16, 3, true); // IndexDataOffset (u16 units)
  dv.setInt32(20, 0, true); // VertexDataOffset0
  dv.setInt32(24, 64, true); // VertexDataOffset1
  b[32] = 16; // entrySize0
  b[33] = 20; // entrySize1
  return b;
}

function meshParts(): Uint8Array {
  const b = new Uint8Array(16);
  const dv = new DataView(b.buffer);
  dv.setInt32(0, 0, true); // IndexOffset
  dv.setInt32(4, 6, true); // IndexCount
  return b;
}

function fakeMdl(): XivMdl {
  return {
    header: { meshCount: 1 },
    modelData: { meshPartCount: 1 },
    vertexInfo: new Uint8Array(0),
    sections: {
      lodHeaders: lodHeaders(),
      meshHeaders: meshHeaders(),
      meshParts: meshParts(),
    },
    geometry: new Uint8Array(0),
  } as unknown as XivMdl;
}

describe("parseGeometryLayout", () => {
  it("reads LoD/mesh/part offsets and the LoD partition", () => {
    const layout = parseGeometryLayout(fakeMdl());
    expect(layout.lods[0]!.vertexDataOffset).toBe(1000);
    expect(layout.lods[0]!.indexDataOffset).toBe(2000);
    expect(layout.lods[0]!.meshCount).toBe(1);
    expect(layout.meshes[0]).toMatchObject({
      vertexCount: 4,
      indexCount: 6,
      indexDataOffset: 3,
      vertexDataOffset0: 0,
      vertexDataOffset1: 64,
      vertexDataEntrySize0: 16,
      vertexDataEntrySize1: 20,
    });
    expect(layout.parts[0]).toEqual({ indexOffset: 0, indexCount: 6 });
    expect(layout.meshLod).toEqual([0]); // mesh 0 belongs to LoD 0
  });
});
