import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeToRgba } from "../src/tex/decode";
import { generateMipmaps } from "../src/tex/encode";
import { parseTex, serializeTex } from "../src/tex/tex";
import { texMipSizes } from "../src/tex/types";

const dir = join(__dirname, "fixtures");

// (a) Round-trip an extracted .tex if present.
const sample = join(dir, "sample.tex");
describe.skipIf(!existsSync(sample))("tex fixture round-trip", () => {
  it("self round-trips sample.tex byte-identical", () => {
    const bytes = new Uint8Array(readFileSync(sample));
    expect(serializeTex(parseTex(bytes))).toEqual(bytes);
  });
});

// (b) Nvtt mip-filter parity: feed an oracle-produced uncompressed multi-mip tex's TOP mip into our
// generateMipmaps and diff levels 1..N. Requires a captured A8R8G8B8 multi-mip tex from ConsoleTools
// (design spec §6, tier 2). Skips if absent.
const oracleMip = join(dir, "oracle-mips.tex");
describe.skipIf(!existsSync(oracleMip))("tex Nvtt mip-filter parity", () => {
  it("our box downsample matches the oracle's lower mips", () => {
    const bytes = new Uint8Array(readFileSync(oracleMip));
    const tex = parseTex(bytes);
    const topRgba = decodeToRgba({ ...tex, mipCount: 1 }); // decode mip 0 only
    const ours = generateMipmaps(topRgba, tex.width, tex.height);
    // Compare our mip level bytes (repacked B,G,R,A) against the oracle's stored mips.
    const sizes = texMipSizes(tex.format, tex.width, tex.height);
    let offset = sizes[0]!; // skip mip 0
    for (let level = 1; level < tex.mipCount; level++) {
      const oracleMipBytes = tex.mipData.slice(offset, offset + sizes[level]!);
      // Repack our RGBA level into A8R8G8B8 (B,G,R,A) for comparison.
      const oursLevel = ours[level]!;
      const repacked = new Uint8Array(oursLevel.length);
      for (let i = 0; i < oursLevel.length; i += 4) {
        repacked[i] = oursLevel[i + 2]!;
        repacked[i + 1] = oursLevel[i + 1]!;
        repacked[i + 2] = oursLevel[i]!;
        repacked[i + 3] = oursLevel[i + 3]!;
      }
      expect(Buffer.from(repacked).equals(Buffer.from(oracleMipBytes))).toBe(
        true,
      );
      offset += sizes[level]!;
    }
  });
});
