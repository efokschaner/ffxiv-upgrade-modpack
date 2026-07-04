import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeToRgba } from "../../src/tex/decode";
import {
  BC4,
  BC5,
  BC7,
  DXT1,
  DXT3,
  DXT5,
  type XivTex,
} from "../../src/tex/types";
import { applyChannelMap, bc7BlockMode, type ChannelMap } from "./golden-util";

const dir = join(__dirname, "fixtures", "bcn");

interface Vector {
  name: string;
  format: string;
  width: number;
  height: number;
  input: string;
  expected: string;
  channelMap: ChannelMap;
}

const manifest: Vector[] = JSON.parse(
  readFileSync(join(dir, "manifest.json"), "utf8"),
);

const FORMAT_CODES: Record<string, number> = {
  DXT1,
  DXT3,
  DXT5,
  BC4,
  BC5,
  BC7,
};

function texOf(
  format: number,
  width: number,
  height: number,
  mipData: Uint8Array,
): XivTex {
  return {
    attributes: 0,
    format,
    width,
    height,
    depth: 1,
    mipCount: 1,
    mipFlag: 0,
    arraySize: 1,
    lodMips: [0, 0, 0],
    mipMapOffsets: new Array(13).fill(0),
    mipData,
  };
}

describe("tex BCn golden decode (texconv oracle)", () => {
  it("manifest is non-empty", () => {
    expect(manifest.length).toBeGreaterThan(0);
  });

  for (const v of manifest) {
    it(`${v.name} decodes to the texconv golden (${v.format} ${v.width}x${v.height})`, () => {
      const code = FORMAT_CODES[v.format];
      expect(code, `unknown format ${v.format}`).toBeDefined();
      const input = new Uint8Array(readFileSync(join(dir, v.input)));
      const golden = new Uint8Array(readFileSync(join(dir, v.expected)));
      const ours = decodeToRgba(
        texOf(code as number, v.width, v.height, input),
      );
      const expected = applyChannelMap(golden, v.channelMap);
      expect(ours.length).toBe(expected.length);
      expect(Buffer.from(ours).equals(Buffer.from(expected))).toBe(true);
    });
  }
});

describe("tex BCn golden: BC7 mode coverage", () => {
  it("BC7 fixtures cover all 8 modes (0-7)", () => {
    const modes = new Set<number>();
    for (const v of manifest) {
      if (v.format !== "BC7") continue;
      const input = new Uint8Array(readFileSync(join(dir, v.input)));
      for (let off = 0; off + 16 <= input.length; off += 16)
        modes.add(bc7BlockMode(input, off));
    }
    expect([...modes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
