import { describe, expect, it } from "vitest";
import {
  BinaryReader,
  ByteBuilder,
  concatBytes,
  fnv1aKey,
} from "../../src/util/binary";
import { readZip, writeZip } from "../../src/zip/zip";

describe("zip wrapper", () => {
  it("round-trips entries", () => {
    const entries = new Map<string, Uint8Array>([
      ["a/b.txt", new TextEncoder().encode("hello")],
      ["TTMPD.mpd", new Uint8Array([1, 2, 3, 4])],
    ]);
    const zipped = writeZip(entries, { store: true });
    const back = readZip(zipped);
    expect([...back.keys()].sort()).toEqual(["TTMPD.mpd", "a/b.txt"]);
    expect(back.get("TTMPD.mpd")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(new TextDecoder().decode(back.get("a/b.txt"))).toBe("hello");
  });
});

// A minimal hand-built STORED-entry zip, so we control the general-purpose bit flag directly
// (fflate's own writer does not expose it). The CRC-32/offset fields are left 0 -- irrelevant here,
// since these tests only exercise readZip's Central Directory pre-check, which runs before fflate
// ever reads entry data.
function buildStoredZip(
  nameBytes: Uint8Array,
  data: Uint8Array,
  flags: number,
): Uint8Array {
  const local = new ByteBuilder()
    .u32(0x04034b50)
    .u16(20) // version needed to extract
    .u16(flags)
    .u16(0) // compression method: store
    .u16(0) // last mod file time
    .u16(0) // last mod file date
    .u32(0) // crc-32
    .u32(data.length)
    .u32(data.length)
    .u16(nameBytes.length)
    .u16(0) // extra field length
    .bytes(nameBytes)
    .bytes(data)
    .toUint8Array();

  const central = new ByteBuilder()
    .u32(0x02014b50)
    .u16(20) // version made by
    .u16(20) // version needed to extract
    .u16(flags)
    .u16(0) // compression method
    .u16(0) // last mod file time
    .u16(0) // last mod file date
    .u32(0) // crc-32
    .u32(data.length)
    .u32(data.length)
    .u16(nameBytes.length)
    .u16(0) // extra field length
    .u16(0) // file comment length
    .u16(0) // disk number start
    .u16(0) // internal file attributes
    .u32(0) // external file attributes
    .u32(0) // relative offset of local header
    .bytes(nameBytes)
    .toUint8Array();

  const eocd = new ByteBuilder()
    .u32(0x06054b50)
    .u16(0) // number of this disk
    .u16(0) // disk where central directory starts
    .u16(1) // number of central directory records on this disk
    .u16(1) // total number of central directory records
    .u32(central.length)
    .u32(local.length) // offset of start of central directory
    .u16(0) // comment length
    .toUint8Array();

  return concatBytes([local, central, eocd]);
}

// CRITICAL fix coverage: TexTools unzips with Ionic.Zip (IOUtil.UnzipFiles, IOUtil.cs:625/654/669),
// whose non-UTF-8 fallback is IBM437; fflate's unzipSync falls back to latin1 instead. The two
// disagree on any byte >= 0x80, so an entry name with the UTF-8 flag unset and a high byte is one we
// cannot resolve the way TexTools would -- readZip must fail loud rather than silently pick a
// different name (see src/zip/zip.ts's findNonUtf8HighByteEntryNames doc comment).
describe("readZip: non-UTF-8-flagged high-byte entry names (IOUtil.cs:625/654/669)", () => {
  it("throws when an entry name has the UTF-8 flag unset and a byte >= 0x80", () => {
    // 0xE9 with no UTF-8 flag is genuinely ambiguous: IBM437 (Ionic.Zip/TexTools) and latin1
    // (fflate) map it to different characters ('┌'-adjacent vs. 'é').
    const nameBytes = concatBytes([
      new TextEncoder().encode("caf"),
      new Uint8Array([0xe9]),
    ]);
    const zip = buildStoredZip(nameBytes, new Uint8Array([1, 2, 3]), 0);
    expect(() => readZip(zip)).toThrow(/UTF-8/);
  });

  it("does not throw for the same high byte when the entry's UTF-8 flag IS set", () => {
    const nameBytes = new TextEncoder().encode("café"); // UTF-8: multi-byte, all >= 0x80 for 'é'
    const zip = buildStoredZip(nameBytes, new Uint8Array([1, 2, 3]), 0x0800);
    const back = readZip(zip);
    expect([...back.keys()]).toEqual(["café"]);
  });

  it("does not throw for a plain-ASCII name with the UTF-8 flag unset", () => {
    const nameBytes = new TextEncoder().encode("plain.txt");
    const zip = buildStoredZip(nameBytes, new Uint8Array([1, 2, 3]), 0);
    const back = readZip(zip);
    expect([...back.keys()]).toEqual(["plain.txt"]);
  });
});

describe("binary utils", () => {
  it("reads little-endian ints and slices", () => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setInt32(0, 305419896, true); // 0x12345678
    const r = new BinaryReader(buf);
    expect(r.readInt32()).toBe(305419896);
    r.seek(0);
    expect(r.slice(0, 2)).toEqual(buf.slice(0, 2));
  });

  it("concats and builds stable dedupe keys", () => {
    expect(concatBytes([new Uint8Array([1]), new Uint8Array([2, 3])])).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    const a = fnv1aKey(new Uint8Array([1, 2, 3]));
    const b = fnv1aKey(new Uint8Array([1, 2, 3]));
    const c = fnv1aKey(new Uint8Array([1, 2, 4]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
