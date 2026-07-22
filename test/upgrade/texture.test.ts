import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackFile,
  type ModpackOption,
} from "../../src/model/modpack";
import { buildCanonicalTexHeader } from "../../src/tex/header";
import {
  createHairMaps,
  createIndexTexture,
  upgradeGearMask,
} from "../../src/tex/helpers";
import { resizeBicubic } from "../../src/tex/imagesharp/resample";
import {
  decodeToRgba,
  encodeUncompressedTex,
  parseTex,
} from "../../src/tex/tex";
import { BC7, DXT3 } from "../../src/tex/types";
import {
  createIndexFromNormal,
  updateEndwalkerHairTextures,
  upgradeMaskTex,
  upgradeRemainingTextures,
} from "../../src/upgrade/texture";
import {
  EUpgradeTextureUsage,
  type UpgradeInfo,
} from "../../src/upgrade/upgrade-info";
import { concatBytes } from "../../src/util/binary";

function a8r8g8b8Tex(
  width: number,
  height: number,
  rgba: Uint8Array,
): Uint8Array {
  return encodeUncompressedTex(rgba, width, height, { mips: false });
}

/** A .tex of `format` whose mip 0 is `blocks`, for exercising format/size branches that
 *  `a8r8g8b8Tex` cannot reach. Block sizes are the caller's responsibility. */
function rawTex(
  format: number,
  width: number,
  height: number,
  blocks: Uint8Array,
): Uint8Array {
  return concatBytes([
    buildCanonicalTexHeader(format, width, height, 1),
    blocks,
  ]);
}

describe("createIndexFromNormal", () => {
  it("produces an A8R8G8B8 index tex whose pixels match createIndexTexture", () => {
    const w = 2,
      h = 2;
    // Alpha values 0/17/34/255; RGB arbitrary.
    const rgba = new Uint8Array([
      1, 2, 3, 0, 4, 5, 6, 17, 7, 8, 9, 34, 10, 11, 12, 255,
    ]);
    const idxTex = createIndexFromNormal(a8r8g8b8Tex(w, h, rgba));
    const parsed = parseTex(idxTex);
    expect(parsed.width).toBe(w);
    expect(parsed.height).toBe(h);
    const got = decodeToRgba(parsed);
    const expected = createIndexTexture(rgba, w, h);
    expect(Array.from(got)).toEqual(Array.from(expected));
  });

  it("resizes an NPOT normal to its nearest pow2 size (EndwalkerUpgrade.cs:1096-1099)", () => {
    // 400 -> RoundToPowerOfTwo picks 512 (|512-400| = 112 < |400-256| = 144), IOUtil.cs:905-930.
    const w = 400,
      h = 400;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 7 + 3) & 0xff);
    const out = createIndexFromNormal(a8r8g8b8Tex(w, h, rgba));
    const parsed = parseTex(out);
    expect(parsed.width).toBe(512);
    expect(parsed.height).toBe(512);
    const expected = createIndexTexture(
      resizeBicubic(rgba, w, h, 512, 512),
      512,
      512,
    );
    expect(Array.from(decodeToRgba(parsed))).toEqual(Array.from(expected));
  });

  it("leaves an already-pow2 normal unresized (TextureHelpers.cs:368 early return)", () => {
    const w = 64,
      h = 64;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 5 + 1) & 0xff);
    const out = createIndexFromNormal(a8r8g8b8Tex(w, h, rgba));
    const parsed = parseTex(out);
    expect(parsed.width).toBe(w);
    expect(parsed.height).toBe(h);
    expect(Array.from(decodeToRgba(parsed))).toEqual(
      Array.from(createIndexTexture(rgba, w, h)),
    );
  });

  it("throws when a rounded dimension is under 64 (Tex.cs:656-660)", () => {
    // 40 -> RoundToPowerOfTwo picks 32 (|40-32| = 8 < |64-40| = 24), so MergePixelData's
    // TexImpNet size guard fires on the POST-resize dims.
    const rgba = new Uint8Array(40 * 40 * 4);
    expect(() => createIndexFromNormal(a8r8g8b8Tex(40, 40, rgba))).toThrow(
      /64x64 Minimum Size/,
    );
  });

  it("throws on a format GetCompressionFormat rejects (Tex.cs:718-747)", () => {
    // DXT3 decodes fine for us but is absent from GetCompressionFormat's switch, so TexTools
    // aborts the whole upgrade rather than resizing it.
    const blocks = new Uint8Array((400 / 4) * (400 / 4) * 16);
    expect(() => createIndexFromNormal(rawTex(DXT3, 400, 400, blocks))).toThrow(
      /unsupported/i,
    );
  });

  it("exempts BC7 from the <64 guard (Tex.cs:650-653 takes the TexConv path)", () => {
    // Mode-6 blocks: byte0 = 0x40 is six zero bits then the mode bit, LSB-first.
    const blocks = new Uint8Array((40 / 4) * (40 / 4) * 16);
    for (let i = 0; i < blocks.length; i += 16) blocks[i] = 0x40;
    const out = createIndexFromNormal(rawTex(BC7, 40, 40, blocks));
    expect(parseTex(out).width).toBe(32);
  });
});

describe("upgradeMaskTex", () => {
  it("upgrades a pow2 mask (non-legacy) byte-exact vs upgradeGearMask", () => {
    const w = 2,
      h = 2;
    const rgba = new Uint8Array([
      10, 0, 20, 200, 30, 255, 40, 100, 5, 60, 70, 255, 1, 2, 3, 4,
    ]);
    const out = upgradeMaskTex(a8r8g8b8Tex(w, h, rgba), false);
    const got = decodeToRgba(parseTex(out));
    const expected = rgba.slice();
    upgradeGearMask(expected, w, h, false);
    expect(Array.from(got)).toEqual(Array.from(expected));
  });

  it("resizes an NPOT mask to its nearest pow2 size (EndwalkerUpgrade.cs:2086-2089)", () => {
    const w = 400,
      h = 400;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 11 + 5) & 0xff);
    const out = upgradeMaskTex(a8r8g8b8Tex(w, h, rgba), true);
    const parsed = parseTex(out);
    expect(parsed.width).toBe(512);
    expect(parsed.height).toBe(512);
    const expected = resizeBicubic(rgba, w, h, 512, 512);
    upgradeGearMask(expected, 512, 512, true);
    expect(Array.from(decodeToRgba(parsed))).toEqual(Array.from(expected));
  });

  it("throws when a rounded dimension is under 64 (Tex.cs:656-660)", () => {
    const rgba = new Uint8Array(40 * 40 * 4);
    expect(() => upgradeMaskTex(a8r8g8b8Tex(40, 40, rgba), false)).toThrow(
      /64x64 Minimum Size/,
    );
  });

  it("throws on a format GetCompressionFormat rejects (Tex.cs:718-747)", () => {
    const blocks = new Uint8Array((400 / 4) * (400 / 4) * 16);
    expect(() => upgradeMaskTex(rawTex(DXT3, 400, 400, blocks), false)).toThrow(
      /unsupported/i,
    );
  });

  it("exempts BC7 from the <64 guard (Tex.cs:650-653 takes the TexConv path)", () => {
    const blocks = new Uint8Array((40 / 4) * (40 / 4) * 16);
    for (let i = 0; i < blocks.length; i += 16) blocks[i] = 0x40;
    const out = upgradeMaskTex(rawTex(BC7, 40, 40, blocks), false);
    expect(parseTex(out).width).toBe(32);
  });
});

describe("updateEndwalkerHairTextures", () => {
  it("regenerates normal+mask byte-exact vs createHairMaps (equal pow2 sizes)", () => {
    const w = 2,
      h = 2;
    const nRgba = new Uint8Array([
      10, 20, 30, 40, 11, 21, 31, 41, 12, 22, 32, 42, 13, 23, 33, 43,
    ]);
    const mRgba = new Uint8Array([
      0, 100, 200, 50, 1, 101, 201, 51, 2, 102, 202, 52, 3, 103, 203, 53,
    ]);
    const res = updateEndwalkerHairTextures(
      a8r8g8b8Tex(w, h, nRgba),
      a8r8g8b8Tex(w, h, mRgba),
    );
    const expN = nRgba.slice();
    const expM = mRgba.slice();
    createHairMaps(expN, expM, w, h);
    expect(Array.from(decodeToRgba(parseTex(res.normal)))).toEqual(
      Array.from(expN),
    );
    expect(Array.from(decodeToRgba(parseTex(res.mask)))).toEqual(
      Array.from(expM),
    );
  });
  it("resizes the smaller mask up to the normal's size via Bicubic before createHairMaps (EndwalkerUpgrade.cs:1205, ResizeImages)", () => {
    const nW = 4,
      nH = 4;
    const mW = 2,
      mH = 2;
    const nRgba = new Uint8Array(nW * nH * 4).map((_, i) => (i * 7 + 3) & 0xff);
    const mRgba = new Uint8Array(mW * mH * 4).map(
      (_, i) => (i * 13 + 5) & 0xff,
    );
    const res = updateEndwalkerHairTextures(
      a8r8g8b8Tex(nW, nH, nRgba),
      a8r8g8b8Tex(mW, mH, mRgba),
    );
    const expN = nRgba.slice();
    const expM = resizeBicubic(mRgba, mW, mH, nW, nH);
    createHairMaps(expN, expM, nW, nH);
    const parsedN = parseTex(res.normal);
    const parsedM = parseTex(res.mask);
    expect(parsedN.width).toBe(nW);
    expect(parsedN.height).toBe(nH);
    expect(parsedM.width).toBe(nW);
    expect(parsedM.height).toBe(nH);
    expect(Array.from(decodeToRgba(parsedN))).toEqual(Array.from(expN));
    expect(Array.from(decodeToRgba(parsedM))).toEqual(Array.from(expM));
  });

  it("resizes an NPOT normal to its nearest pow2 size before createHairMaps (EndwalkerUpgrade.cs:1195-1197, RoundToPowerOfTwo)", () => {
    // 96 -> RoundToPowerOfTwo ties between floor=64 and ceil=128 (both distance 32) and resolves
    // to the floor (IOUtil.cs:905-911: `max - x < x - min ? max : min`, false on a tie).
    //
    // 96 rather than a smaller tie like 3->2 deliberately, and it buys two things at once. The
    // hair NPOT pre-step is a ResizeXivTx call, so it now runs MergePixelData's `<64` guard
    // (Tex.cs:656-660) like the index/mask sites — a 3x3 fixture would round to 2x2 and throw,
    // testing the guard instead of the resize. Landing exactly ON 64 also pins the guard's
    // boundary: `w < 64` must be false at 64, so this test fails if that comparison is ever
    // written as `<=`.
    const nW = 96,
      nH = 96;
    const mW = 64,
      mH = 64;
    const nRgba = new Uint8Array(nW * nH * 4).map((_, i) => (i * 7 + 3) & 0xff);
    const mRgba = new Uint8Array(mW * mH * 4).map(
      (_, i) => (i * 13 + 5) & 0xff,
    );
    const res = updateEndwalkerHairTextures(
      a8r8g8b8Tex(nW, nH, nRgba),
      a8r8g8b8Tex(mW, mH, mRgba),
    );
    const expN = resizeBicubic(nRgba, nW, nH, 64, 64);
    const expM = mRgba.slice();
    createHairMaps(expN, expM, 64, 64);
    const parsedN = parseTex(res.normal);
    expect(parsedN.width).toBe(64);
    expect(parsedN.height).toBe(64);
    expect(Array.from(decodeToRgba(parsedN))).toEqual(Array.from(expN));
    expect(Array.from(decodeToRgba(parseTex(res.mask)))).toEqual(
      Array.from(expM),
    );
  });

  it("propagates the <64 guard from the hair NPOT pre-step (Tex.cs:656-660 via EndwalkerUpgrade.cs:1195-1202)", () => {
    // The hair pre-step is a ResizeXivTx call like the index/mask sites, so it owns the same two
    // MergePixelData failures. 3 -> 2 is under the guard, so TexTools aborts the pack here and so
    // must we — before this was routed through resizeToPow2ForMerge we silently succeeded.
    const nRgba = new Uint8Array(3 * 3 * 4);
    const mRgba = new Uint8Array(2 * 2 * 4);
    expect(() =>
      updateEndwalkerHairTextures(
        a8r8g8b8Tex(3, 3, nRgba),
        a8r8g8b8Tex(2, 2, mRgba),
      ),
    ).toThrow(/64x64 Minimum Size/);
  });
});

function option(
  files: Array<{ gamePath: string; data: Uint8Array }>,
): ModpackOption {
  const m = new Map<string, ModpackFile>();
  for (const f of files) {
    m.set(f.gamePath, {
      data: f.data,
      storage: FileStorageType.RawUncompressed,
    });
  }
  return {
    name: "O",
    description: "",
    image: "",
    priority: 0,
    selected: false,
    fileSwaps: {},
    manipulations: [],
    files: m,
  };
}

describe("upgradeRemainingTextures", () => {
  it("generates the index tex into the option holding the normal", () => {
    const w = 2,
      h = 2;
    const normalPath = "chara/x/tex/foo_n.tex";
    const indexPath = "chara/x/tex/foo_id.tex";
    const rgba = new Uint8Array([
      1, 2, 3, 0, 4, 5, 6, 17, 7, 8, 9, 34, 10, 11, 12, 255,
    ]);
    const o = option([{ gamePath: normalPath, data: a8r8g8b8Tex(w, h, rgba) }]);
    const targets = new Map<string, UpgradeInfo>([
      [
        indexPath,
        {
          usage: EUpgradeTextureUsage.IndexMaps,
          files: { normal: normalPath, index: indexPath },
        },
      ],
    ]);
    upgradeRemainingTextures(o, targets);
    const idxFile = o.files.get(indexPath);
    expect(idxFile).toBeDefined();
    const got = decodeToRgba(parseTex(idxFile!.data!));
    expect(Array.from(got)).toEqual(Array.from(createIndexTexture(rgba, w, h)));
  });

  it("no-ops a target whose source is absent from the option", () => {
    const o = option([
      {
        gamePath: "chara/x/tex/other.tex",
        data: a8r8g8b8Tex(2, 2, new Uint8Array(16)),
      },
    ]);
    const targets = new Map<string, UpgradeInfo>([
      [
        "chara/x/tex/foo_id.tex",
        {
          usage: EUpgradeTextureUsage.IndexMaps,
          files: {
            normal: "chara/x/tex/foo_n.tex",
            index: "chara/x/tex/foo_id.tex",
          },
        },
      ],
    ]);
    upgradeRemainingTextures(o, targets);
    expect(o.files.has("chara/x/tex/foo_id.tex")).toBe(false);
  });

  it("throws when hair has the normal but not the mask", () => {
    const o = option([
      { gamePath: "n.tex", data: a8r8g8b8Tex(2, 2, new Uint8Array(16)) },
    ]);
    const targets = new Map<string, UpgradeInfo>([
      [
        "n.tex",
        {
          usage: EUpgradeTextureUsage.HairMaps,
          files: { normal: "n.tex", mask: "m.tex" },
        },
      ],
    ]);
    expect(() => upgradeRemainingTextures(o, targets)).toThrow(
      /Normal and Mask/,
    );
  });

  it("generates the index tex for an NPOT normal instead of skipping it (EndwalkerUpgrade.cs:1096-1099)", () => {
    // Was "skips (no throw) a target whose normal is NPOT": before this change, any NPOT normal
    // threw a swallowed resize-unsupported sentinel and the target was silently dropped (the
    // class-1 bug this task fixes -- see Club Cyberia Motorbike.ttmp2's missing _n_c_id.tex).
    // createIndexFromNormal now resizes NPOT sources instead, so a large-enough NPOT normal
    // generates the index tex normally.
    const normalPath = "chara/x/tex/npot_n.tex";
    const indexPath = "chara/x/tex/npot_id.tex";
    const w = 400,
      h = 400;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 3 + 9) & 0xff);
    const o = option([{ gamePath: normalPath, data: a8r8g8b8Tex(w, h, rgba) }]);
    const targets = new Map<string, UpgradeInfo>([
      [
        indexPath,
        {
          usage: EUpgradeTextureUsage.IndexMaps,
          files: { normal: normalPath, index: indexPath },
        },
      ],
    ]);
    upgradeRemainingTextures(o, targets);
    const idxFile = o.files.get(indexPath);
    expect(idxFile).toBeDefined();
    expect(parseTex(idxFile!.data!).width).toBe(512);
  });

  it("propagates a too-small NPOT normal instead of swallowing it (Tex.cs:656-660)", () => {
    // 3x2 rounds to 2x2 (roundToPowerOfTwo ties to the floor, IOUtil.cs:905-930), below
    // MergePixelData's 64x64 size guard. upgradeRemainingTextures has no try/catch around this
    // call -- matching TexTools, where EndwalkerUpgrade.cs:1842 has no try/catch around
    // CreateIndexFromNormal either -- so the error propagates and aborts the whole upgrade
    // (ModpackUpgrader.cs:133-141 rethrows wrapped).
    const normalPath = "chara/x/tex/npot_n.tex";
    const indexPath = "chara/x/tex/npot_id.tex";
    const o = option([
      {
        gamePath: normalPath,
        data: a8r8g8b8Tex(3, 2, new Uint8Array(3 * 2 * 4)),
      },
    ]);
    const targets = new Map<string, UpgradeInfo>([
      [
        indexPath,
        {
          usage: EUpgradeTextureUsage.IndexMaps,
          files: { normal: normalPath, index: indexPath },
        },
      ],
    ]);
    expect(() => upgradeRemainingTextures(o, targets)).toThrow(
      /64x64 Minimum Size/,
    );
    expect(o.files.has(indexPath)).toBe(false);
  });
});
