// Generates src/upgrade/reference/eye-materials.ts. Regenerate on a machine with FFXIV +
// ConsoleTools installed: `npx tsx scripts/extract-eye-materials.ts`.
//
// Enumerates the DT base-game iris materials that EXIST (in-process index hash, GameIndex) and,
// for each hit, records its g_SamplerDiffuse texture path — the minimum UpdateEyeMask reads
// (EndwalkerUpgrade.cs:2044-2059). The table's KEY doubles as the FileExists oracle (:2049): a
// miss == absent in-game. See docs/superpowers/specs/2026-07-16-eye-mask-partial-design.md §3.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMtrl } from "../src/mtrl/mtrl";
import { ESamplerId } from "../src/mtrl/shader";
import type { EyeMaterialEntry } from "../src/upgrade/reference/eye-materials-types";
import { GameIndex } from "./lib/game-index";

(globalThis as unknown as { __dirname: string }).__dirname = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "helpers",
);
const { extractGameFile } = await import("../test/helpers/oracle");

const SQPACK =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online\\game\\sqpack\\ffxiv";

// The full IDRaceDictionary race-code list (identical to extract-hair-materials.ts RACES). "0000"
// is intentionally absent: no iris material exists for a race-less code, and the runtime maps an
// unknown c-code to "0000" -> a table miss -> a faithful skip (spec §3.3).
const RACES = [
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
];
// Face IDs are low-numbered in retail; the mask path admits f[0-9]{4}. Scan a generous bound and
// log it, so a face beyond it reads as a deliberate visible limit, not a silent mis-skip (spec §3.2).
const FACE_MAX = 999;

const d4 = (n: number) => n.toString().padStart(4, "0");
const irisFmt = (r: string, f: string) =>
  `chara/human/c${r}/obj/face/f${f}/material/mt_c${r}f${f}_iri_a.mtrl`;

const dir = mkdtempSync(join(tmpdir(), "eyemat-"));
function extractBytes(path: string): Uint8Array {
  const dest = join(dir, "m.mtrl");
  extractGameFile(path, dest); // only called on index hits
  return new Uint8Array(readFileSync(dest));
}

const idx = GameIndex.load(SQPACK);
const table = new Map<string, EyeMaterialEntry>();
let probed = 0;
for (const race of RACES) {
  for (let i = 1; i <= FACE_MAX; i++) {
    probed++;
    const matPath = irisFmt(race, d4(i));
    if (!idx.fileExists(matPath)) continue;
    const m = parseMtrl(extractBytes(matPath), matPath);
    // RAW TexturePath, not dx11 (EndwalkerUpgrade.cs:2058-2059 reads mtrlTex.TexturePath directly).
    const diffuse = m.textures.find(
      (x) => x.sampler?.samplerIdRaw === ESamplerId.g_SamplerDiffuse,
    );
    const entry: EyeMaterialEntry = {};
    if (diffuse) entry.diffusePath = diffuse.texturePath;
    table.set(matPath, entry);
  }
}

const sorted = [...table.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
const body = sorted
  .map(([k, v]) => `  [${JSON.stringify(k)}, ${JSON.stringify(v)}],`)
  .join("\n");
writeFileSync(
  "src/upgrade/reference/eye-materials.ts",
  `// GENERATED — regenerate via \`npx tsx scripts/extract-eye-materials.ts\`. Do not edit by hand.\n` +
    `// DT base-game iris materials that exist, with their g_SamplerDiffuse path. The table's KEY\n` +
    `// IS the FileExists oracle — a miss means the iris material is absent in-game (a faithful\n` +
    `// skip, EndwalkerUpgrade.cs:2049). See src/upgrade/reference/eye-materials-types.ts.\n` +
    `import type { EyeMaterialTable } from "./eye-materials-types";\n\n` +
    `export const EYE_MATERIALS: EyeMaterialTable = new Map([\n${body}\n]);\n`,
);
console.log(
  `probed ${probed} candidates (FACE_MAX=${FACE_MAX}), wrote ${sorted.length} iris materials`,
);

// EndwalkerUpgrade.cs:1928-1932 — base-game eye textures ConvertEyeMaskToDiffuse reads.
function extractTgaRgba(gamePath: string): {
  width: number;
  height: number;
  rgba: Uint8Array;
} {
  const dest = join(dir, "e.tga");
  extractGameFile(gamePath, dest); // ConsoleTools /extract -> TexTools' own decode
  const tga = new Uint8Array(readFileSync(dest));
  const width = tga[12]! | (tga[13]! << 8);
  const height = tga[14]! | (tga[15]! << 8);
  const px = tga.subarray(18); // uncompressed 32bpp, bottom-left origin, BGRA
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const s = (height - 1 - y) * width * 4;
    const d = y * width * 4;
    for (let x = 0; x < width; x++) {
      rgba[d + x * 4] = px[s + x * 4 + 2]!; // R<-B
      rgba[d + x * 4 + 1] = px[s + x * 4 + 1]!; // G
      rgba[d + x * 4 + 2] = px[s + x * 4]!; // B<-R
      rgba[d + x * 4 + 3] = px[s + x * 4 + 3]!; // A
    }
  }
  return { width, height, rgba };
}
const base = extractTgaRgba("chara/common/texture/eye/eye01_base.tex");
const mask = extractTgaRgba("chara/common/texture/eye/eye01_mask.tex");
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
writeFileSync(
  "src/upgrade/reference/eye-base-textures.ts",
  `// GENERATED — regenerate via \`npx tsx scripts/extract-eye-materials.ts\`. Do not edit by hand.\n` +
    `// Base-game eye textures ConvertEyeMaskToDiffuse reads (EndwalkerUpgrade.cs:1928-1932), decoded\n` +
    `// RGBA. Sourced from TexTools' own decode via ConsoleTools /extract .tga (GetRawPixels-exact),\n` +
    `// so no reliance on our BC decoder. See the eye-mask pixel-pipeline spec §5.6.\n` +
    `import { base64ToBytes } from "../../util/base64";\n\n` +
    `export interface EyeBaseTexture { width: number; height: number; rgba: Uint8Array; }\n` +
    `export const EYE01_BASE: EyeBaseTexture = { width: ${base.width}, height: ${base.height}, rgba: base64ToBytes(${JSON.stringify(b64(base.rgba))}) };\n` +
    `export const EYE01_MASK: EyeBaseTexture = { width: ${mask.width}, height: ${mask.height}, rgba: base64ToBytes(${JSON.stringify(b64(mask.rgba))}) };\n`,
);
console.log(
  `wrote eye-base-textures.ts: base ${base.width}x${base.height}, mask ${mask.width}x${mask.height}`,
);
