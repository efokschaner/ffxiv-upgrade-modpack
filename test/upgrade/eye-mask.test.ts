// Tests for the round-6 eye-mask control-flow gate (EndwalkerUpgrade.cs:2007-2079), see
// src/upgrade/eye-mask.ts. The pixel conversion (ConvertEyeMaskToDiffuse) is deferred
// (docs/backlog/2026-07-15-partials-eye-mask.md); this file pins the guards and the fail-loud throw.
import { describe, expect, it } from "vitest";
import {
  emptyMeta,
  FileStorageType,
  type ModpackFile,
  ModpackFormat,
  type ModpackOption,
} from "../../src/model/modpack";
import { raceCodeFromPath, updateEyeMask } from "../../src/upgrade/eye-mask";
import { EYE_MATERIALS } from "../../src/upgrade/reference/eye-materials";
import type { EyeMaterialTable } from "../../src/upgrade/reference/eye-materials-types";
import { upgradeModpack } from "../../src/upgrade/upgrade";
import { buildMinimalTex } from "../tex/make-tex";

function opt(files: Record<string, Uint8Array>): ModpackOption {
  return {
    name: "o",
    description: "",
    image: "",
    priority: 0,
    fileSwaps: {},
    manipulations: [],
    files: new Map<string, ModpackFile>(
      Object.entries(files).map(([p, data]) => [
        p,
        { storage: FileStorageType.RawUncompressed, data },
      ]),
    ),
  };
}

const IRIS_MAT =
  "chara/human/c0801/obj/face/f0002/material/mt_c0801f0002_iri_a.mtrl";
const MASK = "chara/human/c0801/obj/face/f0002/texture/--c0801f0002_iri_s.tex";
const table: EyeMaterialTable = new Map([[IRIS_MAT, { diffusePath: "d" }]]);
const empty: EyeMaterialTable = new Map();

describe("updateEyeMask", () => {
  it("throws the documented gap when the mask clears every guard (iris exists)", () => {
    const o = opt({ [MASK]: buildMinimalTex() });
    expect(() => updateEyeMask(o, MASK, table)).toThrow(/unported/i);
  });

  it("skips (no throw) a non-eye texture — regex miss (EndwalkerUpgrade.cs:2009)", () => {
    const other =
      "chara/human/c0801/obj/face/f0002/texture/--c0801f0002_norm.tex";
    const o = opt({ [other]: new Uint8Array([1]) });
    expect(() => updateEyeMask(o, other, table)).not.toThrow();
  });

  it("skips (no throw) when the iris material is absent — FileExists false (EndwalkerUpgrade.cs:2049)", () => {
    const o = opt({ [MASK]: buildMinimalTex() });
    expect(() => updateEyeMask(o, MASK, empty)).not.toThrow();
  });

  it("skips (no throw) a mask whose race digits are not a real race (round-trips to c0000, table miss)", () => {
    // c9998 is not a XivRace Description -> GetXivRace defaults to All_Races -> code "0000" ->
    // iris path mt_c0000f... -> table miss -> faithful skip (spec §3.3).
    const bogus =
      "chara/human/c9998/obj/face/f0002/texture/--c9998f0002_iri_s.tex";
    const o = opt({ [bogus]: buildMinimalTex() });
    expect(() => updateEyeMask(o, bogus, table)).not.toThrow();
  });

  it("throws on a malformed mask (unparseable header) before the iris gate — EndwalkerUpgrade.cs:2030-2032", () => {
    // A 1-byte mask cannot parse as an uncompressed tex; C# throws at FromUncompressedTex (:2032),
    // before the FileExists gate, regardless of whether the iris material exists. Iris IS in-table
    // here, yet the parse throw must fire first (not the /unported/ pixel-gap throw).
    const o = opt({ [MASK]: new Uint8Array([1]) });
    expect(() => updateEyeMask(o, MASK, table)).toThrow();
    expect(() => updateEyeMask(o, MASK, table)).not.toThrow(/unported/i);
  });

  it("throws on a byte-less mask (ResolveFile null) before the iris gate — EndwalkerUpgrade.cs:2030-2032", () => {
    // A PMP Files entry can name a mask with no bytes (RawUncompressed, data undefined). ResolveFile
    // returns null (:2030) and C# then throws at FromUncompressedTex(null) (XivTex.cs:96); reproduced
    // by the explicit null throw, before the FileExists gate — even though the iris IS in-table here.
    const o: ModpackOption = {
      name: "o",
      description: "",
      image: "",
      priority: 0,
      fileSwaps: {},
      manipulations: [],
      files: new Map<string, ModpackFile>([
        [MASK, { storage: FileStorageType.RawUncompressed }],
      ]),
    };
    expect(() => updateEyeMask(o, MASK, table)).toThrow(/did not resolve/i);
    expect(() => updateEyeMask(o, MASK, table)).not.toThrow(/unported/i);
  });
});

describe("raceCodeFromPath (IOUtil.GetRaceFromPath().GetRaceCode())", () => {
  it("round-trips a known race code to itself", () => {
    expect(raceCodeFromPath(MASK)).toBe("0801");
  });
  it("maps an unknown race code to All_Races's code 0000", () => {
    expect(
      raceCodeFromPath("chara/human/c9998/obj/face/f0002/texture/x.tex"),
    ).toBe("0000");
  });
});

function pack(files: Record<string, Uint8Array>) {
  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: emptyMeta(),
    groups: [
      {
        name: "g",
        description: "",
        image: "",
        page: 0,
        priority: 0,
        selectionType: "Single",
        defaultSettings: 0,
        options: [
          {
            name: "o",
            description: "",
            image: "",
            priority: 0,
            fileSwaps: {},
            manipulations: [],
            files: new Map(
              Object.entries(files).map(([p, d]) => [
                p,
                { storage: FileStorageType.RawUncompressed, data: d } as const,
              ]),
            ),
          },
        ],
      },
    ],
  };
}

// Derive a real, in-table mask path from the first committed iris material key.
const firstIris = [...EYE_MATERIALS.keys()][0]!;
const rc = /c([0-9]{4}).*?f([0-9]{4})/.exec(firstIris)!;
const realMask = `chara/human/c${rc[1]}/obj/face/f${rc[2]}/texture/--c${rc[1]}f${rc[2]}_iri_s.tex`;

describe("upgradeModpack — eye-mask wiring (ModpackUpgrader.cs:174-177)", () => {
  it("throws the documented gap on an unclaimed iri_s.tex whose iris material exists", () => {
    expect(() =>
      upgradeModpack(pack({ [realMask]: buildMinimalTex() })),
    ).toThrow(/unported/i);
  });

  it("does not throw when the iris material is absent (bogus face f9999)", () => {
    const absent = `chara/human/c${rc[1]}/obj/face/f9999/texture/--c${rc[1]}f9999_iri_s.tex`;
    expect(() =>
      upgradeModpack(pack({ [absent]: buildMinimalTex() })),
    ).not.toThrow();
  });
});
