import { describe, expect, it } from "vitest";
import {
  buildBoundingBoxBlock,
  buildRadiusBoundingBox,
  computeExtents,
  computeRadius,
} from "../../../src/mdl/model/bounding-box";
import type { TTModel } from "../../../src/mdl/model/tt-model";

function partModel(positions: number[][], bones: string[] = []): TTModel {
  const vertices = positions.map((p) => ({
    position: p,
    normal: [0, 0, 0],
    binormal: [0, 0, 0],
    handedness: true,
    flowDirection: [0, 0, 0],
    vertexColor: [255, 255, 255, 255],
    vertexColor2: [0, 0, 0, 255],
    uv1: [0, 0],
    uv2: [0, 0],
    uv3: [0, 0],
    boneIds: new Uint8Array(8),
    weights: new Uint8Array(8),
  }));
  return {
    source: "",
    mdlVersion: 6,
    attributes: [],
    bones,
    materials: [],
    shapeNames: [],
    anisotropicLighting: false,
    flags1: 0,
    meshGroups: [
      {
        name: "g",
        meshType: 0,
        material: "m",
        bones,
        parts: [
          {
            name: "p",
            attributes: new Set<string>(),
            triangleIndices: [],
            vertices,
          },
        ],
      },
    ],
  } as unknown as TTModel;
}

describe("computeExtents / computeRadius", () => {
  it("computes min/max/abs and float32 radius", () => {
    const e = computeExtents(
      partModel([
        [1, 2, 3],
        [-4, 5, -6],
        [0, 0, 0],
      ]),
    );
    expect(e.min).toEqual([-4, 0, -6]);
    expect(e.max).toEqual([1, 5, 3]);
    expect(e.abs).toEqual([4, 5, 6]);
    expect(computeRadius(e.abs)).toBe(Math.fround(Math.sqrt(77))); // ≈ 8.7749643
  });
});

describe("buildBoundingBoxBlock", () => {
  it("box[0] is origin-clamped, box[1] is the real extent", () => {
    const e = computeExtents(
      partModel(
        [
          [1, 2, 3],
          [4, 5, 6],
        ],
        ["b0"],
      ),
    ); // all-positive -> clamp bites box[0].min
    const block = buildBoundingBoxBlock(
      partModel(
        [
          [1, 2, 3],
          [4, 5, 6],
        ],
        ["b0"],
      ),
      computeRadius(e.abs),
      e.min,
      e.max,
      false,
    );
    const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
    // box[0] min (origin-clamped): (0,0,0,1)
    expect([
      dv.getFloat32(0, true),
      dv.getFloat32(4, true),
      dv.getFloat32(8, true),
      dv.getFloat32(12, true),
    ]).toEqual([0, 0, 0, 1]);
    // box[0] max: (4,5,6,1)
    expect([
      dv.getFloat32(16, true),
      dv.getFloat32(20, true),
      dv.getFloat32(24, true),
      dv.getFloat32(28, true),
    ]).toEqual([4, 5, 6, 1]);
    // box[1] min (unclamped): (1,2,3,1) at offset 32
    expect([
      dv.getFloat32(32, true),
      dv.getFloat32(36, true),
      dv.getFloat32(40, true),
      dv.getFloat32(44, true),
    ]).toEqual([1, 2, 3, 1]);
    // box[2] (water) and box[3] (fog) are zero: bytes 64..127
    expect(Array.from(block.subarray(64, 128)).every((b) => b === 0)).toBe(
      true,
    );
    // total length: 128 model boxes + 32 per bone (1 bone)
    expect(block.length).toBe(128 + 32);
  });
});

describe("buildBoundingBoxBlock with furniture (boneless-part) boxes", () => {
  // Two parts across one group; unweighted (no bones), the furniture-BB shape.
  function twoPartModel(): TTModel {
    const mk = (positions: number[][]) => ({
      name: "p",
      attributes: new Set<string>(),
      triangleIndices: [],
      vertices: positions.map((p) => ({
        position: p,
        normal: [0, 0, 0],
        binormal: [0, 0, 0],
        handedness: true,
        flowDirection: [0, 0, 0],
        vertexColor: [255, 255, 255, 255],
        vertexColor2: [0, 0, 0, 255],
        uv1: [0, 0],
        uv2: [0, 0],
        uv3: [0, 0],
        boneIds: new Uint8Array(8),
        weights: new Uint8Array(8),
      })),
    });
    return {
      source: "",
      mdlVersion: 6,
      attributes: [],
      bones: [],
      materials: [],
      shapeNames: [],
      anisotropicLighting: false,
      flags1: 0,
      meshGroups: [
        {
          name: "g",
          meshType: 0,
          material: "m",
          bones: [],
          parts: [
            mk([
              [1, -2, 3],
              [-4, 5, -6],
            ]),
            mk([
              [0, 0, 0],
              [2, 2, 2],
            ]),
          ],
        },
      ],
    } as unknown as TTModel;
  }

  it("appends one 32-byte box per part after the model boxes, each part's own min/max (Mdl.cs:3751-3772)", () => {
    const m = twoPartModel();
    const block = buildBoundingBoxBlock(m, 10, [-4, -2, -6], [2, 5, 3], true);
    const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
    // 4 model boxes (128 B) + 0 bone cubes + 2 part boxes (64 B) = 192 B.
    expect(block.length).toBe(128 + 64);
    // part 0 box at 128: min (-4,-2,-6,1), max (1,5,3,1).
    const read = (o: number) => [
      dv.getFloat32(o, true),
      dv.getFloat32(o + 4, true),
      dv.getFloat32(o + 8, true),
      dv.getFloat32(o + 12, true),
    ];
    expect(read(128)).toEqual([-4, -2, -6, 1]);
    expect(read(144)).toEqual([1, 5, 3, 1]);
    // part 1 box at 160: min (0,0,0,1), max (2,2,2,1).
    expect(read(160)).toEqual([0, 0, 0, 1]);
    expect(read(176)).toEqual([2, 2, 2, 1]);
  });

  it("omits the per-part boxes when useFurnitureBBs is false", () => {
    const m = twoPartModel();
    const block = buildBoundingBoxBlock(m, 10, [-4, -2, -6], [2, 5, 3], false);
    expect(block.length).toBe(128); // model boxes only, no bones
  });
});

describe("buildRadiusBoundingBox", () => {
  it("is a ±radius/20 cube with w=1", () => {
    const dv = new DataView(buildRadiusBoundingBox(20).buffer);
    expect(dv.getFloat32(0, true)).toBe(-1);
    expect(dv.getFloat32(12, true)).toBe(1);
    expect(dv.getFloat32(16, true)).toBe(1);
    expect(dv.getFloat32(28, true)).toBe(1);
  });
});
