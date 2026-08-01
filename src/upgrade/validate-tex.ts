// Port of EndwalkerUpgrade.ValidateTexFileData (EndwalkerUpgrade.cs:2100-2129) — the load-time .tex
// repair TTMP.FixOldTexData (TTMP.cs:1413-1460) runs on every .tex of an old pack, called from
// WizardData.FromWizardGroup:705 (the /upgrade + /resave load path). Given the UNCOMPRESSED tex bytes,
// returns fixed bytes, or null when nothing changed. See
// docs/superpowers/specs/2026-07-25-validate-tex-load-seam-design.md.
import {
  assertTexHeaderWritable,
  fixUpBrokenMipOffsets,
  serializeTexHeader,
} from "../tex/header";
import { decodeToRgba, encodeUncompressedTex, parseTex } from "../tex/tex";
import { isPowerOfTwo, resizeForMerge, roundToPowerOfTwo } from "./texture";

export function validateTexFileData(
  uncompressedTex: Uint8Array,
): Uint8Array | null {
  const tex = parseTex(uncompressedTex);
  const npot = !isPowerOfTwo(tex.width) || !isPowerOfTwo(tex.height);

  // EndwalkerUpgrade.cs:2107 — (!IsPow2(W) || !IsPow2(H)) && MipCount > 1.
  if (npot && tex.mipCount > 1) {
    // EndwalkerUpgrade.cs:2110 — ResizeXivTx(tex, RoundToPowerOfTwo(Width), RoundToPowerOfTwo(WIDTH),
    // false): Width passed for BOTH dims (TexTools bug, docs/TEXTOOLS_BUGS.md #20). Reproduced.
    const round = roundToPowerOfTwo(tex.width);
    // resizeForMerge fires MergePixelData's two faithful guards (unsupported format, <64 non-BC7),
    // which at the load seam DROP the file. It succeeds for every format MergePixelData supports.
    const src = resizeForMerge(
      decodeToRgba(tex),
      tex.width,
      tex.height,
      round,
      round,
      tex.format,
    );
    // Emit the resized image as A8R8G8B8 for EVERY decodable format. A8R8G8B8 source → byte-exact
    // (MergePixelData maps it to lossless BGRA and ToUncompressedTex stores A8R8G8B8). A BC source →
    // TexTools re-encodes back to its ORIGINAL BC format via nvtt, which we have no encoder for, so
    // we diverge: same resized image, uncompressed instead of BC. This is the same MergePixelData
    // elision the material-round mask/index paths ship, a CONFIRMED divergence (design §3.4;
    // docs/backlog/2026-07-22-bc-encoder-merge-pixel-data.md; real pack KK_Sportcar reaches it).
    return encodeUncompressedTex(src.rgba, src.width, src.height, {
      mips: true,
    });
  }

  // Branch B — EndwalkerUpgrade.cs:2116-2124. Fix broken mip offsets; rebuild only if something moved.
  const fix = fixUpBrokenMipOffsets(tex, uncompressedTex.length);
  if (fix.headerChanged || fix.calculatedTexSize !== uncompressedTex.length) {
    assertTexHeaderWritable(tex); // header.ToBytes() guard (Tex.cs:138-145); throw → drop at the seam
    // Array.Copy(uncompressedTex, 80, newData, 80, CalculatedTexSize-80) throws on a source overrun
    // (EndwalkerUpgrade.cs:2122) — a truncated/corrupt tex whose computed mip0 exceeds the file. That
    // throw is caught by FromWizardGroup's catch → the file is dropped. Reproduce it (a bare subarray
    // would silently zero-pad and KEEP a corrupt tex — a silent divergence).
    if (fix.calculatedTexSize > uncompressedTex.length) {
      throw new Error(
        "validateTexFileData: calculated tex size exceeds file length",
      );
    }
    const out = new Uint8Array(fix.calculatedTexSize);
    out.set(serializeTexHeader(tex), 0); // ORIGINAL mipCount + FIXED offset/lod tables (struct-copy quirk)
    out.set(uncompressedTex.subarray(80, fix.calculatedTexSize), 80);
    return out;
  }
  return null;
}
