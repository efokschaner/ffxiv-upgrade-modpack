export class BinaryReader {
  private view: DataView;
  private pos = 0;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  seek(pos: number): void { this.pos = pos; }
  tell(): number { return this.pos; }
  readInt32(): number { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  readUint32(): number { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  readInt16(): number { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  readUint16(): number { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  slice(start: number, len: number): Uint8Array {
    return this.bytes.slice(start, start + len);
  }
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
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
