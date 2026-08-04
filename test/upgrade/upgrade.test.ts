import { describe, expect, it } from "vitest";
import { DiagnosticCode, upgradeModpack } from "../../src/index";
import {
  allGroups,
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
import { UnportedGapError } from "../../src/util/errors";
import { firstCorpusModel } from "../helpers/corpus-models";
import { filesMap } from "../helpers/make-packs";
import { buildEmptySamplerColorsetMtrl } from "../mtrl/make-mtrl";

/** Narrows an `UpgradeResult`, throwing a clear failure message if the upgrade did not succeed.
 * Not for the boundary/propagation tests below, which assert the outcome rather than consume it. */
function upgradedOk(input: ModpackData): ModpackData {
  const r = upgradeModpack(input);
  if (!r.ok) {
    throw new Error(
      `expected a successful upgrade, got: ${r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ")}`,
    );
  }
  return r.data;
}

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
    pages: [
      {
        groups: [
          {
            name: "G",
            description: "",
            image: "",
            priority: 0,
            selectionType: "Single",
            defaultSettings: 0,
            options: [
              {
                name: "O",
                description: "",
                image: "",
                priority: 0,
                selected: false,
                fileSwaps: {},
                manipulations: [],
                files: filesMap([
                  [
                    "a/b.mtrl",
                    {
                      data: new Uint8Array([1, 2, 3]),
                      storage: FileStorageType.SqPackCompressed,
                    },
                  ],
                ]),
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
    pages: [
      {
        groups: [
          {
            name: "G",
            description: "",
            image: "",
            priority: 0,
            selectionType: "Single",
            defaultSettings: 0,
            options: [
              {
                name: "O",
                description: "",
                image: "",
                priority: 0,
                selected: false,
                fileSwaps: {},
                manipulations: [],
                files: filesMap([[gamePath, { data, storage }]]),
              },
            ],
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

    const out = upgradedOk(input);
    const outFile = [...allGroups(out)[0]!.options[0]!.files.values()][0]!;

    expect(Array.from(outFile.data!)).toEqual(Array.from(uncompressed));
  });

  it("leaves an unparseable chara/**.mtrl file byte-untouched", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const input = modpackWithSingleFile(
      "chara/foo/material/mt_bad.mtrl",
      data,
      FileStorageType.RawUncompressed,
    );

    const out = upgradedOk(input);
    const outFile = [...allGroups(out)[0]!.options[0]!.files.values()][0]!;

    expect(Array.from(outFile.data!)).toEqual([1, 2, 3, 4, 5]);
  });

  it("leaves a colorset material with no resolvable normal texture byte-untouched (regression: C# throws an NRE on normalTex.Dx11Path before the mask code, and its per-material try/catch swallows it, leaving the file untouched)", () => {
    const uncompressed = serializeMtrl(noNormalColorsetMtrl());
    const input = modpackWithSingleFile(
      "chara/foo/material/mt_foo.mtrl",
      uncompressed,
      FileStorageType.RawUncompressed,
    );

    const out = upgradedOk(input);
    const outFile = [...allGroups(out)[0]!.options[0]!.files.values()][0]!;

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

    const out = upgradedOk(input);
    const [outGamePath, outFile] = [
      ...allGroups(out)[0]!.options[0]!.files,
    ][0]!;

    expect(outFile.storage).toBe(FileStorageType.SqPackCompressed);
    const decoded = decodeSqPackFile(outFile.data!).data;
    const parsed = parseMtrl(decoded, outGamePath);
    expect(parsed.colorSetData.length).toBe(1024);
    expect(parsed.shaderPackRaw).toBe("characterlegacy.shpk");
    const idxTex = parsed.textures.find(
      (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerIndex,
    );
    expect(idxTex).toBeDefined();
    expect(ESamplerId.g_SamplerIndex).toBe(0x565f8fd8);
  });
});

function characterColorsetMtrlWithNormal(
  mtrlPath: string,
  normalPath: string,
): XivMtrl {
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
    mtrlPath,
  };
}

describe("upgradeModpack (material round) - unported gap propagation", () => {
  // Fix round 1, Task 3 review finding: idPath (material.ts:130-134) is derived from the MOD'S OWN
  // normal-texture path, which is not constrained to chara/ the way mtrl.mtrlPath is (that
  // constraint is IS_CHARA_MTRL, upgrade.ts:157/167, gating only the material path). If the normal
  // sampler points outside chara/ into another bundled FOLDER_KEYS prefix (ui/, vfx/, ...), gate B's
  // fileExists(idPath) (material.ts:155) throws UnportedGapError instead of returning a boolean.
  // That must propagate out of upgradeModpack, not be silently absorbed by materialRound's
  // per-material catch (which exists to mirror EndwalkerUpgrade.cs:522-539's NRE swallow, a
  // C#-reachable failure -- this port-gap signal is not one).
  it("propagates UnportedGapError rather than leaving the file byte-untouched, when the normal sampler's convention idPath falls outside chara/ (gate B)", () => {
    // A REAL base-game material (see build-synthetic-index-fallback.ts's header comment #1 for the
    // same confirmed path) so gate A (fileExists(mtrl.mtrlPath)) is true and evaluation reaches
    // gate B's fileExists(idPath) rather than short-circuiting on a false gate A.
    const mtrlPath =
      "chara/equipment/e0194/material/v0001/mt_c0201e0194_top_a.mtrl";
    // Normal sampler outside chara/: convention idPath ("ui/uld/dummy_id.tex") falls in the bundled
    // "ui/" FOLDER_KEYS prefix, which file-exists.ts does not bundle data for.
    const uncompressed = serializeMtrl(
      characterColorsetMtrlWithNormal(mtrlPath, "ui/uld/dummy_n.tex"),
    );
    const input = modpackWithSingleFile(
      mtrlPath,
      uncompressed,
      FileStorageType.RawUncompressed,
    );

    // The boundary catches every throw (spec §4.1), so propagation is no longer visible as a raised
    // exception here: it shows up as a fatal `ok: false` whose diagnostic wraps the SAME
    // UnportedGapError as `cause`, rather than `ok: true` with the file left byte-untouched (which
    // is what a silent swallow by materialRound's per-material catch would produce instead).
    const r = upgradeModpack(input);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect(d.code).toBe(DiagnosticCode.UnportedGap);
    // A DIRECT instanceof, not a cause-chain walk — that is exactly why spec §4.3 annotates the
    // error in place instead of wrapping it at each frame.
    expect(d.cause).toBeInstanceOf(UnportedGapError);
    // Motivation 3: the fatal report now names WHICH material aborted the pack, and which
    // group/option it lived in — which the bare propagating throw never did even though
    // materialRound's and upgradeModpack's own frames knew them. modpackWithSingleFile
    // (:124-166) names its lone group "G" and its lone option "O".
    expect(d.gamePath).toBe(mtrlPath);
    expect(d.option).toEqual({ group: "G", option: "O" });
  });

  // Amendment to fix round 1: the SAME UnportedGapError category also covers serializeMtrl's
  // empty-sampler placeholder gap (mtrl/serialize.ts:43-47) -- pre-existing before this branch, but
  // reached from the SAME materialRound catch (upgrade.ts:182 calls serializeMtrl inside the try),
  // so today it was silently swallowed and the material left byte-untouched. Must propagate too.
  it("propagates UnportedGapError rather than leaving the file byte-untouched, when the upgraded material still carries an empty-sampler placeholder (serializeMtrl's gap)", () => {
    const mtrlPath = "chara/foo/material/mt_foo.mtrl";
    const input = modpackWithSingleFile(
      mtrlPath,
      buildEmptySamplerColorsetMtrl(),
      FileStorageType.RawUncompressed,
    );

    const r = upgradeModpack(input);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect(d.code).toBe(DiagnosticCode.UnportedGap);
    expect(d.cause).toBeInstanceOf(UnportedGapError);
    // Same annotation proof as the gate-B case above, for the OTHER materialRound throw site
    // (serializeMtrl, reached via the `restore` call rather than gate B's fileExists).
    expect(d.gamePath).toBe(mtrlPath);
    expect(d.option).toEqual({ group: "G", option: "O" });
  });
});

describe("upgradeModpack (skeleton)", () => {
  it("returns content-equal data", () => {
    const input = sampleData();
    const out = upgradedOk(input);
    expect(out.meta.name).toBe("M");
    const outFile = allGroups(out)[0]!.options[0]!.files.get("a/b.mtrl")!;
    expect(Array.from(outFile.data!)).toEqual([1, 2, 3]);
  });

  it("does not mutate the input when the output is edited (fresh containers)", () => {
    const input = sampleData();
    const out = upgradedOk(input);
    expect(out).not.toBe(input);
    expect(out.pages).not.toBe(input.pages);
    expect(out.pages![0]!.groups[0]!.options[0]!.files).not.toBe(
      input.pages![0]!.groups[0]!.options[0]!.files,
    );
    out.pages![0]!.groups[0]!.options[0]!.files.set("x.tex", {
      data: new Uint8Array(),
      storage: FileStorageType.RawUncompressed,
    });
    expect(input.pages![0]!.groups[0]!.options[0]!.files.size).toBe(1);
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
    pages: [
      {
        groups: [
          {
            name: "G",
            description: "",
            image: "",
            priority: 0,
            selectionType: "Single",
            defaultSettings: 0,
            options: [
              {
                name: "O",
                description: "",
                image: "",
                priority: 0,
                selected: false,
                fileSwaps: {},
                manipulations: [],
                files: filesMap([
                  [
                    "chara/x/mat/mt_foo.mtrl",
                    {
                      data: mtrlBytes,
                      storage: FileStorageType.RawUncompressed,
                    },
                  ],
                  [
                    normalPath,
                    {
                      data: normalTexBytes,
                      storage: FileStorageType.RawUncompressed,
                    },
                  ],
                ]),
              },
            ],
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
    const out = upgradedOk(data);
    const files = allGroups(out)[0]!.options[0]!.files;
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
      storage: FileStorageType.RawUncompressed,
    };
    expect(() => requireBytes(f, "chara/x.mdl")).toThrow(/file has no bytes/);
  });
});

describe("restore threads the source SqPack type", () => {
  it("round-trips a Standard entry (mechanism, arbitrary bytes)", () => {
    const raw = new Uint8Array([1, 2, 3, 4, 5]);
    const f: SqPackCompressedFile = {
      data: encodeSqPackFile(raw, SqPackType.Standard),
      storage: FileStorageType.SqPackCompressed,
    };
    const { bytes, type } = requireBytes(f, "chara/x.mtrl");
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
      data: encodeSqPackFile(bytes, SqPackType.Model),
      storage: FileStorageType.SqPackCompressed,
    };
    const dec = requireBytes(f, "chara/x.mdl");
    expect(dec.type).toBe(SqPackType.Model);
    const re = decodeSqPackFile(restore(f, dec.bytes, dec.type).data);
    expect(re.type).toBe(SqPackType.Model);
    expect(Array.from(re.data)).toEqual(Array.from(bytes));
  });
});

describe("upgradeModpack (boundary)", () => {
  it("returns ok:true and the upgraded data on success", () => {
    const r = upgradeModpack(sampleData());
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.data).toBeDefined();
    expect(r.diagnostics).toEqual([]);
  });

  it("converts an escaping throw into ok:false with a null data pack, never re-throwing", () => {
    // meta-drop's `parseMetaRoot` guard is a fail-loud throw with no C# analogue; it is the
    // cheapest way to reach the boundary from a constructed input.
    const input = modpackWithSingleFile(
      "chara/nonsense/root.meta",
      new Uint8Array([0, 0, 0, 0]),
      FileStorageType.RawUncompressed,
    );
    const r = upgradeModpack(input);
    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]!.severity).toBe("error");
  });
});
