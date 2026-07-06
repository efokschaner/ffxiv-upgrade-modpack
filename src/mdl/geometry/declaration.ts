// Vertex declaration codec: the 136-byte-per-mesh vertex-info block <-> structured
// elements. Ported from xivModdingFramework Mdl.cs (parse :562-600, serialize :2735-2763) (GPL-3.0).

import type { VertexDataType, VertexUsageType } from "./format";

export const VERTEX_DATA_HEADER = 136; // Mdl._VertexDataHeaderSize (0x88)

export interface VertexElement {
  stream: number;
  offset: number;
  type: VertexDataType;
  usage: VertexUsageType;
  count: number;
}

/** Parse `meshCount` consecutive 136-byte declaration blocks into per-mesh element lists. */
export function parseVertexDeclarations(
  vertexInfo: Uint8Array,
  meshCount: number,
): VertexElement[][] {
  const decls: VertexElement[][] = [];
  for (let m = 0; m < meshCount; m++) {
    const base = m * VERTEX_DATA_HEADER;
    const elements: VertexElement[] = [];
    let p = base;
    while (true) {
      const stream = vertexInfo[p]!;
      if (stream === 0xff) break;
      const offset = vertexInfo[p + 1]!;
      const type = vertexInfo[p + 2]! as VertexDataType;
      const usage = vertexInfo[p + 3]! as VertexUsageType;
      const count = vertexInfo[p + 4]!;
      if (
        vertexInfo[p + 5] !== 0 ||
        vertexInfo[p + 6] !== 0 ||
        vertexInfo[p + 7] !== 0
      ) {
        throw new Error(
          `mdl: non-zero vertex descriptor padding at mesh ${m} offset ${p - base}`,
        );
      }
      elements.push({ stream, offset, type, usage, count });
      p += 8;
    }
    decls.push(elements);
  }
  return decls;
}

/** Serialize per-mesh element lists back to the 136-byte-per-mesh block (inverse of parse). */
export function serializeVertexDeclarations(
  decls: VertexElement[][],
): Uint8Array {
  const out = new Uint8Array(decls.length * VERTEX_DATA_HEADER); // zero-filled = padding + terminator tail
  for (let m = 0; m < decls.length; m++) {
    let p = m * VERTEX_DATA_HEADER;
    for (const e of decls[m]!) {
      out[p] = e.stream;
      out[p + 1] = e.offset;
      out[p + 2] = e.type;
      out[p + 3] = e.usage;
      out[p + 4] = e.count;
      // out[p+5..p+7] already 0
      p += 8;
    }
    out[p] = 0xff; // terminator; remaining bytes stay 0
  }
  return out;
}
