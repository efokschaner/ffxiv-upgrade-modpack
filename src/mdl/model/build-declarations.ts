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

const MAX_VERTEX_BUFFER_SIZE = 8388608; // Mdl._MaxVertexBufferSize (8 MB)

/** Per-vertex byte estimate mirroring Mdl.cs:2513-2542's overflow check, used
 *  only to assert our Half->Float upgrade path is safe for the corpus (see
 *  buildDeclarations doc comment). */
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

/** Port of the element-set construction in MakeUncompressedMdlFile
 *  (Mdl.cs:2614-2711), assuming upgradePrecision=true (Half->Float upgrade):
 *  our corpus never approaches the 8 MB _MaxVertexBufferSize that would force
 *  TexTools to fall back to Half-precision (Mdl.cs:2513-2542), so we assert
 *  that here and fail loud rather than silently emit a byte-incompatible
 *  Half-precision declaration.
 *
 *  The element set is model-wide (depends only on getUsageInfo(m),
 *  hasWeights(m) and m.anisotropicLighting), so every mesh group receives an
 *  identical declaration (distinct array references, identical contents). */
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
  let total = 0;
  for (const group of m.meshGroups) {
    let vertexCount = 0;
    for (const part of group.parts) {
      vertexCount += part.vertices.length;
    }
    total += vertexCount * perVertex;
  }
  if (total >= MAX_VERTEX_BUFFER_SIZE) {
    throw new Error(
      "mdl: vertex buffer would overflow 8MB; Half-precision path unsupported",
    );
  }

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

  add(0, VertexUsageType.Position, VertexDataType.Float3);
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
  add(1, VertexUsageType.Normal, VertexDataType.Float3);
  add(1, VertexUsageType.Binormal, VertexDataType.Ubyte4n);
  if (flow) {
    add(1, VertexUsageType.Flow, VertexDataType.Ubyte4n);
  }
  add(1, VertexUsageType.Color, VertexDataType.Ubyte4n);
  if (usesVColor2) {
    add(1, VertexUsageType.Color, VertexDataType.Ubyte4n);
  }
  add(
    1,
    VertexUsageType.TextureCoordinate,
    maxUv === 1 ? VertexDataType.Float2 : VertexDataType.Float4,
  );
  if (maxUv > 2) {
    add(1, VertexUsageType.TextureCoordinate, VertexDataType.Float2);
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
