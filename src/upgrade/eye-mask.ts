// Port of EndwalkerUpgrade.UpdateEyeMask (EndwalkerUpgrade.cs:2007-2079): the round-6 partial that
// converts a loose Endwalker iris mask (--c{race}f{face}_iri_s.tex) to a Dawntrail iris diffuse.
// This ports the CONTROL FLOW up to the pixel conversion only; the ImageSharp pixel pipeline
// ConvertEyeMaskToDiffuse (:1910-2003) + the write tail (:2056-2077) are deferred and fail loud.
// See docs/superpowers/specs/2026-07-16-eye-mask-partial-design.md and the backlog item cited below.
import type { ModpackOption } from "../model/modpack";
import { parseTex } from "../tex/tex";
import type { EyeMaterialTable } from "./reference/eye-materials-types";
import { resolveFile } from "./upgrade";

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
 *  ModpackUpgrader.cs:174-177). Reproduces every skip guard, then THROWS at the pixel conversion —
 *  the one step this port does not yet reproduce faithfully (docs/backlog/2026-07-15-partials-eye-mask.md).
 *  `table` stands in for `rTx.FileExists(irisPath)` (:2049): a miss == absent in-game -> faithful skip. */
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
  // FileExists gate. A byte-less or undecodable mask makes ResolveFile null -> FromUncompressedTex
  // throws (ArgumentNullException, XivTex.cs:96); a decodable-but-malformed mask throws in the header
  // parse (EndOfStreamException). Reproduce that seam so an unparseable mask fails loud here instead of
  // being silently skipped by the iris gate below. (The parsed tex is consumed by the deferred pixel
  // half; here we invoke the parse for its throw behaviour, matching the C# ordering.)
  const resolved = resolveFile(file); // ResolveFile (:2030) — a ResolveFile call site (decode error -> null)
  if (!resolved) {
    throw new Error(
      `upgrade: eye-mask mask did not resolve (absent or undecodable) — ` +
        `XivTex.FromUncompressedTex throws on null (EndwalkerUpgrade.cs:2032): ${maskPath}`,
    );
  }
  parseTex(resolved.bytes); // FromUncompressedTex (:2032) — throws on a malformed header
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
  // :2056-2077 — reads the iris material and runs ConvertEyeMaskToDiffuse (:2064), the ImageSharp
  // pixel pipeline this port does not yet reproduce. Fail loud rather than pass the mask through
  // unchanged (a silent divergence) or emit a best-effort wrong texture.
  throw new Error(
    `upgrade: eye-mask diffuse conversion is unported — ConvertEyeMaskToDiffuse ImageSharp pixel ` +
      `pipeline (EndwalkerUpgrade.cs:1910-2003, 2056-2077); see ` +
      `docs/backlog/2026-07-15-partials-eye-mask.md: ${maskPath}`,
  );
}
