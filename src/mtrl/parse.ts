import { BinaryReader } from "../util/binary";
import { readColorset } from "./colorset";
import { readDye } from "./dye";
import {
  type XivMtrl, type MtrlTexture, type MtrlString, type ShaderKey, type ShaderConstant,
  EMPTY_SAMPLER_PREFIX, isPrimaryMapSampler,
} from "./types";

/**
 * Parses a raw uncompressed .mtrl file into an XivMtrl. Faithful port of
 * Mtrl.GetXivMtrl(byte[], string) (Mtrl.cs:174). Strict on structurally impossible inputs
 * (unrecognized colorset size), tolerant where C# is (shader constant past the data block).
 */
export function parseMtrl(bytes: Uint8Array, mtrlPath = ""): XivMtrl {
  const r = new BinaryReader(bytes);

  const signature = r.readInt32();
  r.readUint16(); // fileSize — discarded, recomputed on write
  const colorSetDataSizeField = r.readUint16();
  const stringBlockSize = r.readUint16();
  const shaderNameOffset = r.readUint16();
  const texCount = r.readUint8();
  const mapCount = r.readUint8();
  const colorsetCount = r.readUint8();
  const additionalDataSize = r.readUint8();

  // Offset/flag tables: textures, then UV maps, then colorset strings.
  const textures: MtrlTexture[] = [];
  const texPathOffsets: number[] = [];
  for (let i = 0; i < texCount; i++) {
    texPathOffsets.push(r.readInt16());
    textures.push({ texturePath: "", flags: r.readUint16() });
  }
  const uvMapStrings: MtrlString[] = [];
  const mapOffsets: number[] = [];
  for (let i = 0; i < mapCount; i++) {
    mapOffsets.push(r.readInt16());
    uvMapStrings.push({ value: "", flags: r.readUint16() });
  }
  const colorsetStrings: MtrlString[] = [];
  const colorsetOffsets: number[] = [];
  for (let i = 0; i < colorsetCount; i++) {
    colorsetOffsets.push(r.readInt16());
    colorsetStrings.push({ value: "", flags: r.readUint16() });
  }

  // Strings: every offset is relative to the block start; null-terminated UTF-8.
  const stringBlockStart = r.tell();
  for (let i = 0; i < texCount; i++) {
    r.seek(stringBlockStart + texPathOffsets[i]!);
    textures[i]!.texturePath = r.readNullTerminatedString();
  }
  for (let i = 0; i < mapCount; i++) {
    r.seek(stringBlockStart + mapOffsets[i]!);
    uvMapStrings[i]!.value = r.readNullTerminatedString();
  }
  for (let i = 0; i < colorsetCount; i++) {
    r.seek(stringBlockStart + colorsetOffsets[i]!);
    colorsetStrings[i]!.value = r.readNullTerminatedString();
  }
  r.seek(stringBlockStart + shaderNameOffset);
  const shaderPackRaw = r.readNullTerminatedString();

  r.seek(stringBlockStart + stringBlockSize);
  const additionalData = r.readBytes(additionalDataSize);

  // Colorset section (present iff colorSetDataSize > 0).
  let colorSetData: number[] = [];
  let colorSetDyeData = new Uint8Array(0);
  if (colorSetDataSizeField > 0) {
    const colorDataSize = colorSetDataSizeField >= 2048 ? 2048 : 512;
    const remainder = colorSetDataSizeField - colorDataSize;
    if (remainder !== 0 && remainder !== 32 && remainder !== 128) {
      throw new Error(`mtrl: unrecognized colorSetDataSize ${colorSetDataSizeField}`);
    }
    colorSetData = readColorset(r, colorDataSize);
    if (remainder > 0) colorSetDyeData = readDye(r, remainder);
  }

  // Shader block header.
  const shaderConstantsDataSizeField = r.readUint16();
  const shaderKeysCount = r.readUint16();
  const shaderConstantsCount = r.readUint16();
  const textureSamplerCount = r.readUint16();
  const materialFlags = r.readUint16();
  const materialFlags2 = r.readUint16();

  const shaderKeys: ShaderKey[] = [];
  for (let i = 0; i < shaderKeysCount; i++) {
    shaderKeys.push({ keyId: r.readUint32(), value: r.readUint32() });
  }

  const descriptors: { constantId: number; offset: number; size: number }[] = [];
  for (let i = 0; i < shaderConstantsCount; i++) {
    descriptors.push({ constantId: r.readUint32(), offset: r.readInt16(), size: r.readInt16() });
  }

  // Sampler section: assign to textures, with the drop/replace/placeholder rules (Mtrl.cs:356).
  for (let i = 0; i < textureSamplerCount; i++) {
    const sampler = { samplerIdRaw: r.readUint32(), samplerSettingsRaw: r.readUint32() };
    const textureIndex = r.readUint8();
    r.readBytes(3); // padding
    if (textureIndex < textures.length) {
      const tex = textures[textureIndex]!;
      if (tex.sampler !== undefined) {
        // Already bound. A primary Map0/Spec0/Normal0 replaces; anything else (the secondary
        // ...Map1 that SE double-writes for 2-UV materials) is dropped on parse.
        if (isPrimaryMapSampler(sampler.samplerIdRaw)) tex.sampler = sampler;
      } else {
        tex.sampler = sampler;
      }
    } else {
      // Index 255 (or any out-of-range): a fake placeholder texture holds the sampler.
      textures.push({ texturePath: EMPTY_SAMPLER_PREFIX + sampler.samplerIdRaw, flags: 0, sampler });
    }
  }

  // Shader-constant float data block, read sequentially (Mtrl.cs:403). Offsets are recomputed on
  // write, so we do not seek by them here. A descriptor pointing past the block yields zeros.
  const shaderConstants: ShaderConstant[] = [];
  let bytesRead = 0;
  for (const d of descriptors) {
    let values: number[];
    if (bytesRead + d.size <= shaderConstantsDataSizeField) {
      values = [];
      for (let idx = 0; idx < d.size; idx += 4) { values.push(r.readFloat32()); bytesRead += 4; }
    } else {
      values = new Array(Math.floor(d.size / 4)).fill(0);
    }
    shaderConstants.push({ constantId: d.constantId, values });
  }
  while (bytesRead < shaderConstantsDataSizeField) { r.readUint8(); bytesRead += 1; }

  return {
    signature, shaderPackRaw, additionalData,
    textures, uvMapStrings, colorsetStrings,
    colorSetData, colorSetDyeData,
    shaderKeys, shaderConstants,
    materialFlags, materialFlags2, mtrlPath,
  };
}
