import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackFile,
  type ModpackOption,
} from "../../src/model/modpack";
import {
  createHairMaps,
  createIndexTexture,
  upgradeGearMask,
} from "../../src/tex/helpers";
import {
  decodeToRgba,
  encodeUncompressedTex,
  parseTex,
} from "../../src/tex/tex";
import {
  createIndexFromNormal,
  TextureResizeUnsupported,
  updateEndwalkerHairTextures,
  upgradeMaskTex,
  upgradeRemainingTextures,
} from "../../src/upgrade/texture";
import {
  EUpgradeTextureUsage,
  type UpgradeInfo,
} from "../../src/upgrade/upgrade-info";

function a8r8g8b8Tex(
  width: number,
  height: number,
  rgba: Uint8Array,
): Uint8Array {
  return encodeUncompressedTex(rgba, width, height, { mips: false });
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

  it("throws TextureResizeUnsupported for a non-power-of-two normal", () => {
    const rgba = new Uint8Array(3 * 2 * 4);
    expect(() => createIndexFromNormal(a8r8g8b8Tex(3, 2, rgba))).toThrow(
      TextureResizeUnsupported,
    );
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
  it("throws TextureResizeUnsupported for a NPOT mask", () => {
    const rgba = new Uint8Array(6 * 4 * 4);
    expect(() => upgradeMaskTex(a8r8g8b8Tex(6, 4, rgba), true)).toThrow(
      TextureResizeUnsupported,
    );
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
  it("throws TextureResizeUnsupported when normal and mask differ in size", () => {
    const n = a8r8g8b8Tex(4, 4, new Uint8Array(4 * 4 * 4));
    const m = a8r8g8b8Tex(2, 2, new Uint8Array(2 * 2 * 4));
    expect(() => updateEndwalkerHairTextures(n, m)).toThrow(
      TextureResizeUnsupported,
    );
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

  it("skips (no throw) a target whose normal is NPOT", () => {
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
    expect(() => upgradeRemainingTextures(o, targets)).not.toThrow();
    expect(o.files.has(indexPath)).toBe(false);
  });
});
