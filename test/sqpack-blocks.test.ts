// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Edmund Fokschaner
//
// Part of ffxiv-upgrade-modpack. Portions are a C#-to-TypeScript port of
// xivModdingFramework / FFXIV TexTools (GPL-3.0-or-later). See LICENSE and NOTICE.

import { describe, it, expect } from "vitest";
import { BinaryReader, concatBytes, deflateRaw } from "../src/util/binary";
import { readBlock, writeBlock, compressData } from "../src/sqpack/blocks";

const enc = new TextEncoder();

/**
 * Build a raw compressed block WITHOUT the trailing 128-byte alignment padding that `writeBlock`
 * normally adds, then append exactly `trailingZeros` zero bytes. This lets tests reproduce the
 * "improper block spacing" real legacy TexTools textures contain — where blocks are not
 * 128-aligned, so the reader must recover via leading-zero skipping and/or padding rewind.
 */
function rawBlock(data: Uint8Array, trailingZeros = 0): Uint8Array {
  const comp = deflateRaw(data);
  const head = new Uint8Array(16);
  const dv = new DataView(head.buffer);
  dv.setInt32(0, 16, true);
  dv.setInt32(4, 0, true);
  dv.setInt32(8, comp.length, true);
  dv.setInt32(12, data.length, true);
  return concatBytes([head, comp, new Uint8Array(trailingZeros)]);
}

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

  it("recovers tightly-packed (unpadded) blocks via padding rewind", () => {
    // No 128-alignment between blocks: each next header sits inside the prior block's
    // computed padding window, so readBlock must find the `16` magic there and rewind to it.
    // This exercises the recovery path that fires constantly on real legacy-spaced textures
    // and was previously untested (self round-trip can't reach it — encode always emits clean blocks).
    const a = enc.encode("AAAAAAAAAA first legacy payload");
    const b = enc.encode("BBBB second legacy payload here");
    const c = enc.encode("CCCCCC third");
    const stream = concatBytes([rawBlock(a), rawBlock(b), rawBlock(c), new Uint8Array(200)]);
    const r = new BinaryReader(stream);
    expect(readBlock(r)).toEqual(a);
    expect(readBlock(r)).toEqual(b);
    expect(readBlock(r)).toEqual(c);
  });

  it("decodes an irregularly-spaced multi-block stream (mixed skip + rewind)", () => {
    // Mirror real legacy TexTools output: blocks separated by irregular zero gaps that are not
    // 128-aligned, so each block is recovered via either leading-zero skip or padding rewind.
    const payloads = Array.from({ length: 6 }, (_, i) => enc.encode(`legacy mip block #${i} ${"x".repeat(i * 9)}`));
    const gaps = [0, 16, 48, 0, 96, 32]; // trailing zero padding after each block (deliberately non-128-aligned)
    const stream = concatBytes([
      ...payloads.map((p, i) => rawBlock(p, gaps[i]!)),
      new Uint8Array(256), // room for the final block's padding scan
    ]);
    const r = new BinaryReader(stream);
    for (const p of payloads) expect(readBlock(r)).toEqual(p);
  });
});
