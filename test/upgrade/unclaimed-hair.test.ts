// Tests for the hair/tail/ear rescue (EndwalkerUpgrade.cs:1342-1503), see
// src/upgrade/unclaimed-hair.ts for provenance. No tail-rewrite / accessory coverage here
// (Tasks 5/6); this file only exercises the shared match->group->winnow->copy->transform path.
import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackFile,
  type ModpackOption,
} from "../../src/model/modpack";
import { parseTex } from "../../src/tex/tex";
import type { HairMaterialTable } from "../../src/upgrade/reference/hair-materials-types";
import { updateUnclaimedHairTextures } from "../../src/upgrade/unclaimed-hair";
import { buildMinimalTex, buildMinimalTexSized } from "../tex/make-tex";

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

const HAIR_MAT =
  "chara/human/c0101/obj/hair/h0001/material/v0001/mt_c0101h0001_hir_a.mtrl";
const HAIR_NORM_DEST =
  "chara/human/c0101/obj/hair/h0001/texture/--c0101h0001_hir_norm.tex";
const HAIR_MASK_DEST =
  "chara/human/c0101/obj/hair/h0001/texture/--c0101h0001_hir_mask.tex";

const table: HairMaterialTable = new Map([
  [
    HAIR_MAT,
    {
      shaderPackRaw: "hair.shpk",
      normalDx11Path: HAIR_NORM_DEST,
      maskDx11Path: HAIR_MASK_DEST,
      hideBackfaces: false,
    },
  ],
]);

describe("updateUnclaimedHairTextures (hair)", () => {
  it("copies a loose normal+mask to the canonical Dx11 destinations", () => {
    const nOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
    const sOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_s.tex";
    const o = opt({ [nOld]: buildMinimalTex(), [sOld]: buildMinimalTex() });
    updateUnclaimedHairTextures(o, new Set([nOld, sOld]), table);
    expect(o.files.has(HAIR_NORM_DEST)).toBe(true);
    expect(o.files.has(HAIR_MASK_DEST)).toBe(true);
  });

  it("skips when the base material IS present", () => {
    const nOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
    const sOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_s.tex";
    const o = opt({
      [nOld]: buildMinimalTex(),
      [sOld]: buildMinimalTex(),
      [HAIR_MAT]: buildMinimalTex(),
    });
    updateUnclaimedHairTextures(o, new Set([nOld, sOld]), table);
    expect(o.files.has(HAIR_NORM_DEST)).toBe(false);
    expect(o.files.has(HAIR_MASK_DEST)).toBe(false);
  });

  it("skips a (race,id) with only one of the two texTypes", () => {
    const nOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
    const o = opt({ [nOld]: buildMinimalTex() });
    updateUnclaimedHairTextures(o, new Set([nOld]), table);
    expect(o.files.has(HAIR_NORM_DEST)).toBe(false);
  });

  it("Dx11-prefixed (--) source wins the tie-break over a non-Dx11 one for the same texType", () => {
    // Both a non-Dx11 and a Dx11 normal are present, distinguishable by SIZE so the test is not
    // vacuous: the non-Dx11 normal is 4x4, the Dx11 normal and the mask are both 2x2. If the
    // tie-break wrongly picked the non-Dx11 (4x4) source, it would mismatch the 2x2 mask, the
    // transform would throw, and the raw 4x4 copy would remain at the destination (width 4).
    // Only the Dx11 (2x2) source winning lets the transform succeed, producing a 2x2 destination.
    const nOldPlain =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
    const nOldDx11 =
      "chara/human/c0101/obj/hair/h0001/texture/--c0101h0001_hir_n.tex";
    const sOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_s.tex";
    const o = opt({
      [nOldPlain]: buildMinimalTexSized(4, 4),
      [nOldDx11]: buildMinimalTexSized(2, 2),
      [sOld]: buildMinimalTexSized(2, 2),
    });
    updateUnclaimedHairTextures(o, new Set([nOldPlain, nOldDx11, sOld]), table);
    expect(o.files.has(HAIR_NORM_DEST)).toBe(true);
    expect(o.files.has(HAIR_MASK_DEST)).toBe(true);
    const normFile = o.files.get(HAIR_NORM_DEST)!;
    const parsed = parseTex(normFile.data!);
    expect(parsed.width).toBe(2);
  });

  it("does not match textures that are outside `contained` even if present in option.files", () => {
    const nOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
    const sOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_s.tex";
    // Both files exist in the option, but `contained` (the pass-3 unused-texture set) is empty.
    const o = opt({ [nOld]: buildMinimalTex(), [sOld]: buildMinimalTex() });
    updateUnclaimedHairTextures(o, new Set(), table);
    expect(o.files.has(HAIR_NORM_DEST)).toBe(false);
    expect(o.files.has(HAIR_MASK_DEST)).toBe(false);
  });

  it("skips a (race,id) whose canonical material is missing from the table (FileExists false)", () => {
    const nOld =
      "chara/human/c0102/obj/hair/h0002/texture/c0102h0002_hir_n.tex";
    const sOld =
      "chara/human/c0102/obj/hair/h0002/texture/c0102h0002_hir_s.tex";
    const o = opt({ [nOld]: buildMinimalTex(), [sOld]: buildMinimalTex() });
    // Fresh empty table -> lookup miss -> continue.
    updateUnclaimedHairTextures(o, new Set([nOld, sOld]), new Map());
    const destNorm =
      "chara/human/c0102/obj/hair/h0002/texture/--c0102h0002_hir_norm.tex";
    expect(o.files.has(destNorm)).toBe(false);
  });

  it("skips when the shader pack gate does not match hair.shpk", () => {
    const nOld =
      "chara/human/c0103/obj/hair/h0003/texture/c0103h0003_hir_n.tex";
    const sOld =
      "chara/human/c0103/obj/hair/h0003/texture/c0103h0003_hir_s.tex";
    const matPath =
      "chara/human/c0103/obj/hair/h0003/material/v0001/mt_c0103h0003_hir_a.mtrl";
    const norm =
      "chara/human/c0103/obj/hair/h0003/texture/--c0103h0003_hir_norm.tex";
    const mask =
      "chara/human/c0103/obj/hair/h0003/texture/--c0103h0003_hir_mask.tex";
    const t: HairMaterialTable = new Map([
      [
        matPath,
        {
          shaderPackRaw: "skin.shpk", // not hair.shpk
          normalDx11Path: norm,
          maskDx11Path: mask,
          hideBackfaces: false,
        },
      ],
    ]);
    const o = opt({ [nOld]: buildMinimalTex(), [sOld]: buildMinimalTex() });
    updateUnclaimedHairTextures(o, new Set([nOld, sOld]), t);
    expect(o.files.has(norm)).toBe(false);
  });

  it("skips when a destination is already present (already-converted guard)", () => {
    const nOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
    const sOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_s.tex";
    const o = opt({
      [nOld]: buildMinimalTex(),
      [sOld]: buildMinimalTex(),
      [HAIR_NORM_DEST]: buildMinimalTex(), // already converted
    });
    updateUnclaimedHairTextures(o, new Set([nOld, sOld]), table);
    // The mask destination must NOT have been written either -- the whole (race,id) is skipped.
    expect(o.files.has(HAIR_MASK_DEST)).toBe(false);
  });

  it("leaves the raw copies untransformed when the transform throws (bare catch-all, EndwalkerUpgrade.cs:1498-1501)", () => {
    // Normal 2x2 vs mask 4x4: a genuine size mismatch, so updateEndwalkerHairTextures throws
    // TextureResizeUnsupported (EndwalkerUpgrade.cs:1205). The function must not propagate that
    // (or any other transform error) -- it must swallow it, leaving the raw copies already
    // written by the copy-first step untouched at both destinations.
    const nOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
    const sOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_s.tex";
    const normBytes = buildMinimalTexSized(2, 2);
    const maskBytes = buildMinimalTexSized(4, 4);
    const o = opt({ [nOld]: normBytes, [sOld]: maskBytes });

    expect(() =>
      updateUnclaimedHairTextures(o, new Set([nOld, sOld]), table),
    ).not.toThrow();

    expect(o.files.has(HAIR_NORM_DEST)).toBe(true);
    expect(o.files.has(HAIR_MASK_DEST)).toBe(true);
    // Bytes at the destinations equal the raw source bytes verbatim -- untransformed.
    expect(o.files.get(HAIR_NORM_DEST)!.data).toEqual(normBytes);
    expect(o.files.get(HAIR_MASK_DEST)!.data).toEqual(maskBytes);
  });
});
