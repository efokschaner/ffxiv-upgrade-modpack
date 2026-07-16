import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
} from "../../src/model/modpack";
import { encodeType4, texMipSizes } from "../../src/sqpack/type4";
import { needsTexFix, texFixRound } from "../../src/upgrade/texfix";
import { filesMap } from "../helpers/make-packs";

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

function packWithFiles(
  version: string | undefined,
  files: Array<[string, ModpackFile]>,
): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: false,
    meta: baseMeta(version),
    groups: [
      {
        name: "G",
        description: "",
        image: "",
        page: 0,
        priority: 0,
        selectionType: "Single",
        defaultSettings: 0,
        options: [
          {
            name: "O",
            description: "",
            image: "",
            priority: 0,
            fileSwaps: {},
            manipulations: [],
            files: filesMap(files),
          },
        ],
      },
    ],
  };
}

describe("texFixRound", () => {
  it("drops a malformed compressed .tex, keeps a valid one, keeps a malformed ui/ .tex, keeps a non-.tex file", () => {
    const data = packWithFiles(undefined, [
      [
        "chara/x/tex/malformed_n.tex",
        {
          data: malformedTexEntry(),
          storage: FileStorageType.SqPackCompressed,
        },
      ],
      [
        "chara/x/tex/valid_n.tex",
        { data: validTexEntry(), storage: FileStorageType.SqPackCompressed },
      ],
      [
        "ui/uld/malformed.tex",
        {
          data: malformedTexEntry(),
          storage: FileStorageType.SqPackCompressed,
        },
      ],
      [
        "chara/x/mat/foo.mtrl",
        {
          data: new Uint8Array([1, 2, 3]),
          storage: FileStorageType.SqPackCompressed,
        },
      ],
    ]);

    texFixRound(data);

    const paths = [...data.groups[0]!.options[0]!.files.keys()];
    expect(paths).not.toContain("chara/x/tex/malformed_n.tex");
    expect(paths).toContain("chara/x/tex/valid_n.tex");
    expect(paths).toContain("ui/uld/malformed.tex");
    expect(paths).toContain("chara/x/mat/foo.mtrl");
  });

  it("drops nothing when needsTexFix is false, even if a compressed .tex is malformed", () => {
    const data = packWithFiles("2.1s", [
      [
        "chara/x/tex/malformed_n.tex",
        {
          data: malformedTexEntry(),
          storage: FileStorageType.SqPackCompressed,
        },
      ],
    ]);

    texFixRound(data);

    const paths = [...data.groups[0]!.options[0]!.files.keys()];
    expect(paths).toContain("chara/x/tex/malformed_n.tex");
  });
});
