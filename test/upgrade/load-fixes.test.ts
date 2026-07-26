import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type SqPackCompressedFile,
} from "../../src/model/modpack";
import { encodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import { encodeUncompressedTex } from "../../src/tex/tex";
import { makeTtmpLoadFix } from "../../src/upgrade/load-fixes";
import { makeSolidDxt5Tex } from "../tex/tex-fixtures";

function texFile(bytes: Uint8Array): SqPackCompressedFile {
  return {
    storage: FileStorageType.SqPackCompressed,
    data: encodeSqPackFile(bytes, SqPackType.Texture),
  };
}
const fix = makeTtmpLoadFix({ needsTexFix: true, needsMdlFix: false });

describe("makeTtmpLoadFix .tex branch", () => {
  it("keeps and repairs a POT tex with a broken mip offset", () => {
    // 16x16 A8R8G8B8 (mipCount=4, monotonic LoDMips — avoids TEXTOOLS_BUGS #19); clobber mip0 offset.
    const good = encodeUncompressedTex(
      new Uint8Array(16 * 16 * 4).fill(200),
      16,
      16,
      { mips: true },
    );
    const broken = good.slice();
    new DataView(broken.buffer, broken.byteOffset).setUint32(28, 999, true);
    const out = fix("chara/x/v01_x.tex", texFile(broken));
    expect(out).not.toBeNull(); // repaired file kept, not dropped
  });

  it("drops a majorly-broken (undecodable) tex", () => {
    const junk: SqPackCompressedFile = {
      storage: FileStorageType.SqPackCompressed,
      data: new Uint8Array([1, 2, 3]),
    };
    expect(fix("chara/x/v01_x.tex", junk)).toBeNull();
  });

  it("keeps and produces A8R8G8B8 for a BC NPOT-with-mips source (confirmed divergence, no abort)", () => {
    // 96x96 DXT5 → Branch A → resized + re-encoded A8R8G8B8 (we have no BC encoder). The file is KEPT
    // (a confirmed divergence), not aborted. See design spec §3.4.
    const out = fix("chara/x/v01_x.tex", texFile(makeSolidDxt5Tex(96, 96)));
    expect(out).not.toBeNull();
  });

  it("leaves a ui/*.tex untouched (MakeFileStorageInformationDictionary carve-out)", () => {
    const t = texFile(
      encodeUncompressedTex(new Uint8Array(16 * 16 * 4).fill(1), 16, 16, {
        mips: true,
      }),
    );
    expect(fix("ui/icon/000001.tex", t)).toBe(t);
  });
});
