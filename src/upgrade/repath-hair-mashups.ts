// Port of ModpackUpgrader.RepathHairMashups (ModpackUpgrader.cs:379-482): the material-only
// "mashup hair" half of the ResolveHighlightOptionsAndMashupHair pre-round. For each option's
// hair/zear/tail .mtrl, retargets a Hair/Character material's normal/mask/diffuse sampler suffix to
// its Dawntrail name when the old texture is gone from the game and the renamed one exists
// (rtx.FileExists -> the bundled hairTextureExists oracle). Called from resolve-highlight.ts in
// place of the deferred fail-loud throw.
import type { ModpackData } from "../model/modpack";
import { dx11Path } from "../mtrl/dx11-path";
import { parseMtrl, serializeMtrl } from "../mtrl/mtrl";
import { ESamplerId, SHPK_CHARACTER, SHPK_HAIR } from "../mtrl/shader";
import { hairTextureExists } from "./reference/hair-texture-exists";
import { findSamplerUnguarded } from "./resolve-highlight";
import { writeGeneratedMtrl } from "./texture";
import { requireBytes } from "./upgrade";

// The three material regexes RepathHairMashups runs, in order (:381-383).
const MTRL_REGEXES = [
  /chara\/human\/c[0-9]{4}\/obj\/hair.*\.mtrl/,
  /chara\/human\/c[0-9]{4}\/obj\/zear.*\.mtrl/,
  /chara\/human\/c[0-9]{4}\/obj\/tail.*\.mtrl/,
];

export function repathHairMashups(data: ModpackData): void {
  for (const regex of MTRL_REGEXES) repathOne(data, regex);
}

function repathOne(data: ModpackData, regex: RegExp): void {
  for (const group of data.groups) {
    for (const option of group.options) {
      // Snapshot: C# copies o.Files then writes back into the live dict (:392, :479).
      for (const [m, ref] of [...option.files]) {
        if (!regex.test(m)) continue;

        // No try/catch in C# here (unlike the highlight half): a decode/parse failure throws.
        const mtrl = parseMtrl(requireBytes(ref, m).bytes, m);

        // Shader gate: Hair OR Character (NOT CharacterLegacy) (:401).
        if (
          mtrl.shaderPackRaw !== SHPK_HAIR &&
          mtrl.shaderPackRaw !== SHPK_CHARACTER
        )
          continue;

        // Unguarded x.Sampler.SamplerId (:406-408) — findSamplerUnguarded throws on a null sampler,
        // which propagates here (no catch), matching the C# NRE.
        const norm = findSamplerUnguarded(mtrl, ESamplerId.g_SamplerNormal);
        const mask = findSamplerUnguarded(mtrl, ESamplerId.g_SamplerMask);
        const diff = findSamplerUnguarded(mtrl, ESamplerId.g_SamplerDiffuse);
        if (!norm || !mask) continue; // (:410)

        // Normal: _n -> _norm, strip "--", gated on old-absent + new-present (:414-421).
        const nPath = dx11Path(norm);
        if (!hairTextureExists(nPath)) {
          const newPath = nPath
            .replaceAll("_n.tex", "_norm.tex")
            .replaceAll("--", "");
          if (hairTextureExists(newPath)) {
            norm.texturePath = norm.texturePath
              .replaceAll("_n.tex", "_norm.tex")
              .replaceAll("--", "");
          }
        }

        // Mask: first match of _m->_mask, _m->_mult, _s->_mask, _s->_mult wins (:423-453).
        const mPath = dx11Path(mask);
        if (!hairTextureExists(mPath)) {
          let found = false;
          const tryMask = (from: string, to: string): void => {
            const cand = mPath.replaceAll(from, to).replaceAll("--", "");
            if (hairTextureExists(cand) && !found) {
              mask.texturePath = mask.texturePath
                .replaceAll(from, to)
                .replaceAll("--", "");
              found = true;
            }
          };
          tryMask("_m.tex", "_mask.tex");
          tryMask("_m.tex", "_mult.tex");
          tryMask("_s.tex", "_mask.tex");
          tryMask("_s.tex", "_mult.tex");
        }

        // Diffuse: _d -> _base (:455-463). NB C# uses the 1-arg FileExists here (no forceOriginal)
        // while norm/mask use the 2-arg forceOriginal:true form (:414, :423) — our bundled oracle
        // (hairTextureExists) is base-game only either way, so both map to the same call here.
        if (diff && !hairTextureExists(dx11Path(diff))) {
          const newPath = dx11Path(diff)
            .replaceAll("_d.tex", "_base.tex")
            .replaceAll("--", "");
          if (hairTextureExists(newPath)) {
            diff.texturePath = diff.texturePath
              .replaceAll("_d.tex", "_base.tex")
              .replaceAll("--", "");
          }
        }

        // Unconditional re-serialize + write-back (:466-479), storage-mirrored to the source file.
        writeGeneratedMtrl(option, m, serializeMtrl(mtrl), ref);
      }
    }
  }
}
