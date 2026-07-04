import { concatBytes } from "../util/binary";
import { serializeTexHeader } from "./header";
import type { XivTex } from "./types";

/** Serializes an XivTex back to raw .tex bytes by replaying the retained header + mip tail. Byte-exact
 *  for parsed inputs (design spec §2). Regenerated textures use encodeUncompressedTex (Task 8) instead. */
export function serializeTex(tex: XivTex): Uint8Array {
  return concatBytes([serializeTexHeader(tex), tex.mipData]);
}
