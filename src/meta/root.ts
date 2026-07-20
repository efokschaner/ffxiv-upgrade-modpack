// Ports XivDependencyRootInfo path parsing (reference: XivDependencyGraph.cs ·
// PrimaryExtractionRegex / _slotRegex, lines ~238-250, 668-693) and
// Est.GetEstType(XivDependencyRootInfo) (reference: Models/FileTypes/Est.cs, lines 63-95)
// enough to pick the reconstruction inputs for a .meta root.
//
// PrimaryExtractionRegex: ^chara\/([a-z]+)\/[a-z]([0-9]{4})(?:\/obj\/([a-z]+)\/[a-z]([0-9]{4})\/?)?.*$
//   group 1 = PrimaryType, group 2 = PrimaryId, group 3 = SecondaryType, group 4 = SecondaryId.
// _slotRegex: [a-z][0-9]{4}(?:[a-z][0-9]{4})?_([a-z]{3})(?:_.+\.|\.)[a-z]+...$
//   group 1 = Slot, taken from the filename suffix before the extension.
//
// estType null means "no EST segment expansion" (i.e. Est.GetEstType returned EstType.Invalid).
export type EstType = "Head" | "Body" | "Hair" | "Face" | null;
export interface MetaRoot {
  primaryId: number;
  slot: string;
  itemType:
    | "equipment"
    | "accessory"
    | "other"
    | "weapon"
    | "monster"
    | "demihuman";
  estType: EstType;
  // The character race parsed from the `c####` path prefix, for Hair/Face roots only; null for
  // equipment/accessory (whose EST is race-iterated over all PLAYABLE_RACES, not keyed on one race).
  // Port of Est.GetExtraSkeletonEntries's `race = XivRaces.GetXivRace(root.PrimaryId)` (Est.cs:278),
  // where PrimaryId is the human root's race id (our `c####` prefix) — see
  // XivDependencyGraph's PrimaryExtractionRegex (this file's header comment): for a
  // `chara/human/c####/obj/{hair,face}/...` path, PrimaryId is the `c####` race and SecondaryId is
  // the h####/f#### id (captured below as `primaryId`, per the Est.cs:267-270 `id = SecondaryId` swap
  // for Face/Hair).
  race: number | null;
}

// Est.GetEstType(XivDependencyRootInfo) (Est.cs:63-95):
//   human/face   -> EstType.Face
//   human/hair   -> EstType.Hair
//   equipment "met" slot -> EstType.Head
//   equipment "top" slot -> EstType.Body
//   everything else (incl. all accessory slots, and any other equipment slot) -> EstType.Invalid
// This is a flat slot lookup, not a body-type classification — equipment carries EST only for
// met/top; accessories never carry EST at all. Any other slot must map to null (Invalid), not throw:
// only an unrecognized *path* (root type we don't parse) is a fail-loud condition.
const EQUIPMENT_SLOT_EST: Record<string, EstType> = {
  met: "Head",
  top: "Body",
};

export function parseMetaRoot(gamePath: string): MetaRoot {
  const equip = gamePath.match(/^chara\/equipment\/e(\d+)\/e\d+_(\w+)\.meta$/);
  if (equip) {
    const slot = equip[2]!;
    return {
      primaryId: Number.parseInt(equip[1]!, 10),
      slot,
      itemType: "equipment",
      estType: EQUIPMENT_SLOT_EST[slot] ?? null,
      race: null,
    };
  }
  const acc = gamePath.match(/^chara\/accessory\/a(\d+)\/a\d+_(\w+)\.meta$/);
  if (acc) {
    return {
      primaryId: Number.parseInt(acc[1]!, 10),
      slot: acc[2]!,
      itemType: "accessory",
      // Est.GetEstType: PrimaryType == accessory falls into the final `else` -> Invalid, always.
      estType: null,
      race: null,
    };
  }
  const hair = gamePath.match(/\/hair\/h(\d+)\/c(\d+)h\d+_(\w+)\.meta$/);
  if (hair) {
    return {
      primaryId: Number.parseInt(hair[1]!, 10),
      slot: hair[3]!,
      itemType: "other",
      estType: "Hair",
      race: Number.parseInt(hair[2]!, 10),
    };
  }
  const face = gamePath.match(/\/face\/f(\d+)\/c(\d+)f\d+_(\w+)\.meta$/);
  if (face) {
    return {
      primaryId: Number.parseInt(face[1]!, 10),
      slot: face[3]!,
      itemType: "other",
      estType: "Face",
      race: Number.parseInt(face[2]!, 10),
    };
  }
  // Demihuman roots: PrimaryExtractionRegex (XivDependencyGraph.cs:250, this file's header)
  // matches these with PrimaryType = demihuman, PrimaryId = the d#### id, SecondaryType =
  // "equipment", SecondaryId = the e#### id, and _slotRegex (XivDependencyGraph.cs:238, this
  // file's header) takes the `_xxx` filename suffix as the Slot (validated against
  // XivItemTypes.GetAvailableSlots(equipment) at ExtractRootInfo, XivDependencyGraph.cs:684-685,
  // since SecondaryType is equipment). Unlike weapon/monster below, these DO carry a real slot.
  // estType is null: Est.GetEstType (Est.cs:63-95) returns Invalid for every PrimaryType that is
  // not human or equipment (demihuman falls into the final `else`, Est.cs:91-94).
  const demihuman = gamePath.match(
    /^chara\/demihuman\/d(\d+)\/obj\/equipment\/e\d+\/d\d+e\d+_(\w+)\.meta$/,
  );
  if (demihuman) {
    return {
      primaryId: Number.parseInt(demihuman[1]!, 10),
      slot: demihuman[2]!,
      itemType: "demihuman",
      estType: null,
      race: null,
    };
  }
  // Weapon/monster roots: PrimaryExtractionRegex
  // (XivDependencyGraph.cs:250, this file's header) matches these paths with PrimaryType =
  // weapon/monster, PrimaryId = the w####/m#### model number, SecondaryType = "body",
  // SecondaryId = the b#### id. Verified shapes against the real corpus:
  //   chara/weapon/w2021/obj/body/b0001/w2021b0001.meta   (Persona 3 Evoker.ttmp2)
  //   chara/monster/m8045/obj/body/b0001/m8045b0001.meta  ([Atelier Jaque] Balloon of Stars.ttmp2)
  // Unlike equipment/accessory/demihuman filenames, these have no `_xxx` suffix before the
  // extension, so _slotRegex (XivDependencyGraph.cs:238, this file's header) never matches them:
  // the real XivDependencyRootInfo.Slot is left unset (ExtractRootInfo, XivDependencyGraph.cs:
  // 679-689, only assigns info.Slot when _slotRegex matches). `slot` here is a placeholder filled
  // from the SecondaryType ("body") instead of the real (unset) Slot. No production code in this
  // codebase reads `MetaRoot.slot` for any root type any more: the sole consumer, reconstruct.ts's
  // IMC base-seed lookup, is keyed on the whole `.meta` root path (IMC_TABLE), not on
  // itemType/primaryId/slot, so this placeholder is inert. (Tests still read it — see
  // docs/backlog/2026-07-19-metaroot-slot-unread.md.)
  const weapon = gamePath.match(
    /^chara\/weapon\/w(\d+)\/obj\/(\w+)\/[a-z]\d+\/w\d+[a-z]\d+\.meta$/,
  );
  if (weapon) {
    return {
      primaryId: Number.parseInt(weapon[1]!, 10),
      slot: weapon[2]!,
      itemType: "weapon",
      estType: null,
      race: null,
    };
  }
  const monster = gamePath.match(
    /^chara\/monster\/m(\d+)\/obj\/(\w+)\/[a-z]\d+\/m\d+[a-z]\d+\.meta$/,
  );
  if (monster) {
    return {
      primaryId: Number.parseInt(monster[1]!, 10),
      slot: monster[2]!,
      itemType: "monster",
      estType: null,
      race: null,
    };
  }
  throw new Error(`meta: unrecognized root path ${gamePath}`);
}
