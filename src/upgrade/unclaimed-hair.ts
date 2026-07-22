// Port of EndwalkerUpgrade.UpdateUnclaimedHairTextures / UpdateUnclaimedHairAccessory
// (EndwalkerUpgrade.cs:1342-1716): rescues loose hair/tail/ear/accessory textures shipped
// without their material by copying them to the canonical DT Dx11 paths, running the hair
// pixel transform for hair/tail/ear (accessory is a pure repath copy). Driven by the bundled
// hair-material table (the FileExists oracle; src/upgrade/reference/hair-materials-types.ts).
// See docs/superpowers/specs/2026-07-16-unclaimed-hair-partials-design.md §4.2-§4.4.
//
// This module covers both the shared hair/tail/ear function, INCLUDING the tail-specific
// constant-swap material rewrite (EndwalkerUpgrade.cs:1504-1516), and the accessory variant
// (UpdateUnclaimedHairAccessory, EndwalkerUpgrade.cs:1522-1716).
import type { ModpackFile, ModpackOption } from "../model/modpack";
import { parseMtrl, serializeMtrl } from "../mtrl/mtrl";
import { base64ToBytes } from "../util/base64";
import { SAMPLE_HAIR_MTRL_BASE64 } from "./reference/hair-materials";
import type {
  HairMaterialEntry,
  HairMaterialTable,
} from "./reference/hair-materials-types";
import {
  updateEndwalkerHairTextures,
  writeGeneratedMtrl,
  writeGeneratedTex,
} from "./texture";
import { resolveFile } from "./upgrade";

type TexType = "normal" | "specular" | "diffuse";

export interface HairRegexSet {
  oldTexture: RegExp; // groups: 1=race 2=id 3=tex-letter
  material: RegExp; // groups: 1=race 2=id
  matFormat: (race: string, id: string) => string;
}

// EndwalkerUpgrade.cs:1293-1321 (verbatim path shapes).
export const HAIR_REGEXES: HairRegexSet = {
  oldTexture:
    /chara\/human\/c[0-9]{4}\/obj\/hair\/h[0-9]{4}\/texture\/(?:--)?c([0-9]{4})h([0-9]{4})_hir_([ns])\.tex/,
  material:
    /chara\/human\/c[0-9]{4}\/obj\/hair\/h[0-9]{4}\/material\/v0001\/mt_c([0-9]{4})h([0-9]{4})_hir_a\.mtrl/,
  matFormat: (r, i) =>
    `chara/human/c${r}/obj/hair/h${i}/material/v0001/mt_c${r}h${i}_hir_a.mtrl`,
};
export const TAIL_REGEXES: HairRegexSet = {
  oldTexture:
    /chara\/human\/c[0-9]{4}\/obj\/tail\/t[0-9]{4}\/texture\/(?:--)?c([0-9]{4})t([0-9]{4})_etc_([ns])\.tex/,
  material:
    /chara\/human\/c[0-9]{4}\/obj\/tail\/t[0-9]{4}\/material\/v0001\/mt_c([0-9]{4})t([0-9]{4})_a\.mtrl/,
  matFormat: (r, i) =>
    `chara/human/c${r}/obj/tail/t${i}/material/v0001/mt_c${r}t${i}_a.mtrl`,
};
export const EAR_REGEXES: HairRegexSet = {
  oldTexture:
    /chara\/human\/c[0-9]{4}\/obj\/zear\/z[0-9]{4}\/texture\/(?:--)?c([0-9]{4})z([0-9]{4})_etc_([ns])\.tex/,
  material:
    /chara\/human\/c[0-9]{4}\/obj\/zear\/z[0-9]{4}\/material\/v0001\/mt_c([0-9]{4})z([0-9]{4})_a\.mtrl/,
  matFormat: (r, i) =>
    `chara/human/c${r}/obj/zear/z${i}/material/v0001/mt_c${r}z${i}_a.mtrl`,
};
// EndwalkerUpgrade.cs:1316-1321 (verbatim path shapes).
export const ACCESSORY_REGEXES: HairRegexSet = {
  oldTexture:
    /chara\/human\/c[0-9]{4}\/obj\/hair\/h[0-9]{4}\/texture\/(?:--)?c([0-9]{4})h([0-9]{4})_acc_([dns])\.tex/,
  material:
    /chara\/human\/c[0-9]{4}\/obj\/hair\/h[0-9]{4}\/material\/v0001\/mt_c([0-9]{4})h([0-9]{4})_acc_b\.mtrl/,
  matFormat: (r, i) =>
    `chara/human/c${r}/obj/hair/h${i}/material/v0001/mt_c${r}h${i}_acc_b.mtrl`,
};

const d4 = (n: number) => n.toString().padStart(4, "0");

interface Grouped {
  race: number;
  id: number;
  texs: { path: string; texType: TexType }[];
}

/** Shared match->group->winnow for one regex set (EndwalkerUpgrade.cs:1344-1417 for
 *  hair/tail/ear; :1527-1602 for accessory). `scanKeys` is the material-scan set
 *  (option.files.keys() for hair/tail/ear, per the `fileInfos.Keys` branch at :1347; `contained`
 *  itself for accessory, :1527 -- accessory scans only `contained` for materials too, a real
 *  asymmetry, see updateUnclaimedHairAccessory); `texKeys` (`contained`, :1360/:1527) is the
 *  texture-match set. `bothTypesRequired` selects the winnow shape: hair/tail/ear additionally
 *  require both texTypes present (`Count < 2`, :1403); accessory does not (:1590-1596). */
function collect(
  scanKeys: Iterable<string>,
  texKeys: Set<string>,
  set: HairRegexSet,
  letters: Record<string, TexType>,
  bothTypesRequired: boolean,
): Grouped[] {
  const materials = new Set<string>(); // `${race}:${id}`
  const groups = new Map<string, Grouped>();
  for (const file of scanKeys) {
    const mm = set.material.exec(file);
    if (mm) {
      materials.add(`${Number(mm[1])}:${Number(mm[2])}`);
      continue;
    }
    // Only match textures to those in the main list (EndwalkerUpgrade.cs:1360).
    if (!texKeys.has(file)) continue;
    const tm = set.oldTexture.exec(file);
    if (!tm) continue;
    const race = Number(tm[1]);
    const id = Number(tm[2]);
    const tt = letters[tm[3]!];
    if (tt === undefined) continue;
    const key = `${race}:${id}`;
    let g = groups.get(key);
    if (!g) {
      g = { race, id, texs: [] };
      groups.set(key, g);
    }
    const prev = g.texs.find((x) => x.texType === tt);
    if (prev) {
      if (prev.path.includes("--")) continue; // Dx11 wins (EndwalkerUpgrade.cs:1383)
      g.texs = g.texs.filter((x) => x.texType !== tt); // replace non-Dx11
    }
    g.texs.push({ path: file, texType: tt });
  }
  // Winnow: no material present (EndwalkerUpgrade.cs:1590-1596), plus -- for hair/tail/ear
  // only -- both types present too (:1403-1409). Accessory has no such requirement.
  return [...groups.values()].filter(
    (g) =>
      (!bothTypesRequired || g.texs.length >= 2) &&
      !materials.has(`${g.race}:${g.id}`),
  );
}

/** Raw-copy a resolved source file into `option` at `dest`, in the source's storage form
 *  (mirrors WriteFile + writeGeneratedTex's storage mirroring, EndwalkerUpgrade.cs:1478-1492). */
function copyRaw(option: ModpackOption, src: ModpackFile, dest: string): void {
  option.files.set(dest, { ...src });
}

/** Port of the shared body of UpdateUnclaimedHairTextures (EndwalkerUpgrade.cs:1342-1503),
 *  dispatched over the hair/tail/ear regex sets (:1326-1328). `contained` is the pass-3
 *  unused-texture set intersected with the option (spec §4.1) — the texture-match source
 *  (:1360); `option.files.keys()` is the separate material-scan source (:1347). `table` is
 *  the bundled canonical-material lookup standing in for `rtx.FileExists` + `Mtrl.GetXivMtrl`
 *  (:1430-1436): a miss means the path does not exist in DT (or invalid), matching `continue`. */
export function updateUnclaimedHairTextures(
  option: ModpackOption,
  contained: Set<string>,
  table: HairMaterialTable,
): void {
  for (const set of [HAIR_REGEXES, TAIL_REGEXES, EAR_REGEXES]) {
    const isTail = set === TAIL_REGEXES;
    const groups = collect(
      option.files.keys(),
      contained,
      set,
      { n: "normal", s: "specular" },
      true, // hair/tail/ear require both texTypes present (EndwalkerUpgrade.cs:1403)
    );
    for (const g of groups) {
      const matPath = set.matFormat(d4(g.race), d4(g.id));
      const entry = table.get(matPath);
      if (!entry) continue; // FileExists false (spec §3.1, EndwalkerUpgrade.cs:1430-1434)
      if (entry.shaderPackRaw !== "hair.shpk") continue; // (EndwalkerUpgrade.cs:1438)
      const normDest = entry.normalDx11Path;
      const maskDest = entry.maskDx11Path;
      if (!normDest || !maskDest) continue; // (EndwalkerUpgrade.cs:1447)
      // Already-converted guard (EndwalkerUpgrade.cs:1460-1476): any destination already
      // present in the option ⇒ skip the whole (race,id). The C# checks a `.ToList()` snapshot
      // of the file list taken once at :1347 (`fileList`), not re-read mid-loop; we check the
      // live `option.files` instead. Unobservable: destination paths are unique per (race,id)
      // (derived from that group's own race/id), so no earlier iteration of this loop can have
      // added a dest this check would then (dis)agree with the snapshot about.
      const destFor = (t: TexType) => (t === "normal" ? normDest : maskDest);
      if (g.texs.some((t) => option.files.has(destFor(t.texType)))) continue;
      // Copy raw first (EndwalkerUpgrade.cs:1478-1492), THEN transform (:1495-1502). On any
      // transform error, `continue` — leaving the raw copies in place.
      const srcNorm = option.files.get(
        g.texs.find((t) => t.texType === "normal")!.path,
      )!;
      const srcMask = option.files.get(
        g.texs.find((t) => t.texType === "specular")!.path,
      )!;
      copyRaw(option, srcNorm, normDest);
      copyRaw(option, srcMask, maskDest);
      try {
        const rn = resolveFile(option.files.get(normDest)!);
        const rm = resolveFile(option.files.get(maskDest)!);
        if (!rn || !rm) continue; // unresolved source ⇒ leave raw copies
        const res = updateEndwalkerHairTextures(rn.bytes, rm.bytes);
        writeGeneratedTex(
          option,
          normDest,
          res.normal,
          option.files.get(normDest)!,
        );
        writeGeneratedTex(
          option,
          maskDest,
          res.mask,
          option.files.get(maskDest)!,
        );
      } catch {
        // Bare catch-all, faithfully reproducing EndwalkerUpgrade.cs:1498-1501
        // (`catch (Exception ex) { Trace.WriteLine(ex); continue; }`): it swallows ANY transform
        // failure — a genuinely corrupt or malformed input as much as any other — leaving the raw
        // copies already written above in place.
        // See docs/TEXTOOLS_BUGS.md #12 for why this catch-all is itself a TexTools defect we
        // reproduce rather than narrow.
        continue;
      }
      // Tail-only constant-swap rewrite (EndwalkerUpgrade.cs:1504-1516). Only fires when the
      // canonical tail material lacks HideBackfaces; `tailRewriteMtrlBase64` is present in the
      // table ONLY for that case (hair-materials-types.ts), so its presence stands in for both
      // the `hairset == TailRegexes` and the `MaterialFlags & HideBackfaces == 0` C# conditions.
      if (isTail && !entry.hideBackfaces && entry.tailRewriteMtrlBase64) {
        const canon = parseMtrl(
          base64ToBytes(entry.tailRewriteMtrlBase64),
          matPath,
        );
        canon.materialFlags |= 0x01; // EMaterialFlags1.HideBackfaces (XivMtrl.cs:43)
        // Rip constants from standard hair to better match usages (EndwalkerUpgrade.cs:1510-1512).
        const sample = parseMtrl(
          base64ToBytes(SAMPLE_HAIR_MTRL_BASE64),
          "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl",
        );
        canon.shaderConstants = sample.shaderConstants;
        const bytes = serializeMtrl(canon);
        // WriteFile (EndwalkerUpgrade.cs:1515); mirror the just-written normal destination's
        // storage form, same rationale as writeGeneratedTex's storage mirroring.
        writeGeneratedMtrl(option, matPath, bytes, option.files.get(normDest)!);
      }
    }
  }
}

/** Per-texType Dx11 destination for an accessory table entry (EndwalkerUpgrade.cs:1651-1670:
 *  Normal -> normTex.Dx11Path, Specular -> specTex.Dx11Path, Diffuse -> diffuseTex.Dx11Path).
 *  Returns undefined when the entry does not bind that sampler at all, standing in for the C#'s
 *  `specTex == null` / `diffuseTex == null` checks. */
function accessoryDestFor(
  entry: HairMaterialEntry,
  texType: TexType,
): string | undefined {
  if (texType === "normal") return entry.normalDx11Path;
  if (texType === "specular") return entry.maskDx11Path;
  return entry.diffuseDx11Path;
}

/** Port of UpdateUnclaimedHairAccessory (EndwalkerUpgrade.cs:1522-1716). Shares the match->
 *  group->winnow shape with the hair/tail/ear function (`collect`) but differs from it in
 *  several load-bearing ways:
 *  - Scans ONLY `contained` for both materials and textures (:1527) -- unlike hair/tail/ear,
 *    which scan the whole option for materials (:1347). A material path present in the option
 *    but absent from `contained` therefore does NOT winnow an accessory group out; reproduced
 *    as-is, not smoothed over.
 *  - Three texTypes: `d` -> Diffuse, `n` -> Normal, `s` -> Specular (:1554-1567); a letter
 *    outside those (impossible given `oldTexture`'s `[dns]` character class, but mirrored via
 *    `collect`'s `letters` lookup miss for defense-in-depth, as the hair/tail/ear path also does).
 *  - Winnow is no-material-only (:1590-1596) -- there is no "both types present" requirement
 *    (`bothTypesRequired: false`), unlike hair/tail/ear's `Count < 2` gate.
 *  - Shader gate accepts `character.shpk` OR `characterlegacy.shpk` (:1623), not `hair.shpk`.
 *  - A missing `normalDx11Path` (the entry's g_SamplerNormal) skips the whole (race,id) (:1633).
 *  - The already-converted guard early-`break`s the per-tex loop the moment a Specular or
 *    Diffuse tex has no corresponding sampler on the material (:1656-1660/:1664-1668) -- so, per
 *    (race,id), any earlier-iterated texs (including a valid Normal) are also abandoned, not
 *    just the offending one. A destination that already exists in the option sets `skip` too,
 *    but via `continue` (not `break`, :1672-1677) -- the loop keeps running (functionally
 *    equivalent here since `skip` only ever flips true->true, never resets).
 *  - NO pixel transform: each tex is a pure raw copy to its Dx11 destination (:1685-1713); there
 *    is no `updateEndwalkerHairTextures` call and no tail-style material rewrite. */
export function updateUnclaimedHairAccessory(
  option: ModpackOption,
  contained: Set<string>,
  table: HairMaterialTable,
): void {
  const groups = collect(
    contained,
    contained,
    ACCESSORY_REGEXES,
    { d: "diffuse", n: "normal", s: "specular" },
    false, // no-material-only winnow, no both-types requirement (EndwalkerUpgrade.cs:1590-1596)
  );
  for (const g of groups) {
    const matPath = ACCESSORY_REGEXES.matFormat(d4(g.race), d4(g.id));
    const entry = table.get(matPath);
    if (!entry) continue; // FileExists false (EndwalkerUpgrade.cs:1615-1619)
    if (
      entry.shaderPackRaw !== "character.shpk" &&
      entry.shaderPackRaw !== "characterlegacy.shpk"
    ) {
      continue; // (EndwalkerUpgrade.cs:1623-1627)
    }
    if (!entry.normalDx11Path) continue; // normTex == null (EndwalkerUpgrade.cs:1633-1637)

    // Already-converted guard with early break on a missing spec/diffuse sampler
    // (EndwalkerUpgrade.cs:1646-1683). Unlike the hair guard above (which checks
    // `option.files`, standing in for the C#'s `fileList = fileInfos.Keys.ToList()` -- ALL
    // option files, :1466), the accessory guard checks `files.Contains(newPath)` (:1672) where
    // `files` is the SAME list bound to our `contained` param, not `fileInfos`/`option.files` --
    // a real asymmetry, so we check `contained` here, not `option.files`. (The C#'s
    // `files.Add(newPath)` at :1712 would grow that list as groups are processed, but that's
    // unobservable here: distinct (race,id) groups resolve to distinct destinations, so we don't
    // need to mirror the growth by re-adding copied dests to `contained`.)
    let skip = false;
    for (const t of g.texs) {
      const dest = accessoryDestFor(entry, t.texType);
      if (dest === undefined) {
        skip = true;
        break; // missing spec/diffuse sampler aborts the whole (race,id) (:1656-1660/:1664-1668)
      }
      if (contained.has(dest)) skip = true; // already converted (:1672-1677, `continue` not `break`)
    }
    if (skip) continue;

    // Pure raw copy, no transform (EndwalkerUpgrade.cs:1685-1713).
    for (const t of g.texs) {
      const dest = accessoryDestFor(entry, t.texType)!; // presence guaranteed by the guard above
      const src = option.files.get(t.path)!;
      copyRaw(option, src, dest);
    }
  }
}
