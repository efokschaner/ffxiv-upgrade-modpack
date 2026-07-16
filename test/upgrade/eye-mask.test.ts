// Tests for the round-6 eye-mask control-flow gate (EndwalkerUpgrade.cs:2007-2079), see
// src/upgrade/eye-mask.ts. The pixel conversion (ConvertEyeMaskToDiffuse) is deferred
// (docs/backlog/2026-07-15-partials-eye-mask.md); this file pins the guards and the fail-loud throw.
import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackFile,
  type ModpackOption,
} from "../../src/model/modpack";
import { raceCodeFromPath, updateEyeMask } from "../../src/upgrade/eye-mask";
import type { EyeMaterialTable } from "../../src/upgrade/reference/eye-materials-types";

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
    const o = opt({ [MASK]: new Uint8Array([1]) });
    expect(() => updateEyeMask(o, MASK, table)).toThrow(/unported/i);
  });

  it("skips (no throw) a non-eye texture — regex miss (EndwalkerUpgrade.cs:2009)", () => {
    const other =
      "chara/human/c0801/obj/face/f0002/texture/--c0801f0002_norm.tex";
    const o = opt({ [other]: new Uint8Array([1]) });
    expect(() => updateEyeMask(o, other, table)).not.toThrow();
  });

  it("skips (no throw) when the iris material is absent — FileExists false (EndwalkerUpgrade.cs:2049)", () => {
    const o = opt({ [MASK]: new Uint8Array([1]) });
    expect(() => updateEyeMask(o, MASK, empty)).not.toThrow();
  });

  it("skips (no throw) a mask whose race digits are not a real race (round-trips to c0000, table miss)", () => {
    // c9998 is not a XivRace Description -> GetXivRace defaults to All_Races -> code "0000" ->
    // iris path mt_c0000f... -> table miss -> faithful skip (spec §3.3).
    const bogus =
      "chara/human/c9998/obj/face/f0002/texture/--c9998f0002_iri_s.tex";
    const o = opt({ [bogus]: new Uint8Array([1]) });
    expect(() => updateEyeMask(o, bogus, table)).not.toThrow();
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
