import { describe, it, expect } from "vitest";
import { BinaryReader, concatBytes } from "../src/util/binary";
import { readBlock, writeBlock, compressData } from "../src/sqpack/blocks";

const enc = new TextEncoder();

describe("block codec", () => {
  it("round-trips a single block", () => {
    const payload = enc.encode("hello sqpack block");
    const block = writeBlock(payload);
    expect(block.length % 128).toBe(0); // padded to 128
    const r = new BinaryReader(block);
    expect(readBlock(r)).toEqual(payload);
  });

  it("splits >16000 bytes into multiple blocks and round-trips", () => {
    const big = new Uint8Array(40000).map((_, i) => i & 0xff);
    const blocks = compressData(big);
    expect(blocks.length).toBe(3); // ceil(40000/16000)
    const joined = concatBytes(blocks);
    const r = new BinaryReader(joined);
    const out = concatBytes(blocks.map(() => readBlock(r)));
    expect(out).toEqual(big);
  });

  it("reads a stored (uncompressed) block (32000 sentinel)", () => {
    // Build a stored block by hand: [16][0][32000][len] + raw + pad-to-128.
    const raw = enc.encode("stored payload");
    const head = new Uint8Array(16);
    const dv = new DataView(head.buffer);
    dv.setInt32(0, 16, true); dv.setInt32(4, 0, true);
    dv.setInt32(8, 32000, true); dv.setInt32(12, raw.length, true);
    const body = concatBytes([head, raw]);
    const padded = concatBytes([body, new Uint8Array((128 - (body.length % 128)) % 128)]);
    const r = new BinaryReader(padded);
    expect(readBlock(r)).toEqual(raw);
  });

  it("tolerates legacy leading-zero block spacing", () => {
    const payload = enc.encode("legacy spaced");
    const block = writeBlock(payload);
    // Prepend stray zero bytes before the block header (old TexTools artifact).
    const shifted = concatBytes([new Uint8Array([0, 0, 0]), block]);
    const r = new BinaryReader(shifted);
    expect(readBlock(r)).toEqual(payload);
  });
});
