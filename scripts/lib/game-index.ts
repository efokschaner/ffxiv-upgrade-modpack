// SqPack game-index reader — extraction tooling only (NOT shipped port code).
// Ports HashGenerator.GetHash/ComputeCRC (HashGenerator.cs:154-205), the 040000
// index1 existence check (IndexFile.cs · ReadIndex1Data/GetRawDataOffset · 172-199 / 516-621),
// the raw-offset -> (datNum, byteOffset) decode (IndexFile.cs · FileIndexEntry.DatNum/DataOffset ·
// 1183-1200), and the on-disk entry length (Dat.cs · GetCompressedFileSize · 2178-2297) needed to
// slice a SqPack entry out of a .dat before handing it to decodeSqPackFile.
// Lets scripts/extract-hair-materials.ts enumerate existing DT materials in-process,
// exactly as EndwalkerUpgrade uses rtx.FileExists(matPath) (EndwalkerUpgrade.cs:1430), and lets a
// later enumerator read thousands of game files in-process with no ConsoleTools subprocess.
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { decodeSqPackFile } from "../../src/sqpack/sqpack";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC32 of the lowercased path bytes, matching HashGenerator.ComputeCRC (init -1, no final XOR). */
export function computeHash(path: string): number {
  let crc = 0xffffffff;
  const s = path.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    // Index is always 0-255 (masked with & 0xff) so this indexed access cannot be undefined.
    crc = CRC_TABLE[(crc ^ s.charCodeAt(i)) & 0xff]! ^ (crc >>> 8);
  }
  return crc >>> 0; // C# returns the raw (un-complemented) accumulator cast to uint.
}

export class GameIndex {
  private readonly entries = new Set<string>(); // `${folderHash}:${fileHash}` from index1
  private readonly offsets = new Map<string, number>(); // `${folderHash}:${fileHash}` -> raw dataOffset
  private sqpackDir = "";

  static load(sqpackDir: string): GameIndex {
    const gi = new GameIndex();
    gi.sqpackDir = sqpackDir;
    const buf = readFileSync(join(sqpackDir, "040000.win32.index"));
    // segmentOffset/segmentSize at file offset 1032/1036 (IndexFile.cs:137-174).
    const segOffset = buf.readInt32LE(1032);
    const segSize = buf.readInt32LE(1036);
    for (let p = segOffset; p < segOffset + segSize; p += 16) {
      const fileHash = buf.readUInt32LE(p + 0) >>> 0; // FileIndexEntry: fileNameHash @ +0
      const folderHash = buf.readUInt32LE(p + 4) >>> 0; // folderPathHash @ +4
      const rawOffset = buf.readUInt32LE(p + 8) >>> 0; // FileIndexEntry: fileOffset (dataFileOffset) @ +8
      gi.entries.add(`${folderHash}:${fileHash}`);
      gi.offsets.set(`${folderHash}:${fileHash}`, rawOffset);
    }
    return gi;
  }

  /** True iff `gamePath` (folder + "/" + file) exists in the 040000 index1 (IndexFile.cs:516-621). */
  fileExists(gamePath: string): boolean {
    const slash = gamePath.lastIndexOf("/");
    const folder = gamePath.slice(0, slash);
    const file = gamePath.slice(slash + 1);
    return this.entries.has(`${computeHash(folder)}:${computeHash(file)}`);
  }

  /** Reads and decompresses a base-game file by path, entirely in-process (no ConsoleTools).
   *  Ports the raw-offset decode (IndexFile.cs · FileIndexEntry.DatNum/DataOffset · 1183-1200) and
   *  Dat.ReadSqPackFile's entry lookup (Dat.cs:1016), handing the sliced entry to decodeSqPackFile
   *  (which already mirrors ReadSqPackType2/3/4's decompression). Throws if the path is absent in
   *  the 040000 index.
   *
   *  Uses positioned reads (fs.readSync) rather than reading the whole .dat: base-game .dat files
   *  regularly exceed Node's 2 GiB readFileSync/Buffer ceiling (the ffxiv dat0 alone is ~12 GiB). */
  read(gamePath: string): Uint8Array {
    const slash = gamePath.lastIndexOf("/");
    const key = `${computeHash(gamePath.slice(0, slash))}:${computeHash(gamePath.slice(slash + 1))}`;
    const raw = this.offsets.get(key);
    if (raw === undefined) throw new Error(`game-index: absent ${gamePath}`);
    // FileIndexEntry.DatNum (IndexFile.cs:1183-1189): (fileOffset & 0x0F) / 2. Masking bits 1-3 then
    // shifting is equivalent (bit0 never survives either way).
    const datNum = (raw & 0x0e) >> 1;
    // FileIndexEntry.DataOffset (IndexFile.cs:1194-1200): (fileOffset*8 / 128) * 128, i.e. drop the
    // low 4 bits (dat-number bits) of fileOffset before multiplying by the x8 scale factor.
    const byteOffset = (raw & ~0xf) * 8;
    const fd = openSync(join(this.sqpackDir, `040000.win32.dat${datNum}`), "r");
    try {
      // The entry's own headerLength (first int32) bounds every field entryBodyLength reads
      // (Dat.ReadSqPackType2/3's "extraData" padding fills exactly out to endOfHeader), so peek 4
      // bytes for headerLength, then re-read that many bytes as the full header.
      const peek = Buffer.alloc(4);
      readSync(fd, peek, 0, 4, byteOffset);
      const headerLength = peek.readInt32LE(0);
      const header = Buffer.alloc(headerLength);
      readSync(fd, header, 0, headerLength, byteOffset);
      const total = entryBodyLength(header);
      const entry = Buffer.alloc(total);
      readSync(fd, entry, 0, total, byteOffset);
      return decodeSqPackFile(entry).data;
    } finally {
      closeSync(fd);
    }
  }
}

/** Total on-disk length (header + compressed body, rounded up to 256 bytes) of a SqPack entry,
 *  given its header bytes (`header[0]` is the entry's own start, i.e. offsets below are relative to
 *  the entry, not absolute file positions). Faithful port of Dat.GetCompressedFileSize
 *  (Dat.cs:2178-2297) — the same byte-count oracle TexTools itself uses when relocating/copying dat
 *  entries, so it is exact for all three entry types without needing to actually decompress
 *  anything. */
function entryBodyLength(header: Buffer): number {
  const headerLength = header.readInt32LE(0);
  const fileType = header.readInt32LE(4);
  // uncompSize @+8, unknown @+12, maxBufferSize @+16 (Dat.cs:2191-2193) are read by the C# but
  // unused by this computation; skip them.
  let compSize: number;
  if (fileType === 2) {
    // Dat.cs:2206-2224: blockCount int16 @+20; block table entries are 8 bytes at +24+8*i
    // (int32 blockOffset, uint16 compressedSize); only the LAST entry matters — offsets increase
    // monotonically, so it bounds the whole compressed body.
    const blockCount = header.readInt16LE(20);
    let lastOffset = 0;
    let lastSize = 0;
    for (let i = 0; i < blockCount; i++) {
      const p = 24 + 8 * i;
      lastOffset = header.readInt32LE(p);
      lastSize = header.readUInt16LE(p + 4) + 16; // 16 bytes of block header per block (Dat.cs:2218).
    }
    compSize = headerLength + lastOffset + lastSize;
  } else if (fileType === 3) {
    // Dat.cs:2225-2261: first chunk offset (int32) @+112; 11 segment block-counts (uint16, Vertex
    // Info/Model Data/[Vertex x3]/[Edge x3]/[Index x3]) @+178; per-block compressed sizes (uint16)
    // immediately follow @+208, one per block summed across all 11 segments.
    const firstOffset = header.readInt32LE(112);
    let totalBlocks = 0;
    for (let i = 0; i < 11; i++) {
      totalBlocks += header.readUInt16LE(178 + 2 * i);
    }
    let totalCompressedSize = 0;
    for (let i = 0; i < totalBlocks; i++) {
      totalCompressedSize += header.readUInt16LE(208 + 2 * i);
    }
    compSize = headerLength + firstOffset + totalCompressedSize;
  } else if (fileType === 4) {
    // Dat.cs:2262-2286: blockCount int16 @+20 (one per mipmap); mipmap table entries are 20 bytes
    // at +24+20*i (int32 offsetFromHeaderEnd, int32 compressedSize); only the last entry matters.
    const blockCount = header.readInt16LE(20);
    let lastOffset = 0;
    let lastSize = 0;
    for (let i = 0; i < blockCount; i++) {
      const p = 24 + 20 * i;
      lastOffset = header.readInt32LE(p);
      lastSize = header.readInt32LE(p + 4);
    }
    compSize = headerLength + lastOffset + lastSize;
  } else {
    throw new Error(`game-index: unsupported SqPack entry type ${fileType}`);
  }
  // Dat.cs:2289-2294: round up to the nearest 256 bytes.
  return compSize % 256 === 0 ? compSize : compSize + (256 - (compSize % 256));
}
