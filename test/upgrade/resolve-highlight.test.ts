import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../../src/model/modpack";
import { dx11Path } from "../../src/mtrl/dx11-path";
import { parseMtrl } from "../../src/mtrl/mtrl";
import { ESamplerId } from "../../src/mtrl/shader";
import { SAMPLE_HAIR_MTRL_BASE64 } from "../../src/upgrade/reference/hair-materials";
import { resolveHighlightOptionsAndMashupHair } from "../../src/upgrade/resolve-highlight";

const HAIR_MTRL_BYTES = new Uint8Array(
  Buffer.from(SAMPLE_HAIR_MTRL_BASE64, "base64"),
);
const HAIR_MTRL_PATH =
  "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl";

const SAMPLE = parseMtrl(HAIR_MTRL_BYTES, HAIR_MTRL_PATH);
const N = dx11Path(
  SAMPLE.textures.find(
    (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerNormal,
  )!,
);
const M = dx11Path(
  SAMPLE.textures.find(
    (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerMask,
  )!,
);

function raw(bytes: Uint8Array): ModpackFile {
  return { data: bytes, storage: FileStorageType.RawUncompressed };
}
function tex(seed: number): ModpackFile {
  return raw(new Uint8Array([seed, seed + 1, seed + 2]));
}
function option(
  name: string,
  files: Array<[string, ModpackFile]>,
): ModpackOption {
  return {
    name,
    description: "",
    image: "",
    priority: 0,
    fileSwaps: {},
    manipulations: [],
    files: new Map(files),
  };
}
function pack(options: ModpackOption[]): ModpackData {
  const group: ModpackGroup = {
    name: "G",
    description: "",
    image: "",
    page: 0,
    priority: 0,
    selectionType: "Single",
    defaultSettings: 0,
    options,
  };
  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: {
      name: "M",
      author: "A",
      version: "1",
      description: "",
      url: "",
      image: "",
      tags: [],
      minimumFrameworkVersion: "1.0.0.0",
    },
    groups: [group],
  };
}

describe("resolveHighlightOptionsAndMashupHair", () => {
  it("no-ops when there are no hair materials", () => {
    const data = pack([option("O", [["chara/x/y.tex", tex(1)]])]);
    resolveHighlightOptionsAndMashupHair(data);
    expect([...data.groups[0]!.options[0]!.files.keys()]).toEqual([
      "chara/x/y.tex",
    ]);
  });

  it("no-ops when every hair pair is complete in the option that holds either", () => {
    const data = pack([
      option("Both", [
        [HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)],
        [N, tex(1)],
        [M, tex(2)],
      ]),
    ]);
    resolveHighlightOptionsAndMashupHair(data);
    expect(data.groups[0]!.options[0]!.files.size).toBe(3);
  });

  it("staples the missing texture from the sole container into each split option", () => {
    const a = option("Has Normal", [
      [HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)],
      [N, tex(1)],
    ]);
    const b = option("Has Mask", [[M, tex(2)]]);
    const bMaskData = b.files.get(M)!.data;
    const data = pack([a, b]);
    resolveHighlightOptionsAndMashupHair(data);
    expect(a.files.has(M)).toBe(true);
    expect(b.files.has(N)).toBe(true);
    // A's stapled M shares B's original buffer (pointer duplication).
    expect(a.files.get(M)!.data).toBe(bMaskData);
  });

  it("throws InvalidDataException-style when the missing texture is in more than one container", () => {
    const a = option("A", [
      [HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)],
      [N, tex(1)],
    ]);
    const b = option("B", [[N, tex(2)]]);
    const c = option("C", [[M, tex(3)]]);
    const data = pack([a, b, c]);
    expect(() => resolveHighlightOptionsAndMashupHair(data)).toThrow(
      /unresolveable/,
    );
  });

  it("throws KeyNotFound-style when a split option's missing texture is in no container", () => {
    const a = option("A", [
      [HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)],
      [N, tex(1)],
    ]);
    const data = pack([a]);
    expect(() => resolveHighlightOptionsAndMashupHair(data)).toThrow(
      /no option|KeyNotFound/,
    );
  });

  it("throws the deferred RepathHairMashups error for material-only mashup hair", () => {
    const a = option("A", [[HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)]]);
    const data = pack([a]);
    expect(() => resolveHighlightOptionsAndMashupHair(data)).toThrow(
      /RepathHairMashups|mashup/,
    );
  });

  it("skips a .mtrl that fails to parse", () => {
    const data = pack([
      option("O", [
        ["chara/x/bad.mtrl", raw(new Uint8Array([0, 0, 0, 0]))],
        [N, tex(1)],
      ]),
    ]);
    resolveHighlightOptionsAndMashupHair(data);
    expect(data.groups[0]!.options[0]!.files.has(N)).toBe(true);
  });
});
