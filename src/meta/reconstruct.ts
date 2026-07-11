import { PLAYABLE_RACES } from "./playable-races";
import { parseMetaRoot } from "./root";
import type { ItemMeta } from "./types";

// Reconstruct a .meta the way ConsoleTools /upgrade does: seed from the base game, apply the mod's
// deltas. EQDP is data-free (ItemMetadata.cs:782-788 injects 0 for missing PlayableRaces at read,
// overwriting the base seed), so we expand to the canonical 18 races here. EST/EQP/GMP/IMC are
// filled in by later tasks; for now they pass through unchanged.
export function reconstructMeta(mod: ItemMeta, gamePath: string): ItemMeta {
  let eqdp = mod.eqdp;
  if (eqdp) {
    // parseMetaRoot's root shape isn't consumed by EQDP expansion (it's data-free), but this
    // task validates it here anyway (throws on unknown roots) rather than at the top of the
    // function: root.ts (Task 4) only recognizes equipment/accessory/hair/face roots, and the
    // corpus has weapon/monster .meta files (e.g. chara/weapon/w2021/.../w2021b0001.meta) that
    // carry only an IMC segment (no eqdp) and pass through untouched this round. Validating
    // unconditionally would fail-loud on those even though this task does nothing to them yet;
    // gate the check on there being actual EQDP work so weapon/monster keep no-oping until a
    // later task ports their root shape.
    parseMetaRoot(gamePath);
    const byRace = new Map(eqdp.map((e) => [e.race, e.value]));
    eqdp = PLAYABLE_RACES.map((race) => ({
      race,
      value: byRace.get(race) ?? 0,
    }));
  }
  return { ...mod, eqdp };
}
