// Port of the texture-generation orchestration from xivModdingFramework
// Mods/EndwalkerUpgrade.cs (UpgradeRemainingTextures and its helpers). Pixel math
// lives in src/tex/helpers.ts (TextureHelpers.cs); this module only decodes source
// textures, applies a transform, and re-encodes as uncompressed A8R8G8B8
// (DefaultTextureFormat = A8R8G8B8, XivCache.cs:68).

import {
  FileStorageType,
  type ModpackFile,
  type ModpackOption,
} from "../model/modpack";
import { encodeSqPackFile, SqPackType } from "../sqpack/sqpack";
import {
  createHairMaps,
  createIndexTexture,
  upgradeGearMask,
} from "../tex/helpers";
import { decodeToRgba, encodeUncompressedTex, parseTex } from "../tex/tex";
import { uncompressedBytes } from "./upgrade";
import { EUpgradeTextureUsage, type UpgradeInfo } from "./upgrade-info";

/** Thrown when a source texture would require an ImageSharp resize (NPOT normalize or
 *  hair normal/mask size mismatch) that this round does not yet port. Caught+skipped at
 *  the dispatch boundary so one un-generatable target degrades to a ratchet-baselined
 *  diff rather than crashing the whole pack. See spec §4.4/§5. */
export class TextureResizeUnsupported extends Error {}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** Port of CreateIndexFromNormal (EndwalkerUpgrade.cs:1083). Decodes the normal, builds
 *  the index map from its alpha, re-encodes A8R8G8B8 with mips. NPOT normals need a
 *  Bicubic resize (:1098) we don't port -> throw the resize sentinel. */
export function createIndexFromNormal(normalTexBytes: Uint8Array): Uint8Array {
  const tex = parseTex(normalTexBytes);
  if (!isPowerOfTwo(tex.width) || !isPowerOfTwo(tex.height)) {
    throw new TextureResizeUnsupported(
      `index: NPOT normal ${tex.width}x${tex.height} needs a resize (EndwalkerUpgrade.cs:1098)`,
    );
  }
  const normalRgba = decodeToRgba(tex);
  const indexRgba = createIndexTexture(normalRgba, tex.width, tex.height);
  return encodeUncompressedTex(indexRgba, tex.width, tex.height, {
    mips: true,
  });
}

/** Port of UpgradeMaskTex (EndwalkerUpgrade.cs:2082). Decodes the mask, applies the
 *  gear-mask channel remap, re-encodes A8R8G8B8 with mips. NPOT masks resize (:2088) ->
 *  throw the resize sentinel. */
export function upgradeMaskTex(
  maskTexBytes: Uint8Array,
  legacy: boolean,
): Uint8Array {
  const tex = parseTex(maskTexBytes);
  if (!isPowerOfTwo(tex.width) || !isPowerOfTwo(tex.height)) {
    throw new TextureResizeUnsupported(
      `gearmask: NPOT mask ${tex.width}x${tex.height} needs a resize (EndwalkerUpgrade.cs:2088)`,
    );
  }
  const rgba = decodeToRgba(tex);
  upgradeGearMask(rgba, tex.width, tex.height, legacy);
  return encodeUncompressedTex(rgba, tex.width, tex.height, { mips: true });
}

/** Port of UpdateEndwalkerHairTextures (EndwalkerUpgrade.cs:1175). Decodes normal + mask,
 *  applies CreateHairMaps, re-encodes both A8R8G8B8 with mips. C# resizes each to pow2
 *  (:1195) then to their common max size (ResizeImages, :1205, Bicubic); we do not port
 *  that resampler, so any NPOT input or size mismatch throws the resize sentinel. When
 *  sizes already match and are pow2 (the common case), ResizeImages is a no-op (early
 *  return, TextureHelpers.cs:368) and the result is byte-exact. */
export function updateEndwalkerHairTextures(
  normalTexBytes: Uint8Array,
  maskTexBytes: Uint8Array,
): { normal: Uint8Array; mask: Uint8Array } {
  const nTex = parseTex(normalTexBytes);
  const mTex = parseTex(maskTexBytes);
  for (const t of [nTex, mTex]) {
    if (!isPowerOfTwo(t.width) || !isPowerOfTwo(t.height)) {
      throw new TextureResizeUnsupported(
        `hair: NPOT texture ${t.width}x${t.height} needs a resize (EndwalkerUpgrade.cs:1195)`,
      );
    }
  }
  if (nTex.width !== mTex.width || nTex.height !== mTex.height) {
    throw new TextureResizeUnsupported(
      `hair: normal ${nTex.width}x${nTex.height} != mask ${mTex.width}x${mTex.height} needs a resize (EndwalkerUpgrade.cs:1205)`,
    );
  }
  const nRgba = decodeToRgba(nTex);
  const mRgba = decodeToRgba(mTex);
  createHairMaps(nRgba, mRgba, nTex.width, nTex.height);
  return {
    normal: encodeUncompressedTex(nRgba, nTex.width, nTex.height, {
      mips: true,
    }),
    mask: encodeUncompressedTex(mRgba, mTex.width, mTex.height, { mips: true }),
  };
}

function findFile(
  option: ModpackOption,
  gamePath: string,
): ModpackFile | undefined {
  return option.files.find((f) => f.gamePath === gamePath);
}

/** Writes a generated uncompressed .tex into the option, mirroring the storage form of a
 *  reference source file in the same option (a ttmp source is SqPackCompressed -> encode a
 *  Type-4 Texture entry; a pmp source is RawUncompressed -> store raw). Replaces any
 *  existing entry at that path. */
function writeGeneratedTex(
  option: ModpackOption,
  gamePath: string,
  texBytes: Uint8Array,
  reference: ModpackFile,
): void {
  const file: ModpackFile =
    reference.storage === FileStorageType.SqPackCompressed
      ? {
          gamePath,
          storage: FileStorageType.SqPackCompressed,
          data: encodeSqPackFile(texBytes, SqPackType.Texture),
        }
      : { gamePath, storage: FileStorageType.RawUncompressed, data: texBytes };
  const existing = option.files.findIndex((f) => f.gamePath === gamePath);
  if (existing >= 0) option.files[existing] = file;
  else option.files.push(file);
}

/** Port of UpgradeRemainingTextures (EndwalkerUpgrade.cs:1832). For each target, generate
 *  its texture(s) only if the option locally holds the required source(s); a resize-
 *  unsupported target is skipped (baselined diff), everything else stays fail-loud. */
export function upgradeRemainingTextures(
  option: ModpackOption,
  targets: Map<string, UpgradeInfo>,
): void {
  for (const info of targets.values()) {
    try {
      if (info.usage === EUpgradeTextureUsage.IndexMaps) {
        const normal = findFile(option, info.files.normal!);
        if (!normal) continue;
        const idx = createIndexFromNormal(uncompressedBytes(normal).bytes);
        writeGeneratedTex(option, info.files.index!, idx, normal);
      } else if (info.usage === EUpgradeTextureUsage.HairMaps) {
        const normal = findFile(option, info.files.normal!);
        const mask = findFile(option, info.files.mask!);
        if (normal && mask) {
          const res = updateEndwalkerHairTextures(
            uncompressedBytes(normal).bytes,
            uncompressedBytes(mask).bytes,
          );
          writeGeneratedTex(option, info.files.normal!, res.normal, normal);
          writeGeneratedTex(option, info.files.mask!, res.mask, mask);
        } else if (normal || mask) {
          throw new Error(
            `hair: Normal and Mask must be in the same option (EndwalkerUpgrade.cs:1862): ${info.files.normal} / ${info.files.mask}`,
          );
        }
      } else {
        // GearMaskNew / GearMaskLegacy
        const old = findFile(option, info.files.mask_old!);
        if (!old) continue;
        const legacy = info.usage === EUpgradeTextureUsage.GearMaskLegacy;
        const data = upgradeMaskTex(uncompressedBytes(old).bytes, legacy);
        writeGeneratedTex(option, info.files.mask_new!, data, old);
      }
    } catch (e) {
      if (e instanceof TextureResizeUnsupported) continue; // localized baselined gap
      throw e;
    }
  }
}
