// Builds test/corpus/synthetic/absent-file-upgraded.pmp: like absent-file.pmp (an option whose
// Files map names a payload the archive never contains), but paired with a payload that genuinely
// upgrades, so ConsoleTools /upgrade actually WRITES a pack instead of no-opping. That is what
// gives the writer's Files-key drop (PMP.cs:883-888) a real /upgrade golden: ConsoleTools emits
// group_001_absent.json with the absent gamePath's Files key gone and the surviving mtrl's key
// intact, and we must match it byte-for-byte.
//
// Two things this pack must get right or it tests the wrong thing entirely:
//
// 1. Zip layout. Both writers regenerate every payload entry name as `<optionPrefix><gamePath>`
//    (PmpExtensions.cs:534). For a single-option group, MakeOptionPrefix (WizardData.cs:1419)
//    collapses to the group's own folder (no per-option subfolder), and MakeGroupPrefix
//    (:1383-1412) lowercases the group name via IOUtil.MakePathSafe and appends "/". A one-page,
//    one-group, one-option pack named "Absent" therefore gets optionPrefix "absent/", so every
//    payload here is zipped at "absent/<gamePath>" — keeping the diff focused on the Files-key
//    drop rather than on naming.
// 2. The material must actually upgrade. DoesMtrlNeedDawntrailUpdate (EndwalkerUpgrade.cs:550)
//    fires on any 256-entry (Endwalker-era) colorset, which buildEwColorsetMtrl (synthetic-mtrl.ts,
//    where this builder's local copy now lives) encodes, with a NormalMap0 sampler bound so the
//    colorset round's normalTex lookup (EndwalkerUpgrade.cs:912) finds a match. A realistic game
//    path (chara/equipment/.../texture/..._n.tex) is used for a representative repro. The
//    referenced normal texture is deliberately NOT packed, so the second upgrade round's
//    `files.ContainsKey(upgrade.Files["normal"])` guard (EndwalkerUpgrade.cs:1840) misses and no
//    texture file is generated — keeping this pack's only non-absent payload the one .mtrl.

import {
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";
import { buildEwColorsetMtrl } from "./synthetic-mtrl";

// The material that genuinely upgrades. Not a gamePath /upgrade ignores — the whole point here is
// that it DOES process this one.
const mtrlGamePath =
  "chara/equipment/e9999/material/v0001/mt_c0101e9999_top_a.mtrl";
const normalTexPath = "chara/equipment/e9999/texture/v01_c0101e9999_top_n.tex";

// A gamePath the archive genuinely does not contain (mirrors absent-file.pmp). Its payload is
// never packed below, so this Files key names nothing.
const absentGamePath = "chara/dummy/absent_file_missing.bin";

// Single-option group "Absent" -> MakeOptionPrefix collapses to the group folder "absent/"
// (see header comment #1). Every zip member below must sit under that prefix.
const optionPrefix = "absent/";
const mtrlZipPath = optionPrefix + mtrlGamePath;

writePmp("absent-file-upgraded.pmp", {
  meta: syntheticMeta("Absent File Upgraded Repro"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_absent.json": singleOptionGroup("Absent", {
      [mtrlGamePath]: mtrlZipPath.toLowerCase().replace(/\//g, "\\"),
      [absentGamePath]: (optionPrefix + absentGamePath)
        .toLowerCase()
        .replace(/\//g, "\\"),
    }),
  },
  files: { [mtrlZipPath]: buildEwColorsetMtrl(normalTexPath) },
});
