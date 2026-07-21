// Probe (not wired into the suite; needs a local ConsoleTools install + game install; slow):
// does the canonical index-sampler (_id.tex) path of a base-game material follow a rule derivable
// from the material path alone, or must it be read from the material file? Backed the T4
// index-path-overrides item (shipped 2026-07-20; the backlog item file was deleted on shipping —
// see docs/superpowers/specs/2026-07-20-index-path-resolution-design.md §2.1, which cites this
// probe's result as the reason a derivation rule was rejected). For a sample of base-game materials
// across namespaces, extract via ConsoleTools /extract, read the material's OWN index-sampler
// Dx11Path, and compare to the rule-derived guess (drop `mt_`, drop the trailing variant letter,
// add the material folder's `v{NN}_` version prefix). A single BREAK disproves "derivable by rule".
//
// Run: npx tsx scripts/probes/probe-idpath-rule.ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMtrl } from "../../src/mtrl/parse";
import { samplerIdToTexUsage, XivTexType } from "../../src/mtrl/shader";

// oracle.ts reads __dirname at module scope (Vite-only global); shim it before importing.
(globalThis as unknown as { __dirname: string }).__dirname = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "helpers",
);
const { extractGameFile } = await import("../../test/helpers/oracle");

const dir = mkdtempSync(join(tmpdir(), "idprobe-"));

function indexPathOf(materialPath: string): string | null | undefined {
  const dest = join(dir, "m.mtrl");
  try {
    extractGameFile(materialPath, dest);
  } catch {
    return undefined; // not a base-game file
  }
  const mtrl = parseMtrl(new Uint8Array(readFileSync(dest)), materialPath);
  const idx = mtrl.textures.find(
    (t) =>
      t.sampler &&
      samplerIdToTexUsage(t.sampler.samplerIdRaw, mtrl) === XivTexType.Index,
  );
  return idx ? idx.texturePath : null; // null = no index sampler
}

// The rule I proposed: root/texture/v{NN}_{name sans 'mt_' sans trailing _<letter>}_id.tex
function ruleGuess(materialPath: string): string | null {
  const m = materialPath.match(/^(.*)\/material\/v(\d{4})\/mt_(.+)\.mtrl$/);
  if (!m) return null;
  const [, root, ver, name] = m;
  const nn = String(Number(ver)).padStart(2, "0");
  const nameNoVariant = name!.replace(/_[a-z]$/, "");
  return `${root}/texture/v${nn}_${nameNoVariant}_id.tex`;
}

const candidates = [
  // corpus-confirmed equipment
  "chara/equipment/e0194/material/v0001/mt_c0201e0194_top_a.mtrl",
  "chara/equipment/e0239/material/v0002/mt_c0201e0239_dwn_b.mtrl",
  "chara/equipment/e6077/material/v0001/mt_c0201e6077_top_a.mtrl",
  // more equipment, varied slots/races/variants
  "chara/equipment/e0000/material/v0001/mt_c0101e0000_top_a.mtrl",
  "chara/equipment/e0001/material/v0001/mt_c0101e0001_met_a.mtrl",
  "chara/equipment/e0002/material/v0001/mt_c0101e0002_glv_a.mtrl",
  "chara/equipment/e0100/material/v0001/mt_c0101e0100_top_a.mtrl",
  "chara/equipment/e5000/material/v0001/mt_c0101e5000_top_a.mtrl",
  // accessory
  "chara/accessory/a0001/material/v0001/mt_c0101a0001_ear_a.mtrl",
  "chara/accessory/a0011/material/v0001/mt_c0101a0011_nek_a.mtrl",
  // weapon
  "chara/weapon/w0101/obj/body/b0001/material/v0001/mt_w0101b0001_a.mtrl",
  "chara/weapon/w2001/obj/body/b0001/material/v0001/mt_w2001b0001_a.mtrl",
  // monster (item says these break)
  "chara/monster/m0001/obj/body/b0001/material/v0001/mt_m0001b0001_a.mtrl",
  "chara/monster/m8373/obj/body/b0001/material/v0001/mt_m8373b0001_a.mtrl",
  // human hair (item says common-texture references appear here)
  "chara/human/c0101/obj/hair/h0001/material/v0001/mt_c0101h0001_hir_a.mtrl",
  "chara/human/c0201/obj/hair/h0001/material/v0001/mt_c0201h0001_hir_a.mtrl",
  // human body/face
  "chara/human/c0101/obj/body/b0001/material/v0001/mt_c0101b0001_a.mtrl",
  "chara/human/c0101/obj/face/f0001/material/v0001/mt_c0101f0001_fac_a.mtrl",
  // demihuman
  "chara/demihuman/d1001/obj/equipment/e0001/material/v0001/mt_d1001e0001_top_a.mtrl",
];

let hold = 0;
let broke = 0;
let noIdx = 0;
let absent = 0;
for (const c of candidates) {
  const actual = indexPathOf(c);
  if (actual === undefined) {
    absent++;
    console.log(`ABSENT   ${c}`);
    continue;
  }
  if (actual === null) {
    noIdx++;
    console.log(`NO-INDEX ${c}`);
    continue;
  }
  const guess = ruleGuess(c);
  const ok = guess === actual;
  if (ok) hold++;
  else broke++;
  console.log(`${ok ? "HOLD    " : "BREAK   "} ${c}`);
  console.log(`         actual: ${actual}`);
  if (!ok) console.log(`         rule:   ${guess}`);
}
console.log(`\nHOLD=${hold} BREAK=${broke} NO-INDEX=${noIdx} ABSENT=${absent}`);
