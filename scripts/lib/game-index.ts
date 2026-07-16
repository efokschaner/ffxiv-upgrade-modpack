// SqPack game-index reader — extraction tooling only (NOT shipped port code).
// Ports HashGenerator.GetHash/ComputeCRC (HashGenerator.cs:154-205) and the 040000
// index1 existence check (IndexFile.cs · ReadIndex1Data/GetRawDataOffset · 172-199 / 516-621).
// Lets scripts/extract-hair-materials.ts enumerate existing DT materials in-process,
// exactly as EndwalkerUpgrade uses rtx.FileExists(matPath) (EndwalkerUpgrade.cs:1430).
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  static load(sqpackDir: string): GameIndex {
    const gi = new GameIndex();
    const buf = readFileSync(join(sqpackDir, "040000.win32.index"));
    // segmentOffset/segmentSize at file offset 1032/1036 (IndexFile.cs:137-174).
    const segOffset = buf.readInt32LE(1032);
    const segSize = buf.readInt32LE(1036);
    for (let p = segOffset; p < segOffset + segSize; p += 16) {
      const fileHash = buf.readUInt32LE(p + 0) >>> 0; // FileIndexEntry: fileNameHash @ +0
      const folderHash = buf.readUInt32LE(p + 4) >>> 0; // folderPathHash @ +4
      gi.entries.add(`${folderHash}:${fileHash}`);
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
}
