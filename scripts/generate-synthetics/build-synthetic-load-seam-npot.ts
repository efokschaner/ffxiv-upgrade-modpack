// Builds test/corpus/synthetic/load-seam-npot.ttmp2 — the /upgrade golden for Branch A of
// EndwalkerUpgrade.ValidateTexFileData (EndwalkerUpgrade.cs:2107-2113), the load-time NPOT resize.
// Deferred from docs/superpowers/specs/2026-07-25-validate-tex-load-seam-design.md §6.1, whose
// coverage until now was a hand-computed unit test plus one real pack (KK_Sportcar) that reaches the
// branch only on a BC source, where our output is a confirmed divergence rather than a match.
//
// The fixture is 96x192 A8R8G8B8 with two mips. Three things follow, and each is load-bearing:
//   - NPOT with MipCount > 1 is the branch gate (:2107). One mip would fall through to Branch B.
//   - RoundToPowerOfTwo(96) = 64: floor 64 and ceil 128 are equidistant and ties go to the FLOOR
//     (IOUtil.cs:905-930). TexTools then passes WIDTH for BOTH dimensions (:2110), so a 96x192
//     source becomes 64x64 rather than 64x128 — that is registered bug #20, and this pack is its
//     first real-oracle proof.
//   - 64 is exactly the floor of MergePixelData's own size guard (`< 64`, Tex.cs:655-659), so the
//     resize proceeds instead of dropping the file. Choosing a narrower source would test the guard,
//     not the resize; npot-guards.ttmp2 already covers that.
// A8R8G8B8 maps to CompressionFormat.BGRA (Tex.cs:718-747), so the MergePixelData round-trip we
// elide is lossless — but that turned out to bound only mip0, not the whole payload. See the
// "NOT byte-exact" note below, an empirical finding this pack exists to surface.
//
// TTMPVersion "2.0w" gates the load fix on; the .mtrl + power-of-two normal/mask triple forces
// AnyChanges so ConsoleTools actually writes a pack. See build-synthetic-load-seam-mipfix.ts's
// header for why both are necessary — in particular why "2.0" (no suffix) is NOT usable: TTMP.cs ·
// GetModpackType · 165-172 classifies purely by suffix and falls through to EModpackType.Invalid
// without one, which NREs the oracle via WizardData.FromModpack returning null. "2.0w" keeps the
// NeedsTexFix-only gate of DoesModpackNeedFix (TTMP.cs:918-932, major==2 && minor==0) while still
// classifying as TtmpWizard.
//
// ---------------------------------------------------------------------------------------------
// NOT byte-exact — a genuine, previously-unknown divergence this pack's first real-oracle run
// uncovered (2026-08-09), separate from and in ADDITION to the expected ModsJsons re-derivation
// gap below.
// ---------------------------------------------------------------------------------------------
// The 64x64 dimension bug (#20) IS confirmed byte-for-byte: golden bytes 8-11 read 64/64, and
// the resized mip0 (the first 16384 bytes of pixel data) is byte-IDENTICAL to the golden's —
// resizeBicubic's 96x192->64x64 resample is exact. But the header's MipCount differs: ours is 6,
// the golden's is 7, and pixel data diverges starting exactly at the mip0/mip1 boundary (byte
// offset 16384 into the payload). The golden is 4 bytes longer than ours — one more 1x1 mip level
// (64*4/2^12 = 1 byte... concretely 1*1*4 = 4 bytes) that our output lacks entirely.
//
// Root cause, traced through the C# rather than guessed: ValidateTexFileData's Branch A
// (EndwalkerUpgrade.cs:2109-2112) calls `tex.ToUncompressedTex()` DIRECTLY on the ResizeXivTx
// result — there is no subsequent ConvertToDDS call, unlike the OTHER three ResizeXivTx sites
// (CreateIndexFromNormal :1105-1112, UpgradeMaskTex :2094, UpdateEndwalkerHairTextures :1213/1222)
// where ResizeXivTx is only an NPOT-normalizing PRE-STEP and the actual final encode is a later,
// separate `Tex.ConvertToDDS(byte[], ..., allowFast8888: true)` call that takes the
// `CreateFast8888DDS` fast path for A8R8G8B8 (Tex.cs:772-774) — the "stop at a 2px floor" filter
// `src/tex/encode.ts`'s `generateMipmaps` faithfully ports and cites in its own header comment.
// Branch A has no such second call: `ResizeXivTx` -> `MergePixelData` (Tex.cs:636-705) IS the
// final encode, and MergePixelData sets `tex.MipMapCount = GetMipCount(tex.Width, tex.Height)`
// (Tex.cs:702-714), `GetMipCount(largestSize) = floor(log2(largestSize) + 1)` — a FULL pyramid
// down to 1x1 (7 levels for a 64 source), fed by nvtt's real Compressor mip generation, not
// CreateFast8888DDS's decimation. `src/upgrade/validate-tex.ts`'s `validateTexFileData` calls
// `encodeUncompressedTex(..., { mips: true })` — the CreateFast8888DDS-style mip chain — for this
// call site too, which is the wrong algorithm for what Branch A's C# actually does. That mismatch
// is invisible on `test/upgrade/validate-tex.test.ts`'s existing unit tests (they assert only
// width/height, never mip count or mip payload bytes) and was never exercised against a real
// oracle before this pack — exactly the gap this task exists to close.
//
// NOT fixed here: fixing it needs either a real nvtt-compatible box/mip filter for this call site
// (unclear whether `generateMipmaps`'s "top-left texel" decimation happens to already match
// nvtt's non-BC mip filter for mip1..mip5, since only the mip0/mip1 boundary was probed) or a
// second, `GetMipCount`-shaped variant of the encode used ONLY by validateTexFileData. Left for a
// follow-up; this pack's /upgrade and /resave golden checks are deliberately left red pending
// that fix, and must NOT be baselined over — a baseline entry would permanently launder a real,
// previously-unknown port bug rather than track a documented, accepted divergence. See
// docs/superpowers/sdd/2026-08-09-textools-repin-part-b/task-5-report.md for the full
// investigation (byte offsets, header hex dumps, C# citations).
//
// Per docs/backlog/2026-07-13-resave-ttmp2-name-category.md, this pack's /upgrade and /resave
// golden checks ALSO come back red on ModsJsons[].{Name,Category,DatFile} — the same pre-existing
// writer gap every other real-golden .ttmp2 synthetic hits (see build-synthetic-load-seam-mipfix.ts's
// header and npot-mask-a8's/imc-weapon's baseline entries). That part alone would be an expected,
// poolable red; the mip-chain divergence above is not, and is why this pack's golden checks stay
// unblessed.

import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";
import { buildEwColorsetMaskMtrl } from "./synthetic-mtrl";
import { writeTtmp2Files } from "./ttmp2-builder";

const MTRL = "chara/equipment/e9997/material/v0001/mt_c9997e9997_top_a.mtrl";
const NORMAL = "chara/equipment/e9997/texture/c9997e9997_top_a_n.tex";
const MASK = "chara/equipment/e9997/texture/c9997e9997_top_a_m.tex";
const NPOT = "chara/equipment/e9997/texture/c9997e9997_top_b_d.tex";

/** Deterministic non-uniform bytes — a flat fill would hide a mis-sized copy. */
function pattern(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + 3) & 0xff;
  return out;
}

const POT = 64;
const potTex = concatBytes([
  buildCanonicalTexHeader(A8R8G8B8, POT, POT, 1),
  pattern(POT * POT * 4),
]);

// 96x192, two mips: mip0 = 96*192*4 = 73728, mip1 = 48*96*4 = 18432.
const NPOT_W = 96;
const NPOT_H = 192;
const npotTex = concatBytes([
  buildCanonicalTexHeader(A8R8G8B8, NPOT_W, NPOT_H, 2),
  pattern(NPOT_W * NPOT_H * 4 + (NPOT_W / 2) * (NPOT_H / 2) * 4),
]);

writeTtmp2Files(
  "load-seam-npot.ttmp2",
  "Load Seam NPOT Resize",
  [
    { gamePath: MTRL, data: buildEwColorsetMaskMtrl(NORMAL, MASK) },
    { gamePath: NORMAL, data: potTex },
    { gamePath: MASK, data: potTex },
    { gamePath: NPOT, data: npotTex },
  ],
  "synthetic",
  "2.0w",
);
