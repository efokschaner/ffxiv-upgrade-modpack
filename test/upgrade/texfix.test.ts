import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
  type SqPackCompressedFile,
} from "../../src/model/modpack";
import { encodeType4, texMipSizes } from "../../src/sqpack/type4";
import { makeTtmpLoadFix } from "../../src/upgrade/load-fixes";
import { needsTexFix, ttmpNeedsTexFix } from "../../src/upgrade/texfix";

const TEX_HEADER_SIZE = 80;
const BC5 = 25136; // 8 bpp, min dimension 4

// Mirrors test/sqpack/sqpack-type4.test.ts's makeUncompressedTex: a minimal but valid
// uncompressed .tex (80-byte header + mip pixels), used here to build a compressed
// Type-4 entry via encodeType4.
function makeUncompressedTex(
  width: number,
  height: number,
  mipCount: number,
): Uint8Array {
  const sizes = texMipSizes(BC5, width, height).slice(0, mipCount);
  const total = sizes.reduce((a, b) => a + b, 0);
  const buf = new Uint8Array(TEX_HEADER_SIZE + total);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0, true); // attributes
  dv.setUint32(4, BC5, true); // texture format
  dv.setUint16(8, width, true);
  dv.setUint16(10, height, true);
  dv.setUint16(12, 1, true); // depth
  buf[14] = mipCount & 0xf; // mip count (low nibble)
  for (let i = TEX_HEADER_SIZE; i < buf.length; i++)
    buf[i] = (i * 17 + 3) & 0xff;
  return buf;
}

/** A valid compressed Type-4 .tex entry (unpatched). */
function validTexEntry(): Uint8Array {
  return encodeType4(makeUncompressedTex(16, 16, 1));
}

/**
 * A malformed compressed Type-4 .tex entry: patches the SQPack header's
 * uncompressedFileSize field (3rd int32, bytes [8..12)) to 16, which is smaller than
 * the 80-byte tex header. Mirrors the same patch used in
 * test/sqpack/sqpack-type4.test.ts to make decodeType4 throw (Dat.cs:908-909).
 */
function malformedTexEntry(): Uint8Array {
  const entry = validTexEntry().slice();
  new DataView(entry.buffer, entry.byteOffset).setInt32(8, 16, true);
  return entry;
}

function sqpackFile(data: Uint8Array): SqPackCompressedFile {
  return { data, storage: FileStorageType.SqPackCompressed };
}

function baseMeta(version: string | undefined) {
  return {
    name: "M",
    author: "A",
    version: "1",
    description: "",
    url: "",
    image: "",
    tags: ["t"],
    minimumFrameworkVersion: "1.0.0.0",
    sourceTtmpVersion: version,
  };
}

function packWithVersion(
  version: string | undefined,
  format: ModpackFormat = ModpackFormat.Ttmp2,
): ModpackData {
  return {
    sourceFormat: format,
    isSimple: false,
    meta: baseMeta(version),
    groups: [],
  };
}

describe("ttmpNeedsTexFix (pure version gate)", () => {
  it("is true for major < 2 and for exactly 2.0; false above", () => {
    expect(ttmpNeedsTexFix("1.3w")).toBe(true);
    expect(ttmpNeedsTexFix(undefined)).toBe(true); // treated as 0.0
    expect(ttmpNeedsTexFix("2.0")).toBe(true);
    expect(ttmpNeedsTexFix("2.1s")).toBe(false);
    expect(ttmpNeedsTexFix("3.0")).toBe(false);
  });
});

describe("needsTexFix", () => {
  it("is true for a TTMP pack with sourceTtmpVersion '1.3w' (major < 2)", () => {
    expect(needsTexFix(packWithVersion("1.3w"))).toBe(true);
  });

  it("is true for a TTMP pack with sourceTtmpVersion undefined (treated as 0.0)", () => {
    expect(needsTexFix(packWithVersion(undefined))).toBe(true);
  });

  it("is true for a TTMP pack with sourceTtmpVersion '2.0' (major==2, minor==0)", () => {
    expect(needsTexFix(packWithVersion("2.0"))).toBe(true);
  });

  it("is false for a TTMP pack with sourceTtmpVersion '2.1s' (major==2, minor==1)", () => {
    expect(needsTexFix(packWithVersion("2.1s"))).toBe(false);
  });

  it("is false for a TTMP pack with sourceTtmpVersion '3.0' (major 3 (>2) → no fix; only major<2 or exactly 2.0 qualify)", () => {
    expect(needsTexFix(packWithVersion("3.0"))).toBe(false);
  });

  it("is false for a Pmp pack regardless of version", () => {
    expect(needsTexFix(packWithVersion("1.3w", ModpackFormat.Pmp))).toBe(false);
    expect(needsTexFix(packWithVersion(undefined, ModpackFormat.Pmp))).toBe(
      false,
    );
  });

  it("is false for a PmpFolder pack regardless of version", () => {
    expect(needsTexFix(packWithVersion("1.3w", ModpackFormat.PmpFolder))).toBe(
      false,
    );
  });
});

// The per-.tex validity-check DROP that used to be `texFixRound` now lives in makeTtmpLoadFix's
// `.tex` branch (FromWizardGroup fix-before-collapse, WizardData.cs:701-712). Drive it directly.
describe("makeTtmpLoadFix (.tex validity-check drop)", () => {
  const fix = makeTtmpLoadFix({ needsTexFix: true, needsMdlFix: false });

  it("drops a malformed compressed .tex (returns null)", () => {
    expect(
      fix("chara/x/tex/malformed_n.tex", sqpackFile(malformedTexEntry())),
    ).toBeNull();
  });

  it("keeps a valid .tex, bytes unchanged (validity check only)", () => {
    const valid = validTexEntry();
    const kept = fix("chara/x/tex/valid_n.tex", sqpackFile(valid));
    expect(kept).not.toBeNull();
    expect(Array.from(kept!.data)).toEqual(Array.from(valid));
  });

  it("keeps a malformed ui/ .tex (ui/ excluded, MakeFileStorageInformationDictionary TTMP.cs:1367)", () => {
    const malformed = malformedTexEntry();
    const kept = fix("ui/uld/malformed.tex", sqpackFile(malformed));
    expect(kept).not.toBeNull();
    expect(Array.from(kept!.data)).toEqual(Array.from(malformed));
  });

  it("leaves a non-.tex file untouched", () => {
    const f = sqpackFile(new Uint8Array([1, 2, 3]));
    expect(fix("chara/x/mat/foo.mtrl", f)).toBe(f);
  });

  it("does not drop anything when needsTexFix is false, even a malformed .tex", () => {
    const noFix = makeTtmpLoadFix({ needsTexFix: false, needsMdlFix: false });
    const f = sqpackFile(malformedTexEntry());
    expect(noFix("chara/x/tex/malformed_n.tex", f)).toBe(f);
  });
});
