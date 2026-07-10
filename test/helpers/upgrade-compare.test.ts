import { describe, expect, it } from "vitest";
import { A8R8G8B8, BC5, DXT1 } from "../../src/tex/types";
import { confirmDivergence } from "./upgrade-compare";

/** Builds an 80-byte XivTex header (XivTex.cs layout, see src/tex/types.ts) with the given
 *  format at byte offset 4 (u32 LE) and zeroed everything else. */
function makeHeader(format: number): Uint8Array {
  const header = new Uint8Array(80);
  new DataView(header.buffer).setUint32(4, format, true);
  return header;
}

function makeTex(format: number, pixelBytes: number[]): Uint8Array {
  const header = makeHeader(format);
  return Uint8Array.from([...header, ...pixelBytes]);
}

describe("DIVERGENCE_RULES: BC-source-decode ±1 on generated A8R8G8B8 textures", () => {
  it("confirms when header is identical and pixel bytes differ by exactly ±1", () => {
    const ours = makeTex(A8R8G8B8, [10, 20, 30, 255, 0, 254, 128, 129]);
    const golden = makeTex(A8R8G8B8, [11, 19, 30, 255, 1, 255, 127, 128]);
    expect(confirmDivergence("chara/foo_id.tex", ours, golden)).toBe(true);
  });

  it("rejects when a pixel byte differs by 2", () => {
    const ours = makeTex(A8R8G8B8, [10, 20, 30, 255]);
    const golden = makeTex(A8R8G8B8, [10, 20, 32, 255]);
    expect(confirmDivergence("chara/foo_id.tex", ours, golden)).toBe(false);
  });

  it("rejects when lengths differ (e.g. golden is trailing-trimmed)", () => {
    const ours = makeTex(A8R8G8B8, [10, 20, 30, 255]);
    const golden = makeTex(A8R8G8B8, [10, 20, 30]);
    expect(confirmDivergence("chara/foo_id.tex", ours, golden)).toBe(false);
  });

  it("rejects when the header differs (e.g. width byte)", () => {
    const ours = makeTex(A8R8G8B8, [10, 20, 30, 255]);
    const golden = makeTex(A8R8G8B8, [10, 20, 30, 255]);
    golden[8] = 0xff; // width low byte @8 differs
    expect(confirmDivergence("chara/foo_id.tex", ours, golden)).toBe(false);
  });

  it("rejects when the header format field is not A8R8G8B8 (e.g. DXT1)", () => {
    const ours = makeTex(DXT1, [10, 20, 30, 255]);
    const golden = makeTex(DXT1, [11, 19, 30, 255]);
    expect(confirmDivergence("chara/foo_id.tex", ours, golden)).toBe(false);
  });

  it("rejects when the header format field is BC5, even with ±1 post-header bytes", () => {
    const ours = makeTex(BC5, [10, 20, 30, 255]);
    const golden = makeTex(BC5, [11, 19, 31, 254]);
    expect(confirmDivergence("chara/foo_id.tex", ours, golden)).toBe(false);
  });

  it("rejects a non-.tex gamePath even with matching ±1 bytes", () => {
    const ours = makeTex(A8R8G8B8, [10, 20, 30, 255]);
    const golden = makeTex(A8R8G8B8, [11, 19, 30, 255]);
    expect(confirmDivergence("chara/foo.mtrl", ours, golden)).toBe(false);
  });
});
