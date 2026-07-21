// Builds test/corpus/synthetic/index-fallback.pmp: the design spec §1.1 edge case (see
// docs/superpowers/specs/2026-07-20-index-path-resolution-design.md) where a mod overwrites a
// base-game equipment material's colorset WITHOUT shipping that material's normal texture. The
// index reference gets added (EndwalkerUpgrade.cs:923-936) but the second round's index-texture
// generation never runs (its `files.ContainsKey(upgrade.Files["normal"])` guard,
// EndwalkerUpgrade.cs:1840, misses because the normal was never packed) — so ConsoleTools falls
// back to the base material's own canonical, in-game index path (the "steal") instead of the
// convention `_id.tex` sibling of a texture that does not exist. This pack pins that our
// `resolveStolenIndexPath` (src/upgrade/reference/index-path-resolver.ts) reproduces the same
// steal, by running the same real ConsoleTools /upgrade oracle the rest of the corpus does.
//
// Gate conditions (mirrors resolveStolenIndexPath / idTexExists' call site, material.ts:138-145):
//
// 1. Gate A — the mod's material path must be a REAL base-game material with an index sampler,
//    present in the resolver's generated table. `chara/equipment/e0194/material/v0001/
//    mt_c0201e0194_top_a.mtrl` is confirmed by test/upgrade/index-path-resolver.test.ts ("drops
//    the variant letter where the game does (e0194)") to resolve to the stolen path
//    `chara/equipment/e0194/texture/v01_c0201e0194_top_id.tex`.
// 2. Gate B — the convention `_id.tex` sibling of the material's normal texture must be ABSENT
//    from the base game. The normal path passed to buildEwColorsetMtrl,
//    `chara/equipment/e0194/texture/c0201e0194_top_a_n.tex`, has convention idPath
//    `chara/equipment/e0194/texture/c0201e0194_top_a_id.tex` — distinct from the real
//    `v01_c0201e0194_top_id.tex` above (no `v01_` prefix, keeps the `_a` variant letter), so
//    idTexExists misses it and gate B holds.
// 3. The normal texture itself must NOT be packed, so the second upgrade round's Files-key guard
//    misses and no index texture is generated for this option — see buildEwColorsetMtrl's own doc
//    comment (synthetic-mtrl.ts) for the mechanism this exercises.
//
// With both gates satisfied and no index texture generated, TexTools repoints the material's index
// sampler at the stolen canonical path rather than leaving a dangling convention reference. Our
// output should therefore fully match the golden with no `.upgrade-baseline` entry.

import {
  EMPTY_DEFAULT_MOD,
  singleOptionGroup,
  syntheticMeta,
  writePmp,
} from "./pmp-builder";
import { buildEwColorsetMtrl } from "./synthetic-mtrl";

// Real base-game material (gate A) — see header comment #1.
const mtrlGamePath =
  "chara/equipment/e0194/material/v0001/mt_c0201e0194_top_a.mtrl";
// Normal texture path baked into the .mtrl's texture usage entry (gate B — see header comment #2).
// Deliberately never packed (see header comment #3).
const normalTexPath = "chara/equipment/e0194/texture/c0201e0194_top_a_n.tex";

// Single-option group "IndexFallback" -> MakeOptionPrefix collapses to the group folder
// "indexfallback/" (single-option group; see absent-file-upgraded.ts's header comment #1 for the
// mechanism). Every zip member below sits under that prefix.
const optionPrefix = "indexfallback/";
const mtrlZipPath = optionPrefix + mtrlGamePath;

writePmp("index-fallback.pmp", {
  meta: syntheticMeta("Index Fallback Repro"),
  defaultMod: EMPTY_DEFAULT_MOD,
  groups: {
    "group_001_indexfallback.json": singleOptionGroup("IndexFallback", {
      [mtrlGamePath]: mtrlZipPath.toLowerCase().replace(/\//g, "\\"),
    }),
  },
  files: { [mtrlZipPath]: buildEwColorsetMtrl(normalTexPath) },
});
