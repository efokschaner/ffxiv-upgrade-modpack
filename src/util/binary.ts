import { deflateSync, inflateSync } from "fflate";

export class BinaryReader {
  private view: DataView;
  private pos = 0;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  seek(pos: number): void {
    this.pos = pos;
  }
  tell(): number {
    return this.pos;
  }
  readInt32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  readUint32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  readInt16(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  readUint16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  readUint8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }
  readBytes(len: number): Uint8Array {
    const out = this.bytes.slice(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  readFloat32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  readNullTerminatedString(): string {
    const start = this.pos;
    while (this.view.getUint8(this.pos) !== 0) this.pos += 1;
    const s = new TextDecoder().decode(this.bytes.subarray(start, this.pos));
    this.pos += 1; // consume the null terminator
    return s;
  }
  slice(start: number, len: number): Uint8Array {
    return this.bytes.slice(start, start + len);
  }
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// FNV-1a (32-bit) over bytes, prefixed with length, for cheap content dedup keys.
export function fnv1aKey(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return `${bytes.length}:${(h >>> 0).toString(16)}`;
}

/** Raw DEFLATE (no zlib/gzip framing), matching C# DeflateStream. */
export function deflateRaw(bytes: Uint8Array): Uint8Array {
  return deflateSync(bytes);
}
export function inflateRaw(bytes: Uint8Array, size: number): Uint8Array {
  const out = inflateSync(bytes, { out: new Uint8Array(size) });
  return out;
}

/** Little-endian byte builder for constructing SQPack headers. */
export class ByteBuilder {
  private parts: number[] = [];
  u8(v: number): this {
    this.parts.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    this.parts.push(v & 0xff, (v >>> 8) & 0xff);
    return this;
  }
  u32(v: number): this {
    this.parts.push(
      v & 0xff,
      (v >>> 8) & 0xff,
      (v >>> 16) & 0xff,
      (v >>> 24) & 0xff,
    );
    return this;
  }
  f32(v: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    this.parts.push(b[0]!, b[1]!, b[2]!, b[3]!);
    return this;
  }
  i32(v: number): this {
    this.parts.push(
      v & 0xff,
      (v >>> 8) & 0xff,
      (v >>> 16) & 0xff,
      (v >>> 24) & 0xff,
    );
    return this;
  }
  bytes(a: Uint8Array | number[]): this {
    for (const b of a) this.parts.push(b & 0xff);
    return this;
  }
  get length(): number {
    return this.parts.length;
  }
  toUint8Array(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}
