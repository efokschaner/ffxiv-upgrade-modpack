import { BinaryReader } from "../util/binary";
import type { EqdpEntry, EstEntry, ItemMeta } from "./types";

// Port of ItemMetadata.Deserialize (ItemMetadata.cs:869-967). Reads the header table then each
// present segment. EQP/GMP/IMC kept as opaque bytes; EQDP/EST structured (ItemMetadata.cs:715-859).
// Uses BinaryReader (src/util/binary.ts): fixed-width reads go through DataView, which throws
// RangeError on overrun, and readNullTerminatedString() likewise throws instead of looping
// forever over a path with no NUL terminator — matching C#'s `reader.ReadChar()` throwing at
// end-of-stream (ItemMetadata.cs:878).
const TYPE_IMC = 1;
const TYPE_EQDP = 2;
const TYPE_EQP = 3;
const TYPE_EST = 4;
const TYPE_GMP = 5;

interface HeaderEntry {
  type: number;
  offset: number;
  size: number;
}

export function deserializeMeta(data: Uint8Array): ItemMeta {
  const reader = new BinaryReader(data);

  const version = reader.readUint32();
  const path = reader.readNullTerminatedString();

  const headerCount = reader.readUint32();
  const perHeaderSize = reader.readUint32();
  const headerEntryStart = reader.readUint32();

  // Per-segment header table: (type, offset, size) triples, each perHeaderSize apart
  // (ItemMetadata.cs:891-910). First match wins on duplicate types (entries.FirstOrDefault),
  // so scan front-to-back and only record the first entry seen per type.
  const entries: HeaderEntry[] = [];
  for (let i = 0; i < headerCount; i++) {
    const entryStart = headerEntryStart + i * perHeaderSize;
    reader.seek(entryStart);
    const type = reader.readUint32();
    const offset = reader.readUint32();
    const size = reader.readUint32();
    entries.push({ type, offset, size });
  }
  const firstOfType = (type: number): HeaderEntry | undefined =>
    entries.find((e) => e.type === type);

  const imcSeg = firstOfType(TYPE_IMC);
  let imc: Uint8Array[] | null = null;
  if (imcSeg) {
    imc = [];
    for (let o = 0; o < imcSeg.size; o += 6) {
      imc.push(reader.slice(imcSeg.offset + o, 6));
    }
  }

  const eqpSeg = firstOfType(TYPE_EQP);
  const eqp = eqpSeg ? reader.slice(eqpSeg.offset, eqpSeg.size) : null;

  const eqdpSeg = firstOfType(TYPE_EQDP);
  let eqdp: EqdpEntry[] | null = null;
  if (eqdpSeg) {
    eqdp = [];
    for (let o = 0; o < eqdpSeg.size; o += 5) {
      reader.seek(eqdpSeg.offset + o);
      const race = reader.readUint32();
      const value = reader.readUint8();
      eqdp.push({ race, value });
    }
  }

  const estSeg = firstOfType(TYPE_EST);
  let est: EstEntry[] | null = null;
  if (estSeg) {
    est = [];
    for (let o = 0; o < estSeg.size; o += 6) {
      reader.seek(estSeg.offset + o);
      const race = reader.readUint16();
      const setId = reader.readUint16();
      const skelId = reader.readUint16();
      est.push({ race, setId, skelId });
    }
  }

  const gmpSeg = firstOfType(TYPE_GMP);
  const gmp = gmpSeg ? reader.slice(gmpSeg.offset, gmpSeg.size) : null;

  return { version, path, imc, eqp, eqdp, est, gmp };
}
