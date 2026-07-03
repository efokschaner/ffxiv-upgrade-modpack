import { describe, expect, it } from "vitest";
import { parseMtrl, serializeMtrl } from "../src/mtrl/mtrl";
import {
  getRealSamplerCount,
  isEmptySampler,
  SAMPLER_COLOR_MAP_0,
  SAMPLER_NORMAL_MAP_0,
} from "../src/mtrl/types";
import { buildDoubleUvMtrl, buildEmptySamplerMtrl } from "./helpers/make-mtrl";

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

  it("round-trips an index-255 empty sampler as an excluded placeholder texture", () => {
    const x = buildEmptySamplerMtrl();
    const m = parseMtrl(x);

    expect(m.textures).toHaveLength(2);
    expect(isEmptySampler(m.textures[0]!)).toBe(false);
    expect(isEmptySampler(m.textures[1]!)).toBe(true);
    expect(m.textures[1]!.sampler!.samplerIdRaw).toBe(SAMPLER_COLOR_MAP_0);

    const out = serializeMtrl(m);
    expect(out[12]).toBe(1); // header texCount byte excludes the placeholder
    expect(out).toEqual(x);
  });
});
