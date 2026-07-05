import { describe, expect, it } from "vitest";
import { upgradeModpack } from "../../src/index";
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../../src/model/modpack";
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";
import { ESamplerId } from "../../src/mtrl/shader";
import type { XivMtrl } from "../../src/mtrl/types";
import {
  decodeSqPackFile,
  encodeSqPackFile,
  SqPackType,
} from "../../src/sqpack/sqpack";

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
            files: [
              {
                gamePath: "a/b.mtrl",
                data: new Uint8Array([1, 2, 3]),
                storage: FileStorageType.SqPackCompressed,
              },
            ],
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
            files: [{ gamePath, data, storage }],
          },
        ],
      },
    ],
  };
}

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
    const outFile = out.groups[0]!.options[0]!.files[0]!;

    expect(outFile.storage).toBe(FileStorageType.SqPackCompressed);
    const decoded = decodeSqPackFile(outFile.data).data;
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
    expect(out.groups[0]!.options[0]!.files[0]!.gamePath).toBe("a/b.mtrl");
    expect(Array.from(out.groups[0]!.options[0]!.files[0]!.data)).toEqual([
      1, 2, 3,
    ]);
  });

  it("does not mutate the input when the output is edited (fresh containers)", () => {
    const input = sampleData();
    const out = upgradeModpack(input);
    expect(out).not.toBe(input);
    expect(out.groups).not.toBe(input.groups);
    expect(out.groups[0]!.options[0]!.files).not.toBe(
      input.groups[0]!.options[0]!.files,
    );
    out.groups[0]!.options[0]!.files.push({
      gamePath: "x.tex",
      data: new Uint8Array(),
      storage: FileStorageType.RawUncompressed,
    });
    expect(input.groups[0]!.options[0]!.files.length).toBe(1);
  });
});
