// Tests for the hair/tail/ear rescue (EndwalkerUpgrade.cs:1342-1503) AND the tail-only
// constant-swap material rewrite (EndwalkerUpgrade.cs:1504-1516), see
// src/upgrade/unclaimed-hair.ts for provenance. No accessory coverage here (Task 6); this file
// exercises the shared match->group->winnow->copy->transform path plus the tail rewrite.
import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackFile,
  type ModpackOption,
} from "../../src/model/modpack";
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";
import { parseTex } from "../../src/tex/tex";
import { SAMPLE_HAIR_MTRL_BASE64 } from "../../src/upgrade/reference/hair-materials";
import type { HairMaterialTable } from "../../src/upgrade/reference/hair-materials-types";
import {
  updateUnclaimedHairAccessory,
  updateUnclaimedHairTextures,
} from "../../src/upgrade/unclaimed-hair";
import { resolveFile } from "../../src/upgrade/upgrade";
import { buildMinimalMtrl } from "../mtrl/make-mtrl";
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

describe("updateUnclaimedHairTextures (tail)", () => {
  const TAIL_MAT =
    "chara/human/c0201/obj/tail/t0005/material/v0001/mt_c0201t0005_a.mtrl";
  const TAIL_NORM_DEST =
    "chara/human/c0201/obj/tail/t0005/texture/--c0201t0005_etc_norm.tex";
  const TAIL_MASK_DEST =
    "chara/human/c0201/obj/tail/t0005/texture/--c0201t0005_etc_mask.tex";

  // Fixture canonical tail mtrl with HideBackfaces explicitly CLEARED, so the assertion below
  // actually exercises the rewrite (buildMinimalMtrl()'s raw materialFlags happens to already
  // carry that bit; clearing it first keeps the test meaningful).
  const canonParsed = parseMtrl(buildMinimalMtrl(), TAIL_MAT);
  canonParsed.materialFlags &= ~0x01;
  const tailRewriteMtrlBase64 = Buffer.from(
    serializeMtrl(canonParsed),
  ).toString("base64");

  const tailTable: HairMaterialTable = new Map([
    [
      TAIL_MAT,
      {
        shaderPackRaw: "hair.shpk",
        normalDx11Path: TAIL_NORM_DEST,
        maskDx11Path: TAIL_MASK_DEST,
        hideBackfaces: false,
        tailRewriteMtrlBase64,
      },
    ],
  ]);

  it("tail: writes the canonical material with HideBackfaces set", () => {
    const nOld =
      "chara/human/c0201/obj/tail/t0005/texture/c0201t0005_etc_n.tex";
    const sOld =
      "chara/human/c0201/obj/tail/t0005/texture/c0201t0005_etc_s.tex";
    const o = opt({ [nOld]: buildMinimalTex(), [sOld]: buildMinimalTex() });

    updateUnclaimedHairTextures(o, new Set([nOld, sOld]), tailTable);

    const written = o.files.get(TAIL_MAT);
    expect(written).toBeDefined();
    const back = parseMtrl(resolveFile(written!)!.bytes, TAIL_MAT);
    expect(back.materialFlags & 0x01).toBe(0x01);
    // Constants are ripped from _SampleHair, not left as the canon's own.
    const sample = parseMtrl(
      new Uint8Array(Buffer.from(SAMPLE_HAIR_MTRL_BASE64, "base64")),
      "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl",
    );
    expect(back.shaderConstants).toEqual(sample.shaderConstants);
  });

  it("skips the rewrite when the canonical tail material already has HideBackfaces (no tailRewriteMtrlBase64)", () => {
    // Matches the generator's real invariant (hair-materials-types.ts): tailRewriteMtrlBase64 is
    // present ONLY for tail entries lacking HideBackfaces, so an already-set entry has none.
    const mat =
      "chara/human/c0201/obj/tail/t0006/material/v0001/mt_c0201t0006_a.mtrl";
    const normDest =
      "chara/human/c0201/obj/tail/t0006/texture/--c0201t0006_etc_norm.tex";
    const maskDest =
      "chara/human/c0201/obj/tail/t0006/texture/--c0201t0006_etc_mask.tex";
    const t: HairMaterialTable = new Map([
      [
        mat,
        {
          shaderPackRaw: "hair.shpk",
          normalDx11Path: normDest,
          maskDx11Path: maskDest,
          hideBackfaces: true,
        },
      ],
    ]);
    const nOld =
      "chara/human/c0201/obj/tail/t0006/texture/c0201t0006_etc_n.tex";
    const sOld =
      "chara/human/c0201/obj/tail/t0006/texture/c0201t0006_etc_s.tex";
    const o = opt({ [nOld]: buildMinimalTex(), [sOld]: buildMinimalTex() });

    updateUnclaimedHairTextures(o, new Set([nOld, sOld]), t);

    // Textures are still rescued...
    expect(o.files.has(normDest)).toBe(true);
    expect(o.files.has(maskDest)).toBe(true);
    // ...but the canonical material is never written.
    expect(o.files.has(mat)).toBe(false);
  });

  it("does not rewrite a material for a HAIR group (isTail false)", () => {
    const nOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
    const sOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_s.tex";
    const o = opt({ [nOld]: buildMinimalTex(), [sOld]: buildMinimalTex() });

    updateUnclaimedHairTextures(o, new Set([nOld, sOld]), table);

    expect(o.files.has(HAIR_NORM_DEST)).toBe(true);
    expect(o.files.has(HAIR_MASK_DEST)).toBe(true);
    expect(o.files.has(HAIR_MAT)).toBe(false);
  });
});

// Accessory (EndwalkerUpgrade.cs:1522-1716). Differs from hair/tail/ear in several load-bearing
// ways -- see src/upgrade/unclaimed-hair.ts's updateUnclaimedHairAccessory header for citations.
describe("updateUnclaimedHairAccessory", () => {
  const ACC_MAT =
    "chara/human/c0101/obj/hair/h0001/material/v0001/mt_c0101h0001_acc_b.mtrl";
  const ACC_NORM_DEST =
    "chara/human/c0101/obj/hair/h0001/texture/--c0101h0001_acc_norm.tex";
  const ACC_DIFF_DEST =
    "chara/human/c0101/obj/hair/h0001/texture/--c0101h0001_acc_diff.tex";
  const ACC_MASK_DEST =
    "chara/human/c0101/obj/hair/h0001/texture/--c0101h0001_acc_mask.tex";

  const accTable: HairMaterialTable = new Map([
    [
      ACC_MAT,
      {
        shaderPackRaw: "character.shpk",
        normalDx11Path: ACC_NORM_DEST,
        maskDx11Path: ACC_MASK_DEST,
        diffuseDx11Path: ACC_DIFF_DEST,
        hideBackfaces: false,
      },
    ],
  ]);

  it("copies a loose normal+diffuse to the entry's normal + diffuse Dx11 destinations", () => {
    const nOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_n.tex";
    const dOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_d.tex";
    const o = opt({ [nOld]: buildMinimalTex(), [dOld]: buildMinimalTex() });

    updateUnclaimedHairAccessory(o, new Set([nOld, dOld]), accTable);

    expect(o.files.has(ACC_NORM_DEST)).toBe(true);
    expect(o.files.has(ACC_DIFF_DEST)).toBe(true);
  });

  it("skips the whole (race,id) -- nothing copied -- when a specular tex is present but the entry has no maskDx11Path", () => {
    const nOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_n.tex";
    const sOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_s.tex";
    const t: HairMaterialTable = new Map([
      [
        ACC_MAT,
        {
          shaderPackRaw: "character.shpk",
          normalDx11Path: ACC_NORM_DEST,
          // no maskDx11Path
          hideBackfaces: false,
        },
      ],
    ]);
    const o = opt({ [nOld]: buildMinimalTex(), [sOld]: buildMinimalTex() });

    updateUnclaimedHairAccessory(o, new Set([nOld, sOld]), t);

    // Early break (EndwalkerUpgrade.cs:1656-1660) aborts the whole (race,id): even the
    // normal tex, which had a valid destination, is not copied either.
    expect(o.files.has(ACC_NORM_DEST)).toBe(false);
    expect(o.files.has(ACC_MASK_DEST)).toBe(false);
  });

  it("does NOT require both texTypes -- a single diffuse-only tex with no material still gets copied (no bothTypesRequired winnow, unlike hair)", () => {
    const dOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_d.tex";
    const o = opt({ [dOld]: buildMinimalTex() });

    updateUnclaimedHairAccessory(o, new Set([dOld]), accTable);

    expect(o.files.has(ACC_DIFF_DEST)).toBe(true);
    // No normal source was provided, so nothing is written to the normal destination.
    expect(o.files.has(ACC_NORM_DEST)).toBe(false);
  });

  it("winnow drops a (race,id) whose material IS present in `contained` (no-material-only, EndwalkerUpgrade.cs:1590-1596)", () => {
    const dOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_d.tex";
    const o = opt({ [dOld]: buildMinimalTex(), [ACC_MAT]: buildMinimalTex() });

    updateUnclaimedHairAccessory(o, new Set([dOld, ACC_MAT]), accTable);

    expect(o.files.has(ACC_DIFF_DEST)).toBe(false);
  });

  it("scans ONLY `contained` for materials -- a material present in option.files but absent from `contained` does not winnow it out (asymmetry vs hair, EndwalkerUpgrade.cs:1527)", () => {
    const dOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_d.tex";
    // ACC_MAT is present in the option's files but deliberately excluded from `contained` --
    // hair would still notice it (it scans option.files.keys() for materials); accessory must not.
    const o = opt({ [dOld]: buildMinimalTex(), [ACC_MAT]: buildMinimalTex() });

    updateUnclaimedHairAccessory(o, new Set([dOld]), accTable);

    expect(o.files.has(ACC_DIFF_DEST)).toBe(true);
  });

  it("accepts characterlegacy.shpk as well as character.shpk", () => {
    const dOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_d.tex";
    const t: HairMaterialTable = new Map([
      [
        ACC_MAT,
        {
          shaderPackRaw: "characterlegacy.shpk",
          normalDx11Path: ACC_NORM_DEST,
          diffuseDx11Path: ACC_DIFF_DEST,
          hideBackfaces: false,
        },
      ],
    ]);
    const o = opt({ [dOld]: buildMinimalTex() });

    updateUnclaimedHairAccessory(o, new Set([dOld]), t);

    expect(o.files.has(ACC_DIFF_DEST)).toBe(true);
  });

  it("skips when the shader pack is neither character.shpk nor characterlegacy.shpk", () => {
    const dOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_d.tex";
    const t: HairMaterialTable = new Map([
      [
        ACC_MAT,
        {
          shaderPackRaw: "hair.shpk",
          normalDx11Path: ACC_NORM_DEST,
          diffuseDx11Path: ACC_DIFF_DEST,
          hideBackfaces: false,
        },
      ],
    ]);
    const o = opt({ [dOld]: buildMinimalTex() });

    updateUnclaimedHairAccessory(o, new Set([dOld]), t);

    expect(o.files.has(ACC_DIFF_DEST)).toBe(false);
  });

  it("skips the whole (race,id) when the entry has no normalDx11Path at all", () => {
    const dOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_d.tex";
    const t: HairMaterialTable = new Map([
      [
        ACC_MAT,
        {
          shaderPackRaw: "character.shpk",
          // no normalDx11Path
          diffuseDx11Path: ACC_DIFF_DEST,
          hideBackfaces: false,
        },
      ],
    ]);
    const o = opt({ [dOld]: buildMinimalTex() });

    updateUnclaimedHairAccessory(o, new Set([dOld]), t);

    expect(o.files.has(ACC_DIFF_DEST)).toBe(false);
  });

  it("skips when a destination is already present in `contained` (already-converted guard, EndwalkerUpgrade.cs:1672)", () => {
    // Unlike hair (which checks ALL option files, :1466), the accessory guard checks the SAME
    // `files` list bound to `contained` (:1672), not `fileInfos`/option.files. So the pre-existing
    // destination must be reflected in `contained` for the guard to fire -- matching how the real
    // `partials()` glue builds it (`contained = unusedTextures ∩ option.files.keys()`, so
    // `contained` is always a subset of `option.files`, never the other way around).
    const nOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_n.tex";
    const dOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_d.tex";
    const o = opt({
      [nOld]: buildMinimalTex(),
      [dOld]: buildMinimalTex(),
      [ACC_DIFF_DEST]: buildMinimalTex(), // already converted
    });

    updateUnclaimedHairAccessory(
      o,
      new Set([nOld, dOld, ACC_DIFF_DEST]),
      accTable,
    );

    // The whole (race,id) is skipped -- the normal destination must NOT be written either.
    expect(o.files.has(ACC_NORM_DEST)).toBe(false);
  });

  it("does NOT skip when the destination exists only in option.files but not in `contained` (proves the guard checks `contained`, not all option files)", () => {
    const nOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_n.tex";
    const dOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_d.tex";
    const o = opt({
      [nOld]: buildMinimalTex(),
      [dOld]: buildMinimalTex(),
      [ACC_DIFF_DEST]: buildMinimalTex(), // present in the option, but NOT passed via `contained`
    });

    updateUnclaimedHairAccessory(o, new Set([nOld, dOld]), accTable);

    // The guard only consults `contained`, so this is NOT treated as already-converted; the
    // normal destination gets written (the diffuse copy overwrites the pre-existing file, as the
    // C# does).
    expect(o.files.has(ACC_NORM_DEST)).toBe(true);
  });

  it("performs a pure raw copy -- no pixel transform -- even for mismatched normal/diffuse sizes", () => {
    const nOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_n.tex";
    const dOld =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_acc_d.tex";
    const normBytes = buildMinimalTexSized(2, 2);
    const diffBytes = buildMinimalTexSized(4, 4);
    const o = opt({ [nOld]: normBytes, [dOld]: diffBytes });

    updateUnclaimedHairAccessory(o, new Set([nOld, dOld]), accTable);

    // Bytes at the destinations equal the raw source bytes verbatim -- no transform attempted,
    // so a size mismatch that would throw in the hair pixel transform is a non-issue here.
    expect(o.files.get(ACC_NORM_DEST)!.data).toEqual(normBytes);
    expect(o.files.get(ACC_DIFF_DEST)!.data).toEqual(diffBytes);
  });
});
