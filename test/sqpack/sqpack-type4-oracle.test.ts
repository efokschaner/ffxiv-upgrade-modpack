import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { parseTex } from "../../src/tex/tex";
import { A8R8G8B8 } from "../../src/tex/types";
import { bytesEqual } from "../helpers/compare";

// Validates our Type-4 (texture) SQPack DECODER against Square Enix's real Type-4 COMPRESSOR output.
// The golden pair is committed (see fixtures/regen.ts + fixtures/README.md): type4-sample.bin is a
// ConsoleTools `/wrap … /sqpack` of the synthetic uncompressed type4-sample.tex. No game and no
// ConsoleTools at test time — the old version extracted a game texture and re-wrapped it live.
//
// Unique coverage: the corpus `/unwrap` oracle does NOT decompress Type 4 (corpus-sqpack.ts), so the
// corpus only self-round-trips Type-4 entries against our own encoder. This is the only check of our
// Type-4 decode against genuine SE-compressed bytes.
const DIR = join(__dirname, "fixtures");
const raw = new Uint8Array(readFileSync(join(DIR, "type4-sample.tex")));
const entry = new Uint8Array(readFileSync(join(DIR, "type4-sample.bin")));

describe("sqpack Type 4 texture decode (SE /wrap golden)", () => {
  it("decodes an SE-compressed Type-4 entry byte-exact to the original tex", () => {
    const decoded = decodeSqPackFile(entry);
    expect(decoded.type).toBe(SqPackType.Texture);
    expect(bytesEqual(decoded.data, raw)).toBe(true);
  });

  it("the decoded bytes parse as the expected A8R8G8B8 multi-mip tex", () => {
    const tex = parseTex(decodeSqPackFile(entry).data);
    expect(tex.format).toBe(A8R8G8B8);
    expect(tex.width).toBe(64);
    expect(tex.height).toBe(64);
    expect(tex.mipCount).toBe(6); // 64,32,16,8,4,2 — matches the committed golden
  });
});
