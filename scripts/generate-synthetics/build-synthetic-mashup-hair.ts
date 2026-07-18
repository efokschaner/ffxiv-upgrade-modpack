// Builds test/corpus/synthetic/mashup-hair.pmp: a wizard PMP with one Single-select group, one
// option "On", whose SOLE file is a Hair-shader .mtrl for a real DT (race,id) with OLD-suffix
// (_n/_m) sampler texture paths and NO textures. The pre-round's highlight half finds a hair
// material but no split options and no option holding the textures (badOptions==0 && containers==0)
// -> RepathHairMashups fires, retargeting the samplers to their DT names. AB-tests
// ModpackUpgrader.cs:379-482 against ConsoleTools. See
// docs/superpowers/specs/2026-07-18-repath-hair-mashups-design.md §5.
//
// The .pmp is gitignored; regenerate with `npm run synthetics`.
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";
import { ESamplerId } from "../../src/mtrl/shader";
import { SAMPLE_HAIR_MTRL_BASE64 } from "../../src/upgrade/reference/hair-materials";
import {
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

const MTRL_GAME_PATH =
  "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl";

// Take the bundled canonical _SampleHair (c0801 h0115, real DT hair), rewrite its norm/mask samplers
// back to pre-DT suffixes so RepathHairMashups has something to fix.
const m = parseMtrl(
  new Uint8Array(Buffer.from(SAMPLE_HAIR_MTRL_BASE64, "base64")),
  MTRL_GAME_PATH,
);
const norm = m.textures.find(
  (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerNormal,
)!;
const mask = m.textures.find(
  (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerMask,
)!;
norm.texturePath = norm.texturePath.replaceAll("_norm.tex", "_n.tex");
norm.flags &= ~0x8000;
mask.texturePath = mask.texturePath
  .replaceAll("_mask.tex", "_m.tex")
  .replaceAll("_mult.tex", "_m.tex");
mask.flags &= ~0x8000;
const mtrlBytes = serializeMtrl(m);

const ZIP_PATH = "files\\mt_c0801h0115_hir_a.mtrl";

writePmp("mashup-hair.pmp", {
  meta: syntheticMeta("Mashup Hair Repath"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_mashup hair.json": singleOptionGroup("Mashup Hair", {
      [MTRL_GAME_PATH]: ZIP_PATH,
    }),
  },
  files: { [ZIP_PATH.replace(/\\/g, "/")]: mtrlBytes },
});
