// Port of ModpackUpgrader.ResolveHighlightOptionsAndMashupHair, highlight-resolution half
// (reference/.../Mods/ModpackUpgrader.cs:295-405). A pre-round (run before round 1, ungated by
// includePartials — :89) that staples split Hair-shader normal/mask ("highlight/visibility")
// textures across options, or falls through to RepathHairMashups (:407-510, ported in
// repath-hair-mashups.ts) for the material-only mashup-hair case.
import {
  allGroups,
  type ModpackData,
  type ModpackOption,
} from "../model/modpack";
import { dx11Path } from "../mtrl/dx11-path";
import { parseMtrl } from "../mtrl/mtrl";
import { ESamplerId, SHPK_HAIR } from "../mtrl/shader";
import type { MtrlTexture, XivMtrl } from "../mtrl/types";
import { repathHairMashups } from "./repath-hair-mashups";
import { resolveFile } from "./upgrade";

/** Sampler lookup by id, reproducing C#'s UNGUARDED `x.Sampler.SamplerId` (ModpackUpgrader.cs:322-323
 * in the highlight half; :434-436 in RepathHairMashups): a texture that bound no sampler NREs when
 * reached before a match. In the highlight half the caller's try/catch (:329-332) turns that into
 * "skip this .mtrl"; RepathHairMashups (repath-hair-mashups.ts) has no catch, so the NRE propagates
 * (see docs/TEXTOOLS_BUGS.md #15). Array.find stops at the first match or first throw, matching
 * FirstOrDefault's enumeration order (same pattern as material.ts's findSpecDiffuse). Called with
 * g_SamplerNormal / g_SamplerMask and — from RepathHairMashups — g_SamplerDiffuse. */
export function findSamplerUnguarded(
  mtrl: XivMtrl,
  samplerId: number,
): MtrlTexture | undefined {
  return mtrl.textures.find((t) => {
    if (!t.sampler) throw new Error("mtrl: texture bound no sampler");
    return t.sampler.samplerIdRaw === samplerId;
  });
}

interface HairPair {
  normal: string;
  mask: string;
}

export function resolveHighlightOptionsAndMashupHair(data: ModpackData): void {
  // Stage 1 — ForAllFiles (:303-339): rip every option's .mtrl, keep Hair-shader ones with a
  // normal AND mask sampler, collect their (normalDx11, maskDx11) pair. mData is an ordered List
  // (C# List<(Normal,Mask)>, :300) — duplicates are kept; the count drives the throw below.
  const mData: HairPair[] = [];
  for (const group of allGroups(data)) {
    for (const option of group.options) {
      for (const [path, f] of option.files) {
        if (!path.endsWith(".mtrl")) continue;
        // GetUncompressedFile (:309). A resolve miss => C# outer catch => skip (:329-332).
        const resolved = resolveFile(f);
        if (!resolved) continue;
        let mtrl: XivMtrl;
        try {
          mtrl = parseMtrl(resolved.bytes, path); // GetXivMtrl inner try/catch (:311-318)
        } catch {
          continue;
        }
        if (mtrl.shaderPackRaw !== SHPK_HAIR) continue; // (:320)
        let norm: MtrlTexture | undefined;
        let mask: MtrlTexture | undefined;
        try {
          norm = findSamplerUnguarded(mtrl, ESamplerId.g_SamplerNormal); // (:322)
          mask = findSamplerUnguarded(mtrl, ESamplerId.g_SamplerMask); // (:323)
        } catch {
          continue; // null-sampler NRE => outer catch => skip file (:329-332)
        }
        if (!norm || !mask) continue; // (:325)
        // C# also adds f.Key to a `hairMaterials` HashSet (:326) that is never read again — dead; dropped.
        mData.push({ normal: dx11Path(norm), mask: dx11Path(mask) }); // (:327)
      }
    }
  }
  if (mData.length === 0) return; // (:336-339)

  // Stage 2 — ForAllOptions (:342-372): build `containers` (which options hold each texture path;
  // C# Dictionary<string, List<option>>, dups allowed) and `badOptions` (options holding exactly
  // one of a pair; C# List<option>, dups allowed). containers is populated for ALL options,
  // including those with both — the both/neither guard only gates the badOptions.Add.
  const containers = new Map<string, ModpackOption[]>();
  const badOptions: ModpackOption[] = [];
  const addContainer = (texPath: string, o: ModpackOption): void => {
    let list = containers.get(texPath);
    if (!list) {
      list = [];
      containers.set(texPath, list);
    }
    list.push(o);
  };
  for (const group of allGroups(data)) {
    for (const option of group.options) {
      for (const pair of mData) {
        const hasMask = option.files.has(pair.mask);
        const hasNorm = option.files.has(pair.normal);
        if (hasNorm) addContainer(pair.normal, option); // (:351-358)
        if (hasMask) addContainer(pair.mask, option); // (:359-366)
        if (hasMask && hasNorm) continue; // (:368)
        if (!hasMask && !hasNorm) continue; // (:369)
        badOptions.push(option); // (:370)
      }
    }
  }

  // (:374-383)
  if (badOptions.length === 0) {
    if (containers.size === 0) {
      repathHairMashups(data); // Material-only Mashup hair (:376-381) -> RepathHairMashups.
      return;
    }
    return; // (:382)
  }

  // Stage 3 — resolution (:386-404). NO both/neither guard here (unlike stage 2): every
  // (badOption, pair) is processed. o.files is read LIVE and mutated by the staple, so a later
  // pair sees an earlier staple.
  for (const o of badOptions) {
    for (const pair of mData) {
      const hasMask = o.files.has(pair.mask); // (:390)
      const missingTex = hasMask ? pair.normal : pair.mask; // (:393)
      const container = containers.get(missingTex);
      if (container === undefined) {
        // C# Dictionary indexer on an absent key throws KeyNotFoundException (:395): the missing
        // texture is in no option at all (e.g. a base-game texture) — unresolvable.
        throw new Error(
          `resolve-highlight: missing hair texture is in no option (KeyNotFound): ${missingTex}`,
        );
      }
      if (container.length !== 1) {
        throw new Error(
          // InvalidDataException (:397) — the case every real throwing corpus mod hits.
          "Cannot upgrade modpack - Highlight/Visibility options are unresolveable either due to " +
            "missing files or too much complexity.\nTry installing the modpack and creating an " +
            "updated pack from the desired options.",
        );
      }
      const src = container[0]!.files.get(missingTex)!; // Files[missingTex] indexer (:401)
      if (o.files.has(missingTex)) {
        // C# Dictionary.Add throws on a duplicate key (:402); Map.set would silently overwrite.
        throw new Error(
          `resolve-highlight: duplicate staple key: ${missingTex}`,
        );
      }
      o.files.set(missingTex, { ...src }); // staple the pointer, sharing bytes (:402)
    }
  }
}
