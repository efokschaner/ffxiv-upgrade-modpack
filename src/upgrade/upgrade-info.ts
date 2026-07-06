export enum EUpgradeTextureUsage {
  IndexMaps = "IndexMaps",
  GearMaskLegacy = "GearMaskLegacy",
  GearMaskNew = "GearMaskNew",
  HairMaps = "HairMaps",
}
export interface UpgradeInfo {
  usage: EUpgradeTextureUsage;
  files: Record<string, string>;
}
