// Port of ModpackUpgrader.ResolveHighlightOptionsAndMashupHair, highlight-resolution half
// (reference/.../Mods/ModpackUpgrader.cs:267-377). A pre-round (run before round 1, ungated by
// includePartials — :83) that staples split Hair-shader normal/mask ("highlight/visibility")
// textures across options, or fails loud when it cannot. The RepathHairMashups half (:379-482)
// needs the live Dawntrail game index (rtx.FileExists) and is deferred, see
// docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md.
import type { ModpackData, ModpackOption } from "../model/modpack";
import { dx11Path } from "../mtrl/dx11-path";
import { parseMtrl } from "../mtrl/mtrl";
import { ESamplerId, SHPK_HAIR } from "../mtrl/shader";
import type { MtrlTexture, XivMtrl } from "../mtrl/types";
import { resolveFile } from "./upgrade";

/** g_SamplerNormal / g_SamplerMask lookup reproducing C#'s UNGUARDED `x.Sampler.SamplerId`
 * (ModpackUpgrader.cs:294-295): a texture that bound no sampler NREs when reached before a match,
 * which the caller's try/catch (:301-304) turns into "skip this .mtrl". Array.find stops at the
 * first match or first throw, matching FirstOrDefault's enumeration order (same pattern as
 * material.ts's findSpecDiffuse). */
function findSamplerUnguarded(
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
  // Stage 1 — ForAllFiles (:275-311): rip every option's .mtrl, keep Hair-shader ones with a
  // normal AND mask sampler, collect their (normalDx11, maskDx11) pair. mData is an ordered List
  // (C# List<(Normal,Mask)>, :272) — duplicates are kept; the count drives the throw below.
  const mData: HairPair[] = [];
  for (const group of data.groups) {
    for (const option of group.options) {
      for (const [path, f] of option.files) {
        if (!path.endsWith(".mtrl")) continue;
        // GetUncompressedFile (:281). A resolve miss => C# outer catch => skip (:301-304).
        const resolved = resolveFile(f);
        if (!resolved) continue;
        let mtrl: XivMtrl;
        try {
          mtrl = parseMtrl(resolved.bytes, path); // GetXivMtrl inner try/catch (:283-290)
        } catch {
          continue;
        }
        if (mtrl.shaderPackRaw !== SHPK_HAIR) continue; // (:292)
        let norm: MtrlTexture | undefined;
        let mask: MtrlTexture | undefined;
        try {
          norm = findSamplerUnguarded(mtrl, ESamplerId.g_SamplerNormal); // (:294)
          mask = findSamplerUnguarded(mtrl, ESamplerId.g_SamplerMask); // (:295)
        } catch {
          continue; // null-sampler NRE => outer catch => skip file (:301-304)
        }
        if (!norm || !mask) continue; // (:297)
        // C# also adds f.Key to a `hairMaterials` HashSet (:298) that is never read again — dead; dropped.
        mData.push({ normal: dx11Path(norm), mask: dx11Path(mask) }); // (:299)
      }
    }
  }
  if (mData.length === 0) return; // (:308-311)

  // Stage 2 — ForAllOptions (:314-344): build `containers` (which options hold each texture path;
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
  for (const group of data.groups) {
    for (const option of group.options) {
      for (const pair of mData) {
        const hasMask = option.files.has(pair.mask);
        const hasNorm = option.files.has(pair.normal);
        if (hasNorm) addContainer(pair.normal, option); // (:323-330)
        if (hasMask) addContainer(pair.mask, option); // (:331-338)
        if (hasMask && hasNorm) continue; // (:340)
        if (!hasMask && !hasNorm) continue; // (:341)
        badOptions.push(option); // (:342)
      }
    }
  }

  // (:346-355)
  if (badOptions.length === 0) {
    if (containers.size === 0) {
      // Material-only Mashup hair (:348-353) -> RepathHairMashups. DEFERRED: needs the live DT
      // game index (rtx.FileExists). Fail loud.
      throw new Error(
        "resolve-highlight: material-only mashup hair (RepathHairMashups) is unported — it needs " +
          "the live Dawntrail game index; see " +
          "docs/backlog/2026-07-15-resolve-highlight-mashup-hair-preround.md",
      );
    }
    return; // (:354)
  }

  // Stage 3 — resolution (:358-376). NO both/neither guard here (unlike stage 2): every
  // (badOption, pair) is processed. o.files is read LIVE and mutated by the staple, so a later
  // pair sees an earlier staple.
  for (const o of badOptions) {
    for (const pair of mData) {
      const hasMask = o.files.has(pair.mask); // (:362)
      const missingTex = hasMask ? pair.normal : pair.mask; // (:365)
      const container = containers.get(missingTex);
      if (container === undefined) {
        // C# Dictionary indexer on an absent key throws KeyNotFoundException (:367): the missing
        // texture is in no option at all (e.g. a base-game texture) — unresolvable.
        throw new Error(
          `resolve-highlight: missing hair texture is in no option (KeyNotFound): ${missingTex}`,
        );
      }
      if (container.length !== 1) {
        throw new Error(
          // InvalidDataException (:369) — the case every real throwing corpus mod hits.
          "Cannot upgrade modpack - Highlight/Visibility options are unresolveable either due to " +
            "missing files or too much complexity.\nTry installing the modpack and creating an " +
            "updated pack from the desired options.",
        );
      }
      const src = container[0]!.files.get(missingTex)!; // Files[missingTex] indexer (:373)
      if (o.files.has(missingTex)) {
        // C# Dictionary.Add throws on a duplicate key (:374); Map.set would silently overwrite.
        throw new Error(
          `resolve-highlight: duplicate staple key: ${missingTex}`,
        );
      }
      o.files.set(missingTex, { ...src }); // staple the pointer, sharing bytes (:374)
    }
  }
}
