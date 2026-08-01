// Builds test/corpus/synthetic/mashup-hair-outofns.pmp: the sibling of mashup-hair.pmp for the
// OUT-OF-NAMESPACE case. Same canonical DT hair material, but its g_SamplerNormal points at a FACE
// texture — outside the hair/zear/tail texture namespace the old bundled oracle covered — whose old
// `_n` form is absent from the game and whose `_norm` form exists. RepathHairMashups
// (ModpackUpgrader.cs:414-421) therefore renames it, and an oracle scoped to hair textures alone
// silently does not. AB-tests that rename against ConsoleTools. See
// docs/superpowers/specs/2026-07-31-game-file-exists-oracle-design.md §7.
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

// Verified against the live 040000 index (2026-07-31): the `_n` form is absent, the `_norm` form
// exists — one of 47 such face-texture pairs. Neither is under the hair/zear/tail texture folders.
const OUT_OF_NAMESPACE_NORMAL =
  "chara/human/c0101/obj/face/f0001/texture/c0101f0001_fac_n.tex";
// A path that DOES exist, so the mask branch (ModpackUpgrader.cs:423-453) is inert and this pack
// exercises the normal branch alone.
const EXISTING_MASK =
  "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_norm.tex";

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
// Clear the DX9/DX11 dual-provision flag (0x8000) on both so Dx11Path === TexturePath and the paths
// below are asked of the oracle verbatim, with no `--` inserted.
norm.texturePath = OUT_OF_NAMESPACE_NORMAL;
norm.flags &= ~0x8000;
mask.texturePath = EXISTING_MASK;
mask.flags &= ~0x8000;
const mtrlBytes = serializeMtrl(m);

const ZIP_PATH = "files\\mt_c0801h0115_hir_a.mtrl";

writePmp("mashup-hair-outofns.pmp", {
  meta: syntheticMeta("Mashup Hair Repath Out Of Namespace"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_mashup hair outofns.json": singleOptionGroup(
      "Mashup Hair OutOfNs",
      { [MTRL_GAME_PATH]: ZIP_PATH },
    ),
  },
  files: { [ZIP_PATH.replace(/\\/g, "/")]: mtrlBytes },
});
