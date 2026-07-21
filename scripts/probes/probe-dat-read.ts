// Manual verification for Task 1 (native SqPack dat reader). Reads a known base-game material
// entirely in-process via GameIndex.read (no ConsoleTools subprocess), parses it with parseMtrl,
// and prints its index-sampler (_id.tex) path. Expected output (matches the ConsoleTools-backed
// probe in scripts/probes/probe-idpath-rule.ts):
//   chara/equipment/e0194/texture/v01_c0201e0194_top_id.tex
//
// Run: npx tsx scripts/probes/probe-dat-read.ts
import { parseMtrl } from "../../src/mtrl/mtrl";
import { samplerIdToTexUsage, XivTexType } from "../../src/mtrl/shader";
import { GameIndex } from "../lib/game-index";

const SQPACK =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online\\game\\sqpack\\ffxiv";
const MATERIAL_PATH =
  "chara/equipment/e0194/material/v0001/mt_c0201e0194_top_a.mtrl";

const idx = GameIndex.load(SQPACK);
const bytes = idx.read(MATERIAL_PATH);
const mtrl = parseMtrl(bytes, MATERIAL_PATH);
const indexTex = mtrl.textures.find(
  (t) =>
    t.sampler &&
    samplerIdToTexUsage(t.sampler.samplerIdRaw, mtrl) === XivTexType.Index,
);

if (!indexTex) {
  throw new Error(`probe-dat-read: no index sampler found on ${MATERIAL_PATH}`);
}
console.log(indexTex.texturePath);
