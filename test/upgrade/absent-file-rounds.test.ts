import { describe, expect, it } from "vitest";
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackOption,
} from "../../src/model/modpack";
import { upgradeRemainingTextures } from "../../src/upgrade/texture";
import { upgradeModpack } from "../../src/upgrade/upgrade";
import {
  EUpgradeTextureUsage,
  type UpgradeInfo,
} from "../../src/upgrade/upgrade-info";
import { filesMap } from "../helpers/make-packs";

/** A file the archive did not contain: present in the option, no bytes (PMP.cs:1071-1102). */
function absent(gamePath: string): [string, ModpackFile] {
  return [gamePath, { storage: FileStorageType.RawUncompressed }];
}
function present(gamePath: string, data: Uint8Array): [string, ModpackFile] {
  return [gamePath, { data, storage: FileStorageType.RawUncompressed }];
}
function optionOf(files: Array<[string, ModpackFile]>): ModpackOption {
  return {
    name: "On",
    description: "",
    image: "",
    priority: 0,
    files: filesMap(files),
    fileSwaps: {},
    manipulations: [],
  };
}
function packOf(option: ModpackOption): ModpackData {
  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: {
      name: "t",
      author: "t",
      version: "1",
      description: "",
      url: "",
      image: "",
      tags: [],
      minimumFrameworkVersion: "1.0.0.0",
    },
    groups: [
      {
        name: "G",
        description: "",
        image: "",
        page: 0,
        priority: 0,
        selectionType: "Single",
        defaultSettings: 0,
        options: [option],
      },
    ],
  };
}

describe("upgrade rounds vs an absent file (ResolveFile, EndwalkerUpgrade.cs:1758)", () => {
  it("material round skips it, leaving the entry untouched (:495 continue)", () => {
    const data = packOf(
      optionOf([
        absent("chara/equipment/e0001/material/v0001/mt_c0101e0001_top_a.mtrl"),
      ]),
    );
    const out = upgradeModpack(data);
    const f = out.groups[0]!.options[0]!.files.get(
      "chara/equipment/e0001/material/v0001/mt_c0101e0001_top_a.mtrl",
    )!;
    expect(f.data).toBeUndefined();
  });

  it("model fix never reaches an absent file — gated off for PMP (needsMdlFix, TTMP.cs:916)", () => {
    // FixOldModel (EndwalkerUpgrade.cs:190-192) reads its file unguarded, unlike the different,
    // unrelated UpdateEndwalkerModel (:250-256). The model fix (makeTtmpLoadFix's .mdl branch, run at
    // LOAD) only fires when needsMdlFix is true, which is never the case for PMP — and absent files
    // are a PMP-only phenomenon. upgradeModpack no longer runs a model round at all (the fix moved to
    // the load seam), so an absent .mdl passes through untouched here regardless.
    const data = packOf(
      optionOf([absent("chara/equipment/e0001/model/c0101e0001_top.mdl")]),
    );
    const out = upgradeModpack(data);
    const f = out.groups[0]!.options[0]!.files.get(
      "chara/equipment/e0001/model/c0101e0001_top.mdl",
    )!;
    expect(f.data).toBeUndefined();
  });

  it("IndexMaps skips an absent normal (:1087 null -> :1843 continue)", () => {
    const normal = "chara/equipment/e0001/texture/v01_c0101e0001_top_n.tex";
    const index = "chara/equipment/e0001/texture/v01_c0101e0001_top_id.tex";
    const option = optionOf([absent(normal)]);
    const targets = new Map<string, UpgradeInfo>([
      [
        index,
        {
          usage: EUpgradeTextureUsage.IndexMaps,
          files: { normal, index },
        } as UpgradeInfo,
      ],
    ]);
    upgradeRemainingTextures(option, targets);
    expect(option.files.size).toBe(1);
    expect(option.files.get(normal)!.data).toBeUndefined();
  });

  it("GearMaskLegacy skips an absent mask (:1883 null-checked)", () => {
    const maskOld = "chara/equipment/e0001/texture/v01_c0101e0001_top_m.tex";
    const maskNew = "chara/equipment/e0001/texture/v01_c0101e0001_top_mask.tex";
    const option = optionOf([absent(maskOld)]);
    const targets = new Map<string, UpgradeInfo>([
      [
        maskOld,
        {
          usage: EUpgradeTextureUsage.GearMaskLegacy,
          files: { mask_old: maskOld, mask_new: maskNew },
        } as UpgradeInfo,
      ],
    ]);
    upgradeRemainingTextures(option, targets);
    expect(option.files.size).toBe(1);
  });

  it("GearMaskNew THROWS on an absent mask — C# derefs null (:1870, TEXTOOLS_BUGS §1)", () => {
    const maskOld = "chara/equipment/e0001/texture/v01_c0101e0001_top_m.tex";
    const maskNew = "chara/equipment/e0001/texture/v01_c0101e0001_top_mask.tex";
    const option = optionOf([absent(maskOld)]);
    const targets = new Map<string, UpgradeInfo>([
      [
        maskOld,
        {
          usage: EUpgradeTextureUsage.GearMaskNew,
          files: { mask_old: maskOld, mask_new: maskNew },
        } as UpgradeInfo,
      ],
    ]);
    expect(() => upgradeRemainingTextures(option, targets)).toThrow(
      /did not resolve/,
    );
  });

  it("metadataRound THROWS on an absent .meta (no C# analogue — fail-loud guard, not a ported behaviour)", () => {
    // PMP .meta files are materialized from manipulations (PMP.cs:1141-1164), never read from a
    // zip member, so a `.meta` `Files` entry with no bytes is structurally unreachable from a real
    // PMP. requireBytes's no-bytes throw is what pins that guard.
    const data = packOf(
      optionOf([
        absent("chara/equipment/e0001/material/v0001/mt_c0101e0001_top_a.meta"),
      ]),
    );
    expect(() => upgradeModpack(data)).toThrow(/file has no bytes/);
  });

  it("HairMaps THROWS when a key-present normal has no bytes (:1187)", () => {
    const normal =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
    const mask =
      "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_m.tex";
    // Both keys are present in the option — C#'s ContainsKey guard (:1852) passes — but the
    // normal has no bytes, so UpdateEndwalkerHairTextures throws FileNotFoundException (:1187).
    const option = optionOf([
      absent(normal),
      present(mask, new Uint8Array([0, 1, 2, 3])),
    ]);
    const targets = new Map<string, UpgradeInfo>([
      [
        normal,
        {
          usage: EUpgradeTextureUsage.HairMaps,
          files: { normal, mask },
        } as UpgradeInfo,
      ],
    ]);
    expect(() => upgradeRemainingTextures(option, targets)).toThrow(
      /did not resolve/,
    );
  });
});
