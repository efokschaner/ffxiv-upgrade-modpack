// BC7 (BPTC) decoder ported from richgel999/bc7enc_rdo (bc7decomp.cpp unpack_bc7):
//   Copyright (c) 2020-2021 Richard Geldreich, Jr. (MIT / Unlicense) — see NOTICE.
// The BPTC algorithm is an unpatented public standard.
//
// BC7 modes 0-7 are verified pixel-exact against the DirectXTex `texconv` reference decoder by the
// golden-fixture suite (test/tex/tex-bcn-golden.test.ts), which also asserts all 8 modes are covered.

// Decodes BC7-compressed data to RGBA8888 at width x height, applying the red/blue swap that the
// reference applies after Bc7Sharp.Decode (DxtUtil.SwapRedBlue).
// The red/blue swap (applied on top of a standard-order block decode) is verified against texconv in
// test/tex/tex-bcn-golden.test.ts (channelMap "swapRB"); the channel order is settled.
export function decodeBc7(
  src: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const bx = (width + 3) >> 2;
  const by = (height + 3) >> 2;
  for (let y = 0; y < by; y++) {
    for (let x = 0; x < bx; x++) {
      const block = decodeBc7Block(src, (y * bx + x) * 16); // 16 RGBA texels
      for (let t = 0; t < 16; t++) {
        const px = x * 4 + (t & 3);
        const py = y * 4 + (t >> 2);
        if (px < width && py < height) {
          const o = (py * width + px) * 4;
          // Red/blue swap (matches DxtUtil.SwapRedBlue on BcnSharp output).
          out[o] = block[t * 4 + 2]!;
          out[o + 1] = block[t * 4 + 1]!;
          out[o + 2] = block[t * 4]!;
          out[o + 3] = block[t * 4 + 3]!;
        }
      }
    }
  }
  return out;
}

// --- BPTC weight / partition / anchor tables (bc7decomp.cpp g_bc7_*). ---

const g_bc7_weights2 = [0, 21, 43, 64];
const g_bc7_weights3 = [0, 9, 18, 27, 37, 46, 55, 64];
const g_bc7_weights4 = [
  0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64,
];

// biome-ignore format: BPTC 2-subset partition table, rows kept 16-wide to match bc7decomp.cpp g_bc7_partition2
const g_bc7_partition2 = [
  0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1,
  0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
  0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1,
  0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1,
  0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1,
  0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1,
  0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1,
  0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
  0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1,
  0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0,
  0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0,
  0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0,
  0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1,
  0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0,
  0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0,
  0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0,
  0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0,
  0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0,
  0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
  0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0,
  0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0,
  0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
  0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1,
  0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0,
  0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0,
  0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0,
  0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0,
  0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1,
  0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1,
  0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0,
  0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0,
  0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0,
  0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0,
  0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
  0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1,
  0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1,
  0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0,
  0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0,
  0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0,
  0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0,
  0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1,
  0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1,
  0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0,
  0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0,
  0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1,
  0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1,
  0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1,
  0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1,
  0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1,
  0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
  0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0,
  0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1,
];

// biome-ignore format: BPTC 3-subset partition table, rows kept 16-wide to match bc7decomp.cpp g_bc7_partition3
const g_bc7_partition3 = [
  0, 0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 1, 2, 2, 2, 2,
  0, 0, 0, 1, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 2, 1,
  0, 0, 0, 0, 2, 0, 0, 1, 2, 2, 1, 1, 2, 2, 1, 1,
  0, 2, 2, 2, 0, 0, 2, 2, 0, 0, 1, 1, 0, 1, 1, 1,
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2,
  0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 2, 2,
  0, 0, 2, 2, 0, 0, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1,
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2,
  0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2,
  0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2,
  0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2,
  0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 2,
  0, 0, 1, 1, 0, 1, 1, 2, 1, 1, 2, 2, 1, 2, 2, 2,
  0, 0, 1, 1, 2, 0, 0, 1, 2, 2, 0, 0, 2, 2, 2, 0,
  0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 2, 1, 1, 2, 2,
  0, 1, 1, 1, 0, 0, 1, 1, 2, 0, 0, 1, 2, 2, 0, 0,
  0, 0, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2,
  0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 2, 2, 1, 1, 1, 1,
  0, 1, 1, 1, 0, 1, 1, 1, 0, 2, 2, 2, 0, 2, 2, 2,
  0, 0, 0, 1, 0, 0, 0, 1, 2, 2, 2, 1, 2, 2, 2, 1,
  0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 2, 2, 0, 1, 2, 2,
  0, 0, 0, 0, 1, 1, 0, 0, 2, 2, 1, 0, 2, 2, 1, 0,
  0, 1, 2, 2, 0, 1, 2, 2, 0, 0, 1, 1, 0, 0, 0, 0,
  0, 0, 1, 2, 0, 0, 1, 2, 1, 1, 2, 2, 2, 2, 2, 2,
  0, 1, 1, 0, 1, 2, 2, 1, 1, 2, 2, 1, 0, 1, 1, 0,
  0, 0, 0, 0, 0, 1, 1, 0, 1, 2, 2, 1, 1, 2, 2, 1,
  0, 0, 2, 2, 1, 1, 0, 2, 1, 1, 0, 2, 0, 0, 2, 2,
  0, 1, 1, 0, 0, 1, 1, 0, 2, 0, 0, 2, 2, 2, 2, 2,
  0, 0, 1, 1, 0, 1, 2, 2, 0, 1, 2, 2, 0, 0, 1, 1,
  0, 0, 0, 0, 2, 0, 0, 0, 2, 2, 1, 1, 2, 2, 2, 1,
  0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 2, 2, 1, 2, 2, 2,
  0, 2, 2, 2, 0, 0, 2, 2, 0, 0, 1, 2, 0, 0, 1, 1,
  0, 0, 1, 1, 0, 0, 1, 2, 0, 0, 2, 2, 0, 2, 2, 2,
  0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0,
  0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0,
  0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0,
  0, 1, 2, 0, 2, 0, 1, 2, 1, 2, 0, 1, 0, 1, 2, 0,
  0, 0, 1, 1, 2, 2, 0, 0, 1, 1, 2, 2, 0, 0, 1, 1,
  0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0, 1, 1,
  0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2,
  0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 2, 1, 2, 1, 2, 1,
  0, 0, 2, 2, 1, 1, 2, 2, 0, 0, 2, 2, 1, 1, 2, 2,
  0, 0, 2, 2, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 1, 1,
  0, 2, 2, 0, 1, 2, 2, 1, 0, 2, 2, 0, 1, 2, 2, 1,
  0, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 0, 1, 0, 1,
  0, 0, 0, 0, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1,
  0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2,
  0, 2, 2, 2, 0, 1, 1, 1, 0, 2, 2, 2, 0, 1, 1, 1,
  0, 0, 0, 2, 1, 1, 1, 2, 0, 0, 0, 2, 1, 1, 1, 2,
  0, 0, 0, 0, 2, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2,
  0, 2, 2, 2, 0, 1, 1, 1, 0, 1, 1, 1, 0, 2, 2, 2,
  0, 0, 0, 2, 1, 1, 1, 2, 1, 1, 1, 2, 0, 0, 0, 2,
  0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 2, 2,
  0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 2, 2, 1, 1, 2,
  0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 2, 2, 2, 2, 2, 2,
  0, 0, 2, 2, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 2, 2,
  0, 0, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2, 0, 0, 2, 2,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 2,
  0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1,
  0, 2, 2, 2, 1, 2, 2, 2, 0, 2, 2, 2, 1, 2, 2, 2,
  0, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  0, 1, 1, 1, 2, 0, 1, 1, 2, 2, 0, 1, 2, 2, 2, 0,
];

// biome-ignore format: BPTC anchor-index table (2nd subset), rows kept 16-wide to match bc7decomp.cpp g_bc7_table_anchor_index_second_subset
const g_bc7_table_anchor_index_second_subset = [
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
  15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2,
  15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6,
  6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15,
];

// biome-ignore format: BPTC anchor-index table (3rd subset, first), rows kept 16-wide to match bc7decomp.cpp g_bc7_table_anchor_index_third_subset_1
const g_bc7_table_anchor_index_third_subset_1 = [
  3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3,
  3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15,
  8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15,
  3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3,
];

// biome-ignore format: BPTC anchor-index table (3rd subset, second), rows kept 16-wide to match bc7decomp.cpp g_bc7_table_anchor_index_third_subset_2
const g_bc7_table_anchor_index_third_subset_2 = [
  15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8,
  15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8,
  15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8,
  15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8,
];

// --- Bit helpers. ---

const MASK64 = (1n << 64n) - 1n;

/** Ports bc7decomp.cpp insert_weight_zero: inserts a forced-zero index at texel `offset`. */
function insertWeightZero(
  indexBits: bigint,
  bitsPerIndex: number,
  offset: number,
): bigint {
  const lowBitMask = (1n << BigInt(bitsPerIndex * (offset + 1) - 1)) - 1n;
  const highBitMask = MASK64 ^ lowBitMask;
  return ((indexBits & highBitMask) << 1n) | (indexBits & lowBitMask);
}

/** bc7_dequant(val, pbit, val_bits): quantized endpoint + p-bit -> 8-bit, with bit replication. */
function bc7DequantP(val: number, pbit: number, valBits: number): number {
  const totalBits = valBits + 1;
  let v = (val << 1) | pbit;
  v <<= 8 - totalBits;
  v |= v >> totalBits;
  return v & 0xff;
}

/** bc7_dequant(val, val_bits): quantized endpoint (no p-bit) -> 8-bit, with bit replication. */
function bc7Dequant(val: number, valBits: number): number {
  let v = val << (8 - valBits);
  v |= v >> valBits;
  return v & 0xff;
}

function bc7Interp(l: number, h: number, w: number, bits: number): number {
  switch (bits) {
    case 2:
      return (l * (64 - g_bc7_weights2[w]!) + h * g_bc7_weights2[w]! + 32) >> 6;
    case 3:
      return (l * (64 - g_bc7_weights3[w]!) + h * g_bc7_weights3[w]! + 32) >> 6;
    case 4:
      return (l * (64 - g_bc7_weights4[w]!) + h * g_bc7_weights4[w]! + 32) >> 6;
    default:
      return 0;
  }
}

type Color = [number, number, number, number];

function newEndpoints(n: number): Color[] {
  const e: Color[] = [];
  for (let i = 0; i < n; i++) e.push([0, 0, 0, 0]);
  return e;
}

// --- Per-mode decoders (bc7decomp.cpp unpack_bc7_mode*). Each writes 16 RGBA texels to `out`. ---

/** unpack_bc7_mode0_2: 3-subset modes 0 and 2. */
function unpackMode0_2(
  mode: number,
  low: bigint,
  high: bigint,
  out: Uint8Array,
): void {
  const ENDPOINTS = 6;
  const COMPS = 3;
  const WEIGHT_BITS = mode === 0 ? 3 : 2;
  const WEIGHT_MASK = BigInt((1 << WEIGHT_BITS) - 1);
  const ENDPOINT_BITS = mode === 0 ? 4 : 5;
  const ENDPOINT_MASK = BigInt((1 << ENDPOINT_BITS) - 1);
  const PBITS = mode === 0 ? 6 : 0;
  const WEIGHT_VALS = 1 << WEIGHT_BITS;
  const PART_BITS = mode === 0 ? 4 : 6;
  const PART_MASK = BigInt((1 << PART_BITS) - 1);

  const part = Number((low >> BigInt(mode + 1)) & PART_MASK);

  const channelReadChunks: bigint[] = [0n, 0n, 0n];
  if (mode === 0) {
    channelReadChunks[0] = low >> 5n;
    channelReadChunks[1] = low >> 29n;
    channelReadChunks[2] = (low >> 53n) | (high << 11n);
  } else {
    channelReadChunks[0] = low >> 9n;
    channelReadChunks[1] = (low >> 39n) | (high << 25n);
    channelReadChunks[2] = high >> 5n;
  }

  const endpoints = newEndpoints(ENDPOINTS);
  for (let c = 0; c < COMPS; c++) {
    let chunk = channelReadChunks[c]!;
    for (let e = 0; e < ENDPOINTS; e++) {
      endpoints[e]![c] = Number(chunk & ENDPOINT_MASK);
      chunk >>= BigInt(ENDPOINT_BITS);
    }
  }

  const pbits: number[] = [0, 0, 0, 0, 0, 0];
  if (mode === 0) {
    const pBitsChunk = Number((high >> 13n) & 0xffn);
    for (let p = 0; p < PBITS; p++) pbits[p] = (pBitsChunk >> p) & 1;
  }

  let weightsChunk = high >> BigInt(67 - 16 * WEIGHT_BITS);
  weightsChunk = insertWeightZero(weightsChunk, WEIGHT_BITS, 0);
  const a1 = g_bc7_table_anchor_index_third_subset_1[part]!;
  const a2 = g_bc7_table_anchor_index_third_subset_2[part]!;
  weightsChunk = insertWeightZero(weightsChunk, WEIGHT_BITS, Math.min(a1, a2));
  weightsChunk = insertWeightZero(weightsChunk, WEIGHT_BITS, Math.max(a1, a2));

  const weights: number[] = [];
  for (let i = 0; i < 16; i++) {
    weights.push(Number(weightsChunk & WEIGHT_MASK));
    weightsChunk >>= BigInt(WEIGHT_BITS);
  }

  for (let e = 0; e < ENDPOINTS; e++) {
    for (let c = 0; c < 4; c++) {
      endpoints[e]![c] =
        c === 3
          ? 255
          : PBITS
            ? bc7DequantP(endpoints[e]![c]!, pbits[e]!, ENDPOINT_BITS)
            : bc7Dequant(endpoints[e]![c]!, ENDPOINT_BITS);
    }
  }

  const blockColors: Color[][] = [[], [], []];
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < WEIGHT_VALS; i++) {
      const col: Color = [0, 0, 0, 255];
      for (let c = 0; c < 3; c++) {
        col[c] = bc7Interp(
          endpoints[s * 2 + 0]![c]!,
          endpoints[s * 2 + 1]![c]!,
          i,
          WEIGHT_BITS,
        );
      }
      blockColors[s]!.push(col);
    }
  }

  for (let i = 0; i < 16; i++) {
    const col = blockColors[g_bc7_partition3[part * 16 + i]!]![weights[i]!]!;
    out[i * 4] = col[0];
    out[i * 4 + 1] = col[1];
    out[i * 4 + 2] = col[2];
    out[i * 4 + 3] = col[3];
  }
}

/** unpack_bc7_mode1_3_7: 2-subset modes 1, 3 (RGB) and 7 (RGBA). */
function unpackMode1_3_7(
  mode: number,
  low: bigint,
  high: bigint,
  out: Uint8Array,
): void {
  const ENDPOINTS = 4;
  const COMPS = mode === 7 ? 4 : 3;
  const WEIGHT_BITS = mode === 1 ? 3 : 2;
  const WEIGHT_MASK = BigInt((1 << WEIGHT_BITS) - 1);
  const ENDPOINT_BITS = mode === 7 ? 5 : mode === 1 ? 6 : 7;
  const ENDPOINT_MASK = BigInt((1 << ENDPOINT_BITS) - 1);
  const PBITS = mode === 1 ? 2 : 4;
  const SHARED_PBITS = mode === 1;
  const WEIGHT_VALS = 1 << WEIGHT_BITS;

  const part = Number((low >> BigInt(mode + 1)) & 0x3fn);

  const channelReadChunks: bigint[] = [0n, 0n, 0n, 0n];
  channelReadChunks[0] = low >> BigInt(mode + 7);
  let pReadChunk = 0n;
  let weightReadChunk = 0n;

  switch (mode) {
    case 1:
      channelReadChunks[1] = low >> 32n;
      channelReadChunks[2] = (low >> 56n) | (high << 8n);
      pReadChunk = high >> 16n;
      weightReadChunk = high >> 18n;
      break;
    case 3:
      channelReadChunks[1] = (low >> 38n) | (high << 26n);
      channelReadChunks[2] = high >> 2n;
      pReadChunk = high >> 30n;
      weightReadChunk = high >> 34n;
      break;
    case 7:
      channelReadChunks[1] = low >> 34n;
      channelReadChunks[2] = (low >> 54n) | (high << 10n);
      channelReadChunks[3] = high >> 10n;
      pReadChunk = high >> 30n;
      weightReadChunk = high >> 34n;
      break;
  }

  const endpoints = newEndpoints(ENDPOINTS);
  for (let c = 0; c < COMPS; c++) {
    let chunk = channelReadChunks[c]!;
    for (let e = 0; e < ENDPOINTS; e++) {
      endpoints[e]![c] = Number(chunk & ENDPOINT_MASK);
      chunk >>= BigInt(ENDPOINT_BITS);
    }
  }

  const pbits: number[] = [0, 0, 0, 0];
  for (let p = 0; p < PBITS; p++)
    pbits[p] = Number((pReadChunk >> BigInt(p)) & 1n);

  weightReadChunk = insertWeightZero(weightReadChunk, WEIGHT_BITS, 0);
  weightReadChunk = insertWeightZero(
    weightReadChunk,
    WEIGHT_BITS,
    g_bc7_table_anchor_index_second_subset[part]!,
  );

  const weights: number[] = [];
  for (let i = 0; i < 16; i++) {
    weights.push(Number(weightReadChunk & WEIGHT_MASK));
    weightReadChunk >>= BigInt(WEIGHT_BITS);
  }

  for (let e = 0; e < ENDPOINTS; e++) {
    for (let c = 0; c < 4; c++) {
      endpoints[e]![c] =
        mode !== 7 && c === 3
          ? 255
          : bc7DequantP(
              endpoints[e]![c]!,
              pbits[SHARED_PBITS ? e >> 1 : e]!,
              ENDPOINT_BITS,
            );
    }
  }

  const blockColors: Color[][] = [[], []];
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < WEIGHT_VALS; i++) {
      const col: Color = [0, 0, 0, 255];
      for (let c = 0; c < COMPS; c++) {
        col[c] = bc7Interp(
          endpoints[s * 2 + 0]![c]!,
          endpoints[s * 2 + 1]![c]!,
          i,
          WEIGHT_BITS,
        );
      }
      // COMPS==3 -> alpha stays 255; COMPS==4 -> alpha set in the loop above.
      blockColors[s]!.push(col);
    }
  }

  for (let i = 0; i < 16; i++) {
    const col = blockColors[g_bc7_partition2[part * 16 + i]!]![weights[i]!]!;
    out[i * 4] = col[0];
    out[i * 4 + 1] = col[1];
    out[i * 4 + 2] = col[2];
    out[i * 4 + 3] = col[3];
  }
}

/** unpack_bc7_mode4_5: 1-subset dual-plane modes 4 and 5 (separate color/alpha index planes). */
function unpackMode4_5(
  mode: number,
  low: bigint,
  high: bigint,
  out: Uint8Array,
): void {
  const ENDPOINTS = 2;
  const WEIGHT_BITS = 2;
  const WEIGHT_MASK = (1 << WEIGHT_BITS) - 1;
  const A_WEIGHT_BITS = mode === 4 ? 3 : 2;
  const A_WEIGHT_MASK = (1 << A_WEIGHT_BITS) - 1;
  const ENDPOINT_BITS = mode === 4 ? 5 : 7;
  const ENDPOINT_MASK = BigInt((1 << ENDPOINT_BITS) - 1);
  const A_ENDPOINT_BITS = mode === 4 ? 6 : 8;
  const A_ENDPOINT_MASK = BigInt((1 << A_ENDPOINT_BITS) - 1);

  const compRot = Number((low >> BigInt(mode + 1)) & 0x3n);
  const indexMode = mode === 4 ? Number((low >> 7n) & 1n) : 0;

  let colorReadBits = low >> 8n;

  const endpoints = newEndpoints(ENDPOINTS);
  for (let c = 0; c < 3; c++) {
    for (let e = 0; e < ENDPOINTS; e++) {
      endpoints[e]![c] = Number(colorReadBits & ENDPOINT_MASK);
      colorReadBits >>= BigInt(ENDPOINT_BITS);
    }
  }

  // endpoints[0][3] is read then immediately overwritten by the mode branch (faithful to source).
  let rgbWeightsChunk: bigint;
  let aWeightsChunk: bigint;
  if (mode === 4) {
    endpoints[0]![3] = Number(colorReadBits & A_ENDPOINT_MASK);
    endpoints[1]![3] = Number(
      (colorReadBits >> BigInt(A_ENDPOINT_BITS)) & A_ENDPOINT_MASK,
    );
    rgbWeightsChunk = (low >> 50n) | (high << 14n);
    aWeightsChunk = high >> 17n;
  } else {
    endpoints[0]![3] = Number(colorReadBits & A_ENDPOINT_MASK);
    endpoints[1]![3] = Number(((low >> 58n) | (high << 6n)) & A_ENDPOINT_MASK);
    rgbWeightsChunk = high >> 2n;
    aWeightsChunk = high >> 33n;
  }

  rgbWeightsChunk = insertWeightZero(rgbWeightsChunk, WEIGHT_BITS, 0);
  aWeightsChunk = insertWeightZero(aWeightsChunk, A_WEIGHT_BITS, 0);

  const weightBits = [
    indexMode ? A_WEIGHT_BITS : WEIGHT_BITS,
    indexMode ? WEIGHT_BITS : A_WEIGHT_BITS,
  ];
  const weightMask = [
    indexMode ? A_WEIGHT_MASK : WEIGHT_MASK,
    indexMode ? WEIGHT_MASK : A_WEIGHT_MASK,
  ];

  if (indexMode) {
    const tmp = rgbWeightsChunk;
    rgbWeightsChunk = aWeightsChunk;
    aWeightsChunk = tmp;
  }

  const weights: number[] = [];
  for (let i = 0; i < 16; i++) {
    weights.push(Number(rgbWeightsChunk & BigInt(weightMask[0]!)));
    rgbWeightsChunk >>= BigInt(weightBits[0]!);
  }
  const aWeights: number[] = [];
  for (let i = 0; i < 16; i++) {
    aWeights.push(Number(aWeightsChunk & BigInt(weightMask[1]!)));
    aWeightsChunk >>= BigInt(weightBits[1]!);
  }

  for (let e = 0; e < ENDPOINTS; e++) {
    for (let c = 0; c < 4; c++) {
      endpoints[e]![c] = bc7Dequant(
        endpoints[e]![c]!,
        c === 3 ? A_ENDPOINT_BITS : ENDPOINT_BITS,
      );
    }
  }

  const blockColors: Color[] = [];
  for (let i = 0; i < 8; i++) blockColors.push([0, 0, 0, 0]);
  for (let i = 0; i < 1 << weightBits[0]!; i++) {
    for (let c = 0; c < 3; c++) {
      blockColors[i]![c] = bc7Interp(
        endpoints[0]![c]!,
        endpoints[1]![c]!,
        i,
        weightBits[0]!,
      );
    }
  }
  for (let i = 0; i < 1 << weightBits[1]!; i++) {
    blockColors[i]![3] = bc7Interp(
      endpoints[0]![3]!,
      endpoints[1]![3]!,
      i,
      weightBits[1]!,
    );
  }

  for (let i = 0; i < 16; i++) {
    const rgb = blockColors[weights[i]!]!;
    const px: Color = [rgb[0], rgb[1], rgb[2], blockColors[aWeights[i]!]![3]!];
    if (compRot >= 1) {
      const tmp = px[3];
      px[3] = px[compRot - 1]!;
      px[compRot - 1] = tmp;
    }
    out[i * 4] = px[0];
    out[i * 4 + 1] = px[1];
    out[i * 4 + 2] = px[2];
    out[i * 4 + 3] = px[3];
  }
}

/** unpack_bc7_mode6: 1-subset, 4-bit index, single RGBA endpoint pair with per-endpoint p-bit. */
function unpackMode6(low: bigint, high: bigint, out: Uint8Array): void {
  const p0 = Number((low >> 63n) & 1n);
  const p1 = Number(high & 1n);

  const r0 = (Number((low >> 7n) & 0x7fn) << 1) | p0;
  const r1 = (Number((low >> 14n) & 0x7fn) << 1) | p1;
  const g0 = (Number((low >> 21n) & 0x7fn) << 1) | p0;
  const g1 = (Number((low >> 28n) & 0x7fn) << 1) | p1;
  const b0 = (Number((low >> 35n) & 0x7fn) << 1) | p0;
  const b1 = (Number((low >> 42n) & 0x7fn) << 1) | p1;
  const a0 = (Number((low >> 49n) & 0x7fn) << 1) | p0;
  const a1 = (Number((low >> 56n) & 0x7fn) << 1) | p1;

  const vals: Color[] = [];
  for (let i = 0; i < 16; i++) {
    const w = g_bc7_weights4[i]!;
    const iw = 64 - w;
    vals.push([
      (r0 * iw + r1 * w + 32) >> 6,
      (g0 * iw + g1 * w + 32) >> 6,
      (b0 * iw + b1 * w + 32) >> 6,
      (a0 * iw + a1 * w + 32) >> 6,
    ]);
  }

  // Index bits: texel 0 is 3 bits (anchor), texels 1-15 are 4 bits, starting at high-chunk bit 1.
  for (let i = 0; i < 16; i++) {
    const shift = i === 0 ? 1 : i * 4;
    const idx = Number((high >> BigInt(shift)) & (i === 0 ? 0x7n : 0xfn));
    const col = vals[idx]!;
    out[i * 4] = col[0];
    out[i * 4 + 1] = col[1];
    out[i * 4 + 2] = col[2];
    out[i * 4 + 3] = col[3];
  }
}

/** Reads bytes [off, off+8) little-endian into a BigInt (a uint64 chunk). */
function readChunk(src: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) v |= BigInt(src[off + i]!) << BigInt(i * 8);
  return v;
}

// Ports bc7decomp.cpp unpack_bc7: unpack one 16-byte BC7 block to 16 RGBA texels (pre-swap).
function decodeBc7Block(src: Uint8Array, offset: number): Uint8Array {
  const out = new Uint8Array(64);
  const first = src[offset]!;
  // Mode = position of the lowest set bit in byte 0 (unary prefix); byte 0 == 0 -> invalid (mode 8).
  // Equivalent to g_bc7_first_byte_to_mode[first].
  let mode = 8;
  for (let i = 0; i < 8; i++) {
    if ((first >> i) & 1) {
      mode = i;
      break;
    }
  }

  const low = readChunk(src, offset);
  const high = readChunk(src, offset + 8);

  switch (mode) {
    case 0:
    case 2:
      unpackMode0_2(mode, low, high, out);
      break;
    case 1:
    case 3:
    case 7:
      unpackMode1_3_7(mode, low, high, out);
      break;
    case 4:
    case 5:
      unpackMode4_5(mode, low, high, out);
      break;
    case 6:
      unpackMode6(low, high, out);
      break;
    default:
      // Invalid mode: zero-filled block (matches the reference memset).
      break;
  }
  return out;
}
