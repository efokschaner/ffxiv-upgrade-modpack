// Generates src/upgrade/reference/hair-texture-index.ts. Regenerate on a machine with FFXIV
// installed: `npx tsx scripts/extract-hair-texture-index.ts`.
//
// Bundles the (folderHash:fileHash) pairs for every file under the hair/zear/tail TEXTURE folders
// that exist in the 040000 index — the runtime FileExists oracle RepathHairMashups needs
// (ModpackUpgrader.cs:379-482 · rtx.FileExists). Namespace-scoped: ~3.4k entries. See
// docs/superpowers/specs/2026-07-18-repath-hair-mashups-design.md §3.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeHash } from "./lib/game-index";

const SQPACK =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online\\game\\sqpack\\ffxiv";

// Full IDRaceDictionary race grid (Character.cs:530-571), identical to extract-hair-materials.ts.
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
const d4 = (n: number) => n.toString().padStart(4, "0");

// The three texture folders RepathHairMashups' sampler paths live under.
function textureFolders(r: string, i: string): string[] {
  return [
    `chara/human/c${r}/obj/hair/h${i}/texture`,
    `chara/human/c${r}/obj/zear/z${i}/texture`,
    `chara/human/c${r}/obj/tail/t${i}/texture`,
  ];
}

const candidateFolderHashes = new Set<number>();
for (const r of RACES)
  for (let i = 1; i <= ID_MAX; i++)
    for (const f of textureFolders(r, d4(i)))
      candidateFolderHashes.add(computeHash(f));

// Scan the 040000 index1 segment (offsets from IndexFile.cs:137-174, as scripts/lib/game-index.ts).
const buf = readFileSync(join(SQPACK, "040000.win32.index"));
const segOffset = buf.readInt32LE(1032);
const segSize = buf.readInt32LE(1036);
const pairs: [number, number][] = [];
for (let p = segOffset; p < segOffset + segSize; p += 16) {
  const fileHash = buf.readUInt32LE(p + 0) >>> 0;
  const folderHash = buf.readUInt32LE(p + 4) >>> 0;
  if (candidateFolderHashes.has(folderHash)) pairs.push([folderHash, fileHash]);
}
if (pairs.length === 0)
  throw new Error("extract-hair-texture-index: no entries — wrong index path?");

// Sort for a stable diff; pack as LE uint32 pairs -> base64.
pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const out = Buffer.alloc(pairs.length * 8);
pairs.forEach(([f, x], i) => {
  out.writeUInt32LE(f >>> 0, i * 8);
  out.writeUInt32LE(x >>> 0, i * 8 + 4);
});
writeFileSync(
  "src/upgrade/reference/hair-texture-index.ts",
  `// GENERATED — regenerate via \`npx tsx scripts/extract-hair-texture-index.ts\`. Do not edit by hand.\n` +
    `// (folderHash,fileHash) pairs (LE uint32, base64) for every file under the hair/zear/tail\n` +
    `// TEXTURE folders that exist in the 040000 index. The runtime FileExists oracle for\n` +
    `// RepathHairMashups (ModpackUpgrader.cs:379-482). See hair-texture-exists.ts.\n` +
    `export const HAIR_TEX_INDEX_PACKED = ${JSON.stringify(out.toString("base64"))};\n`,
);
console.log(`wrote ${pairs.length} texture entries`);
