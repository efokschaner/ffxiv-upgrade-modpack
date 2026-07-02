import { ByteBuilder } from "../util/binary";
import { writeColorset } from "./colorset";
import { writeDye } from "./dye";
import {
  type XivMtrl, colorSetDataSize, shaderConstantsDataSize, getRealSamplerCount,
  isEmptySampler, secondarySamplerId,
} from "./types";

const enc = new TextEncoder();

function pad4(len: number): number {
  const r = len % 4;
  return r === 0 ? len : len + (4 - r);
}

/**
 * Serializes an XivMtrl back into raw uncompressed .mtrl bytes. Faithful port of
 * Mtrl.XivMtrlToUncompressedMtrl (Mtrl.cs:556). Regenerates the string block, the sampler
 * double-writes, and the normalized header/flags deterministically — byte-exact for canonical
 * inputs (see design spec §5).
 * NOTE: mutates the caller's model by lowercasing each texture.texturePath in place (faithful to
 * Mtrl.cs:558); no other field of the input is mutated.
 */
export function serializeMtrl(mtrl: XivMtrl): Uint8Array {
  // Lowercase all texture paths (Mtrl.cs:558). Real SE paths are already lowercase (a no-op).
  for (const tex of mtrl.textures) tex.texturePath = tex.texturePath.toLowerCase();

  // Placeholder (empty-sampler) textures are excluded from the count, string block, and tables.
  const realTextures = mtrl.textures.filter((t) => !isEmptySampler(t));

  // Build the string block: texture paths -> uv maps -> colorset strings -> shader pack name.
  const stringBytes: number[] = [];
  const pushString = (s: string): number => {
    const at = stringBytes.length;
    for (const byte of enc.encode(s)) stringBytes.push(byte);
    stringBytes.push(0);
    return at;
  };
  const textureOffsets = realTextures.map((t) => pushString(t.texturePath));
  const mapOffsets = mtrl.uvMapStrings.map((s) => pushString(s.value));
  const colorsetOffsets = mtrl.colorsetStrings.map((s) => pushString(s.value));
  const shaderNameOffset = stringBytes.length;
  pushString(mtrl.shaderPackRaw);
  const stringBlockSize = pad4(stringBytes.length);
  while (stringBytes.length < stringBlockSize) stringBytes.push(0);

  // Toggle the 0x08 dye flag on additionalData[0] (Mtrl.cs:648); guarded on non-empty (spec §8).
  const additionalData = new Uint8Array(mtrl.additionalData);
  if (additionalData.length > 0) {
    if (mtrl.colorSetDyeData.length > 0) additionalData[0]! |= 0x08;
    else additionalData[0]! &= ~0x08 & 0xff;
  }

  const b = new ByteBuilder();
  b.i32(mtrl.signature);
  const fileSizePos = b.length;
  b.u16(0); // fileSize backfilled
  b.u16(colorSetDataSize(mtrl));
  const stringBlockSizePos = b.length;
  b.u16(0); // stringBlockSize backfilled
  const shaderNameOffsetPos = b.length;
  b.u16(0); // shaderNameOffset backfilled
  b.u8(realTextures.length);
  b.u8(mtrl.uvMapStrings.length);
  b.u8(mtrl.colorsetStrings.length);
  b.u8(additionalData.length);

  // Offset/flag tables.
  for (let i = 0; i < realTextures.length; i++) b.u16(textureOffsets[i]!).u16(realTextures[i]!.flags);
  for (let i = 0; i < mtrl.uvMapStrings.length; i++) b.u16(mapOffsets[i]!).u16(mtrl.uvMapStrings[i]!.flags);
  for (let i = 0; i < mtrl.colorsetStrings.length; i++) b.u16(colorsetOffsets[i]!).u16(mtrl.colorsetStrings[i]!.flags);

  b.bytes(stringBytes);
  b.bytes(additionalData);

  writeColorset(b, mtrl.colorSetData);
  if (mtrl.colorSetDyeData.length > 0) writeDye(b, mtrl.colorSetDyeData);

  b.u16(shaderConstantsDataSize(mtrl));
  b.u16(mtrl.shaderKeys.length);
  b.u16(mtrl.shaderConstants.length);
  b.u16(getRealSamplerCount(mtrl));
  b.u16(mtrl.materialFlags);
  b.u16(mtrl.materialFlags2);

  for (const k of mtrl.shaderKeys) b.u32(k.keyId).u32(k.value);

  // Shader-constant descriptors: offsets recomputed sequentially (Mtrl.cs:702).
  let constOffset = 0;
  for (const c of mtrl.shaderConstants) {
    const byteSize = c.values.length * 4;
    b.u32(c.constantId).u16(constOffset).u16(byteSize);
    constOffset += byteSize;
  }

  // Sampler section: write each texture's sampler; regenerate the secondary double-write for
  // 2-UV materials unless another texture already carries it (Mtrl.cs:714).
  const multiUv = mtrl.uvMapStrings.length > 1;
  for (let i = 0; i < mtrl.textures.length; i++) {
    const tex = mtrl.textures[i]!;
    if (!tex.sampler) continue;
    if (isEmptySampler(tex)) {
      b.u32(tex.sampler.samplerIdRaw).u32(tex.sampler.samplerSettingsRaw).u8(255).bytes([0, 0, 0]);
    } else {
      b.u32(tex.sampler.samplerIdRaw).u32(tex.sampler.samplerSettingsRaw).u8(i).bytes([0, 0, 0]);
      if (multiUv) {
        const secondary = secondarySamplerId(tex.sampler.samplerIdRaw);
        if (secondary !== undefined &&
            !mtrl.textures.some((x) => x.sampler && x.sampler.samplerIdRaw === secondary)) {
          b.u32(secondary).u32(tex.sampler.samplerSettingsRaw).u8(i).bytes([0, 0, 0]);
        }
      }
    }
  }

  // Shader-constant float data block, zero-padded to shaderConstantsDataSize if short (Mtrl.cs:774).
  const scds = shaderConstantsDataSize(mtrl);
  let floatBytes = 0;
  for (const c of mtrl.shaderConstants) for (const f of c.values) { b.f32(f); floatBytes += 4; }
  for (let i = floatBytes; i < scds; i++) b.u8(0);

  // Backfill header fields.
  const out = b.toUint8Array();
  const dv = new DataView(out.buffer);
  dv.setUint16(fileSizePos, out.length & 0xffff, true);
  dv.setUint16(stringBlockSizePos, stringBlockSize, true);
  dv.setUint16(shaderNameOffsetPos, shaderNameOffset, true);
  return out;
}
