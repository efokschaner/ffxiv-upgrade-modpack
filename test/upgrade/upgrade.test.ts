import { describe, expect, it } from "vitest";
import { upgradeModpack } from "../../src/index";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type SqPackCompressedFile,
} from "../../src/model/modpack";
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";
import { ESamplerId, SHPK_CHARACTER } from "../../src/mtrl/shader";
import type { XivMtrl } from "../../src/mtrl/types";
import {
  decodeSqPackFile,
  encodeSqPackFile,
  SqPackType,
} from "../../src/sqpack/sqpack";
import { createIndexTexture } from "../../src/tex/helpers";
import {
  decodeToRgba,
  encodeUncompressedTex,
  parseTex,
} from "../../src/tex/tex";
import { requireBytes, restore } from "../../src/upgrade/upgrade";
import { firstCorpusModel } from "../helpers/corpus-models";
import { filesMap } from "../helpers/make-packs";

function sampleData(): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: false,
    meta: {
      name: "M",
      author: "A",
      version: "1",
      description: "",
      url: "",
      image: "",
      tags: ["t"],
      minimumFrameworkVersion: "1.0.0.0",
    },
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
            files: filesMap([
              {
                gamePath: "a/b.mtrl",
                data: new Uint8Array([1, 2, 3]),
                storage: FileStorageType.SqPackCompressed,
              },
            ]),
          },
        ],
      },
    ],
  };
}

function ewColorsetMtrl(): XivMtrl {
  const colorSetData = new Array<number>(256).fill(0);
  // A few distinct nonzero raw halves so the expanded 1024-length colorset isn't
  // trivially all-zero (doesn't matter which values -- only the shape/length and
  // shader pack rename are asserted below).
  colorSetData[0] = 0x3c00; // 1.0
  colorSetData[1] = 0x4000; // 2.0
  colorSetData[2] = 0x4200; // 3.0
  return {
    signature: 0x00000301,
    shaderPackRaw: "character.shpk",
    additionalData: new Uint8Array(4),
    textures: [
      {
        texturePath: "chara/foo/texture/mt_foo_n.tex",
        flags: 0,
        sampler: {
          samplerIdRaw: ESamplerId.g_SamplerNormal,
          samplerSettingsRaw: 0,
        },
      },
    ],
    uvMapStrings: [{ value: "", flags: 0 }],
    colorsetStrings: [],
    colorSetData,
    colorSetDyeData: new Uint8Array(0),
    shaderKeys: [],
    shaderConstants: [],
    materialFlags: 0,
    materialFlags2: 0,
    mtrlPath: "chara/foo/material/mt_foo.mtrl",
  };
}

function modpackWithSingleFile(
  gamePath: string,
  data: Uint8Array,
  storage: FileStorageType,
): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: false,
    meta: {
      name: "M",
      author: "A",
      version: "1",
      description: "",
      url: "",
      image: "",
      tags: ["t"],
      minimumFrameworkVersion: "1.0.0.0",
    },
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
            files: filesMap([{ gamePath, data, storage }]),
          },
        ],
      },
    ],
  };
}

function noNormalColorsetMtrl(): XivMtrl {
  const colorSetData = new Array<number>(256).fill(0);
  return {
    signature: 0x00000301,
    shaderPackRaw: "characterlegacy.shpk",
    additionalData: new Uint8Array(4),
    textures: [
      {
        texturePath: "chara/foo/texture/mt_foo_m.tex",
        flags: 0,
        sampler: {
          samplerIdRaw: ESamplerId.g_SamplerMask,
          samplerSettingsRaw: 0,
        },
      },
    ],
    uvMapStrings: [{ value: "", flags: 0 }],
    colorsetStrings: [],
    colorSetData,
    colorSetDyeData: new Uint8Array(0),
    shaderKeys: [],
    shaderConstants: [],
    materialFlags: 0,
    materialFlags2: 0,
    mtrlPath: "chara/foo/material/mt_foo.mtrl",
  };
}

function alreadyDawntrailMtrl(): XivMtrl {
  return {
    signature: 0x00000301,
    shaderPackRaw: "characterlegacy.shpk",
    additionalData: new Uint8Array(4),
    textures: [
      {
        texturePath: "chara/foo/texture/mt_foo_n.tex",
        flags: 0,
        sampler: {
          samplerIdRaw: ESamplerId.g_SamplerNormal,
          samplerSettingsRaw: 0,
        },
      },
    ],
    uvMapStrings: [{ value: "", flags: 0 }],
    colorsetStrings: [],
    colorSetData: new Array<number>(1024).fill(0),
    colorSetDyeData: new Uint8Array(0),
    shaderKeys: [],
    shaderConstants: [],
    materialFlags: 0,
    materialFlags2: 0,
    mtrlPath: "chara/foo/material/mt_foo.mtrl",
  };
}

describe("upgradeModpack (material round passthrough)", () => {
  it("leaves an already-Dawntrail material byte-untouched (no update needed)", () => {
    const uncompressed = serializeMtrl(alreadyDawntrailMtrl());
    const input = modpackWithSingleFile(
      "chara/foo/material/mt_foo.mtrl",
      uncompressed,
      FileStorageType.RawUncompressed,
    );

    const out = upgradeModpack(input);
    const outFile = [...out.groups[0]!.options[0]!.files.values()][0]!;

    expect(Array.from(outFile.data!)).toEqual(Array.from(uncompressed));
  });

  it("leaves an unparseable chara/**.mtrl file byte-untouched", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const input = modpackWithSingleFile(
      "chara/foo/material/mt_bad.mtrl",
      data,
      FileStorageType.RawUncompressed,
    );

    const out = upgradeModpack(input);
    const outFile = [...out.groups[0]!.options[0]!.files.values()][0]!;

    expect(Array.from(outFile.data!)).toEqual([1, 2, 3, 4, 5]);
  });

  it("leaves a colorset material with no resolvable normal texture byte-untouched (regression: C# throws an NRE on normalTex.Dx11Path before the mask code, and its per-material try/catch swallows it, leaving the file untouched)", () => {
    const uncompressed = serializeMtrl(noNormalColorsetMtrl());
    const input = modpackWithSingleFile(
      "chara/foo/material/mt_foo.mtrl",
      uncompressed,
      FileStorageType.RawUncompressed,
    );

    const out = upgradeModpack(input);
    const outFile = [...out.groups[0]!.options[0]!.files.values()][0]!;

    expect(Array.from(outFile.data!)).toEqual(Array.from(uncompressed));
  });
});

describe("upgradeModpack (material round)", () => {
  it("upgrades a chara/**.mtrl EW colorset material and re-encodes it as SqPackCompressed", () => {
    const uncompressed = serializeMtrl(ewColorsetMtrl());
    const sqpackBytes = encodeSqPackFile(uncompressed, SqPackType.Standard);
    const input = modpackWithSingleFile(
      "chara/foo/material/mt_foo.mtrl",
      sqpackBytes,
      FileStorageType.SqPackCompressed,
    );

    const out = upgradeModpack(input);
    const outFile = [...out.groups[0]!.options[0]!.files.values()][0]!;

    expect(outFile.storage).toBe(FileStorageType.SqPackCompressed);
    const decoded = decodeSqPackFile(outFile.data!).data;
    const parsed = parseMtrl(decoded, outFile.gamePath);
    expect(parsed.colorSetData.length).toBe(1024);
    expect(parsed.shaderPackRaw).toBe("characterlegacy.shpk");
    const idxTex = parsed.textures.find(
      (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerIndex,
    );
    expect(idxTex).toBeDefined();
    expect(ESamplerId.g_SamplerIndex).toBe(0x565f8fd8);
  });
});

describe("upgradeModpack (skeleton)", () => {
  it("returns content-equal data", () => {
    const input = sampleData();
    const out = upgradeModpack(input);
    expect(out.meta.name).toBe("M");
    const outFile = out.groups[0]!.options[0]!.files.get("a/b.mtrl")!;
    expect(outFile.gamePath).toBe("a/b.mtrl");
    expect(Array.from(outFile.data!)).toEqual([1, 2, 3]);
  });

  it("does not mutate the input when the output is edited (fresh containers)", () => {
    const input = sampleData();
    const out = upgradeModpack(input);
    expect(out).not.toBe(input);
    expect(out.groups).not.toBe(input.groups);
    expect(out.groups[0]!.options[0]!.files).not.toBe(
      input.groups[0]!.options[0]!.files,
    );
    out.groups[0]!.options[0]!.files.set("x.tex", {
      gamePath: "x.tex",
      data: new Uint8Array(),
      storage: FileStorageType.RawUncompressed,
    });
    expect(input.groups[0]!.options[0]!.files.size).toBe(1);
  });
});

function characterColorsetMtrlFor(normalPath: string): XivMtrl {
  return {
    signature: 0x00000301,
    shaderPackRaw: SHPK_CHARACTER,
    additionalData: new Uint8Array(4),
    textures: [
      {
        texturePath: normalPath,
        flags: 0,
        sampler: {
          samplerIdRaw: ESamplerId.g_SamplerNormal,
          samplerSettingsRaw: 0,
        },
      },
    ],
    uvMapStrings: [{ value: "", flags: 0 }],
    colorsetStrings: [],
    colorSetData: new Array<number>(256).fill(0),
    colorSetDyeData: new Uint8Array(0),
    shaderKeys: [],
    shaderConstants: [],
    materialFlags: 0,
    materialFlags2: 0,
    mtrlPath: "chara/x/mat/mt_foo.mtrl",
  };
}

/**
 * Builds a one-group/one-option ModpackData containing a chara/**.mtrl colorset
 * material whose normal sampler points at `normalPath`, plus the normal .tex itself
 * at `normalPath`. Both files are RawUncompressed so no SqPack round-trip is needed.
 * Drives the texture-round e2e test: upgradeModpack's material round should rewrite
 * the mtrl (recording an IndexMaps UpgradeInfo), and the texture round should then
 * generate the `_id.tex` from the normal.
 */
function buildColorsetPack(
  normalPath: string,
  normalTexBytes: Uint8Array,
): ModpackData {
  const mtrlBytes = serializeMtrl(characterColorsetMtrlFor(normalPath));
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: false,
    meta: {
      name: "M",
      author: "A",
      version: "1",
      description: "",
      url: "",
      image: "",
      tags: ["t"],
      minimumFrameworkVersion: "1.0.0.0",
    },
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
            files: filesMap([
              {
                gamePath: "chara/x/mat/mt_foo.mtrl",
                data: mtrlBytes,
                storage: FileStorageType.RawUncompressed,
              },
              {
                gamePath: normalPath,
                data: normalTexBytes,
                storage: FileStorageType.RawUncompressed,
              },
            ]),
          },
        ],
      },
    ],
  };
}

describe("upgradeModpack texture round (e2e)", () => {
  it("generates the index tex for a colorset mtrl's normal", () => {
    const w = 2;
    const h = 2;
    const rgba = new Uint8Array([
      1, 2, 3, 0, 4, 5, 6, 17, 7, 8, 9, 34, 10, 11, 12, 255,
    ]);
    const data: ModpackData = buildColorsetPack(
      "chara/x/tex/foo_n.tex",
      encodeUncompressedTex(rgba, w, h, { mips: false }),
    );
    const out = upgradeModpack(data);
    const files = out.groups[0]!.options[0]!.files;
    const idx = files.get("chara/x/tex/foo_id.tex");
    expect(idx).toBeDefined();
    expect(Array.from(decodeToRgba(parseTex(idx!.data!)))).toEqual(
      Array.from(createIndexTexture(rgba, w, h)),
    );
  });
});

describe("requireBytes", () => {
  it("throws when the file has no bytes (direct read, no ResolveFile-style skip)", () => {
    const f: ModpackFile = {
      gamePath: "chara/x.mdl",
      storage: FileStorageType.RawUncompressed,
    };
    expect(() => requireBytes(f)).toThrow(/file has no bytes/);
  });
});

describe("restore threads the source SqPack type", () => {
  it("round-trips a Standard entry (mechanism, arbitrary bytes)", () => {
    const raw = new Uint8Array([1, 2, 3, 4, 5]);
    const f: SqPackCompressedFile = {
      gamePath: "chara/x.mtrl",
      data: encodeSqPackFile(raw, SqPackType.Standard),
      storage: FileStorageType.SqPackCompressed,
    };
    const { bytes, type } = requireBytes(f);
    expect(type).toBe(SqPackType.Standard);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
    // f is SqPackCompressed, so restore()'s SqPackCompressedFile overload guarantees `data` back.
    expect(decodeSqPackFile(restore(f, bytes, type).data).type).toBe(
      SqPackType.Standard,
    );
  });

  it("re-encodes a real Model .mdl as SqPackType.Model (lossless re-wrap)", () => {
    const bytes = firstCorpusModel().bytes;
    const f: SqPackCompressedFile = {
      gamePath: "chara/x.mdl",
      data: encodeSqPackFile(bytes, SqPackType.Model),
      storage: FileStorageType.SqPackCompressed,
    };
    const dec = requireBytes(f);
    expect(dec.type).toBe(SqPackType.Model);
    const re = decodeSqPackFile(restore(f, dec.bytes, dec.type).data);
    expect(re.type).toBe(SqPackType.Model);
    expect(Array.from(re.data)).toEqual(Array.from(bytes));
  });
});
