// Enumerator core for the base-game material -> index-sampler (_id.tex) path table — extraction
// tooling only (NOT shipped port code), same status as scripts/lib/game-index.ts and
// scripts/lib/imc-entries.ts. THIS FILE EMITS NO TABLE (that is Task 3); it builds two in-memory
// collections (`pairs`, `idTexPaths`) and logs counts. The smoke run is the acceptance gate.
//
// This reproduces a narrow slice of TexTools' dependency graph — the model->material->texture edges
// XivCache.GetChildFiles walks (XivDependencyGraph.cs · GetChildFiles · 398-435: a model's children
// are Mdl.GetReferencedMaterialPaths, a material's children are its texture samplers) — to find, for
// every base-game equipment/accessory/weapon/monster/demihuman set, each material that carries an
// index sampler and read that sampler's real path. TexTools' idPath refinement steals this base-game
// path verbatim (EndwalkerUpgrade.cs:923-936); a mod's own bytes can't reconstruct it (the canonical
// v{NN}_ version prefix + dropped variant letter), so it must be bundled. See
// scripts/extract-index-overrides.ts for the per-corpus ConsoleTools-driven precursor this replaces.
//
// The dependency chain, per root:
//   1. roots table (item_sets.db) -> XivDependencyRootInfo (primary/secondary type+id, slot).
//   2. XivDependencyRoot.GetModelPath (XivDependencyRoot.cs:228-249): equipment/accessory use a
//      RACIAL model name (one model per race, GetRacialModelName :427-441); weapon/monster/demihuman
//      use the simple model name (GetSimpleModelName :418-425). Keep models present in the index.
//   3. Mdl -> pathData.materialList (src/mdl/model/read-model.ts, mirroring
//      Mdl.GetReferencedMaterialPaths, Mdl.cs:1232-1246) -> referenced material basenames.
//   4. Material version-folder expansion by EXISTENCE PROBE (deliberate substitute for IMC-set
//      expansion): TexTools' gate A is a pure FileExists(MTRLPath) (EndwalkerUpgrade.cs:926), so
//      probing every existing material/v{NNNN}/ folder is exactly right and needs no IMC parsing.
//   5. Mtrl -> index sampler (src/mtrl, mirroring the sampler scan in extract-index-overrides.ts:65-71).
//
// Regenerate on a machine with FFXIV installed; needs node's --experimental-sqlite for the
// item_sets.db enumeration:
//   $env:NODE_OPTIONS="--experimental-sqlite"; npx tsx scripts/extract-index-table.ts
// Smoke run (fast, ~pins the e0194 canary): prefix with `$env:INDEX_LIMIT=50;`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readEditableModel } from "../src/mdl/model/read-model";
import { parseMdl } from "../src/mdl/parse";
import { parseMtrl } from "../src/mtrl/mtrl";
import { samplerIdToTexUsage, XivTexType } from "../src/mtrl/shader";
import { GameIndex } from "./lib/game-index";
import { isImcSharingWeapon } from "./lib/imc-entries";

// The game's sqpack folder, read in-process by GameIndex as the FileExists / read oracle
// (same constant as scripts/extract-hair-texture-index.ts:12-13).
const SQPACK =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online\\game\\sqpack\\ffxiv";

// item_sets.db lives in the vendored framework (reference/ is gitignored; the maintainer re-clones).
const ITEM_SETS_DB = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "reference",
  "FFXIV_TexTools_UI",
  "lib",
  "xivModdingFramework",
  "xivModdingFramework",
  "Resources",
  "DB",
  "item_sets.db",
);

// INDEX_LIMIT=N truncates the roots to the first N for a fast smoke run (mirrors IMC_LIMIT in
// extract-meta-reference.ts:71-76). See the smoke-subset construction below.
const INDEX_LIMIT = process.env.INDEX_LIMIT
  ? Number(process.env.INDEX_LIMIT)
  : Number.POSITIVE_INFINITY;
const SMOKE = INDEX_LIMIT !== Number.POSITIVE_INFINITY;

// Material version-folder probe bound. Base-game equipment tops out well below this; the fail-loud
// guard below trips if any material exists at exactly v{MAX} so the bound gets raised rather than
// silently truncating.
const MAX_MATERIAL_VERSION = 64;

// Full IDRaceDictionary race grid (Character.cs:530-571), copied from
// scripts/extract-hair-texture-index.ts:16-55. These are the XivRace.GetRaceCode() strings
// (XivRace.cs:515-520) equipment/accessory racial model names iterate over.
const RACES = [
  "0101",
  "0104",
  "0201",
  "0204",
  "0301",
  "0304",
  "0401",
  "0404",
  "0501",
  "0504",
  "0601",
  "0604",
  "0701",
  "0704",
  "0801",
  "0804",
  "0901",
  "0904",
  "1001",
  "1004",
  "1101",
  "1104",
  "1201",
  "1204",
  "1301",
  "1304",
  "1401",
  "1404",
  "1501",
  "1504",
  "1601",
  "1604",
  "1701",
  "1704",
  "1801",
  "1804",
  "9104",
  "9204",
];

const pad4 = (n: number): string => String(n).padStart(4, "0");

// XivItemTypes.GetSystemName (XivItemType.cs:353-356): the [Description] string of the enum member.
// For every type we encounter as a primary or secondary here (equipment/accessory/weapon/monster/
// demihuman/body) that description IS the type name itself (XivItemType.cs:34-39), so the identity
// map is faithful. `human` (never a primary/secondary in our roots set) would map to "human".
const getSystemName = (type: string): string => type;

// XivItemTypes.GetSystemPrefix (XivItemType.cs:318-333): "c" for human, else the first char of the
// system name. Mirrors the SYSTEM_PREFIX map in scripts/lib/imc-entries.ts:50-57.
function getSystemPrefix(type: string): string {
  if (type === "human") return "c";
  const name = getSystemName(type);
  return name.length > 0 ? name[0]! : "";
}

interface RootRow {
  primaryType: string;
  primaryId: number;
  secondaryType: string | null;
  secondaryId: number | null;
  slot: string | null;
  rootPath: string;
}

// XivDependencyRoot.GetRootFolder (XivDependencyRoot.cs:169-204), Dat-4 branch only (all our roots
// are chara/*): RootFolderFormatPrimary "chara/{name}/{prefix}{id}/" (:117) optionally followed by
// RootFolderFormatSecondary "obj/{name}/{prefix}{id}/" (:120) when a secondary type is present.
function getRootFolder(r: RootRow): string {
  const primary = `chara/${getSystemName(r.primaryType)}/${getSystemPrefix(r.primaryType)}${pad4(r.primaryId)}/`;
  if (r.secondaryType !== null && r.secondaryId !== null) {
    const s = `obj/${getSystemName(r.secondaryType)}/${getSystemPrefix(r.secondaryType)}${pad4(r.secondaryId)}/`;
    return primary + s;
  }
  return primary;
}

// XivDependencyRoot.GetBaseFileName (XivDependencyRoot.cs:138-158): BaseFileFormatWithSlot
// "{pPrefix}{pId}{sPrefix}{sId}_{slot}" (:127) or BaseFileFormatNoSlot "{pPrefix}{pId}{sPrefix}{sId}"
// (:128). Used by GetSimpleModelName for weapon/monster/demihuman.
function getBaseFileName(r: RootRow): string {
  const pPrefix = getSystemPrefix(r.primaryType);
  const pId = pad4(r.primaryId);
  let sPrefix = "";
  let sId = "";
  if (r.secondaryType !== null && r.secondaryId !== null) {
    sPrefix = getSystemPrefix(r.secondaryType);
    sId = pad4(r.secondaryId);
  }
  if (r.slot !== null) {
    return `${pPrefix}${pId}${sPrefix}${sId}_${r.slot}`;
  }
  return `${pPrefix}${pId}${sPrefix}${sId}`;
}

// XivDependencyRoot.GetRacialBaseName (XivDependencyRoot.cs:398-414): the human prefix ("c") + race
// code, then the PRIMARY type's prefix+id, then the slot. Equipment/accessory only (SecondaryType
// must be null, guarded at :429-432).
function getRacialBaseName(r: RootRow, race: string): string {
  const pPrefix = getSystemPrefix("human"); // "c"
  const pId = race; // race.GetRaceCode() is the 4-digit code string
  const sPrefix = getSystemPrefix(r.primaryType);
  const sId = pad4(r.primaryId);
  if (r.slot !== null) {
    return `${pPrefix}${pId}${sPrefix}${sId}_${r.slot}`;
  }
  return `${pPrefix}${pId}${sPrefix}${sId}`;
}

// XivDependencyRoot.GetModelPath (XivDependencyRoot.cs:228-249) for one root. Equipment/accessory
// yield ONE path per race (GetRacialModelName, :427-441); weapon/monster/demihuman yield a single
// simple-model path (GetSimpleModelName, :418-425, which is ModelNameFormat "{base}.mdl" :131 over
// GetBaseFileName). Returns [modelPath, ...] — every candidate, existence not yet checked.
function getModelPaths(r: RootRow): string[] {
  const rootFolder = getRootFolder(r);
  if (r.primaryType === "equipment" || r.primaryType === "accessory") {
    // Racial: one model per race. GetRacialModelName throws for SecondaryType != null; our
    // equipment/accessory roots always have a null secondary, matching that precondition.
    return RACES.map(
      (race) => `${rootFolder}model/${getRacialBaseName(r, race)}.mdl`,
    );
  }
  // Simple: weapon/monster/demihuman.
  return [`${rootFolder}model/${getBaseFileName(r)}.mdl`];
}

// ---------------------------------------------------------------------------------------------
// Step 1: roots table. Read exactly as extract-meta-reference.ts:279-307 does.
const { DatabaseSync } = await import("node:sqlite");
const rootsDb = new DatabaseSync(ITEM_SETS_DB, { readOnly: true });
let roots = rootsDb
  .prepare(
    "SELECT primary_type AS primaryType, primary_id AS primaryId, " +
      "secondary_type AS secondaryType, secondary_id AS secondaryId, " +
      "slot, root_path AS rootPath FROM roots " +
      "WHERE primary_type IN ('equipment', 'accessory', 'weapon', 'monster', 'demihuman')",
  )
  .all() as unknown as RootRow[];
rootsDb.close();

const totalRoots = roots.length;
if (SMOKE) {
  // Smoke subset: first N roots, but ALWAYS pin the e0194 equipment root(s). The acceptance gate
  // asserts the e0194 material->index pair, which lives ~970 roots deep (e0194 = primary_id 194,
  // 5 slots each), far past any small N. Pinning it keeps the canary meaningful without a huge N.
  const isCanary = (r: RootRow) =>
    r.primaryType === "equipment" && r.primaryId === 194;
  const canary = roots.filter(isCanary);
  const rest = roots.filter((r) => !isCanary(r));
  roots = [...canary, ...rest].slice(0, Math.max(INDEX_LIMIT, canary.length));
  console.log(
    `INDEX_LIMIT=${INDEX_LIMIT}: smoke run over ${roots.length} of ${totalRoots} roots ` +
      `(e0194 canary pinned; no table emitted).`,
  );
}

const gameIndex = GameIndex.load(SQPACK);
const problems: string[] = [];

// Step 2-5 outputs.
const pairs = new Map<string, string>(); // materialPath -> indexPath
const idTexPaths = new Set<string>(); // every base-game _id.tex observed
const presentMaterials = new Set<string>(); // dedup across models before reading

let modelsPresent = 0;

for (const r of roots) {
  for (const modelPath of getModelPaths(r)) {
    // Step 2: keep only models present in the index.
    if (!gameIndex.fileExists(modelPath)) continue;
    modelsPresent++;

    // Step 3: model -> referenced material basenames.
    const modelBytes = gameIndex.read(modelPath);
    const mdl = parseMdl(modelBytes, modelPath);
    const rm = readEditableModel(modelBytes, mdl);

    // Step 4: version-folder expansion by existence probe. rootFolder is the same GetRootFolder()
    // GetMaterialPath uses for its basePath (XivDependencyRoot.cs:274,288); MaterialFolderWithVariant
    // is "{root}material/v{N:D4}/" (:262).
    //
    // Weapon IMC-sharing redirect (XivDependencyRoot.cs:275-284): for an offhand whose weapon type is
    // in Imc.ImcSharingWeaponTypes (isImcSharingWeapon, ported in scripts/lib/imc-entries.ts), the
    // material FOLDER is the mainhand's root (primaryId - 50) while the material BASENAME still embeds
    // the offhand's own id — the C# `nInfo` is a struct COPY, so `nInfo.PrimaryId -= 50` shifts only
    // the folder, not `materialName`. So probe under the shifted root but keep the offhand model's
    // materialList basenames unchanged. The offhand MODEL path is NOT shifted (GetModelPath uses the
    // unshifted root), so model enumeration above is left as-is.
    const rootFolder =
      r.primaryType === "weapon" && isImcSharingWeapon(r.primaryId)
        ? getRootFolder({ ...r, primaryId: r.primaryId - 50 })
        : getRootFolder(r);
    for (const rawName of rm.pathData.materialList) {
      const basename = rawName.startsWith("/") ? rawName.slice(1) : rawName;
      for (let v = 1; v <= MAX_MATERIAL_VERSION; v++) {
        const matPath = `${rootFolder}material/v${pad4(v)}/${basename}`;
        if (!gameIndex.fileExists(matPath)) continue;
        if (v === MAX_MATERIAL_VERSION) {
          // Fail-loud: a hit at the bound means the probe range is too low (a higher version could
          // exist beyond it). Raise MAX_MATERIAL_VERSION.
          problems.push(
            `material exists at v${pad4(MAX_MATERIAL_VERSION)} (bound too low): ${matPath}`,
          );
        }
        presentMaterials.add(matPath);
      }
    }
  }
}

// Step 5: material -> index sampler.
for (const matPath of presentMaterials) {
  const mtrlBytes = gameIndex.read(matPath);
  const mtrl = parseMtrl(mtrlBytes, matPath);
  // Same sampler scan as scripts/extract-index-overrides.ts:65-71.
  const idx = mtrl.textures.find(
    (t) =>
      t.sampler &&
      samplerIdToTexUsage(t.sampler.samplerIdRaw, mtrl) === XivTexType.Index,
  );
  if (!idx) continue; // materials with no index sampler record nothing
  pairs.set(matPath, idx.texturePath);
  idTexPaths.add(idx.texturePath);
}

console.log(
  `Counts: roots=${roots.length} modelsPresent=${modelsPresent} ` +
    `materialsPresent=${presentMaterials.size} pairs=${pairs.size} idTexPaths=${idTexPaths.size}`,
);

if (SMOKE) {
  // Prove the e0194 canary pair the acceptance gate requires.
  const e0194Mat =
    "chara/equipment/e0194/material/v0001/mt_c0201e0194_top_a.mtrl";
  console.log(
    `e0194 canary: ${e0194Mat} -> ${pairs.get(e0194Mat) ?? "MISSING"}`,
  );
}

if (problems.length > 0) {
  for (const p of problems) console.error(`PROBLEM: ${p}`);
  process.exitCode = 1;
}
