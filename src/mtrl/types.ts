// Marker for placeholder textures that hold a sampler bound to no real texture (C# synthesizes one
// per orphan sampler at Mtrl.cs:396). Lowercase so isEmptySampler still matches after serialize's
// path-lowercasing. NOTE (audit M1): C#'s prefix const "_EMPTY_SAMPLER_" (Mtrl.cs:70) is UPPERCASE,
// so its own exclusion checks miss the lowercased path and C# actually WRITES these placeholders to
// output — a quirk serialize.ts does not yet reproduce (it throws instead; see there +
// docs/backlog/2026-07-08-mtrl-empty-sampler-placeholders.md).
export const EMPTY_SAMPLER_PREFIX = "_empty_sampler_";

// ESamplerId raw values needed for the sampler double-write decision (ShaderHelpers.cs:480).
export const SAMPLER_NORMAL_MAP_0 = 0xaab4d9e9;
export const SAMPLER_NORMAL_MAP_1 = 0xddb3e97f;
export const SAMPLER_SPECULAR_MAP_0 = 0x1bbc2f12;
export const SAMPLER_SPECULAR_MAP_1 = 0x6cbb1f84;
export const SAMPLER_COLOR_MAP_0 = 0x1e6fef9c;
export const SAMPLER_COLOR_MAP_1 = 0x6968df0a;

export interface TextureSampler {
  samplerIdRaw: number; // ESamplerId raw CRC (uint32)
  samplerSettingsRaw: number; // packed tiling/LoD settings (uint32)
}

export interface MtrlTexture {
  texturePath: string;
  flags: number; // ushort
  sampler?: TextureSampler; // absent when the file bound no sampler to this texture
}

export interface MtrlString {
  value: string;
  flags: number; // ushort
}

export interface ShaderKey {
  keyId: number; // uint32
  value: number; // uint32
}

export interface ShaderConstant {
  constantId: number; // uint32
  values: number[]; // float32 values
}

export interface XivMtrl {
  signature: number; // int32 (default 0x00000301)
  shaderPackRaw: string; // shader-pack name (e.g. "character.shpk")
  additionalData: Uint8Array; // opaque; byte 0 carries the 0x08 dye flag
  textures: MtrlTexture[];
  uvMapStrings: MtrlString[];
  colorsetStrings: MtrlString[];
  colorSetData: number[]; // raw half-float uint16s (Half.RawValue); byte-exact
  colorSetDyeData: Uint8Array; // raw dye blob (0/32/128 bytes)
  shaderKeys: ShaderKey[];
  shaderConstants: ShaderConstant[];
  materialFlags: number; // ushort (EMaterialFlags1)
  materialFlags2: number; // ushort (EMaterialFlags2)
  mtrlPath: string; // carried for later transform use; does not affect bytes
}

export function isEmptySampler(tex: MtrlTexture): boolean {
  return tex.texturePath.startsWith(EMPTY_SAMPLER_PREFIX);
}

/** Recomputed colorset section size (XivMtrl.cs:105): data halves*2 + dye length. */
export function colorSetDataSize(m: XivMtrl): number {
  return m.colorSetData.length * 2 + m.colorSetDyeData.length;
}

/** Recomputed shader-constant float-block size (XivMtrl.cs:150): sum of values*4. */
export function shaderConstantsDataSize(m: XivMtrl): number {
  let size = 0;
  for (const c of m.shaderConstants) size += c.values.length * 4;
  return size;
}

/** Maps a primary Map0 sampler id to its secondary Map1 id, or undefined if not a primary map. */
export function secondarySamplerId(rawId: number): number | undefined {
  switch (rawId) {
    case SAMPLER_COLOR_MAP_0:
      return SAMPLER_COLOR_MAP_1;
    case SAMPLER_SPECULAR_MAP_0:
      return SAMPLER_SPECULAR_MAP_1;
    case SAMPLER_NORMAL_MAP_0:
      return SAMPLER_NORMAL_MAP_1;
    default:
      return undefined;
  }
}

export function isPrimaryMapSampler(rawId: number): boolean {
  return secondarySamplerId(rawId) !== undefined;
}

/** Faithful port of XivMtrl.GetRealSamplerCount (XivMtrl.cs:262): number of samplers written to
 *  disk, counting the secondary double-write regenerated for 2-UV materials. Counts every texture
 *  with a sampler, INCLUDING empty-sampler placeholders (C# counts them too, at :264/:271 — it does
 *  not special-case them). serialize.ts fails loud before this runs with a placeholder present, so
 *  the placeholder arm here only matters for direct unit coverage; keeping it faithful avoids the
 *  divergence-in-spirit the prior `isEmptySampler` skip introduced (audit M2). */
export function getRealSamplerCount(m: XivMtrl): number {
  let total = m.textures.filter((t) => t.sampler).length;
  if (m.uvMapStrings.length <= 1) return total;
  for (const tex of m.textures) {
    if (!tex.sampler) continue;
    const secondary = secondarySamplerId(tex.sampler.samplerIdRaw);
    if (secondary === undefined) continue;
    if (
      m.textures.some((x) => x.sampler && x.sampler.samplerIdRaw === secondary)
    )
      continue;
    total++;
  }
  return total;
}
