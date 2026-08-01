// Runtime FileExists oracle over the complete bundled chara (040000) index. Ports
// ModTransaction.FileExists (ModTransaction.cs:1125-1137) and the chain it calls:
// IOUtil.IsFFXIVInternalPath (IOUtil.cs:551-570), IOUtil.GetDataFileFromPath (IOUtil.cs:312-329),
// IndexFile.GetRawDataOffsetIndex1 (IndexFile.cs:546-576), and HashGenerator.ComputeCRC
// (HashGenerator.cs:154-205). The bundled set (chara-index.ts) is the COMPLETE chara category, so a
// miss means the file is genuinely absent in-game — not that it fell outside a bundled slice.
//
// Two deliberate non-ports, both safe here:
//   - GetRawDataOffset (IndexFile.cs:516-526) also reads index2 and returns 0 unless the two offsets
//     agree. That is a corrupted-index guard: on a vanilla install the two views are consistent by
//     construction, and a false positive against these full 64-bit (folder, file) keys needs a 2^-64
//     collision, so index2 would add 0.76 MB of payload for no reachable behaviour.
//   - GetRawDataOffsetIndex1's synonym-table half (:562-573). 040000's index1 synonym segment holds
//     only the always-present ending sentinel, i.e. no real synonyms; scripts/extract-chara-index.ts
//     asserts this at generation time and fails loud if a patch ever changes it.
import { base64ToBytes } from "../../util/base64";
import {
  CHARA_INDEX_COUNTS,
  CHARA_INDEX_FILES,
  CHARA_INDEX_FOLDERS,
} from "./chara-index";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC32 of the lowercased path bytes (init -1, no final XOR), matching HashGenerator.ComputeCRC. */
export function computeHash(path: string): number {
  let crc = 0xffffffff;
  const s = path.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    // Index is always 0-255 (masked with & 0xff) so this indexed access cannot be undefined.
    crc = CRC_TABLE[(crc ^ s.charCodeAt(i)) & 0xff]! ^ (crc >>> 8);
  }
  return crc >>> 0;
}

/** IOUtil.cs:550 — note it is case-sensitive, so any uppercase character disqualifies a path. */
const INVALID_RE = /[^a-z0-9./\-_{}]/;

// XivDataFile folder keys (XivDataFile.cs:35-91). The 30 expansion keys ("bg/ex1/01_", "cut/ex3/",
// "music/ex2/", ...) are all extensions of these 11, so for IsFFXIVInternalPath's prefix test this
// list is complete. The full list only matters to GetDataFileFromPath's choice of index — and no key
// extends "chara/", the one category we bundle, so that choice collapses to a single prefix test.
const FOLDER_KEYS = [
  "common/",
  "bgcommon/",
  "bg/",
  "cut/",
  "chara/",
  "shader/",
  "ui/",
  "sound/",
  "vfx/",
  "exd/",
  "music/",
];
const CHARA_KEY = "chara/";

function u32View(b64: string): Uint32Array {
  const bytes = base64ToBytes(b64);
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

const FOLDERS = u32View(CHARA_INDEX_FOLDERS);
const FILES = u32View(CHARA_INDEX_FILES);

/** Per-folder start offsets into FILES: STARTS[i] .. STARTS[i + 1] is folder i's file-hash slice.
 *  Decoded once from the LEB128 counts written by scripts/extract-chara-index.ts. */
const STARTS = (() => {
  const counts = base64ToBytes(CHARA_INDEX_COUNTS);
  const starts = new Uint32Array(FOLDERS.length + 1);
  let p = 0;
  let acc = 0;
  for (let i = 0; i < FOLDERS.length; i++) {
    starts[i] = acc;
    let shift = 1;
    let value = 0;
    for (;;) {
      const b = counts[p++]!;
      value += (b & 0x7f) * shift;
      if ((b & 0x80) === 0) break;
      shift *= 128;
    }
    acc += value;
  }
  starts[FOLDERS.length] = acc;
  return starts;
})();

/** Index of `value` in the ascending `arr[lo, hi)`, or -1. */
function search(
  arr: Uint32Array,
  lo: number,
  hi: number,
  value: number,
): number {
  let l = lo;
  let h = hi;
  while (l < h) {
    const mid = (l + h) >>> 1;
    const x = arr[mid]!;
    if (x === value) return mid;
    if (x < value) l = mid + 1;
    else h = mid;
  }
  return -1;
}

/** True iff `path` exists in the base game, reproducing rtx.FileExists. Throws for a valid FFXIV
 *  path outside the chara category — only 040000 is bundled, and answering `false` there would be an
 *  unjustified miss rather than a faithful one. */
export function fileExists(path: string): boolean {
  if (path.trim().length === 0) return false; // IsNullOrWhiteSpace (ModTransaction.cs:1127)
  if (INVALID_RE.test(path)) return false; // _InvalidRegex (IOUtil.cs:556)
  if (!path.startsWith(CHARA_KEY)) {
    if (FOLDER_KEYS.some((key) => path.startsWith(key))) {
      throw new Error(
        `upgrade: FileExists asked about "${path}", but only the chara (040000) category is ` +
          `bundled. Bundling another category is unported — see ` +
          `docs/superpowers/specs/2026-07-31-game-file-exists-oracle-design.md §3.`,
      );
    }
    return false; // not an FFXIV internal path (IOUtil.cs:561-569)
  }
  const slash = path.lastIndexOf("/");
  const folder = search(
    FOLDERS,
    0,
    FOLDERS.length,
    computeHash(path.slice(0, slash)),
  );
  if (folder < 0) return false;
  return (
    search(
      FILES,
      STARTS[folder]!,
      STARTS[folder + 1]!,
      computeHash(path.slice(slash + 1)),
    ) >= 0
  );
}
