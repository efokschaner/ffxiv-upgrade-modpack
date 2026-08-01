// Generates src/upgrade/reference/chara-index.ts. Regenerate on a machine with FFXIV installed:
// `npx tsx scripts/extract-chara-index.ts`.
//
// Bundles the COMPLETE 040000 (chara) index1 file set — every (folderHash, fileHash) pair in the
// data segment — as the runtime FileExists oracle (IndexFile.cs · GetRawDataOffsetIndex1 · 546-576).
// Deliberately unfiltered: the queried domain is a mod's sampler paths, which can name any chara
// file, so scoping the table by folder or file type would make a miss mean "outside our slice"
// rather than "absent in-game". See
// docs/superpowers/specs/2026-07-31-game-file-exists-oracle-design.md §3 and §5.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SQPACK =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online\\game\\sqpack\\ffxiv";

const buf = readFileSync(join(SQPACK, "040000.win32.index"));
// Data-segment offset/size at file offset 1032/1036 (IndexFile.cs · ReadIndex1Data · 172-199).
const segOffset = buf.readInt32LE(1032);
const segSize = buf.readInt32LE(1036);

// The synonym (collision) segment, read at 1108/1112 — the header walk is SqPackHeader(1024) +
// headerSize + version, then ReadIndex1Data, then a 64-byte hash skip, then dataFileCount
// (IndexFile.cs · ReadIndexFile · 134-169 · ReadSynTable · 248-278). GetRawDataOffsetIndex1 consults
// Index1Synonyms as well as the base table, and this extractor reads only the base table — so assert
// the segment holds nothing but the always-present ending sentinel (IndexFile.cs:1370-1379,
// SynonymTableEntry.Size = 256). If a future patch introduces a real index1 synonym, fail loud here
// rather than silently bundling an incomplete set.
const synSize = buf.readInt32LE(1112);
if (synSize !== 256) {
  throw new Error(
    `extract-chara-index: index1 synonym segment is ${synSize} bytes (${synSize / 256} entries); ` +
      `the port assumes the ending sentinel alone. Port the synonym table before regenerating.`,
  );
}

const byFolder = new Map<number, number[]>();
let total = 0;
for (let p = segOffset; p < segOffset + segSize; p += 16) {
  const fileHash = buf.readUInt32LE(p) >>> 0; // FileIndexEntry: fileNameHash @ +0
  const folderHash = buf.readUInt32LE(p + 4) >>> 0; // folderPathHash @ +4
  const rawOffset = buf.readUInt32LE(p + 8) >>> 0; // fileOffset @ +8
  // FileExists is `offset != 0` (ModTransaction.cs:1135-1136), so a zero-offset entry is absent.
  if (rawOffset === 0) continue;
  let files = byFolder.get(folderHash);
  if (!files) {
    files = [];
    byFolder.set(folderHash, files);
  }
  files.push(fileHash);
  total++;
}
if (total === 0) {
  throw new Error("extract-chara-index: no entries — wrong index path?");
}

/** LEB128, matching the runtime decoder in src/upgrade/reference/file-exists.ts. */
function varint(n: number, out: number[]): void {
  let v = n;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

const folders = [...byFolder.keys()].sort((a, b) => a - b);
const foldersBuf = Buffer.alloc(folders.length * 4);
folders.forEach((f, i) => {
  foldersBuf.writeUInt32LE(f >>> 0, i * 4);
});

const counts: number[] = [];
const filesBuf = Buffer.alloc(total * 4);
let fp = 0;
for (const folder of folders) {
  const files = byFolder.get(folder)!.sort((a, b) => a - b);
  // The runtime binary-searches this slice, which requires strictly ascending keys.
  if (new Set(files).size !== files.length) {
    throw new Error(
      `extract-chara-index: duplicate (folderHash, fileHash) pair under folder ${folder}`,
    );
  }
  varint(files.length, counts);
  for (const fileHash of files) {
    filesBuf.writeUInt32LE(fileHash >>> 0, fp);
    fp += 4;
  }
}

writeFileSync(
  "src/upgrade/reference/chara-index.ts",
  `// GENERATED — regenerate via \`npx tsx scripts/extract-chara-index.ts\`. Do not edit by hand.\n` +
    `// The COMPLETE 040000 (chara) index1 file set — the runtime FileExists oracle (see\n` +
    `// file-exists.ts). Grouped by folder so 82k folder hashes are stored once rather than per file:\n` +
    `// CHARA_INDEX_FOLDERS is u32 LE folder hashes ascending, CHARA_INDEX_COUNTS is one LEB128 file\n` +
    `// count per folder in that order, and CHARA_INDEX_FILES is u32 LE file hashes grouped by folder\n` +
    `// in that same order, ascending within each group.\n` +
    `export const CHARA_INDEX_FOLDERS = ${JSON.stringify(foldersBuf.toString("base64"))};\n` +
    `export const CHARA_INDEX_COUNTS = ${JSON.stringify(Buffer.from(counts).toString("base64"))};\n` +
    `export const CHARA_INDEX_FILES = ${JSON.stringify(filesBuf.toString("base64"))};\n`,
);
console.log(`wrote ${total} entries across ${folders.length} folders`);
