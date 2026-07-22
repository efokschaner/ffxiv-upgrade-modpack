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
import {
  A8R8G8B8,
  BC4,
  BC5,
  BC7,
  DXT1,
  DXT5,
  texFormatName,
} from "../tex/types";
import { resolveFile } from "./upgrade";
import { EUpgradeTextureUsage, type UpgradeInfo } from "./upgrade-info";

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
 * Port of Tex.ResizeXivTx (Tex.cs:413-420) as used by all THREE of its NPOT pre-step call sites:
 * EndwalkerUpgrade.cs:1096-1099 (CreateIndexFromNormal), :2086-2089 (UpgradeMaskTex), and
 * :1195-1202 (UpdateEndwalkerHairTextures, both the normal and the mask).
 * Already-pow2 input is returned untouched — C# only calls ResizeXivTx inside the NPOT branch,
 * so nothing here runs for a pow2 texture.
 *
 * Note :1205's ResizeImages is NOT a fourth site: it calls TextureHelpers.ResizeImage directly
 * (TextureHelpers.cs:336-337), with no MergePixelData behind it, so neither guard below applies to
 * it and the hair path resizes to the common max size with a bare resizeBicubic instead.
 *
 * ELIDED, DELIBERATELY: step 3 of ResizeXivTx is Tex.MergePixelData (Tex.cs:637-706), which
 * re-encodes the resized pixels into the source's own BC format via TexImpNet/nvtt; the caller
 * then immediately decodes them again. We have no nvtt-compatible encoder, so we hand the
 * resized RGBA straight on.
 *
 * WHAT THAT ELISION COSTS, MEASURED against real ConsoleTools /upgrade goldens. It depends
 * entirely on whether MergePixelData's re-encode is lossy for the SOURCE format, and on whether
 * the consumer quantizes the result:
 *
 *   - Lossless source (A8R8G8B8 -> CompressionFormat.BGRA, Tex.cs:739-741): EXACT. The
 *     `npot-mask-a8.ttmp2` synthetic (400x400 A8R8G8B8 mask) is byte-identical to its golden,
 *     0 of 1398176 bytes differing.
 *   - Lossy source, quantizing consumer (the index path): EXACT. `Club Cyberia Motorbike.ttmp2`
 *     (a 400x400 DXT5 normal) is byte-identical in all 12 options, because CreateIndexTexture
 *     reads only alpha and quantizes it into rows of 17 (TextureHelpers.cs:222-260), which
 *     absorbs the round-trip error.
 *   - Lossy source, non-quantizing consumer (the MASK path): KNOWN DIVERGENT. upgradeGearMask
 *     has no quantization to absorb the error, so it reaches the output bytes. Two of the three
 *     synthetics bracket the range, and the spread is the finding — the magnitude tracks how well the
 *     RESAMPLED image fits BC's per-block endpoint model, which is a property of the content,
 *     not of the format:
 *       `npot-mask-dxt5-smooth.ttmp2` (smooth gradient, i.e. what a real gear mask looks like):
 *          680836 of 1398176 bytes differ, **max delta 9**, histogram decaying hard
 *          (370243@1, 195057@2, 83411@3, 26258@4, 4556@5, 1274@6, 33@7, 4@9).
 *       `npot-mask-dxt5.ttmp2` (pseudo-random bytes, the pathological case — after the resample
 *          every 4x4 block has huge internal variance): 1337354 differ, **max delta 116**.
 *     We cannot bound this in general: computing the error for a given input IS the
 *     nvtt-compatible encode we do not have.
 *
 * That last case is an ACCEPTED, OPERATOR-ADJUDICATED divergence (2026-07-22), not an oversight:
 * we emit a correctly-upgraded mask that skipped one lossy recompression cycle rather than
 * refusing the file. It is deliberately NOT confirmed by a DIVERGENCE_RULES entry, and that was
 * considered rather than skipped. A tolerance rule needs a bound tight enough to still reject
 * everything else, the way the global `.tex` +/-1 rule rests on BCn decoder rounding being
 * provably <= 1. There is no such bound here: the error is a function of how well the RESAMPLED
 * image fits BC's endpoint model, so it is a property of the content. All three npot-mask-* packs
 * deliberately share ONE mask gamePath, so a path-scoped predicate could not tell the smooth case
 * (<= 9) from the adversarial one (<= 116) — the only rule expressible over them is <= 116, i.e.
 * ~45% of an 8-bit channel's range, which would confirm essentially any output and is not a
 * confirmation in AGENTS.md's sense. So the packs' ratchet baselines carry it instead, and
 * docs/backlog/2026-07-22-bc-encoder-merge-pixel-data.md tracks the real fix. See the design spec
 * §3.2/§3.3/§6.
 *
 * READ THIS BEFORE TRUSTING THE RATCHET: those two DXT5 baseline entries do NOT assert the
 * measured deltas. Ratchet identity is `kind|gamePath#index:status` (test/helpers/upgrade-baseline.ts),
 * which excludes the bytes and keeps `status` at "mismatch" for any content difference at all — so
 * they RECORD a measurement, they do not police it. `npot-mask-a8` (which carries no payload entry,
 * i.e. must stay byte-exact) is the live regression guard for the resampler and upgradeGearMask.
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
  // Message is Tex.GetCompressionFormat's `default:` arm, verbatim (Tex.cs:743 —
  // `"Format is currently unsupported: " + format.ToString()`), not decorated: the expected-failure
  // harness (assertMatchedUpgradeFailure, test/helpers/corpus-upgrade.ts) asserts our thrown message
  // is a literal substring of ConsoleTools' captured trace, so it must match the C# text exactly
  // rather than merely mention it. resize-context (${width}x${height} -> ${w}x${h}, this format
  // number) stays in this comment instead. Pinned by test/corpus/upgrade-error/npot-dxt3-mask.ttmp2.
  if (!MERGE_SUPPORTED_FORMATS.has(format)) {
    throw new Error(
      `Format is currently unsupported: ${texFormatName(format)}`,
    );
  }
  // Tex.cs:656-660, gated to the non-BC7 arm: BC7 takes the DDS.TexConvRawPixels path
  // (Tex.cs:650-653), which carries no size guard. The dims tested are the POST-resize ones —
  // ResizeXivTx overwrites tex.Width/Height (Tex.cs:417-418) before calling MergePixelData.
  // Message is Tex.cs:659's InvalidDataException text, verbatim, for the same substring-match
  // reason as the format guard above (resize context: ${width}x${height} -> ${w}x${h}). Pinned by
  // test/corpus/upgrade-error/npot-tiny-mask.ttmp2.
  if (format !== BC7 && (w < 64 || h < 64)) {
    throw new Error(
      "Image is too small for DDS Compressor. (64x64 Minimum Size)",
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

/** Port of UpgradeMaskTex (EndwalkerUpgrade.cs:2082-2098). Decodes the mask, NPOT-normalizes it
 *  (:2086-2089, see resizeToPow2ForMerge), applies the gear-mask channel remap, re-encodes
 *  A8R8G8B8 with mips.
 *
 *  THIS IS THE PATH THAT PAYS FOR resizeToPow2ForMerge's ELISION — read its third bullet before
 *  changing anything here. A pow2 mask, and an NPOT mask whose source format is lossless
 *  (A8R8G8B8), are byte-exact against the golden. An NPOT mask in a BC format is KNOWN DIVERGENT
 *  and unbounded, because upgradeGearMask has no quantization to absorb the round-trip error that
 *  CreateIndexTexture's does. Both cases are pinned by synthetic packs with real ConsoleTools
 *  goldens (`npot-mask-a8.ttmp2`, `npot-mask-dxt5.ttmp2`). */
export function upgradeMaskTex(
  maskTexBytes: Uint8Array,
  legacy: boolean,
): Uint8Array {
  const tex = parseTex(maskTexBytes);
  const src = resizeToPow2ForMerge(
    decodeToRgba(tex),
    tex.width,
    tex.height,
    tex.format,
  );
  upgradeGearMask(src.rgba, src.width, src.height, legacy);
  return encodeUncompressedTex(src.rgba, src.width, src.height, { mips: true });
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

  // The NPOT pre-steps (:1195-1202) are ResizeXivTx calls, so they carry MergePixelData's two
  // failures exactly as the index/mask sites do — route them through the same helper rather than
  // open-coding the resize, which would silently succeed where TexTools aborts. Behaviour-neutral
  // for a pow2 input: resizeToPow2ForMerge returns it untouched without reaching either guard.
  const n = resizeToPow2ForMerge(
    decodeToRgba(nTex),
    nTex.width,
    nTex.height,
    nTex.format,
  );
  let nRgba = n.rgba;
  const nW = n.width;
  const nH = n.height;

  const m = resizeToPow2ForMerge(
    decodeToRgba(mTex),
    mTex.width,
    mTex.height,
    mTex.format,
  );
  let mRgba = m.rgba;
  const mW = m.width;
  const mH = m.height;

  // ResizeImages (TextureHelpers.cs:331-342): resize both to the max of the two (now pow2) sizes.
  // NOT a ResizeXivTx call — it goes straight to ResizeImage (:336-337) with no MergePixelData
  // behind it, so the two guards deliberately do NOT apply here.
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
 *  its texture(s) only if the option locally holds the required source(s); everything else
 *  (including a resize failure) stays fail-loud. */
export function upgradeRemainingTextures(
  option: ModpackOption,
  targets: Map<string, UpgradeInfo>,
): void {
  // No try/catch here, matching EndwalkerUpgrade.cs:1842 — UpgradeRemainingTextures does not
  // guard its CreateIndexFromNormal call, so a failure propagates to ModpackUpgrader.cs:133-141
  // and aborts the whole upgrade. (The swallow-and-Trace catch at EndwalkerUpgrade.cs:637-645 is
  // a DIFFERENT call site, gated behind `files == null` at :627 — unreachable on this path.)
  for (const info of targets.values()) {
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
  }
}
