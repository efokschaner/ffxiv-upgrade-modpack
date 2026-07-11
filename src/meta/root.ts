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
  itemType: "equipment" | "accessory" | "other";
  estType: EstType;
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
    };
  }
  const hair = gamePath.match(/\/hair\/h(\d+)\/c\d+h\d+_(\w+)\.meta$/);
  if (hair) {
    return {
      primaryId: Number.parseInt(hair[1]!, 10),
      slot: hair[2]!,
      itemType: "other",
      estType: "Hair",
    };
  }
  const face = gamePath.match(/\/face\/f(\d+)\/c\d+f\d+_(\w+)\.meta$/);
  if (face) {
    return {
      primaryId: Number.parseInt(face[1]!, 10),
      slot: face[2]!,
      itemType: "other",
      estType: "Face",
    };
  }
  throw new Error(`meta: unrecognized root path ${gamePath}`);
}
