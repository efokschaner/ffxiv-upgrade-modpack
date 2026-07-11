// Structured form of a TexTools .meta file. Ports the segment set documented in
// ItemMetadata.cs:31-44 (Imc, Eqdp, Eqp, Est, Gmp). EQP/GMP/IMC entries are kept as
// opaque bytes (we never reinterpret them for reconstruction); EQDP/EST are structured
// because the round manipulates them by race.
export interface EqdpEntry {
  race: number; // uint32 race code (e.g. 101), ItemMetadata.cs:743
  value: number; // 1 EQDP byte, EquipmentDeformationParameter.GetByte()
}
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
  eqdp: EqdpEntry[] | null; // ItemMetadata.cs:735-748
  est: EstEntry[] | null; // ItemMetadata.cs:668-684
  gmp: Uint8Array | null; // raw GMP segment (5 bytes), ItemMetadata.cs:662-666
}
