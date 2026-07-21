// IMC entry reader — extraction tooling only (NOT shipped port code), same status as
// scripts/lib/game-index.ts.
//
// Ports the three symbols ConsoleTools actually executes to build a .meta's IMC base seed
// (ItemMetadata.cs · CreateFromRaw · 233-247 -> GetImcEntryPaths -> GetEntries; CreateFromRaw is the
// private helper ItemMetadata.GetMetadata(XivDependencyRoot, ...) · 182-210 falls back to at :207
// when no .meta already exists):
//   - XivDependencyRoot.cs · GetRawImcFilePath · 1093-1126
//   - XivDependencyRoot.cs · GetImcEntryPaths  · 1133-1202
//   - Imc.cs             · GetEntries          · 189-238
//
// NOT a port of Imc.GetFullImcInfo (Imc.cs:351-451). That function is never on this path, and it
// disagrees with it: its NonSet branch writes `Vfx = variant` for the default subset (Imc.cs:384)
// instead of the entry's own vfx byte. See docs/TEXTOOLS_BUGS.md.

export const IMC_TYPE_UNKNOWN = 0; // ImcType.Unknown, Imc.cs:41
export const IMC_TYPE_NONSET = 1; // ImcType.NonSet,  Imc.cs:42
export const IMC_TYPE_SET = 31; // ImcType.Set,     Imc.cs:43

const ENTRY_SIZE = 6; // subEntrySize, XivDependencyRoot.cs:1185
const STARTING_OFFSET = 4; // startingOffset, XivDependencyRoot.cs:1184

// Imc.SlotOffsetDictionary (Imc.cs:547-559) as a single field in the C# already covering both
// equipment slots (met/top/glv/dwn/sho) and accessory slots (ear/nek/wrs/rir/ril) — it is the one
// dictionary XivDependencyRoot.GetImcEntryPaths reads (:1188), not a merge of two we perform here.
const SLOT_OFFSET: Record<string, number> = {
  met: 0,
  top: 1,
  glv: 2,
  dwn: 3,
  sho: 4,
  ear: 0,
  nek: 1,
  wrs: 2,
  rir: 3,
  ril: 4,
};

export interface ImcRootInfo {
  primaryType: "equipment" | "accessory" | "weapon" | "monster" | "demihuman";
  primaryId: number;
  secondaryType: string | null;
  secondaryId: number | null;
  slot: string | null;
}

// XivItemTypes.GetSystemPrefix (XivItemType.cs:318-333) — the one-letter path prefix per type,
// the first character of XivItemTypes.GetSystemName's [Description] string for each enum member
// (XivItemType.cs:34-39: weapon/equipment/accessory/monster/demihuman/body all name themselves).
const SYSTEM_PREFIX: Record<string, string> = {
  equipment: "e",
  accessory: "a",
  weapon: "w",
  monster: "m",
  demihuman: "d",
  body: "b",
};

const pad4 = (n: number): string => String(n).padStart(4, "0");

// Imc.ImcSharingWeaponTypes (Imc.cs:53-59) — FistsOff, TwinfangsOff, DaggersOff, GlaivesOff —
// expressed as the id ranges XivWeaponTypes.GetWeaponType maps to those members
// (XivItemType.cs:184-253). An offhand in one of these ranges reads the MAINHAND's .imc.
export function isImcSharingWeapon(primaryId: number): boolean {
  return (
    (primaryId > 350 && primaryId <= 400) || // FistsOff
    (primaryId > 1650 && primaryId <= 1700) || // FistsOff
    (primaryId > 1850 && primaryId <= 1900) || // DaggersOff
    (primaryId > 2650 && primaryId <= 2700) || // GlaivesOff
    (primaryId > 3050 && primaryId <= 3100) || // TwinfangsOff
    (primaryId > 3150 && primaryId <= 3200) // TwinfangsOff
  );
}

/** Port of XivDependencyRoot.GetRawImcFilePath (XivDependencyRoot.cs:1093-1126). */
export function rawImcFilePath(root: ImcRootInfo): string {
  if (root.secondaryType === null || root.secondaryId === null) {
    // :1102-1107 — named from the PRIMARY type/id, directly under the root folder
    // (RootFolderFormatPrimary, XivDependencyRoot.cs:117: "chara/{name}/{prefix}{id}/").
    const prefix = SYSTEM_PREFIX[root.primaryType]!;
    const id = pad4(root.primaryId);
    return `chara/${root.primaryType}/${prefix}${id}/${prefix}${id}.imc`;
  }
  // :1108-1124 — named from the SECONDARY type/id, with the weapon redirect applied to the
  // FOLDER's primary id only (nInfo.PrimaryId -= 50, :1119), then RootFolderFormatSecondary
  // appended (XivDependencyRoot.cs:120: "obj/{name}/{prefix}{id}/").
  const secPrefix = SYSTEM_PREFIX[root.secondaryType]!;
  const secId = pad4(root.secondaryId);
  let primaryId = root.primaryId;
  if (root.primaryType === "weapon" && isImcSharingWeapon(primaryId)) {
    primaryId -= 50;
  }
  const priPrefix = SYSTEM_PREFIX[root.primaryType]!;
  return (
    `chara/${root.primaryType}/${priPrefix}${pad4(primaryId)}` +
    `/obj/${root.secondaryType}/${secPrefix}${secId}/${secPrefix}${secId}.imc`
  );
}

/** Port of the offset arithmetic in XivDependencyRoot.GetImcEntryPaths (:1184-1199).
 *  Returns one byte offset per entry, in file order. Empty for ImcType.Unknown (:1179-1182). */
export function imcEntryOffsets(
  header: { subsetCount: number; identifier: number },
  slot: string | null,
): number[] {
  if (header.identifier === IMC_TYPE_UNKNOWN) return [];
  const entrySize =
    header.identifier === IMC_TYPE_NONSET ? ENTRY_SIZE : ENTRY_SIZE * 5;
  // :1188 guards on BOTH `Slot != null` and ContainsKey, so an unrecognized slot means offset 0
  // rather than a throw. Weapon/monster roots have no Slot at all and land here too.
  const subOffset =
    slot !== null && slot in SLOT_OFFSET ? SLOT_OFFSET[slot]! * ENTRY_SIZE : 0;
  const offsets: number[] = [];
  // Inclusive bound (:1195 `i <= subsetCount`): the DEFAULT subset plus every variant subset.
  for (let i = 0; i <= header.subsetCount; i++) {
    offsets.push(STARTING_OFFSET + i * entrySize + subOffset);
  }
  return offsets;
}

/** Port of Imc.GetEntries (Imc.cs:189-238) over the offsets above: six raw bytes per entry,
 *  skipping any that would run past the end of the file (:217). */
export function readImcEntries(
  data: Uint8Array,
  slot: string | null,
): number[][] {
  if (data.byteLength < STARTING_OFFSET) {
    throw new Error(
      `imc: file too short for header (${data.byteLength} bytes)`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const header = {
    subsetCount: view.getInt16(0, true),
    identifier: view.getInt16(2, true),
  };
  const entries: number[][] = [];
  for (const offset of imcEntryOffsets(header, slot)) {
    // Imc.cs:217 — `if (offset > imcByteData.Length - entrySize) continue;`. On a well-formed
    // file the margin is exactly zero and this never fires (spec §3.4.2); it exists so a
    // truncated file yields a SHORT list, as TexTools does, rather than an out-of-bounds read.
    if (offset > data.byteLength - ENTRY_SIZE) continue;
    entries.push(Array.from(data.subarray(offset, offset + ENTRY_SIZE)));
  }
  return entries;
}
