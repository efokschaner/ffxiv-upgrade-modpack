import { describe, expect, it } from "vitest";
import { upgradeModpack } from "../../src/index";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../../src/model/modpack";
import { dx11Path } from "../../src/mtrl/dx11-path";
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";
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

// A second hair material with a DISTINCT normal/mask pair, built by repathing the sample's samplers.
const N2_PATH = "chara/human/c0801/obj/hair/h0116/texture/c0801h0116_hir_n.tex";
const M2_PATH = "chara/human/c0801/obj/hair/h0116/texture/c0801h0116_hir_m.tex";
const MTRL2 = (() => {
  const m = parseMtrl(HAIR_MTRL_BYTES, HAIR_MTRL_PATH);
  const norm = m.textures.find(
    (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerNormal,
  )!;
  const mask = m.textures.find(
    (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerMask,
  )!;
  norm.texturePath = N2_PATH;
  norm.flags &= ~0x8000; // clear DX9 flag so dx11Path == texturePath
  mask.texturePath = M2_PATH;
  mask.flags &= ~0x8000;
  return serializeMtrl(m);
})();
const MTRL2_PATH =
  "chara/human/c0801/obj/hair/h0116/material/v0001/mt_c0801h0116_hir_a.mtrl";

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

  it("stage 3 has no both/neither guard: a badOption is probed against an UNRELATED pair", () => {
    // Option A is bad for pair 1 (has N, not M) and holds NEITHER of pair 2 (N2/M2).
    // Option C carries material 2 and both its textures (so pair 2 is collected and M2 has a
    // sole container). A guarded stage-3 loop would `continue` past pair 2 for A (it holds
    // neither texture of that pair); the faithful NO-guard loop processes it anyway.
    //
    // missingTex = hasMask ? pair.normal : pair.mask (ModpackUpgrader.cs:365) depends ONLY on
    // hasMask, not hasNorm. For pair 2 against A: hasMask = A.files.has(M2) = false (A has
    // neither), so missingTex resolves to pair2.mask (M2) regardless of hasNorm — the formula
    // never even inspects whether A already "has" N2. So the cross-pair staple lands on M2, not
    // N2: the faithful no-guard bug still fires (contamination from an unrelated pair reaches an
    // option that holds neither of its textures), it just always targets the *mask* side when
    // the probed option is mask-less, which A always is for an unrelated pair it has no part of.
    const a = option("A", [
      [HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)],
      [N, tex(1)],
    ]);
    const b = option("B", [[M, tex(2)]]); // sole container for M (resolves A's pair-1 miss)
    const c = option("C", [
      [MTRL2_PATH, raw(MTRL2)],
      [N2_PATH, tex(3)],
      [M2_PATH, tex(4)],
    ]);
    const data = pack([a, b, c]);
    resolveHighlightOptionsAndMashupHair(data);
    // A gained M (its own pair) AND M2 (the unrelated pair — only reachable without the guard).
    expect(a.files.has(M)).toBe(true);
    expect(a.files.has(M2_PATH)).toBe(true);
    expect(a.files.has(N2_PATH)).toBe(false);
  });

  it("skips a .mtrl whose file resolves to no bytes (resolve-miss)", () => {
    const data = pack([
      option("O", [
        [
          HAIR_MTRL_PATH,
          { storage: FileStorageType.RawUncompressed, data: undefined },
        ],
        [N, tex(1)],
      ]),
    ]);
    resolveHighlightOptionsAndMashupHair(data);
    expect(data.groups[0]!.options[0]!.files.has(N)).toBe(true);
    expect(data.groups[0]!.options[0]!.files.has(M)).toBe(false);
  });

  it("skips a non-Hair-shaderpack .mtrl (no pair collected)", () => {
    const nonHairMtrlBytes = (() => {
      const m = parseMtrl(HAIR_MTRL_BYTES, HAIR_MTRL_PATH);
      m.shaderPackRaw = "character.shpk";
      return serializeMtrl(m);
    })();
    const data = pack([
      option("O", [
        [HAIR_MTRL_PATH, raw(nonHairMtrlBytes)],
        [N, tex(1)],
      ]),
    ]);
    resolveHighlightOptionsAndMashupHair(data);
    expect(data.groups[0]!.options[0]!.files.has(N)).toBe(true);
    expect(data.groups[0]!.options[0]!.files.has(M)).toBe(false);
  });
});

describe("upgradeModpack pre-round wiring", () => {
  it("staples split hair textures during the pre-round before other rounds run", () => {
    const a = option("Has Normal", [
      [HAIR_MTRL_PATH, raw(HAIR_MTRL_BYTES)],
      [N, tex(1)],
    ]);
    const b = option("Has Mask", [[M, tex(2)]]);
    const out = upgradeModpack(pack([a, b]));
    expect(out.groups[0]!.options[0]!.files.has(M)).toBe(true);
    expect(out.groups[0]!.options[1]!.files.has(N)).toBe(true);
  });
});
