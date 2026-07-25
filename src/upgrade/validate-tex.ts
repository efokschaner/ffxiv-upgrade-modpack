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
import { isCompressed, texFormatName } from "../tex/types";
import { isPowerOfTwo, resizeForMerge, roundToPowerOfTwo } from "./texture";

/** Branch A on a BC-compressed source needs Tex.MergePixelData's nvtt re-encode back to the original
 *  BC format, which we have no port of (no BC encoder in the repo). Thrown so the load-fix caller can
 *  FAIL LOUD instead of silently dropping (a faithful drop) or emitting a wrong-format A8R8G8B8 file.
 *  Latent — needs an old-version TTMP with a BC NPOT-with-mips tex; no corpus pack reaches it. Gated
 *  behind docs/backlog/2026-07-22-bc-encoder-merge-pixel-data.md. Design §3.4. */
export class UnportedBcReencode extends Error {}

export function validateTexFileData(
  uncompressedTex: Uint8Array,
): Uint8Array | null {
  const tex = parseTex(uncompressedTex);
  const npot = !isPowerOfTwo(tex.width) || !isPowerOfTwo(tex.height);

  // EndwalkerUpgrade.cs:2107 — (!IsPow2(W) || !IsPow2(H)) && MipCount > 1.
  if (npot && tex.mipCount > 1) {
    // EndwalkerUpgrade.cs:2110 — ResizeXivTx(tex, RoundToPowerOfTwo(Width), RoundToPowerOfTwo(WIDTH),
    // false): Width is passed for BOTH dimensions (TexTools bug, docs/TEXTOOLS_BUGS.md). Reproduced.
    const round = roundToPowerOfTwo(tex.width);
    // resizeForMerge fires MergePixelData's two faithful guards (unsupported format, <64 non-BC7),
    // which at THIS seam drop the file (FromWizardGroup catch). It succeeds only for a format
    // MergePixelData supports; the compressed subset of those we still cannot re-encode → fail loud.
    const src = resizeForMerge(
      decodeToRgba(tex),
      tex.width,
      tex.height,
      round,
      round,
      tex.format,
    );
    if (isCompressed(tex.format)) {
      throw new UnportedBcReencode(
        `validateTexFileData: BC re-encode unported for format ${texFormatName(tex.format)}`,
      );
    }
    // A8R8G8B8 (the only uncompressed format MergePixelData accepts) → lossless BGRA round-trip →
    // ToUncompressedTex yields the same bytes our uncompressed encoder produces. Byte-exact.
    return encodeUncompressedTex(src.rgba, src.width, src.height, {
      mips: true,
    });
  }

  // Branch B — EndwalkerUpgrade.cs:2116-2124. Fix broken mip offsets; rebuild only if something moved.
  const fix = fixUpBrokenMipOffsets(tex, uncompressedTex.length);
  if (fix.headerChanged || fix.calculatedTexSize !== uncompressedTex.length) {
    assertTexHeaderWritable(tex); // header.ToBytes() guard (Tex.cs:138-145); throw → drop at the seam
    const out = new Uint8Array(fix.calculatedTexSize);
    out.set(serializeTexHeader(tex), 0); // ORIGINAL mipCount + FIXED offset/lod tables (struct-copy quirk)
    out.set(uncompressedTex.subarray(80, fix.calculatedTexSize), 80);
    return out;
  }
  return null;
}
