import { describe, expect, it } from "vitest";
import {
  parseVertexDeclarations,
  serializeVertexDeclarations,
  VERTEX_DATA_HEADER,
  type VertexElement,
} from "../../../src/mdl/geometry/declaration";
import {
  VertexDataType,
  VertexUsageType,
} from "../../../src/mdl/geometry/format";

function meshBlock(elements: number[][]): number[] {
  const b: number[] = [];
  for (const [stream, offset, type, usage, count] of elements) {
    b.push(stream!, offset!, type!, usage!, count!, 0, 0, 0);
  }
  b.push(0xff);
  while (b.length < VERTEX_DATA_HEADER) b.push(0);
  return b;
}

describe("vertex declarations", () => {
  it("parses a two-mesh block into structured elements", () => {
    const bytes = new Uint8Array([
      ...meshBlock([
        [0, 0, VertexDataType.Half4, VertexUsageType.Position, 0],
        [1, 0, VertexDataType.Half4, VertexUsageType.Normal, 0],
      ]),
      ...meshBlock([
        [0, 0, VertexDataType.Float3, VertexUsageType.Position, 0],
      ]),
    ]);
    const decls = parseVertexDeclarations(bytes, 2);
    expect(decls).toHaveLength(2);
    expect(decls[0]).toEqual<VertexElement[]>([
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
        type: VertexDataType.Half4,
        usage: VertexUsageType.Normal,
        count: 0,
      },
    ]);
    expect(decls[1]).toHaveLength(1);
  });

  it("round-trips parse -> serialize byte-exact", () => {
    const bytes = new Uint8Array([
      ...meshBlock([
        [0, 0, VertexDataType.Half4, VertexUsageType.Position, 0],
        [0, 8, VertexDataType.UByte8, VertexUsageType.BoneWeight, 0],
        [1, 0, VertexDataType.Ubyte4n, VertexUsageType.Binormal, 0],
        [1, 4, VertexDataType.Half2, VertexUsageType.TextureCoordinate, 0],
      ]),
    ]);
    const re = serializeVertexDeclarations(parseVertexDeclarations(bytes, 1));
    expect(Array.from(re)).toEqual(Array.from(bytes));
  });

  it("throws when descriptor padding is non-zero", () => {
    const b = meshBlock([
      [0, 0, VertexDataType.Half4, VertexUsageType.Position, 0],
    ]);
    b[5] = 1; // dirty the pad
    expect(() => parseVertexDeclarations(new Uint8Array(b), 1)).toThrow();
  });
});
