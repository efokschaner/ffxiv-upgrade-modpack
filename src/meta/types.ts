// Structured form of a TexTools .meta file. Ports the segment set documented in
// ItemMetadata.cs:31-44 (Imc, Eqdp, Eqp, Est, Gmp). EQP/GMP/IMC entries are kept as
// opaque bytes (we never reinterpret them for reconstruction); EQDP/EST are structured
// because the round manipulates them by race.
// Also serves as ItemMeta.est's Map value: it carries its own race, like C#'s
// ExtraSkeletonEntry (ItemMetadata.cs:84's Dictionary value type), so the Map key is redundant
// with entry.race but kept in sync with it (mirroring the C# dict's key/value pair).
export interface EstEntry {
  race: number; // uint16 race code, ItemMetadata.cs:678
  setId: number; // uint16
  skelId: number; // uint16
}
export interface ItemMeta {
  version: number; // ItemMetadata._METADATA_VERSION (2)
  path: string; // root file path (e.g. "chara/equipment/e0208/e0208_met.meta")
  imc: Uint8Array[] | null; // N × 6-byte IMC sub-entries, ItemMetadata.cs:692-707
  eqp: Uint8Array | null; // raw EQP segment bytes, ItemMetadata.cs:813-816
  eqdp: Map<number, number> | null; // race -> EQDP byte; Dictionary<XivRace, EquipmentDeformationParameter>, ItemMetadata.cs:79
  est: Map<number, EstEntry> | null; // race -> entry; Dictionary<XivRace, ExtraSkeletonEntry>, ItemMetadata.cs:84
  gmp: Uint8Array | null; // raw GMP segment (5 bytes), ItemMetadata.cs:662-666
}
