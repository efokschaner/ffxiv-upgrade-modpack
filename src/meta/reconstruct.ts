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
      // The ttmp2 /upgrade path re-materializes each .meta rather than passing it through: the raw
      // .meta is converted to per-race Manipulations (WizardData.cs:685-691
      // MetadataToManipulations), which are then re-applied via PMP.ManipulationsToMetadata
      // (WizardData.cs:463-467). That base-seeds EstEntries from the game
      // (PMP.cs:1271 -> ItemMetadata.cs:253 `EstEntries = Est.GetExtraSkeletonEntries(root, ...)`)
      // and then overwrites each manipulation's race in place (PmpManipulation.cs:275-279,
      // `metadata.EstEntries[race].SkelId = Entry`). The base seed itself
      // (Est.GetExtraSkeletonEntries(XivDependencyRootInfo), Est.cs:259-291) branches by EstType:
      const estType = root.estType;
      const setId = root.primaryId;
      if (estType === "Head" || estType === "Body") {
        // Equipment est (Est.cs:267 `id = root.PrimaryId`, no Face/Hair trim): the full-race base
        // seed via the (type, setId) overload (Est.cs:300-334) — walk PLAYABLE_RACES (Eqp.
        // PlayableRaces), skipping races the est file doesn't carry at all, defaulting to skelId 0
        // for a race the file carries but has no entry for this setId. Then each manipulation
        // overwrites entry.SkelId in place ONLY (PmpManipulation.cs:275-279 `entry.SkelId = Entry`;
        // SetId is never touched), so the base's PLAYABLE_RACES order and seeded setId survive and
        // only skelId gets replaced per race.
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
            seed.push({ race, setId, skelId: override.skelId });
          } else {
            seed.push({ race, setId, skelId: raceTable[setId] ?? 0 });
          }
        }
        est = seed;
      } else {
        // Hair/Face est (Est.cs:267-270 `id = root.SecondaryId`, then the 268-288 trim): the base
        // seed is a SINGLE entry for the root's own character race (Est.cs:278
        // `race = XivRaces.GetXivRace(root.PrimaryId)`, our `root.race` — the `c####` prefix), not
        // the full PLAYABLE_RACES set. Default skelId 0 if the base table has no entry for this
        // race/setId (Est.cs:285 `new ExtraSkeletonEntry(race, id)` / ExtraSkeletonEntry.cs:15-20).
        if (root.race === null) {
          throw new Error(
            `meta: ${gamePath} is a Hair/Face EST root with no character race`,
          );
        }
        const race = root.race;
        const baseSkelId = EST_TABLE[estType][race]?.[setId] ?? 0;
        let entry: EstEntry = { race, setId, skelId: baseSkelId };
        for (const modEntry of est) {
          // PmpManipulation.cs:275 `metadata.EstEntries[race]` is a dict keyed on the single seeded
          // race above; applying a manipulation for any other race is a C# KeyNotFoundException.
          // Fail loud instead of silently emitting a race the game seed never had.
          if (modEntry.race !== race) {
            throw new Error(
              `meta: ${gamePath} has a Hair/Face EST entry for race ${modEntry.race}, ` +
                `but the root's seeded race is ${race} (KeyNotFoundException equivalent)`,
            );
          }
          // PmpManipulation.cs:275-279 `entry.SkelId = Entry`: only SkelId is assigned in place;
          // SetId/race are carried from the seed (setId here), never taken from the mod entry.
          entry = { race, setId, skelId: modEntry.skelId };
        }
        est = [entry];
      }
    }
  }
  return { ...mod, eqdp, est };
}
