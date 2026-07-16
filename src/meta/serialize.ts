import { ByteBuilder } from "../util/binary";
import type { ItemMeta } from "./types";

// Port of ItemMetadata.Serialize (ItemMetadata.cs:503-660). Writes the header table in the fixed
// order [Imc, Eqp, Eqdp, Est, Gmp] (ItemMetadata.cs:554-597) then each present segment's data
// (ItemMetadata.cs:603-657), backfilling offset/size. Per-header size is 12 (_METADATA_HEADER_SIZE).
// All segment offsets/sizes are computable upfront (no reader/stream needed), so we build each
// segment's payload first, then append linearly with ByteBuilder: version, path + NUL, count/size/
// headerStart, then each segment's {type,offset,size} header, then each segment's data.
const TYPE_IMC = 1;
const TYPE_EQP = 3;
const TYPE_EQDP = 2;
const TYPE_EST = 4;
const TYPE_GMP = 5;

function eqdpBytes(m: ItemMeta): Uint8Array {
  const b = new ByteBuilder();
  for (const [race, value] of m.eqdp!) {
    // key IS the race (ItemMetadata.cs:743 writes kv.Key)
    b.u32(race);
    b.u8(value);
  }
  return b.toUint8Array();
}

function estBytes(m: ItemMeta): Uint8Array {
  const b = new ByteBuilder();
  for (const x of m.est!.values()) {
    // value's race (ItemMetadata.cs:678 writes kv.Value.Race)
    b.u16(x.race);
    b.u16(x.setId);
    b.u16(x.skelId);
  }
  return b.toUint8Array();
}

function imcBytes(m: ItemMeta): Uint8Array {
  const b = new ByteBuilder();
  for (const chunk of m.imc!) b.bytes(chunk);
  return b.toUint8Array();
}

export function serializeMeta(m: ItemMeta): Uint8Array {
  // Present segments in write order, each with its payload bytes.
  const segments: { type: number; data: Uint8Array }[] = [];
  if (m.imc) segments.push({ type: TYPE_IMC, data: imcBytes(m) });
  if (m.eqp) segments.push({ type: TYPE_EQP, data: m.eqp });
  if (m.eqdp) segments.push({ type: TYPE_EQDP, data: eqdpBytes(m) });
  if (m.est) segments.push({ type: TYPE_EST, data: estBytes(m) });
  if (m.gmp) segments.push({ type: TYPE_GMP, data: m.gmp });

  const enc = new TextEncoder().encode(m.path);
  const headerBase = 4 + enc.length + 1 + 12; // version + pathZ + (count,size,start)
  const headersLen = segments.length * 12;
  let dataAt = headerBase + headersLen;
  const dataOffsets: number[] = [];
  for (const s of segments) {
    dataOffsets.push(dataAt);
    dataAt += s.data.length;
  }

  const b = new ByteBuilder();
  // ItemMetadata.Serialize always writes the current _METADATA_VERSION (2), never the input's
  // version field (ItemMetadata.cs:509). deserializeMeta now rejects anything but v2 on the way in
  // (src/meta/deserialize.ts), so this is defense-in-depth as much as a citation of the C# symbol.
  b.u32(2);
  b.bytes(enc);
  b.u8(0); // NUL terminator
  b.u32(segments.length);
  b.u32(12); // per-header size
  b.u32(headerBase); // header entries start (== current length)

  segments.forEach((s, i) => {
    b.u32(s.type);
    b.u32(dataOffsets[i]!);
    b.u32(s.data.length);
  });

  for (const s of segments) b.bytes(s.data);

  return b.toUint8Array();
}
