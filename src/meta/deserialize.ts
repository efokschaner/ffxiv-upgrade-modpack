import { BinaryReader } from "../util/binary";
import type { EstEntry, ItemMeta } from "./types";

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
  // C#'s current metadata version is 2 (_METADATA_VERSION, ItemMetadata.cs:490); version 1 predates
  // the EST/GMP segments (version history ItemMetadata.cs:490-494). ConsoleTools /upgrade DOES
  // accept a v1 input and cleanly upgrades it to v2, but only by *injecting* base-game data our
  // port cannot faithfully reproduce today: DeserializeEstData defaults a missing EST segment to
  // `Est.GetExtraSkeletonEntries(root)` (ItemMetadata.cs:823-826) and DeserializeGmpData defaults a
  // missing GMP segment to `GetGimmickParameter(root, true)` (ItemMetadata.cs:851-855) — the latter
  // needs a per-item base-game GMP reference table we have never extracted
  // (docs/backlog/2026-07-11-v1-metadata-support.md). Rather than silently emit a wrong
  // (missing-injection) v2 meta, fail loud.
  if (version !== 2) {
    throw new Error(
      `meta: unsupported version ${version} (only v2 is ported; v1's EST/GMP default-injection ` +
        "needs base-game data we don't have — see docs/backlog/2026-07-11-v1-metadata-support.md)",
    );
  }
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
  let eqdp: Map<number, number> | null = null;
  if (eqdpSeg) {
    eqdp = new Map();
    for (let o = 0; o < eqdpSeg.size; o += 5) {
      reader.seek(eqdpSeg.offset + o);
      const race = reader.readUint32();
      const value = reader.readUint8();
      // C# ret.Add(race, entry) throws on a repeat (ItemMetadata.cs:773); the array silently kept both.
      if (eqdp.has(race))
        throw new Error(
          `meta: duplicate EQDP race ${race} (ItemMetadata.cs:773)`,
        );
      eqdp.set(race, value);
    }
  }

  const estSeg = firstOfType(TYPE_EST);
  let est: Map<number, EstEntry> | null = null;
  if (estSeg) {
    est = new Map();
    for (let o = 0; o < estSeg.size; o += 6) {
      reader.seek(estSeg.offset + o);
      const race = reader.readUint16();
      const setId = reader.readUint16();
      const skelId = reader.readUint16();
      // C# ret.Add(race, entry) throws on a repeat (ItemMetadata.cs:843); the array silently kept both.
      if (est.has(race))
        throw new Error(
          `meta: duplicate EST race ${race} (ItemMetadata.cs:843)`,
        );
      est.set(race, { race, setId, skelId });
    }
  }

  const gmpSeg = firstOfType(TYPE_GMP);
  const gmp = gmpSeg ? reader.slice(gmpSeg.offset, gmpSeg.size) : null;

  return { version, path, imc, eqp, eqdp, est, gmp };
}
