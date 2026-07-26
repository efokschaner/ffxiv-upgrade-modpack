import { describe, expect, it } from "vitest";
import { A8R8G8B8, BC5, DXT1 } from "../../src/tex/types";
import { confirmBcResizedAsA8, confirmDivergence } from "./upgrade-compare";

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

// The load-seam Branch A BC-source NPOT resize divergence (docs/TEXTOOLS_BUGS.md #18,
// docs/backlog/2026-07-22-bc-encoder-merge-pixel-data.md): ours is A8R8G8B8, golden is TexTools' BC
// re-encode of the same resized image -- different format/header/length, so confirmBcResizedAsA8
// decodes both to RGBA rather than comparing bytes. Path-scoped to KK_Sportcar's one diverging file.
//
// Fixture builders mirror test/tex/tex-fixtures.ts's makeSolidDxt5Tex shape (Tex.TexHeader layout,
// Tex.cs:71-130: format@4, width@8, height@10, depth@12, mipCount=low nibble of byte@14, mip0
// offset@28) but build a solid A8R8G8B8 tex and a solid DXT1 tex respectively, since DXT1 (not DXT5)
// is the golden's actual format here.
function makeA8Tex(width: number, height: number, pixelByte = 255): Uint8Array {
  const header = new Uint8Array(80);
  const dv = new DataView(header.buffer);
  dv.setUint32(4, A8R8G8B8, true);
  dv.setUint16(8, width, true);
  dv.setUint16(10, height, true);
  dv.setUint16(12, 1, true); // depth
  dv.setUint8(14, 1); // mipCount (low nibble)
  dv.setUint32(28, 80, true); // mip0 offset
  const mip = new Uint8Array(width * height * 4).fill(pixelByte);
  return Uint8Array.from([...header, ...mip]);
}

// One solid, fully-opaque DXT1 block (8 bytes): color0=0xFFFF (white), color1=0x0000 (black),
// indices=0 -> every texel reads color0. c0 > c1 selects DXT1's 4-color (opaque, non-punch-through)
// mode (see decodeDxt1/writeColorBlock), so alphaFor always returns 255.
const SOLID_DXT1_BLOCK = new Uint8Array([0xff, 0xff, 0x00, 0x00, 0, 0, 0, 0]);

function dxt1Mip(w: number, h: number): Uint8Array {
  const bx = Math.ceil(w / 4);
  const by = Math.ceil(h / 4);
  const out = new Uint8Array(bx * by * 8);
  for (let i = 0; i < bx * by; i++) out.set(SOLID_DXT1_BLOCK, i * 8);
  return out;
}

function makeDxt1Tex(width: number, height: number): Uint8Array {
  const header = new Uint8Array(80);
  const dv = new DataView(header.buffer);
  dv.setUint32(4, DXT1, true);
  dv.setUint16(8, width, true);
  dv.setUint16(10, height, true);
  dv.setUint16(12, 1, true); // depth
  dv.setUint8(14, 1); // mipCount (low nibble)
  dv.setUint32(28, 80, true); // mip0 offset
  return Uint8Array.from([...header, ...dxt1Mip(width, height)]);
}

describe("DIVERGENCE_RULES: load-seam BC-source NPOT resize (KK_Sportcar dwn_s.tex)", () => {
  const PATH =
    "chara/demihuman/d1022/obj/equipment/e0001/texture/v01_d1022e0001_dwn_s.tex";
  // Simulate the prefixed member name the real caller passes (see the mask-rule tests above /
  // docs/backlog/2026-07-16-archive-diff-prefixed-gamepath.md) to pin the endsWith predicate survives it.
  const PREFIXED = `option/0/${PATH}`;

  it("confirms ours A8R8G8B8 vs golden DXT1, same dims, decoded content agrees", () => {
    const ours = makeA8Tex(8, 8, 255); // decodes to solid opaque white
    const golden = makeDxt1Tex(8, 8); // also decodes to solid opaque white
    expect(confirmDivergence(PREFIXED, ours, golden)).toBe(true);
  });

  it("rejects different dims (ours 8x8 vs golden 16x16)", () => {
    const ours = makeA8Tex(8, 8, 255);
    const golden = makeDxt1Tex(16, 16);
    expect(confirmDivergence(PREFIXED, ours, golden)).toBe(false);
  });

  it("rejects ours NOT A8R8G8B8 (e.g. ours is also DXT1 -- a real regression, not this rule's shape)", () => {
    const ours = makeDxt1Tex(8, 8);
    const golden = makeDxt1Tex(8, 8);
    expect(confirmDivergence(PREFIXED, ours, golden)).toBe(false);
  });

  it("rejects a golden that is not a decodable BC format (e.g. golden is also A8R8G8B8)", () => {
    const ours = makeA8Tex(8, 8, 255);
    const golden = makeA8Tex(8, 8, 200);
    expect(confirmDivergence(PREFIXED, ours, golden)).toBe(false);
  });

  it("rejects a different gamePath (path-scoped, not phenomenon-scoped)", () => {
    const ours = makeA8Tex(8, 8, 255);
    const golden = makeDxt1Tex(8, 8);
    expect(
      confirmDivergence(
        "chara/equipment/e0002/texture/v01_c0101e0002_dwn_s.tex",
        ours,
        golden,
      ),
    ).toBe(false);
  });
});

describe("confirmBcResizedAsA8: bound parameter (unused by the shipped rule, but kept for a future bounded case)", () => {
  it("bound omitted: accepts even wildly different decoded pixels (structure-only)", () => {
    const ours = makeA8Tex(8, 8, 0); // decodes to transparent black
    const golden = makeDxt1Tex(8, 8); // decodes to opaque white -- delta 255 on every channel
    expect(confirmBcResizedAsA8(ours, golden)).toBe(true);
  });

  it("bound given: rejects decoded pixels beyond it", () => {
    const ours = makeA8Tex(8, 8, 0); // decodes to transparent black
    const golden = makeDxt1Tex(8, 8); // decodes to opaque white -- delta 255, far beyond bound 10
    expect(confirmBcResizedAsA8(ours, golden, 10)).toBe(false);
  });

  it("bound given: accepts decoded pixels within it", () => {
    const ours = makeA8Tex(8, 8, 250); // decodes to near-white, delta 5 from golden on every channel
    const golden = makeDxt1Tex(8, 8); // decodes to opaque white
    expect(confirmBcResizedAsA8(ours, golden, 10)).toBe(true);
  });
});
