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
import { resizeBicubic } from "../tex/imagesharp/resample";
import { decodeToRgba, encodeUncompressedTex, parseTex } from "../tex/tex";
import { A8R8G8B8, BC4, BC5, BC7, DXT1, DXT5 } from "../tex/types";
import { resolveFile } from "./upgrade";
import { EUpgradeTextureUsage, type UpgradeInfo } from "./upgrade-info";

/** Thrown when a source texture would require an ImageSharp resize that this path does not yet
 *  port: NPOT normalize for `createIndexFromNormal` / `upgradeMaskTex` (the hair path below now
 *  ports its own NPOT + common-size resizes via `resizeBicubic`). Caught+skipped at the dispatch
 *  boundary so one un-generatable target degrades to a ratchet-baselined diff rather than crashing
 *  the whole pack. See spec §4.4/§5. */
export class TextureResizeUnsupported extends Error {}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

// IOUtil.cs:905-930 (RoundToPowerOfTwo / CeilPower2 / FloorPower2). NOT a "round up to next
// power of two": RoundToPowerOfTwo picks whichever of floor/ceil power-of-two is numerically
// closer to x, ties going to the floor (`max - x < x - min ? max : min` is false on a tie).
// Natural-log division (`Math.log(x) / Math.log(2)`), not the `Math.log2` intrinsic, mirrors
// C#'s `Math.Log(a, newBase)` implementation (`Log(a) / Log(newBase)`) — the two can disagree
// by an ULP right at an exact power of two, which matters here since CeilPower2 evaluates
// `Math.Log(x - 1, 2)` and `x - 1` is often itself an exact power of two.
function floorPow2(x: number): number {
  if (x < 1) return 1;
  return 2 ** Math.trunc(Math.log(x) / Math.log(2));
}
function ceilPow2(x: number): number {
  if (x < 2) return 1;
  return 2 ** Math.trunc(Math.log(x - 1) / Math.log(2) + 1);
}
function roundToPowerOfTwo(x: number): number {
  const min = floorPow2(x);
  const max = ceilPow2(x);
  return max - x < x - min ? max : min;
}

// Tex.GetCompressionFormat (Tex.cs:718-747): the only XivTexFormats MergePixelData can re-encode.
// Anything else hits its `default:` and throws InvalidDataException. Our decodeToRgba
// (src/tex/decode.ts) accepts strictly more than this (DXT3, A4R4G4B4, A1R5G5B5, L8, A8,
// A16B16G16R16F), so this set is load-bearing rather than incidental.
const MERGE_SUPPORTED_FORMATS = new Set<number>([
  DXT1,
  DXT5,
  BC4,
  BC5,
  BC7,
  A8R8G8B8,
]);

/**
 * Port of Tex.ResizeXivTx (Tex.cs:413-420) as used by the two NPOT pre-steps,
 * EndwalkerUpgrade.cs:1096-1099 (CreateIndexFromNormal) and :2086-2089 (UpgradeMaskTex).
 * Already-pow2 input is returned untouched — C# only calls ResizeXivTx inside the NPOT branch,
 * so nothing here runs for a pow2 texture.
 *
 * ELIDED, DELIBERATELY: step 3 of ResizeXivTx is Tex.MergePixelData (Tex.cs:637-706), which
 * re-encodes the resized pixels into the source's own BC format via TexImpNet/nvtt; the caller
 * then immediately decodes them again. We have no nvtt-compatible encoder, so we hand the
 * resized RGBA straight on. Measured against the ConsoleTools /upgrade golden for
 * `Club Cyberia Motorbike.ttmp2` (a 400x400 DXT5 normal), our output is BYTE-IDENTICAL in all
 * 12 options — CreateIndexTexture reads only the normal's alpha and quantizes it into rows of
 * 17 (TextureHelpers.cs:222-260), which absorbs the round-trip error. See the design spec §3.2.
 * The mask path (upgradeMaskTex) has NO such quantization and, at time of writing, no corpus
 * pack reaching it — see §3.3 and the synthetic packs built for it.
 *
 * NOT elided: the two ways MergePixelData FAILS. Both abort the whole upgrade in C#
 * (EndwalkerUpgrade.cs:1842 has no try/catch; ModpackUpgrader.cs:133-141 rethrows wrapped), so
 * both are plain Errors here. They are checked before the resize rather than after purely to
 * avoid wasted work — either way the call throws.
 */
function resizeToPow2ForMerge(
  rgba: Uint8Array,
  width: number,
  height: number,
  format: number,
): { rgba: Uint8Array; width: number; height: number } {
  if (isPowerOfTwo(width) && isPowerOfTwo(height)) {
    return { rgba, width, height };
  }
  // RoundToPowerOfTwo is never equal to an NPOT input, so ResizeImage's equal-dims early return
  // (TextureHelpers.cs:368) is unreachable from here.
  const w = roundToPowerOfTwo(width);
  const h = roundToPowerOfTwo(height);
  if (!MERGE_SUPPORTED_FORMATS.has(format)) {
    throw new Error(
      `tex resize: format ${format} is currently unsupported by MergePixelData (Tex.cs:718-747)`,
    );
  }
  // Tex.cs:656-660, gated to the non-BC7 arm: BC7 takes the DDS.TexConvRawPixels path
  // (Tex.cs:650-653), which carries no size guard. The dims tested are the POST-resize ones —
  // ResizeXivTx overwrites tex.Width/Height (Tex.cs:417-418) before calling MergePixelData.
  if (format !== BC7 && (w < 64 || h < 64)) {
    throw new Error(
      `tex resize: ${width}x${height} rounds to ${w}x${h} — Image is too small for DDS Compressor. (64x64 Minimum Size) (Tex.cs:656-660)`,
    );
  }
  return {
    rgba: resizeBicubic(rgba, width, height, w, h),
    width: w,
    height: h,
  };
}

/** Port of CreateIndexFromNormal (EndwalkerUpgrade.cs:1083-1113). Decodes the normal,
 *  NPOT-normalizes it (:1096-1099, see resizeToPow2ForMerge), builds the index map from its
 *  alpha, re-encodes A8R8G8B8 with mips. */
export function createIndexFromNormal(normalTexBytes: Uint8Array): Uint8Array {
  const tex = parseTex(normalTexBytes);
  const src = resizeToPow2ForMerge(
    decodeToRgba(tex),
    tex.width,
    tex.height,
    tex.format,
  );
  const indexRgba = createIndexTexture(src.rgba, src.width, src.height);
  return encodeUncompressedTex(indexRgba, src.width, src.height, {
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

/** Port of UpdateEndwalkerHairTextures (EndwalkerUpgrade.cs:1175). Decodes normal + mask, resizes
 *  each NPOT input to its nearest pow2 size (:1195-1202, `Tex.ResizeXivTx` -> `TextureHelpers.
 *  ResizeImage` with `nearestNeighbor=false`, i.e. Bicubic), then resizes both to their common max
 *  size (`ResizeImages`, :1205, also Bicubic — `TextureHelpers.cs:331-355`), applies CreateHairMaps,
 *  and re-encodes both A8R8G8B8 with mips. `resizeBicubic` (src/tex/imagesharp/resample.ts) is a
 *  no-op when target dims already equal source dims, mirroring `ResizeImage`'s early return
 *  (`TextureHelpers.cs:368`) — so the common case (both inputs already pow2 and equal-sized) stays
 *  byte-exact. */
export function updateEndwalkerHairTextures(
  normalTexBytes: Uint8Array,
  maskTexBytes: Uint8Array,
): { normal: Uint8Array; mask: Uint8Array } {
  const nTex = parseTex(normalTexBytes);
  const mTex = parseTex(maskTexBytes);

  let nRgba = decodeToRgba(nTex);
  let nW = nTex.width;
  let nH = nTex.height;
  if (!isPowerOfTwo(nW) || !isPowerOfTwo(nH)) {
    const tW = roundToPowerOfTwo(nW);
    const tH = roundToPowerOfTwo(nH);
    nRgba = resizeBicubic(nRgba, nW, nH, tW, tH);
    nW = tW;
    nH = tH;
  }

  let mRgba = decodeToRgba(mTex);
  let mW = mTex.width;
  let mH = mTex.height;
  if (!isPowerOfTwo(mW) || !isPowerOfTwo(mH)) {
    const tW = roundToPowerOfTwo(mW);
    const tH = roundToPowerOfTwo(mH);
    mRgba = resizeBicubic(mRgba, mW, mH, tW, tH);
    mW = tW;
    mH = tH;
  }

  // ResizeImages (TextureHelpers.cs:331-342): resize both to the max of the two (now pow2) sizes.
  const maxW = Math.max(nW, mW);
  const maxH = Math.max(nH, mH);
  nRgba = resizeBicubic(nRgba, nW, nH, maxW, maxH);
  mRgba = resizeBicubic(mRgba, mW, mH, maxW, maxH);

  createHairMaps(nRgba, mRgba, maxW, maxH);
  return {
    normal: encodeUncompressedTex(nRgba, maxW, maxH, { mips: true }),
    mask: encodeUncompressedTex(mRgba, maxW, maxH, { mips: true }),
  };
}

function findFile(
  option: ModpackOption,
  gamePath: string,
): ModpackFile | undefined {
  return option.files.get(gamePath);
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
 *  round-trips (tested).
 *
 *  KNOWN GAP: the returned `ModpackFile` carries no `ttmp` (Name/Category/DatFile) metadata, so a
 *  TTMP source's regenerated entry loses that metadata outright rather than TexTools' behaviour of
 *  re-deriving it from the game path — see docs/backlog/2026-07-13-resave-ttmp2-name-category.md
 *  (now confirmed to reach a bare `/upgrade`, e.g. `Misty_Hairstyle_Female.ttmp2`'s regenerated hair
 *  textures, not just `/resave`). */
export function writeGeneratedTex(
  option: ModpackOption,
  gamePath: string,
  texBytes: Uint8Array,
  reference: ModpackFile,
): void {
  const file: ModpackFile =
    reference.storage === FileStorageType.SqPackCompressed
      ? {
          storage: FileStorageType.SqPackCompressed,
          data: encodeSqPackFile(texBytes, SqPackType.Texture),
        }
      : { storage: FileStorageType.RawUncompressed, data: texBytes };
  // Map.set replaces in place at the key's existing position, or appends — matching the old
  // findIndex-replace-or-push semantics (WriteFile's replace-or-add-by-path, EndwalkerUpgrade.cs:1795-1823).
  option.files.set(gamePath, file);
}

/** Writes a generated raw .mtrl into the option, mirroring the storage form of a reference
 *  source file in the same option — same storage-mirroring rationale as writeGeneratedTex, but
 *  encoding as a Type-2 Standard SqPack entry (a .mtrl, not a .tex) when mirroring a
 *  SqPackCompressed sibling. Used by the tail constant-swap rewrite
 *  (EndwalkerUpgrade.cs:1504-1516, WriteFile at :1515). */
export function writeGeneratedMtrl(
  option: ModpackOption,
  gamePath: string,
  mtrlBytes: Uint8Array,
  reference: ModpackFile,
): void {
  const file: ModpackFile =
    reference.storage === FileStorageType.SqPackCompressed
      ? {
          storage: FileStorageType.SqPackCompressed,
          data: encodeSqPackFile(mtrlBytes, SqPackType.Standard),
        }
      : { storage: FileStorageType.RawUncompressed, data: mtrlBytes };
  option.files.set(gamePath, file);
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
              `hair: normal/mask did not resolve (absent or undecodable) — unable to properly resolve existing Hair Normal/Mask texture (EndwalkerUpgrade.cs:1184-1188): ${info.files.normal} / ${info.files.mask}`,
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
        // GearMaskNew passes it STRAIGHT INTO UpgradeMaskTex (:1870), which throws an
        // ArgumentNullException on null (XivTex.cs:96, `new MemoryStream(texData)`) — its own
        // null check (:1871) comes one line too late. So an absent/corrupt mask_old is a no-op for
        // Legacy and fails the pack for New. Reproduce, do not fix: skip for Legacy, throw explicitly
        // for New (standing in for the C# ArgumentNullException — same "kill the pack" outcome).
        const src = resolveFile(old);
        if (!src) {
          if (legacy) continue;
          throw new Error(
            `gearmask: mask_old did not resolve (absent or undecodable) (EndwalkerUpgrade.cs:1870 throws ArgumentNullException on null passed into UpgradeMaskTex; see docs/TEXTOOLS_BUGS.md #1): ${info.files.mask_old}`,
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
