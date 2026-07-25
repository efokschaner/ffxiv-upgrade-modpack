import { describe, expect, it } from "vitest";
import { encodeUncompressedTex, parseTex } from "../../src/tex/tex";
import {
  UnportedBcReencode,
  validateTexFileData,
} from "../../src/upgrade/validate-tex";
import { makeSolidDxt5Tex } from "../tex/tex-fixtures";

function solidRgba(w: number, h: number): Uint8Array {
  const a = new Uint8Array(w * h * 4);
  for (let i = 0; i < a.length; i += 4) {
    a[i] = 10;
    a[i + 1] = 20;
    a[i + 2] = 30;
    a[i + 3] = 255;
  }
  return a;
}

describe("validateTexFileData", () => {
  it("Branch A: reproduces the Width-for-both-dims bug (96x192 A8R8G8B8 → 64x64, not 64x128)", () => {
    // NPOT-with-mips. roundToPowerOfTwo(96)=64, roundToPowerOfTwo(192)=128 (both ties→floor). The bug
    // passes round(WIDTH)=64 as the height too, so a faithful port yields a SQUARE 64x64; a corrected
    // impl would yield 64x128. Asserting 64x64 pins the reproduced bug.
    const src = encodeUncompressedTex(solidRgba(96, 192), 96, 192, {
      mips: true,
    });
    const out = validateTexFileData(src);
    expect(out).not.toBeNull();
    const tex = parseTex(out!);
    expect(tex.width).toBe(64);
    expect(tex.height).toBe(64);
  });

  it("Branch A: BC source throws UnportedBcReencode", () => {
    // 96x96 DXT5, NPOT, 2 mips; rounds to 64x64 (>=64, so it clears the <64 drop guard and reaches
    // the BC-abort). resizeForMerge decodes+resizes, then the compressed-format check fails loud.
    const dxt5 = makeSolidDxt5Tex(96, 96);
    expect(() => validateTexFileData(dxt5)).toThrow(UnportedBcReencode);
  });

  it("Branch B: a POT tex with a broken first offset is rewritten, not resized", () => {
    // 16x16 (not 4x4/mipCount=2): a canonical mipCount=2 A8R8G8B8 header has LoDMips=[0,1,0]
    // (CreateTexFileHeader, Tex.cs:1125-1127 — LoD2 stays 0 unless mipCount>2), which is
    // non-monotonic and trips assertTexHeaderWritable's ordering guard (Tex.cs:138) the moment this
    // path needs to rewrite the header — a genuine TexTools defect, not a fixture mistake; see
    // docs/TEXTOOLS_BUGS.md #19. 16x16 (mipCount=4) keeps LoDMips=[0,1,2], avoiding the crash while
    // still exercising the same offset-rewrite behaviour.
    const src = encodeUncompressedTex(solidRgba(16, 16), 16, 16, {
      mips: true,
    });
    const broken = src.slice();
    new DataView(broken.buffer, broken.byteOffset).setUint32(28, 999, true); // clobber mip0 offset
    const out = validateTexFileData(broken);
    expect(out).not.toBeNull();
    expect(new DataView(out!.buffer, out!.byteOffset).getUint32(28, true)).toBe(
      80,
    );
  });

  it("Branch B: an already-correct tex returns null (no change)", () => {
    const src = encodeUncompressedTex(solidRgba(8, 8), 8, 8, { mips: true });
    expect(validateTexFileData(src)).toBeNull();
  });
});
