// Enumerator + encoder for the base-game material -> index-sampler (_id.tex) path table —
// extraction tooling only (NOT shipped port code), same status as scripts/lib/game-index.ts and
// scripts/lib/imc-entries.ts. Builds two in-memory collections (`pairs`, `idTexPaths`), classifies
// each pair against the regular-case reconstruction (index-path-reconstruct.ts), packs the result,
// and writes the generated src/upgrade/reference/index-table.ts. A `--experimental-sqlite` full run
// (no INDEX_LIMIT) also cross-checks completeness against the local corpus (see the corpus scan
// below) and fails loud on any real enumeration miss. The smoke run (INDEX_LIMIT set) skips both the
// cross-check and the emission — it only proves the enumeration walk itself works on a subset.
//
// This reproduces a narrow slice of TexTools' dependency graph — the model->material->texture edges
// XivCache.GetChildFiles walks (XivDependencyGraph.cs · GetChildFiles · 398-435: a model's children
// are Mdl.GetReferencedMaterialPaths, a material's children are its texture samplers) — to find, for
// every base-game equipment/accessory/weapon/monster/demihuman set, each material that carries an
// index sampler and read that sampler's real path. TexTools' idPath refinement steals this base-game
// path verbatim (EndwalkerUpgrade.cs:923-936); a mod's own bytes can't reconstruct it (the canonical
// v{NN}_ version prefix + dropped variant letter), so it must be bundled. Replaces the deleted
// scripts/extract-index-overrides.ts (a per-corpus, ConsoleTools-driven, 11-entry precursor); see
// docs/superpowers/specs/2026-07-20-index-path-resolution-design.md for why it was replaced.
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
//   5. Mtrl -> index sampler (src/mtrl; the same sampler-scan idiom the deleted
//      extract-index-overrides.ts used, see Step 5 below).
//
// Hair/tail/ear/accessory CUSTOMIZATION materials are not items and so have no item_sets.db root at
// all; they are enumerated separately by the same fixed-name existence probe
// scripts/extract-hair-materials.ts:81-102 already established (single material/v0001/ folder per
// part, RACES x ID_MAX grid) — see the dedicated block right before Step 5 below.
//
// Regenerate on a machine with FFXIV installed; needs node's --experimental-sqlite for the
// item_sets.db enumeration:
//   $env:NODE_OPTIONS="--experimental-sqlite"; npx tsx scripts/extract-index-table.ts
// Smoke run (fast, ~pins the e0194 canary): prefix with `$env:INDEX_LIMIT=50;`.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModpack } from "../src/index";
import { readEditableModel } from "../src/mdl/model/read-model";
import { parseMdl } from "../src/mdl/parse";
import { allFiles } from "../src/model/modpack";
import { parseMtrl } from "../src/mtrl/mtrl";
import { samplerIdToTexUsage, XivTexType } from "../src/mtrl/shader";
import { reconstructIndexPath } from "../src/upgrade/reference/index-path-reconstruct";
import { computeHash, GameIndex } from "./lib/game-index";
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

// Material version-folder probe bound. IMC's MaterialSet field is a single byte (Imc.cs), so 255 is
// the true upper bound of what version folder could ever exist; a handful of legacy equipment sets
// (found via the Task 3 completeness cross-check hitting the previous bound of 64 — e.g. e0009,
// e0011, e0016, e0023, e0025, e0029, w2199) genuinely have material variants well past 64, so the
// probe must cover the type's full range rather than the "low double digits" most sets use. The
// fail-loud guard below trips if any material exists at exactly v{MAX} so the bound gets raised
// rather than silently truncating.
const MAX_MATERIAL_VERSION = 255;

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
// Step 1: roots table. Read exactly as extract-meta-reference.ts:279-307 does. Minions and mounts are
// `monster` roots, so they are covered by this filter. The three `roots` types deliberately omitted —
// `human` non-hair (face/body/iris/skin), `indoor`, `outdoor` (housing) — were checked against the game
// and carry NO index sampler (skin/iris and `bg` shaders never bind g_SamplerIndex), so the steal's
// idSamp is always null there and our omission matches C# exactly; see design §3.5. Hair/tail/ear/`_acc`
// customization (which CAN carry one) is folded in separately below.
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

// Hair/tail/ear/accessory CUSTOMIZATION materials are not items, so they never appear in
// item_sets.db and are wholly absent from the roots walk above (found via the completeness
// cross-check below hitting a real corpus material: a hair "_acc" accessory material carrying an
// index sampler pointing at the shared chara/common/texture/id_*.tex namespace — the known
// EXCEPTIONS population this table is expected to hold). Each part lives at a SINGLE fixed
// material/v0001/ folder (no per-item version-folder growth, unlike equipment/accessory items), so
// this reuses the exact vetted formulaic probe scripts/extract-hair-materials.ts:81-102 already
// established over the same RACES x ID_MAX(500, Character.cs:335 _SCAN_LIMIT) grid — existence-probe
// only, then fold hits into the SAME presentMaterials set so Step 5 below reads/classifies them
// identically to every other material.
const HAIR_PART_FORMATS: Array<(race: string, id: string) => string> = [
  (race, id) =>
    `chara/human/c${race}/obj/hair/h${id}/material/v0001/mt_c${race}h${id}_hir_a.mtrl`,
  (race, id) =>
    `chara/human/c${race}/obj/tail/t${id}/material/v0001/mt_c${race}t${id}_a.mtrl`,
  (race, id) =>
    `chara/human/c${race}/obj/zear/z${id}/material/v0001/mt_c${race}z${id}_a.mtrl`,
  (race, id) =>
    `chara/human/c${race}/obj/hair/h${id}/material/v0001/mt_c${race}h${id}_acc_b.mtrl`,
];
const HAIR_ID_MAX = 500; // _SCAN_LIMIT (Character.cs:335), same bound extract-hair-materials.ts uses.
for (const fmt of HAIR_PART_FORMATS) {
  for (const race of RACES) {
    for (let i = 1; i <= HAIR_ID_MAX; i++) {
      const matPath = fmt(race, pad4(i));
      if (gameIndex.fileExists(matPath)) presentMaterials.add(matPath);
    }
  }
}

// Step 5: material -> index sampler.
for (const matPath of presentMaterials) {
  const mtrlBytes = gameIndex.read(matPath);
  const mtrl = parseMtrl(mtrlBytes, matPath);
  // Same sampler-scan idiom the deleted scripts/extract-index-overrides.ts used.
  const idx = mtrl.textures.find(
    (t) =>
      t.sampler &&
      samplerIdToTexUsage(t.sampler.samplerIdRaw, mtrl) === XivTexType.Index,
  );
  if (!idx) continue; // materials with no index sampler record nothing
  // We record the raw `texturePath`; C# steals `idSamp.Dx11Path` (EndwalkerUpgrade.cs:934).
  // Dx11Path (XivMtrl.cs:667-680) equals TexturePath UNLESS the sampler's `Flags & 0x8000` (the
  // DX9->DX11 dual-provision marker) is set, in which case it inserts a `--` before the filename.
  // That flag only ever appears on legacy diffuse/normal/specular textures that shipped separate DX9
  // and DX11 variants; an index map (_id.tex) is Dawntrail-only and has no DX9 counterpart, so an
  // index sampler never sets 0x8000 and Dx11Path === TexturePath here. The shortcut is therefore
  // exact for this domain, not merely close.
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

// ---------------------------------------------------------------------------------------------
// Task 3 Step 5: completeness cross-check (fail-loud). The enumerated `pairs` domain IS the runtime
// resolver's existence oracle (AGENTS.md): a lookup miss must mean "genuinely not a base material
// with an index sampler", never "the roots/models/materials walk above forgot a namespace". Prove
// that by scanning every `.mtrl` gamePath the LOCAL corpus (real + synthetic + upgrade-error, all
// gitignored — see test/helpers/corpus-roots.ts) references: for any such path that IS a base-game
// material (gameIndex.fileExists) but is NOT already in `pairs`, read + parse it and check whether
// it actually carries an index sampler. A base material with genuinely no index sampler is a
// faithful miss (convention applies); a base material WITH one that we failed to enumerate is a
// real gap in the walk above. Skipped in SMOKE mode: a partial root subset cannot cover the whole
// corpus and would just be noisy (mirrors the IMC_LIMIT smoke-skips-validation pattern in
// extract-meta-reference.ts).
if (!SMOKE) {
  // corpus-roots.ts reads __dirname at module scope (Vite-only global); shim it before the dynamic
  // import, exactly as extract-meta-reference.ts does for the same reason (a static import would
  // evaluate the module-scope read before this shim runs).
  (globalThis as unknown as { __dirname: string }).__dirname = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "test",
    "helpers",
  );
  const { corpusPacks, isUpgradeErrorPack } = await import(
    "../test/helpers/corpus-roots"
  );

  const corpusMtrlPaths = new Set<string>();
  for (const pack of corpusPacks()) {
    // upgrade-error packs are deliberately malformed (see corpus-roots.ts): they exist to prove
    // our /upgrade throws exactly where ConsoleTools does, not to supply real material references,
    // so a container-level load failure here is expected and not a completeness gap.
    if (isUpgradeErrorPack(pack)) continue;
    const bytes = new Uint8Array(readFileSync(pack));
    let data: ReturnType<typeof loadModpack>;
    try {
      data = loadModpack(pack, bytes);
    } catch (err) {
      problems.push(
        `completeness: failed to load corpus pack ${pack}: ${(err as Error).message}`,
      );
      continue;
    }
    for (const { gamePath } of allFiles(data)) {
      if (gamePath.endsWith(".mtrl")) corpusMtrlPaths.add(gamePath);
    }
  }

  let rechecked = 0;
  for (const matPath of corpusMtrlPaths) {
    if (pairs.has(matPath)) continue; // already enumerated with an index sampler
    if (!gameIndex.fileExists(matPath)) continue; // not a base-game material at all (mod-only path)
    rechecked++;
    const mtrlBytes = gameIndex.read(matPath);
    const mtrl = parseMtrl(mtrlBytes, matPath);
    const idx = mtrl.textures.find(
      (t) =>
        t.sampler &&
        samplerIdToTexUsage(t.sampler.samplerIdRaw, mtrl) === XivTexType.Index,
    );
    if (idx) {
      problems.push(
        `completeness: ${matPath} has an index sampler (${idx.texturePath}) but is missing from ` +
          "the enumerated pairs table (roots/models/materials walk gap)",
      );
    }
  }
  console.log(
    `Completeness cross-check: ${corpusMtrlPaths.size} distinct corpus .mtrl gamePaths, ` +
      `${rechecked} base-game materials outside pairs re-checked, ` +
      `${problems.length} problem(s).`,
  );
}

// ---------------------------------------------------------------------------------------------
// Task 3 Steps 2-4: classify, pack, and emit the generated table. Skipped in SMOKE mode (Task 2's
// established behaviour: "no table emitted" over a partial root subset).
//
// Generalized encoding (operator decision 2026-07-20, post-full-run finding): the index-TEXTURE
// version prefix is NOT the material's own folder version -- for most equipment, multiple material
// variant folders share one canonical index texture (e.g. v0002-v0004 of a set all point at texture
// v01), so a single keep/drop-letter BIT keyed to the material's own folder version (the original
// Task 3 design) only round-trips ~48% of pairs; the rest fell into EXCEPTIONS as full uncompressed
// strings. Storing the actual observed `version` alongside the letter bit (both non-derivable from
// the material path, both cheap to pack per entry) instead compresses the vast majority, cutting the
// table from ~2.6 MiB to well under 1 MiB.
if (!SMOKE) {
  // Step 2: classify each pair by deriving (version, keepLetter) from the OBSERVED index path, then
  // verifying reconstructIndexPath(matPath, version, keepLetter) reproduces it exactly.
  // reconstructIndexPath itself is keyed off the material's own root, so a match here already implies
  // the parsed index-path root equals the material's root -- no separate root-equality check needed.
  // A non-match (root mismatch, e.g. cross-root hair `_acc` -> chara/common/texture/id_*.tex; or a
  // shape that doesn't even parse as v{N}_..._id.tex) is recorded as an EXCEPTION, storing the full
  // observed path verbatim (always correct, just uncompressed).
  const INDEX_PATH_RE = /^(.*)\/texture\/v(\d+)_(.+)_id\.tex$/;
  const regular: Array<{
    matPath: string;
    version: number;
    keepLetter: boolean;
  }> = [];
  const exceptions: Record<string, string> = {};
  let maxVersion = 0;
  for (const [matPath, indexPath] of pairs) {
    const m = indexPath.match(INDEX_PATH_RE);
    const version = m ? Number(m[2]) : null;
    let keepLetter: boolean | null = null;
    if (version !== null) {
      if (reconstructIndexPath(matPath, version, false) === indexPath)
        keepLetter = false;
      else if (reconstructIndexPath(matPath, version, true) === indexPath)
        keepLetter = true;
    }
    if (keepLetter !== null && version !== null) {
      // Fail-loud: the packed u16 reserves its top bit for keepLetter, leaving 15 bits (0x7fff) for
      // version. Observed max is well under 100, so this should never fire; if it does, the format
      // needs to grow rather than silently truncate.
      if (version > 0x7fff) {
        problems.push(
          `version ${version} for ${matPath} exceeds 0x7fff (u16 top bit is the keepLetter flag)`,
        );
      }
      regular.push({ matPath, version, keepLetter });
      if (version > maxVersion) maxVersion = version;
    } else {
      exceptions[matPath] = indexPath;
    }
  }
  console.log(
    `Classification: regular=${regular.length} EXCEPTIONS=${Object.keys(exceptions).length} ` +
      `(maxVersion=${maxVersion})`,
  );
  // DEBUG: sample a handful of exceptions for the report -- the known populations are (a) hair
  // `_acc` accessory materials (cross-root, chara/common/texture/id_*.tex) and (b) any index path
  // whose shape doesn't parse as v{N}_..._id.tex at all.
  const sampleKeys = Object.keys(exceptions).slice(0, 15);
  console.log(
    `Sample EXCEPTIONS entries (${sampleKeys.length} of ${Object.keys(exceptions).length}):`,
  );
  for (const k of sampleKeys) console.log(`  ${k} -> ${exceptions[k]}`);

  // Round-trip self-check (coordinator-requested): decode each packed (version, keepLetter) back out
  // of its u16 encoding and confirm reconstructIndexPath reproduces the ORIGINAL observed index path
  // byte-for-byte. This is a cheap guard against a bit-packing/masking mistake (as opposed to the
  // classification loop above, which only proves the pre-encoding values are correct).
  let roundTripChecked = 0;
  for (const { matPath, version, keepLetter } of regular) {
    const packed16 = (version & 0x7fff) | (keepLetter ? 0x8000 : 0);
    const decodedVersion = packed16 & 0x7fff;
    const decodedKeepLetter = (packed16 & 0x8000) !== 0;
    const reconstructed = reconstructIndexPath(
      matPath,
      decodedVersion,
      decodedKeepLetter,
    );
    const original = pairs.get(matPath)!;
    if (reconstructed !== original) {
      problems.push(
        `round-trip: ${matPath} packed (version=${version} keepLetter=${keepLetter}) decodes to ` +
          `(version=${decodedVersion} keepLetter=${decodedKeepLetter}) reconstructing "${reconstructed}", ` +
          `expected "${original}"`,
      );
    }
    roundTripChecked++;
  }
  console.log(
    `Round-trip self-check: ${roundTripChecked} regular entries verified lossless.`,
  );

  // Step 3: pack the regular table as fixed 10-byte records -- (folderHash,fileHash) LE uint32 pairs
  // of the MATERIAL path (same convention as extract-hair-texture-index.ts:87-101), followed by a u16
  // holding `version | (keepLetter ? 0x8000 : 0)`. Sort by (folderHash, fileHash) for a stable diff.
  function packRegular(
    entries: Array<{ matPath: string; version: number; keepLetter: boolean }>,
  ): string {
    const rows: [number, number, number][] = entries.map(
      ({ matPath, version, keepLetter }) => {
        const slash = matPath.lastIndexOf("/");
        const folderHash = computeHash(matPath.slice(0, slash));
        const fileHash = computeHash(matPath.slice(slash + 1));
        const flags = (version & 0x7fff) | (keepLetter ? 0x8000 : 0);
        return [folderHash, fileHash, flags];
      },
    );
    rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = Buffer.alloc(rows.length * 10);
    rows.forEach(([f, x, flags], i) => {
      out.writeUInt32LE(f >>> 0, i * 10);
      out.writeUInt32LE(x >>> 0, i * 10 + 4);
      out.writeUInt16LE(flags & 0xffff, i * 10 + 8);
    });
    return out.toString("base64");
  }

  // ID_TEX_PACKED stays the plain 8-byte (folderHash,fileHash) form -- identical to
  // extract-hair-texture-index.ts:87-101 / HAIR_TEX_INDEX_PACKED, unchanged by this generalization.
  function packHashPairs(paths: string[]): string {
    const hashed: [number, number][] = paths.map((p) => {
      const slash = p.lastIndexOf("/");
      return [computeHash(p.slice(0, slash)), computeHash(p.slice(slash + 1))];
    });
    hashed.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = Buffer.alloc(hashed.length * 8);
    hashed.forEach(([f, x], i) => {
      out.writeUInt32LE(f >>> 0, i * 8);
      out.writeUInt32LE(x >>> 0, i * 8 + 4);
    });
    return out.toString("base64");
  }

  const indexPacked = packRegular(regular);
  const idTexPacked = packHashPairs([...idTexPaths]);

  // Step 4: emit the generated module. Only when the completeness cross-check AND the round-trip
  // self-check found no problems -- a known-incomplete or lossy encoding must not silently overwrite
  // a good committed table.
  if (problems.length === 0) {
    const exceptionKeys = Object.keys(exceptions).sort();
    const exceptionsBody = exceptionKeys
      .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(exceptions[k])},`)
      .join("\n");
    const out =
      "// GENERATED — regenerate via `npx tsx scripts/extract-index-table.ts`. Do not edit by hand.\n" +
      "//\n" +
      "// Base-game material -> index (_id.tex) sampler path, compressed. Backs TexTools' idPath\n" +
      "// refinement (EndwalkerUpgrade.cs:923-936): when an upgraded material overwrites a base-game\n" +
      "// material, the generated index sampler steals THAT material's own index path rather than\n" +
      "// deriving one by naming convention. Enumerated by scripts/extract-index-table.ts (item-seeded\n" +
      "// walk: item_sets.db roots -> models -> materials -> index sampler, existence-probed for\n" +
      "// version folders); see that file for full provenance and the corpus completeness cross-check\n" +
      "// that guards this table's coverage.\n" +
      "//\n" +
      "// INDEX_PACKED: one 10-byte record per REGULAR material -- (folderHash,fileHash) LE uint32 of\n" +
      "// the MATERIAL path, then a u16 = `version | (keepLetter ? 0x8000 : 0)`. `version` is the\n" +
      "// index-TEXTURE's own version prefix (e.g. 18 in v18_..._id.tex) -- NOT the material's folder\n" +
      "// version, which usually differs (many material variant folders share one canonical index\n" +
      "// texture). `keepLetter` is whether the index path keeps the material's trailing variant\n" +
      "// letter. Neither is derivable from the material path string alone, so both are stored; the\n" +
      "// runtime resolver reconstructs the full index path via reconstructIndexPath(materialPath,\n" +
      "// version, keepLetter) (index-path-reconstruct.ts).\n" +
      "// INDEX_EXCEPTIONS: materials whose index path does not fit ANY (version, keepLetter) pair the\n" +
      "// regular reconstruction can produce, keyed by the full material path with the full index path\n" +
      "// as the value (~1.9k entries -- NOT mostly hair; dominated by monster (~42%) and hair/tail/ear\n" +
      "// (~28%) materials, ~54% pointing at the shared chara/common/texture/id_*.tex namespace). Correctness is\n" +
      "// unaffected either way: this map always stores the literal path read from the base-game\n" +
      "// material.\n" +
      "// ID_TEX_PACKED: (folderHash,fileHash) pairs for every base-game _id.tex path observed during\n" +
      "// enumeration, for gate B (!FileExists(idPath)) in the runtime resolver.\n" +
      `export const INDEX_PACKED = ${JSON.stringify(indexPacked)};\n` +
      "export const INDEX_EXCEPTIONS: Record<string, string> = {\n" +
      exceptionsBody +
      "\n};\n" +
      `export const ID_TEX_PACKED = ${JSON.stringify(idTexPacked)};\n`;
    const outPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "upgrade",
      "reference",
      "index-table.ts",
    );
    writeFileSync(outPath, out);
    console.log(
      `wrote ${pairs.size} index entries (regular=${regular.length} ` +
        `EXCEPTIONS=${exceptionKeys.length}) to ${outPath}`,
    );
  } else {
    console.log("\nNot writing index-table.ts due to problems above.");
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`PROBLEM: ${p}`);
  process.exitCode = 1;
}
