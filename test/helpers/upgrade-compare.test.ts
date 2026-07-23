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

// The NPOT BC-source mask divergence (docs/TEXTOOLS_BUGS.md #18): path-scoped rules that accept the
// unbounded BC-round-trip pixel divergence on the two fixture masks while still checking structure.
// The prefixed member name the caller actually passes is simulated with an "option/N/" prefix, to
// pin that the endsWith predicate survives it (docs/backlog/2026-07-16-archive-diff-prefixed-gamepath.md).
describe("DIVERGENCE_RULES: NPOT BC-source mask (top_b bounded, top_c structure-only)", () => {
  const SMOOTH =
    "option/0/chara/equipment/e9999/texture/c9999e9999_top_b_m.tex";
  const ADV = "option/0/chara/equipment/e9999/texture/c9999e9999_top_c_m.tex";
  const A8 = "option/0/chara/equipment/e9999/texture/c9999e9999_top_a_m.tex";

  it("top_b: confirms a same-shape A8R8G8B8 mask within the sanity ceiling (delta 9)", () => {
    const ours = makeTex(A8R8G8B8, [10, 20, 30, 255, 100, 200, 5, 250]);
    const golden = makeTex(A8R8G8B8, [19, 11, 39, 246, 91, 209, 14, 241]); // each ±9
    expect(confirmDivergence(SMOOTH, ours, golden)).toBe(true);
  });

  it("top_b: rejects a delta beyond the ceiling (33 > NPOT_MASK_BC_BOUND)", () => {
    const ours = makeTex(A8R8G8B8, [10, 20, 30, 255]);
    const golden = makeTex(A8R8G8B8, [10, 20, 63, 255]); // delta 33
    expect(confirmDivergence(SMOOTH, ours, golden)).toBe(false);
  });

  it("top_c: confirms even a huge pixel delta (adversarial: structure-only)", () => {
    const ours = makeTex(A8R8G8B8, [10, 20, 30, 255]);
    const golden = makeTex(A8R8G8B8, [10, 136, 30, 255]); // delta 116
    expect(confirmDivergence(ADV, ours, golden)).toBe(true);
  });

  it("top_c: still rejects wrong dims / truncation (structure guard holds)", () => {
    const ours = makeTex(A8R8G8B8, [10, 20, 30, 255]);
    const golden = makeTex(A8R8G8B8, [10, 20, 30]); // shorter
    expect(confirmDivergence(ADV, ours, golden)).toBe(false);
  });

  it("top_c: rejects a non-A8R8G8B8 format", () => {
    const ours = makeTex(DXT1, [10, 20, 30, 255]);
    const golden = makeTex(DXT1, [200, 20, 30, 255]);
    expect(confirmDivergence(ADV, ours, golden)).toBe(false);
  });

  it("does NOT cover top_a (npot-mask-a8): its mask stays a hard byte-exact guard", () => {
    // A big diff on the a8 mask must NOT be confirmed by these rules (nor the ±1 rule) — it should
    // surface as a real regression. This is why the fixtures need distinct gamePaths.
    const ours = makeTex(A8R8G8B8, [10, 20, 30, 255]);
    const golden = makeTex(A8R8G8B8, [10, 136, 30, 255]); // delta 116
    expect(confirmDivergence(A8, ours, golden)).toBe(false);
  });
});
