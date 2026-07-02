import { BinaryReader, ByteBuilder, concatBytes, deflateRaw, inflateRaw } from "../util/binary";

const MAX_CHUNK = 16000;
const STORED_SENTINEL = 32000;

function pad128(len: number): number {
  const r = len % 128;
  return r === 0 ? len : len + (128 - r);
}

/**
 * Reads one compressed block at the reader's current position and returns the
 * decompressed bytes, leaving the reader positioned at the next block.
 * Mirrors Dat.ReadCompressedBlock / the per-block loop in BeginReadCompressedBlocks
 * (Dat.cs:2359-2429), including tolerance for legacy improper block spacing.
 */
export function readBlock(r: BinaryReader): Uint8Array {
  const start = r.tell();

  // Skip stray leading zero bytes before the '16' magic (old TexTools artifact).
  let sixteen = r.readUint8();
  while (sixteen !== 16 && sixteen === 0) sixteen = r.readUint8();
  const zeros = r.readBytes(3);
  const zero = r.readInt32();
  if (sixteen !== 16 || zero !== 0 || zeros.some((x) => x !== 0)) {
    throw new Error("sqpack: unable to locate valid compressed block header");
  }

  const compSize = r.readInt32();
  const decompSize = r.readInt32();

  let data: Uint8Array;
  if (compSize === STORED_SENTINEL) {
    data = r.readBytes(decompSize);
  } else {
    data = inflateRaw(r.readBytes(compSize), decompSize);
  }

  // Advance past padding to the next 128-byte boundary, with legacy rewind.
  const length = r.tell() - start;
  const remaining = pad128(length) - length;
  const padding = r.readBytes(remaining);
  const sixteenIndex = padding.indexOf(16);
  if (sixteenIndex !== -1) {
    // Old broken spacing: the next block header starts inside the "padding".
    r.seek(r.tell() - (padding.length - sixteenIndex));
  }
  return data;
}

/** Compresses one chunk (<= 16000 bytes) into a single padded block. Mirrors CompressSmallData (Dat.cs:2094). */
export function writeBlock(chunk: Uint8Array): Uint8Array {
  if (chunk.length > MAX_CHUNK) throw new Error("sqpack: writeBlock chunk too large");
  const compressed = deflateRaw(chunk);
  const header = new ByteBuilder().i32(16).i32(0).i32(compressed.length).i32(chunk.length).toUint8Array();
  const body = concatBytes([header, compressed]);
  const padding = new Uint8Array(pad128(body.length) - body.length);
  return concatBytes([body, padding]);
}

/** Splits data into 16000-byte chunks and returns one padded block per chunk. Mirrors CompressData (Dat.cs:2130). */
export function compressData(data: Uint8Array): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  for (let off = 0; off < data.length; off += MAX_CHUNK) {
    blocks.push(writeBlock(data.slice(off, Math.min(off + MAX_CHUNK, data.length))));
  }
  return blocks;
}
