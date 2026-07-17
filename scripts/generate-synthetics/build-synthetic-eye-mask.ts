// Builds test/corpus/synthetic/eye-mask.pmp: one loose --c{race}f{face}_iri_s.tex for a (race,face)
// present in EYE_MATERIALS, so round-6 UpdateEyeMask (src/upgrade/eye-mask.ts) converts it to the
// iris diffuse (EndwalkerUpgrade.cs ConvertEyeMaskToDiffuse, :1910-2003). The mask is 64x64 A8R8G8B8
// carrying a red gradient (Mask.Red is the only channel the conversion reads, via expandChannel) so
// the conversion is non-trivial; the resulting diffuse is 256x256 (4x upscale), exercising the base
// Bicubic upscale, the frame's nearest-neighbor stretch, and BoxBlur(radius 2) end to end. See
// docs/superpowers/specs/2026-07-16-eye-mask-partial-design.md. The .pmp is gitignored; regenerate
// locally with `npm run synthetics` or
// `npx tsx scripts/generate-synthetics/build-synthetic-eye-mask.ts`.

import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8 } from "../../src/tex/types";
import { EYE_MATERIALS } from "../../src/upgrade/reference/eye-materials";
import { concatBytes } from "../../src/util/binary";
import {
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";

const iris = [...EYE_MATERIALS.keys()][0]!; // e.g. .../mt_c0101f0001_iri_a.mtrl
const m = /c([0-9]{4}).*?f([0-9]{4})/.exec(iris)!;
const race = m[1]!;
const face = m[2]!;
const maskGamePath = `chara/human/c${race}/obj/face/f${face}/texture/--c${race}f${face}_iri_s.tex`;

const W = 64;
const H = 64;
const header = buildCanonicalTexHeader(A8R8G8B8, W, H, 1);
const pixels = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    pixels[o] = (x * 4) & 0xff; // R gradient (the only channel the conversion uses)
    pixels[o + 1] = (y * 4) & 0xff; // G/B/A arbitrary
    pixels[o + 2] = 128;
    pixels[o + 3] = 255;
  }
}
const maskTex = concatBytes([header, pixels]);
const zipPath = "files\\mask_iri_s.tex";

writePmp("eye-mask.pmp", {
  meta: syntheticMeta("Eye Mask Diffuse Conversion"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_loose eye mask.json": singleOptionGroup("Loose Eye Mask", {
      [maskGamePath]: zipPath,
    }),
  },
  files: { [zipPath.replace(/\\/g, "/")]: maskTex },
});
