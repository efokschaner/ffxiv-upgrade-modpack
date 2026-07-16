// Generates src/upgrade/reference/hair-materials.ts. Regenerate on a machine with FFXIV +
// ConsoleTools installed: `npx tsx scripts/extract-hair-materials.ts`.
//
// Enumerates the DT canonical hair/tail/ear/accessory materials that EXIST (in-process index
// hash, GameIndex) and, for each hit, /extracts its bytes and records the minimum fields the
// round-6 partials read (EndwalkerUpgrade.cs:1436-1516 / 1621-1713). The table doubles as the
// FileExists oracle: a miss == absent in-game. See docs/superpowers/specs/2026-07-16-...-design.md §3.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMtrl } from "../src/mtrl/mtrl";
import { ESamplerId } from "../src/mtrl/shader";
import type { XivMtrl } from "../src/mtrl/types";
import type { HairMaterialEntry } from "../src/upgrade/reference/hair-materials-types";
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
const SAMPLE_HAIR =
  "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl";

// Race codes: the FULL IDRaceDictionary (Character.cs:530-571) — every human race's playable
// (xx01) AND NPC (xx04) variant, plus the two NPC catch-alls (9104/9204). Completeness is
// load-bearing: the emitted table is the FileExists oracle, so a race with real DT materials that
// is NOT enumerated here would be silently mis-skipped (see the design spec §3.1/§3.3/§6). The xx04
// codes are NOT empty — they carry real hair/tail/accessory materials in retail.
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
const ID_MAX = 500; // _SCAN_LIMIT (Character.cs:335)
type Part = {
  name: "hair" | "tail" | "ear" | "accessory";
  fmt: (r: string, i: string) => string;
};
const PARTS: Part[] = [
  {
    name: "hair",
    fmt: (r, i) =>
      `chara/human/c${r}/obj/hair/h${i}/material/v0001/mt_c${r}h${i}_hir_a.mtrl`,
  },
  {
    name: "tail",
    fmt: (r, i) =>
      `chara/human/c${r}/obj/tail/t${i}/material/v0001/mt_c${r}t${i}_a.mtrl`,
  },
  {
    name: "ear",
    fmt: (r, i) =>
      `chara/human/c${r}/obj/zear/z${i}/material/v0001/mt_c${r}z${i}_a.mtrl`,
  },
  {
    name: "accessory",
    fmt: (r, i) =>
      `chara/human/c${r}/obj/hair/h${i}/material/v0001/mt_c${r}h${i}_acc_b.mtrl`,
  },
];

const d4 = (n: number) => n.toString().padStart(4, "0");

function dx11Path(tex: XivMtrl["textures"][number]): string {
  if ((tex.flags & 0x8000) === 0) return tex.texturePath; // XivMtrl.cs:667-680
  const s = tex.texturePath;
  const slash = s.lastIndexOf("/");
  return `${s.slice(0, slash)}/--${s.slice(slash + 1)}`;
}
function samplerPath(m: XivMtrl, id: number): string | undefined {
  const t = m.textures.find((x) => x.sampler?.samplerIdRaw === id);
  return t ? dx11Path(t) : undefined;
}

const dir = mkdtempSync(join(tmpdir(), "hairmat-"));
function extractBytes(path: string): Uint8Array {
  const dest = join(dir, "m.mtrl");
  extractGameFile(path, dest); // only called on index hits
  return new Uint8Array(readFileSync(dest));
}

const idx = GameIndex.load(SQPACK);
const table = new Map<string, HairMaterialEntry>();
let probed = 0;
for (const part of PARTS) {
  for (const race of RACES) {
    for (let i = 1; i <= ID_MAX; i++) {
      probed++;
      const matPath = part.fmt(race, d4(i));
      if (!idx.fileExists(matPath)) continue;
      const m = parseMtrl(extractBytes(matPath), matPath);
      const hideBackfaces = (m.materialFlags & 0x01) !== 0; // EMaterialFlags1.HideBackfaces (XivMtrl.cs:43)
      const entry: HairMaterialEntry = {
        shaderPackRaw: m.shaderPackRaw,
        normalDx11Path: samplerPath(m, ESamplerId.g_SamplerNormal),
        maskDx11Path: samplerPath(m, ESamplerId.g_SamplerMask),
        diffuseDx11Path: samplerPath(m, ESamplerId.g_SamplerDiffuse),
        hideBackfaces,
      };
      // Only tails that will actually be rewritten need the raw bytes (minimum surface).
      if (part.name === "tail" && !hideBackfaces) {
        entry.tailRewriteMtrlBase64 = Buffer.from(
          extractBytes(matPath),
        ).toString("base64");
      }
      table.set(matPath, entry);
    }
  }
}

const sampleB64 = Buffer.from(extractBytes(SAMPLE_HAIR)).toString("base64");

const sorted = [...table.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
const body = sorted
  .map(([k, v]) => `  [${JSON.stringify(k)}, ${JSON.stringify(v)}],`)
  .join("\n");
writeFileSync(
  "src/upgrade/reference/hair-materials.ts",
  `// GENERATED — regenerate via \`npx tsx scripts/extract-hair-materials.ts\`. Do not edit by hand.\n` +
    `// DT canonical hair/tail/ear/accessory materials that exist, with the minimum fields the\n` +
    `// round-6 partials read (EndwalkerUpgrade.cs:1436-1516 / 1621-1713). The table IS the\n` +
    `// FileExists oracle — a miss means the material is absent in-game (a faithful skip).\n` +
    `import type { HairMaterialTable } from "./hair-materials-types";\n\n` +
    `export const HAIR_MATERIALS: HairMaterialTable = new Map([\n${body}\n]);\n\n` +
    `/** _SampleHair (EndwalkerUpgrade.cs:56) raw bytes, base64 — source of the tail constant swap. */\n` +
    `export const SAMPLE_HAIR_MTRL_BASE64 = ${JSON.stringify(sampleB64)};\n`,
);
console.log(`probed ${probed} candidates, wrote ${sorted.length} materials`);
