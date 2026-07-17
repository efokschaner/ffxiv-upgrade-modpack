// Builds test/corpus/synthetic/highlight.pmp: a wizard PMP with one Single-select group whose two
// options SPLIT a Hair-shader (hair.shpk) normal/mask pair — "With Highlights" carries the material
// + its normal texture, "Base" carries only the mask. This is the clean-staple case of
// ResolveHighlightOptionsAndMashupHair (ModpackUpgrader.cs:267-377): each option's missing texture
// is held by exactly one container, so the pre-round staples the copy in. No REAL corpus mod reaches
// a clean staple (all 18 that reach the branch throw — spec §1.1), so this synthetic is the only
// byte-exact AB-test of the happy path.
//
// The material is the bundled _SampleHair mtrl (src/upgrade/reference/hair-materials.ts), already
// Dawntrail, so the material/texture rounds leave it and the stapled textures untouched, isolating
// the golden to the staple. Gitignored like the real corpus; regenerate with `npm run synthetics`
// or `npx tsx scripts/generate-synthetics/build-synthetic-highlight.ts`.
import type { PmpGroupJsonRaw } from "../../src/container/manifest-types";
import { dx11Path } from "../../src/mtrl/dx11-path";
import { parseMtrl } from "../../src/mtrl/mtrl";
import { ESamplerId } from "../../src/mtrl/shader";
import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8 } from "../../src/tex/types";
import { SAMPLE_HAIR_MTRL_BASE64 } from "../../src/upgrade/reference/hair-materials";
import { concatBytes } from "../../src/util/binary";
import { EMPTY_DEFAULT_MOD, syntheticMeta, writePmp } from "./pmp-builder";

const MTRL_PATH =
  "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl";
const MTRL_BYTES = new Uint8Array(
  Buffer.from(SAMPLE_HAIR_MTRL_BASE64, "base64"),
);

const sample = parseMtrl(MTRL_BYTES, MTRL_PATH);
const normalTex = sample.textures.find(
  (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerNormal,
);
const maskTex = sample.textures.find(
  (t) => t.sampler?.samplerIdRaw === ESamplerId.g_SamplerMask,
);
if (!normalTex || !maskTex) {
  throw new Error("sample hair mtrl is missing a normal or mask sampler");
}
const N = dx11Path(normalTex);
const M = dx11Path(maskTex);

/** A valid 8x8 A8R8G8B8 single-mip .tex, distinct per seed. */
function tex(seed: number): Uint8Array {
  const header = buildCanonicalTexHeader(A8R8G8B8, 8, 8, 1);
  const pixels = new Uint8Array(8 * 8 * 4).map((_, i) => (i * 7 + seed) & 0xff);
  return concatBytes([header, pixels]);
}

const files: Record<string, Uint8Array> = {
  "files/mtrl.mtrl": MTRL_BYTES,
  "files/normal.tex": tex(1),
  "files/mask.tex": tex(2),
};

const group: PmpGroupJsonRaw = {
  Version: 0,
  Name: "Highlights",
  Description: "",
  Image: "",
  Page: 0,
  Priority: 0,
  Type: "Single",
  DefaultSettings: 0,
  Options: [
    {
      Name: "With Highlights",
      Description: "",
      Image: "",
      Files: { [MTRL_PATH]: "files/mtrl.mtrl", [N]: "files/normal.tex" },
      FileSwaps: {},
      Manipulations: [],
    },
    {
      Name: "Base",
      Description: "",
      Image: "",
      Files: { [M]: "files/mask.tex" },
      FileSwaps: {},
      Manipulations: [],
    },
  ],
};

writePmp("highlight.pmp", {
  meta: syntheticMeta("Highlight Split Hair"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: { "group_001_highlights.json": group },
  files,
});
