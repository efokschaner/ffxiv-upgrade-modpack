import { describe, expect, it } from "vitest";
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";
import {
  getRealSamplerCount,
  isEmptySampler,
  SAMPLER_COLOR_MAP_0,
  SAMPLER_NORMAL_MAP_0,
} from "../../src/mtrl/types";
import { buildDoubleUvMtrl, buildEmptySamplerMtrl } from "./make-mtrl";

describe("mtrl sampler handling", () => {
  it("drops the double-written secondary on parse and regenerates it on serialize", () => {
    const x = buildDoubleUvMtrl();
    const m = parseMtrl(x);

    // The secondary NormalMap1 was dropped; only the primary remains on texture 0.
    expect(m.textures).toHaveLength(1);
    expect(m.textures[0]!.sampler!.samplerIdRaw).toBe(SAMPLER_NORMAL_MAP_0);
    expect(getRealSamplerCount(m)).toBe(2); // primary + regenerated secondary

    expect(serializeMtrl(m)).toEqual(x);
  });

  it("parses an index-255 empty sampler into a placeholder texture", () => {
    const x = buildEmptySamplerMtrl();
    const m = parseMtrl(x);

    expect(m.textures).toHaveLength(2);
    expect(isEmptySampler(m.textures[0]!)).toBe(false);
    expect(isEmptySampler(m.textures[1]!)).toBe(true);
    expect(m.textures[1]!.sampler!.samplerIdRaw).toBe(SAMPLER_COLOR_MAP_0);
  });

  it("fails loud on serializing an empty-sampler placeholder (C# quirk not yet reproduced, audit M1/M2)", () => {
    // C#'s ToLower (Mtrl.cs:560) defeats its uppercase-const StartsWith exclusion checks, so C#
    // WRITES placeholders as ordinary textures — the opposite of the old excluding behaviour this
    // test used to assert. Byte-exact reproduction needs a synthetic modpack (C#'s placeholder path
    // is the lowercased ESamplerId name, not our numeric raw id), so serialize throws until pinned.
    const m = parseMtrl(buildEmptySamplerMtrl());
    expect(() => serializeMtrl(m)).toThrow(/empty-sampler placeholder/);
  });
});
