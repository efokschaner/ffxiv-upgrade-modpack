// Port of EndwalkerUpgrade.UpdateEyeMask (EndwalkerUpgrade.cs:2007-2079): the round-6 partial that
// converts a loose Endwalker iris mask (--c{race}f{face}_iri_s.tex) to a Dawntrail iris diffuse.
// Reproduces the full control flow plus the ImageSharp pixel pipeline, ConvertEyeMaskToDiffuse
// (EndwalkerUpgrade.cs:1910-2003), and the write tail (:2056-2077).
// See docs/superpowers/specs/2026-07-16-eye-mask-partial-design.md.
import type { ModpackOption } from "../model/modpack";
import { expandChannel, maskImage, swizzleRB } from "../tex/helpers";
import { boxBlur } from "../tex/imagesharp/blur";
import { drawImageSrcAtop, drawImageSrcOver } from "../tex/imagesharp/compose";
import {
  resizeBicubic,
  resizeNearestNeighbor,
} from "../tex/imagesharp/resample";
import { decodeToRgba, encodeUncompressedTex, parseTex } from "../tex/tex";
import { EYE01_BASE, EYE01_MASK } from "./reference/eye-base-textures";
import type { EyeMaterialTable } from "./reference/eye-materials-types";
import { writeGeneratedTex } from "./texture";
import { resolveFile } from "./upgrade";

/**
 * Port of ConvertEyeMaskToDiffuse (EndwalkerUpgrade.cs:1910-2003). Takes the raw RGBA pixels of an
 * Endwalker iris mask (`ow`x`oh`) and converts them into a Dawntrail-style diffuse, composited over
 * the base-game `eye01_base`/`eye01_mask` textures (EYE01_BASE/EYE01_MASK, :1928-1932). Mutates
 * `maskRgba` in place (:1935, matching C#'s in-place `ExpandChannel(maskData, ...)`); the EYE01_*
 * constants are cloned first since they are shared module data, not per-call buffers.
 */
export function convertEyeMaskToDiffuse(
  maskRgba: Uint8Array,
  ow: number,
  oh: number,
): { rgba: Uint8Array; width: number; height: number } {
  // :1912-1924 — 4x the mask dims (guarantees an upscale + stays power-of-two), then the iris
  // window within that canvas (~0.44 of it, the old:new sclera/iris ratio product).
  const ratio = 0.442;
  const w = ow * 4;
  const h = oh * 4;
  const irisW = Math.trunc(w * ratio);
  const irisH = Math.trunc(h * ratio);

  // :1935-1936 — greyscale the mask's red channel, then bicubic-resize it up to iris size.
  expandChannel(maskRgba, 0, ow, oh);
  const resizedMask = resizeBicubic(maskRgba, ow, oh, irisW, irisH);

  // :1929/1939 — eye01_mask.tex supplies the frame; clone before mutating (EYE01_MASK.rgba is a
  // shared module constant — expandChannel/resize must never touch it in place).
  let frame = Uint8Array.from(EYE01_MASK.rgba);
  expandChannel(frame, 2, EYE01_MASK.width, EYE01_MASK.height, true);
  // :1943-1957 — nearest-neighbor stretch to (w,h), then a slight box blur to soften the edges.
  frame = resizeNearestNeighbor(
    frame,
    EYE01_MASK.width,
    EYE01_MASK.height,
    w,
    h,
  );
  frame = boxBlur(frame, w, h, Math.trunc(w / 128));

  // :1960-1973 — draw the resized iris mask onto a blank (w,h) canvas, centered.
  const blank = new Uint8Array(w * h * 4);
  drawImageSrcOver(
    blank,
    w,
    h,
    resizedMask,
    irisW,
    irisH,
    (w >> 1) - (irisW >> 1),
    (h >> 1) - (irisH >> 1),
    1,
  );

  // :1977 — use the frame to mask the mask (copies frame's alpha onto blank).
  maskImage(blank, frame, w, h);

  // :1928/1980-2000 — eye01_base.tex resized to (w,h) (clone: shared constant, see above), then the
  // masked iris drawn back atop it (SrcAtop).
  const diffuse = resizeBicubic(
    Uint8Array.from(EYE01_BASE.rgba),
    EYE01_BASE.width,
    EYE01_BASE.height,
    w,
    h,
  );
  drawImageSrcAtop(diffuse, blank, w, h, 1);

  return { rgba: diffuse, width: w, height: h };
}

// EndwalkerUpgrade.cs:2005 (EyeMaskPathRegex), verbatim: note the C# uses an UNESCAPED `.` before
// `tex` (matches any char) — mirrored here, not narrowed to `\.`, to reproduce the oracle exactly.
export const EYE_MASK_PATH_REGEX =
  /chara\/human\/c[0-9]{4}\/obj\/face\/f[0-9]{4}\/texture\/--c[0-9]{4}f[0-9]{4}_iri_s.tex/;

// EndwalkerUpgrade.cs:2034 — face id within the filename.
const FACE_REGEX = /f([0-9]{4})/;
// IOUtil.cs:194 (ExtractRaceRegex).
const RACE_REGEX = /c([0-9]{4})/;

// Every XivRace Description (XivRace.cs:78-123) plus "0000" (All_Races). GetXivRace maps a c-code to
// the XivRace whose Description == the digits, else FirstOrDefault's default = All_Races (numeric 0,
// code "0000"); GetRaceCode maps back. So a known code round-trips to itself; anything else -> "0000".
const KNOWN_RACE_CODES = new Set([
  "0101",
  "0104",
  "0201",
  "0204",
  "0301",
  "0304",
  "0401",
  "0404",
  "0501",
  "0504",
  "0601",
  "0604",
  "0701",
  "0704",
  "0801",
  "0804",
  "0901",
  "0904",
  "1001",
  "1004",
  "1101",
  "1104",
  "1201",
  "1204",
  "1301",
  "1304",
  "1401",
  "1404",
  "1501",
  "1504",
  "1601",
  "1604",
  "1701",
  "1704",
  "1801",
  "1804",
  "9104",
  "9204",
  "0000",
]);

/** Port of IOUtil.GetRaceFromPath(path).GetRaceCode() (IOUtil.cs:164-191, XivRace.cs:515-519/866-871)
 *  for a chara path (the "ui/"/"monster"/".avfx" branches, :173-180, cannot apply to an eye mask). */
export function raceCodeFromPath(path: string): string {
  const m = RACE_REGEX.exec(path);
  if (!m) return "0000"; // no c-code -> GetRaceFromPath returns All_Races -> code "0000"
  const code = m[1]!;
  return KNOWN_RACE_CODES.has(code) ? code : "0000";
}

/** Port of UpdateEyeMask (EndwalkerUpgrade.cs:2007-2079), single-path (called per `contained` entry,
 *  ModpackUpgrader.cs:174-177). Reproduces every skip guard, then converts the mask to a diffuse
 *  (ConvertEyeMaskToDiffuse, :2064) and writes it. `table` stands in for `rTx.FileExists(irisPath)`
 *  (:2049): a miss == absent in-game -> faithful skip. */
export function updateEyeMask(
  option: ModpackOption,
  maskPath: string,
  table: EyeMaterialTable,
): void {
  // :2009 — not an iris mask.
  if (!EYE_MASK_PATH_REGEX.test(maskPath)) return;
  // :2019 — Exists(maskPath, files). `contained ⊆ option.files` by construction (the caller filters
  // `unused` by `option.files.has`), so this is always true here; mirrored for fidelity.
  const file = option.files.get(maskPath);
  if (!file) return;
  // :2030-2032 — ResolveFile + XivTex.FromUncompressedTex, run BEFORE the face regex and the iris
  // FileExists gate, so an unparseable mask fails loud here instead of being silently skipped by the
  // iris gate below. A byte-less or undecodable mask makes ResolveFile null -> FromUncompressedTex
  // throws (ArgumentNullException, XivTex.cs:96) — reproduced by the null throw. Our `parseTex` is a
  // lossless/permissive reader (parse.ts): it reproduces FromUncompressedTex's truncated-header throw
  // (a sub-80-byte header EndsOfStream in the BinaryReader) but NOT its unknown-`TextureFormat`
  // KeyNotFoundException (XivTex.cs:123 TextureTypeDictionary lookup) — a residual, near-zero-
  // reachability UNDER-throw (a valid-length header carrying a bogus format + an absent iris would skip
  // where C# throws; it never OVER-throws a valid mod). That gap closes for free when the deferred pixel
  // half actually consumes the parsed tex's format/mips; not worth perturbing the shared parser now.
  const resolved = resolveFile(file); // ResolveFile (:2030) — a ResolveFile call site (decode error -> null)
  if (!resolved) {
    throw new Error(
      `upgrade: eye-mask mask did not resolve (absent or undecodable) — ` +
        `XivTex.FromUncompressedTex throws on null (EndwalkerUpgrade.cs:2032): ${maskPath}`,
    );
  }
  const tex = parseTex(resolved.bytes); // FromUncompressedTex (:2032) — throws on a truncated header
  // :2024 — _ConvertedTextures dedup. The caller passes it as null (ModpackUpgrader.cs:176), so C#
  // allocates a fresh empty set per call; with one path per call the guard can never fire. Not modeled.
  // :2034-2039 — face id from the filename.
  const base = maskPath.slice(maskPath.lastIndexOf("/") + 1);
  const fm = FACE_REGEX.exec(base);
  if (!fm) return; // guaranteed by EYE_MASK_PATH_REGEX; mirrored anyway.
  const race = raceCodeFromPath(maskPath); // :2041/2045
  const face = Number.parseInt(fm[1]!, 10).toString().padStart(4, "0"); // :2042 (Int32.Parse.ToString("D4"))
  const irisPath = `chara/human/c${race}/obj/face/f${face}/material/mt_c${race}f${face}_iri_a.mtrl`; // :2044-2045
  // :2049 — FileExists false ("// Hmmm...", :2051) -> return.
  if (!table.has(irisPath)) return;
  // :2056-2059 — reads the iris material's g_SamplerDiffuse texture path. C# takes
  // `mtrlTex.TexturePath` unguarded off a `FirstOrDefault` that can be null when no g_SamplerDiffuse
  // sampler is bound — a NullReferenceException at :2059. Our table records that case as
  // `diffusePath === undefined` (eye-materials-types.ts) and fails loud here instead of crashing on
  // a null dereference — the deferred NRE case.
  const diffusePath = table.get(irisPath)!.diffusePath;
  if (diffusePath === undefined) {
    throw new Error(
      `upgrade: eye-mask iris material binds no g_SamplerDiffuse texture — TexturePath is null ` +
        `(EndwalkerUpgrade.cs:2059 NullReferenceException): ${irisPath}`,
    );
  }
  // :2062-2064 — decode the mask (reusing the tex already parsed above) and convert it to a diffuse.
  const maskRgba = decodeToRgba(tex);
  const updated = convertEyeMaskToDiffuse(maskRgba, tex.width, tex.height);
  // :2066 — swizzle R/B before re-encoding (the on-disk .tex channel order).
  swizzleRB(updated.rgba, updated.width, updated.height);
  // :2068-2073 — build mipmaps and an uncompressed .tex. C#'s ConvertToDDS+DDSToUncompressedTex
  // round-trip collapses to the same uncompressed-A8R8G8B8-with-mips result our encoder produces
  // directly.
  const texBytes = encodeUncompressedTex(
    updated.rgba,
    updated.width,
    updated.height,
    { mips: true },
  );
  // :2077 — write the updated diffuse texture, mirroring the mask's own storage form.
  writeGeneratedTex(option, diffusePath, texBytes, file);
}
