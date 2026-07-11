import { PLAYABLE_RACES } from "./playable-races";
import { EST_TABLE } from "./reference/est-table";
import { parseMetaRoot } from "./root";
import type { EstEntry, ItemMeta } from "./types";

// Reconstruct a .meta the way ConsoleTools /upgrade does: seed from the base game, apply the mod's
// deltas. EQDP is data-free (ItemMetadata.cs:782-788 injects 0 for missing PlayableRaces at read,
// overwriting the base seed), so we expand to the canonical 18 races here. EST is reconstructed
// below (base seed from EST_TABLE + mod overrides, port of Est.GetExtraSkeletonEntries). EQP/GMP
// are opaque bytes the mod always supplies (base seed proven never consulted across the corpus,
// see Task 7 brief), so they pass through unchanged via the `{ ...mod }` spread. IMC is filled in
// by a later task.
export function reconstructMeta(mod: ItemMeta, gamePath: string): ItemMeta {
  let eqdp = mod.eqdp;
  let est = mod.est;
  if (mod.eqdp || mod.est) {
    // root.ts (Task 4) only recognizes equipment/accessory/hair/face roots, and the corpus has
    // weapon/monster .meta files (e.g. chara/weapon/w2021/.../w2021b0001.meta) that carry only
    // an IMC segment (no eqdp, no est) and pass through untouched this round. Gate the parse on
    // there being actual EQDP/EST work so weapon/monster keep no-oping until a later task ports
    // their root shape; parseMetaRoot still fails loud on genuinely-unrecognized paths.
    const root = parseMetaRoot(gamePath);
    if (eqdp) {
      const byRace = new Map(eqdp.map((e) => [e.race, e.value]));
      eqdp = PLAYABLE_RACES.map((race) => ({
        race,
        value: byRace.get(race) ?? 0,
      }));
    }
    if (est) {
      if (root.estType === null) {
        throw new Error(`meta: ${gamePath} has an EST segment but no est type`);
      }
      // Empirically (see corpus evidence below), ConsoleTools /upgrade only rebuilds EST from the
      // base seed for EQUIPMENT roots (met/top, EstType Head/Body); Hair/Face .meta pass their EST
      // segment through byte-identical even when the mod supplies only some races. Verified via the
      // golden harness on two ttmp2 (non-PMP) packs, ruling out a PMP-manipulation-vs-raw-.meta
      // explanation: "Purrfection Ears & Bow.ttmp2" (chara/equipment/e5035/e5035_met.meta, EstType
      // Head) — mod supplies 16/18 races, golden adds race 1601 (skelId 5035, base identity entry)
      // AND 1701 (skelId 0, base has no entry for this setId) — full base-seed reconstruction.
      // "Misty_Hairstyle_Female.ttmp2" (chara/human/c0201/obj/hair/h0170/c0201h0170_hir.meta,
      // EstType Hair) — mod supplies only race 201; golden is byte-identical to the mod's own
      // single-entry EST, with NO base-fill despite EST_TABLE.Hair having sections (and, for this
      // setId, real skelId data) for every other PLAYABLE_RACES race. We could not find the specific
      // C# branch point that draws this line (ModpackUpgrader.cs/WizardData.cs touch models/textures
      // and PMP-manipulation import, but not raw .meta segments directly), so this gate reproduces
      // the observed golden split rather than citing a single symbol; see Task 7 report.
      if (root.itemType === "equipment") {
        // Port of Est.GetExtraSkeletonEntries(EstType, ushort setId) (Est.cs:300-334): base seed
        // is built by walking PLAYABLE_RACES (Eqp.PlayableRaces), skipping races the est file
        // doesn't carry at all, and defaulting to skelId 0 for a race the file carries but has no
        // entry for this setId. ManipulationsToMetadata's PMPEstManipulationJson.ApplyToMetadata
        // (PmpManipulation.cs:265-280) then overwrites entry.SkelId for the mod's races in place
        // (metadata.EstEntries[race].SkelId = ...), so the base's PLAYABLE_RACES order survives
        // and only skelId (and, here, setId) get replaced per race.
        const estType = root.estType;
        const setId = root.primaryId;
        const byRace = new Map(est.map((e) => [e.race, e]));
        const baseByRace = EST_TABLE[estType];
        const seed: EstEntry[] = [];
        for (const race of PLAYABLE_RACES) {
          const raceTable = baseByRace[race];
          if (raceTable === undefined) {
            continue;
          }
          const override = byRace.get(race);
          if (override) {
            seed.push(override);
          } else {
            seed.push({ race, setId, skelId: raceTable[setId] ?? 0 });
          }
        }
        est = seed;
      }
      // Hair/Face (root.itemType "other"): leave `est` as the mod's own value, byte-identical.
    }
  }
  return { ...mod, eqdp, est };
}
