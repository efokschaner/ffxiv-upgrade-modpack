import { describe, expect, it } from "vitest";
import { encodeUncompressedTex, parseTex } from "../../src/tex/tex";
import { A8R8G8B8 } from "../../src/tex/types";
import { validateTexFileData } from "../../src/upgrade/validate-tex";
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

  it("Branch A: BC source produces a valid A8R8G8B8 tex (confirmed divergence, no abort)", () => {
    // 96x96 DXT5, NPOT, 2 mips → rounds to 64x64 (width-for-both bug). We have no BC encoder, so we
    // emit the resized image as A8R8G8B8 rather than re-encoding to DXT5 (design §3.4). Byte parity
    // with the golden is confirmed separately by a DIVERGENCE_RULES entry over the real KK_Sportcar
    // pack; here we assert we produce a structurally valid resized A8R8G8B8 tex, not an abort.
    const out = validateTexFileData(makeSolidDxt5Tex(96, 96));
    expect(out).not.toBeNull();
    const tex = parseTex(out!);
    expect(tex.format).toBe(A8R8G8B8);
    expect(tex.width).toBe(64);
    expect(tex.height).toBe(64);
  });

  it("Branch A: BC source rounding below 64 drops via the size guard", () => {
    // 48x96 DXT5, NPOT, 2 mips. validateTexFileData rounds WIDTH (48 → 32) for both dims, so the
    // target is 32x32 (<64). resizeForMerge's own "too small" guard fires — a faithful DROP at the
    // load seam.
    const dxt5 = makeSolidDxt5Tex(48, 96);
    expect(() => validateTexFileData(dxt5)).toThrow(
      "Image is too small for DDS Compressor. (64x64 Minimum Size)",
    );
  });

  it("Branch B: a mipCount==2 tex with a broken offset throws the ToBytes ordering guard (TEXTOOLS_BUGS #19)", () => {
    // A 4x4 A8R8G8B8 tex has exactly 2 mips (generateMipmaps' 2x2 floor), so buildCanonicalTexHeader
    // emits the non-monotonic LoDMips=[0,1,0]. Branch B's rewrite calls assertTexHeaderWritable
    // (= TexHeader.ToBytes' guard), which throws — reproducing the TexTools crash faithfully. At the
    // load seam this becomes a faithful drop. Pins that we keep reproducing #19.
    const src = encodeUncompressedTex(solidRgba(4, 4), 4, 4, { mips: true });
    const broken = src.slice();
    new DataView(broken.buffer, broken.byteOffset).setUint32(28, 999, true);
    expect(() => validateTexFileData(broken)).toThrow(
      "LoDMips is not in non-descending order.",
    );
  });

  it("Branch B: a POT tex with a broken first offset is rewritten, not resized", () => {
    // 16x16 (not 4x4/mipCount=2): a canonical mipCount=2 A8R8G8B8 header has LoDMips=[0,1,0]
    // (CreateTexFileHeader, Tex.cs:1124-1126 — LoD2 stays 0 unless mipCount>2), which is
    // non-monotonic and trips assertTexHeaderWritable's ordering guard (Tex.cs:138 *pre-fix*, deleted by 1993bf6) the moment this
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

  it("Branch B: a tex truncated below its computed mip0 size throws (dropped at the load seam)", () => {
    // 16x16 A8R8G8B8, mipCount=4, canonical LoDMips=[0,1,2] (monotonic — doesn't trip #19), so this
    // reaches assertTexHeaderWritable without throwing and lands on the new overrun guard. Truncate
    // the file to 580 bytes: well past the 80-byte header but short of 80 + mip0's 1024-byte size
    // (16*16*4). fixUpBrokenMipOffsets ALWAYS accounts mip0's full computed size into
    // calculatedTexSize (Tex.cs:159-234 / header.ts:120-122) even though it doesn't fit the
    // truncated file — mip1 then fails the `mipOffset + mipSize > texSizeIncludingHeader` check
    // immediately, so recomputed mipCount(1) != original(4) and headerChanged is forced true, taking
    // the rewrite path. calculatedTexSize (1104) > file length (580): the C# Array.Copy this ports
    // (EndwalkerUpgrade.cs:2122) throws ArgumentException on that source overrun, which
    // WizardData.FromWizardGroup's surrounding try/catch (WizardData.cs:709-718) swallows and
    // `continue`s past — the corrupt/truncated file is silently DROPPED from the upgraded pack, not
    // kept zero-padded. We reproduce the throw so callers at the load seam can drop it the same way.
    const src = encodeUncompressedTex(solidRgba(16, 16), 16, 16, {
      mips: true,
    });
    const truncated = src.subarray(0, 580);
    expect(() => validateTexFileData(truncated)).toThrow("exceeds file length");
  });
});
