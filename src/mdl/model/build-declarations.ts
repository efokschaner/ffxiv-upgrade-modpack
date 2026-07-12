// Vertex declaration rebuild from model usage, ported from the element-set
// construction in xivModdingFramework's MakeUncompressedMdlFile (Mdl.cs:2594-2767;
// element set/types :2614-2711, buffer-overflow/precision gate :2513-2542).
// Split, don't blend: this produces the structured VertexElement[][]; byte
// serialization stays in serializeVertexDeclarations (geometry/declaration.ts).

import type { VertexElement } from "../geometry/declaration";
import {
  dataTypeSize,
  VertexDataType,
  VertexUsageType,
} from "../geometry/format";
import { getUsageInfo, hasWeights, type TTModel } from "./tt-model";

/** Mdl._MaxVertexBufferSize (Mdl.cs:2468, 8 MB). Exported so serialize.ts's port of the
 *  post-assembly hard cap (Mdl.cs:2822) reuses the one source of truth. */
export const MAX_VERTEX_BUFFER_SIZE = 8388608;

/** Per-vertex byte estimate mirroring Mdl.cs:2513-2535's precision-independent vertexSize
 *  (always the Float layout), used to decide upgradePrecision in buildDeclarations. */
function estimatePerVertexSize(
  needsEightWeights: boolean,
  maxUv: number,
  usesVColor2: boolean,
  flow: boolean,
): number {
  const weightsExtra = needsEightWeights ? 8 : 0;
  const uvExtra = maxUv === 2 ? 8 : maxUv >= 3 ? 16 : 0;
  const vColor2Extra = usesVColor2 ? 4 : 0;
  const flowExtra = flow ? 4 : 0;
  return 48 + weightsExtra + uvExtra + vColor2Extra + flowExtra;
}

/** Port of the element-set construction in MakeUncompressedMdlFile (Mdl.cs:2614-2711),
 *  including the precision gate (Mdl.cs:2513-2543). `upgradePrecision` starts true (the
 *  /upgrade path's Half->Float upgrade) and is declined when the estimated Float vertex
 *  buffer would reach the 8 MB _MaxVertexBufferSize; the declaration then stays Half-
 *  precision (Position/Normal Half4, texcoord Half2/Half4) and the Flow element is dropped
 *  entirely (Mdl.cs:2655 gates it on upgradePrecision). The estimate is precision-independent
 *  (always the Float per-vertex size) and mirrors Mdl.cs:2513-2538, including shape-part
 *  vertices (Mdl.cs:2536-2538).
 *
 *  The element set is model-wide (depends only on getUsageInfo(m), hasWeights(m) and
 *  m.anisotropicLighting), so every mesh group receives an identical declaration (distinct
 *  array references, identical contents). */
export function buildDeclarations(m: TTModel): VertexElement[][] {
  const { usesVColor2, maxUv, needsEightWeights } = getUsageInfo(m);
  const weights = hasWeights(m);
  const flow = m.anisotropicLighting;

  const perVertex = estimatePerVertexSize(
    needsEightWeights,
    maxUv,
    usesVColor2,
    flow,
  );
  // Mdl.cs:2536-2538: totalVertexCount = shapeVertCount + VertexCount. shapeVertCount sums
  // every shapePart's vertices EXCEPT the "original" key (the base geometry, already counted).
  let totalVertexCount = 0;
  for (const group of m.meshGroups) {
    for (const part of group.parts) {
      totalVertexCount += part.vertices.length;
      for (const [key, shape] of part.shapeParts) {
        if (key !== "original") totalVertexCount += shape.vertices.length;
      }
    }
  }
  const upgradePrecision =
    perVertex * totalVertexCount < MAX_VERTEX_BUFFER_SIZE;

  const decl: VertexElement[] = [];
  const runningOffset = [0, 0, 0];
  const occ = new Map<VertexUsageType, number>();
  function add(
    stream: number,
    usage: VertexUsageType,
    type: VertexDataType,
  ): void {
    const count = occ.get(usage) ?? 0;
    decl.push({ stream, offset: runningOffset[stream]!, type, usage, count });
    runningOffset[stream]! += dataTypeSize(type);
    occ.set(usage, count + 1);
  }

  add(
    0,
    VertexUsageType.Position,
    upgradePrecision ? VertexDataType.Float3 : VertexDataType.Half4,
  );
  if (weights) {
    add(
      0,
      VertexUsageType.BoneWeight,
      needsEightWeights ? VertexDataType.UByte8 : VertexDataType.Ubyte4n,
    );
    add(
      0,
      VertexUsageType.BoneIndex,
      needsEightWeights ? VertexDataType.UByte8 : VertexDataType.Ubyte4,
    );
  }
  add(
    1,
    VertexUsageType.Normal,
    upgradePrecision ? VertexDataType.Float3 : VertexDataType.Half4,
  );
  add(1, VertexUsageType.Binormal, VertexDataType.Ubyte4n);
  // Mdl.cs:2655: the Flow element is emitted only when upgradePrecision is true -- the Half
  // fallback drops it even if the model uses flow data.
  if (upgradePrecision && flow) {
    add(1, VertexUsageType.Flow, VertexDataType.Ubyte4n);
  }
  add(1, VertexUsageType.Color, VertexDataType.Ubyte4n);
  if (usesVColor2) {
    add(1, VertexUsageType.Color, VertexDataType.Ubyte4n);
  }
  add(
    1,
    VertexUsageType.TextureCoordinate,
    maxUv === 1
      ? upgradePrecision
        ? VertexDataType.Float2
        : VertexDataType.Half2
      : upgradePrecision
        ? VertexDataType.Float4
        : VertexDataType.Half4,
  );
  if (maxUv > 2) {
    add(
      1,
      VertexUsageType.TextureCoordinate,
      upgradePrecision ? VertexDataType.Float2 : VertexDataType.Half2,
    );
  }

  return m.meshGroups.map(() => decl);
}

/** Per-stream (block) byte totals for a declaration -- the vertex stride of
 *  each stream -- derived from the elements themselves so it stays correct
 *  for any usage combination rather than a hardcoded table. */
export function streamEntrySizes(
  elements: VertexElement[],
): [number, number, number] {
  const sizes: [number, number, number] = [0, 0, 0];
  for (const e of elements) {
    sizes[e.stream] += dataTypeSize(e.type);
  }
  return sizes;
}
