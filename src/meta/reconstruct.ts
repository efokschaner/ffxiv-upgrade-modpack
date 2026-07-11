import { PLAYABLE_RACES } from "./playable-races";
import { EST_TABLE } from "./reference/est-table";
import { IMC_TABLE } from "./reference/imc-table";
import { parseMetaRoot } from "./root";
import type { EstEntry, ItemMeta } from "./types";

// Reconstruct a .meta the way ConsoleTools /upgrade does: seed from the base game, apply the mod's
// deltas. EQDP is data-free (ItemMetadata.cs:782-788 injects 0 for missing PlayableRaces at read,
// overwriting the base seed), so we expand to the canonical 18 races here. EST is reconstructed
// below (base seed from EST_TABLE + mod overrides, port of Est.GetExtraSkeletonEntries). EQP/GMP
// are opaque bytes the mod always supplies (base seed proven never consulted across the corpus,
// see Task 7 brief), so they pass through unchanged via the `{ ...mod }` spread. IMC is
// reconstructed below (base seed from IMC_TABLE + mod overrides, port of the
// ItemMetadata.cs:238-241 GetFullImcInfo seed + PMP's ManipulationsToMetadata/ApplyToMetadata
// grow-to-fit).
export function reconstructMeta(mod: ItemMeta, gamePath: string): ItemMeta {
  // root.ts (Task 4 + Task 8b) now recognizes every root shape the corpus exercises
  // (equipment/accessory/hair/face/weapon/monster), so parsing runs unconditionally: this
  // restores fail-loud validation (a genuinely-unrecognized root, e.g. human body/tail/ear,
  // throws here) rather than the Task-5 scaffold that gated parsing on `mod.eqdp || mod.est`
  // being present so weapon/monster (IMC-only metas) could no-op past parseMetaRoot's throw.
  const root = parseMetaRoot(gamePath);

  let eqdp = mod.eqdp;
  if (eqdp) {
    // C#'s DeserializeEqdpData keeps EVERY race the mod file carries, then backfills the missing
    // PLAYABLE_RACES (ItemMetadata.cs:773-788) — a non-playable-race row survives in C#. We instead
    // only emit the 18 canonical PLAYABLE_RACES (see the header comment above), so a mod row for a
    // race outside that set would otherwise be silently dropped here. Game EQDP files are
    // playable-race-scoped in practice (unreachable across the corpus, BACKLOG.md "EQDP
    // reconstruction drops mod rows for non-playable races"), so fail loud instead of dropping it
    // silently — matching the fail-loud posture of the hair/face EST branch below. The faithful fix
    // (if ever needed) is to keep the mod's extra rows verbatim, per ItemMetadata.cs:773.
    for (const e of eqdp) {
      if (!PLAYABLE_RACES.includes(e.race)) {
        throw new Error(
          `meta: ${gamePath} has an EQDP entry for non-playable race ${e.race} ` +
            "(C# retains it, ItemMetadata.cs:773; unsupported here, BACKLOG.md)",
        );
      }
    }
    const byRace = new Map(eqdp.map((e) => [e.race, e.value]));
    eqdp = PLAYABLE_RACES.map((race) => ({
      race,
      value: byRace.get(race) ?? 0,
    }));
  }

  let est = mod.est;
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
      //
      // A mod entry for a race OUTSIDE PLAYABLE_RACES would never be visited by the PLAYABLE_RACES
      // walk below and so would be silently dropped -- unlike C#, which retains non-playable EQDP
      // races (ItemMetadata.cs:773) and would throw a KeyNotFoundException applying an EST
      // manipulation for one (PmpManipulation.cs:275, same mechanism as the race-gap throw above).
      // Unreachable across the corpus (game EST files are playable-race-scoped); fail loud rather
      // than drop, matching the hair/face branch's posture below.
      for (const e of est) {
        if (!PLAYABLE_RACES.includes(e.race)) {
          throw new Error(
            `meta: ${gamePath} has an EST entry for non-playable race ${e.race} ` +
              "(KeyNotFoundException equivalent, PmpManipulation.cs:275; unsupported here)",
          );
        }
      }
      const byRace = new Map(est.map((e) => [e.race, e]));
      const baseByRace = EST_TABLE[estType];
      const seed: EstEntry[] = [];
      for (const race of PLAYABLE_RACES) {
        const raceTable = baseByRace[race];
        if (raceTable === undefined) {
          // PmpManipulation.cs:275 `metadata.EstEntries[race]` applies a manipulation by
          // indexing the base-seeded dict for this race -- a KeyNotFoundException in C# if the
          // base est file never carried the race at all. A mod entry for this race can't be
          // silently dropped (it would vanish with no trace instead of failing like TexTools
          // does); a mod entry the base doesn't cover for a race the base DOES carry is fine
          // (handled by the raceTable[setId] ?? 0 default below).
          if (byRace.has(race)) {
            throw new Error(
              `meta: ${gamePath} has an EST entry for race ${race}, but the base est file ` +
                `has no ${estType} table for that race (KeyNotFoundException equivalent, ` +
                "PmpManipulation.cs:275)",
            );
          }
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

  let imc = mod.imc;
  if (imc) {
    // Base-seed key mirrors Imc.GetFullImcInfo's (itemType, primaryId) lookup + the `slot` column
    // selection XivDependencyRoot.GetImcEntryPaths performs (Imc.cs:189-238, 351-451) -- see
    // imc-table.ts's header for the exact extraction. IMC_TABLE is exhaustive over base-game
    // equipment/accessory (every item_sets.db root), but Set-only: it never carries a
    // weapon/monster (NonSet) key, so the lookup below misses for those and falls to the
    // pass-through branch -- documented, ratchet-guarded (BACKLOG.md "NonSet IMC reference table").
    const key = `${root.itemType}/${root.primaryId}/${root.slot}`;
    const base = IMC_TABLE[key];
    if (base) {
      // ItemMetadata.cs:238-241 seeds ImcEntries from the base game before the PMP apply
      // (ManipulationsToMetadata's IMC handling) overwrites each variant the mod supplies, in
      // place, by index -- the base's own trailing variants (indices past the mod's own count)
      // are left untouched, i.e. the result grows to max(mod.length, base.length), with the mod's
      // variant winning wherever both exist.
      const count = Math.max(imc.length, base.length);
      const grown: Uint8Array[] = [];
      for (let i = 0; i < count; i++) {
        grown.push(i < imc.length ? imc[i]! : new Uint8Array(base[i]!));
      }
      imc = grown;
    }
    // else: no base entry for this key. For weapon/monster (NonSet) roots, IMC_TABLE never
    // carries a key at all (it's Set-only) -- pass mod.imc through unchanged, verified byte-exact
    // against the corpus (see comment above). For equipment/accessory (Set) roots the table is
    // exhaustive over item_sets.db, so a miss means a genuinely unknown item (e.g. one added to the
    // game after the table was last regenerated, or one with no .imc): the golden's base seed
    // (ItemMetadata.cs:238-241 GetFullImcInfo, reading the real item's .imc from the game) is
    // something IMC_TABLE cannot reproduce, and silently passing the mod's IMC through could ship a
    // possibly-under-grown IMC. Fail loud instead of guessing.
    else if (root.itemType === "equipment" || root.itemType === "accessory") {
      throw new Error(
        `meta: ${gamePath} has no IMC_TABLE entry for key "${key}" (unknown Set item, not in the ` +
          "item_sets.db-derived table; regenerate imc-table.ts or investigate — cannot " +
          "faithfully reproduce the base IMC seed, ItemMetadata.cs:238-241)",
      );
    }
  }

  // ItemMetadata.Serialize omits the EQP segment entirely when PrimaryType == equipment &&
  // PrimaryId == 0, even if EqpEntry is non-null -- "SE hard-coded set 0 to use set 1's EQP"
  // (ItemMetadata.cs:522-528). Reproduce the quirk faithfully rather than "fixing" it.
  let eqp = mod.eqp;
  if (root.itemType === "equipment" && root.primaryId === 0) {
    eqp = null;
  }

  return { ...mod, eqdp, est, imc, eqp };
}
