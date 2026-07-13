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
import { resolveFile } from "./upgrade";
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
 *  existing entry at that path. Mirrors WriteFile's replace-or-add-by-path semantics
 *  (EndwalkerUpgrade.cs:1795-1823).
 *
 *  Choosing the storage form is a port-specific adaptation: C#'s WriteFile targets a
 *  transaction/file-dict that carries no explicit per-file storage form, whereas our
 *  ModpackData does. Mirroring a sibling source's form preserves writeModpack's
 *  single-storage-form invariant (all files in a pack share one form, so any source is a
 *  valid reference), and the choice is parity-neutral: the golden harness compares
 *  DECOMPRESSED content, so the container form cannot affect the diff, and encode/decode
 *  round-trips (tested). */
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
        // C# gates on files.ContainsKey (:1840) — true for an absent-on-disk file — then
        // CreateIndexFromNormal's ResolveFile returns null (:1087) and the caller `continue`s
        // (:1843). So a key-present, byte-absent normal is SKIPPED, not an error.
        const src = resolveFile(normal);
        if (!src) continue;
        const idx = createIndexFromNormal(src.bytes);
        writeGeneratedTex(option, info.files.index!, idx, normal);
      } else if (info.usage === EUpgradeTextureUsage.HairMaps) {
        const normal = findFile(option, info.files.normal!);
        const mask = findFile(option, info.files.mask!);
        if (normal && mask) {
          // Both keys present (C#'s ContainsKey guard, :1852). UpdateEndwalkerHairTextures IS a
          // ResolveFile caller for both (:1181-1182) — an absent OR undecodable normal/mask
          // resolves to null there too — and then null-checks explicitly and throws
          // FileNotFoundException (:1184-1188) rather than dereferencing. Mirror both halves:
          // resolveFile (so a corrupt entry is treated the same as an absent one, per ResolveFile's
          // own catch), then an explicit throw on null.
          const normalBytes = resolveFile(normal);
          const maskBytes = resolveFile(mask);
          if (!normalBytes || !maskBytes) {
            throw new Error(
              `hair: normal/mask has no bytes — unable to properly resolve existing Hair Normal/Mask texture (EndwalkerUpgrade.cs:1184-1188): ${info.files.normal} / ${info.files.mask}`,
            );
          }
          const res = updateEndwalkerHairTextures(
            normalBytes.bytes,
            maskBytes.bytes,
          );
          writeGeneratedTex(option, info.files.normal!, res.normal, normal);
          writeGeneratedTex(option, info.files.mask!, res.mask, mask);
        } else if (normal || mask) {
          throw new Error(
            `hair: Normal and Mask must be in the same option (EndwalkerUpgrade.cs:1862): ${info.files.normal} / ${info.files.mask}`,
          );
        }
      } else if (
        info.usage === EUpgradeTextureUsage.GearMaskNew ||
        info.usage === EUpgradeTextureUsage.GearMaskLegacy
      ) {
        const old = findFile(option, info.files.mask_old!);
        if (!old) continue;
        const legacy = info.usage === EUpgradeTextureUsage.GearMaskLegacy;
        // QUIRK (upstream bug — docs/TEXTOOLS_BUGS.md §1): the two branches disagree on null.
        // Both call ResolveFile (:1869 / :1882), so both use resolveFile here — an absent OR
        // undecodable mask_old resolves to null in either branch. But they disagree on what
        // happens next: GearMaskLegacy null-checks the result and skips cleanly (:1882-1887);
        // GearMaskNew passes it STRAIGHT INTO UpgradeMaskTex (:1870), which NREs on null — its own
        // null check (:1871) comes one line too late. So an absent/corrupt mask_old is a no-op for
        // Legacy and fails the pack for New. Reproduce, do not fix: skip for Legacy, throw explicitly
        // for New (standing in for the C# NRE — same "kill the pack" outcome).
        const src = resolveFile(old);
        if (!src) {
          if (legacy) continue;
          throw new Error(
            `gearmask: mask_old resolved to no bytes (EndwalkerUpgrade.cs:1870 NREs on null passed into UpgradeMaskTex; see docs/TEXTOOLS_BUGS.md #1): ${old.gamePath}`,
          );
        }
        const data = upgradeMaskTex(src.bytes, legacy);
        writeGeneratedTex(option, info.files.mask_new!, data, old);
      }
    } catch (e) {
      if (e instanceof TextureResizeUnsupported) continue; // localized baselined gap
      throw e;
    }
  }
}
