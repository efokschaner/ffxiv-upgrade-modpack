import { concatBytes } from "../util/binary";
import { serializeMdlHeader } from "./header";
import { serializeMdlModelData } from "./model-data";
import type { XivMdl } from "./types";

/** Serializes an XivMdl back to runtime .mdl bytes by replaying the retained header + vertexInfo, the
 *  model-data sections in order (MdlModelData re-serialized at position 2), and the geometry tail.
 *  Structural inverse of parseMdl; section order follows GetXivMdl's read order (Mdl.cs:349+).
 *  Byte-exact for any parsed input (design spec §6). */
export function serializeMdl(mdl: XivMdl): Uint8Array {
  const s = mdl.sections;
  return concatBytes([
    serializeMdlHeader(mdl.header),
    mdl.vertexInfo,
    s.pathData,
    serializeMdlModelData(mdl.modelData),
    s.elementIds,
    s.lodHeaders,
    s.extraMeshHeader,
    s.meshHeaders,
    s.attributeOffsets,
    s.terrainShadowMeshHeaders,
    s.meshParts,
    s.terrainShadowParts,
    s.materialOffsets,
    s.boneOffsets,
    s.boneSets,
    s.shapeInfo,
    s.shapeParts,
    s.shapeData,
    s.partBoneSet,
    s.neckMorphTable,
    s.patch72,
    s.padding,
    s.boundingBoxes,
    s.trailing,
    mdl.geometry,
  ]);
}
