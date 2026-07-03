// Mirrors reference/.../Mods/DataContainers/ModPackJson.cs
export interface TtmpModsJson {
  Name: string;
  Category: string;
  FullPath: string;
  ModOffset: number;
  ModSize: number;
  DatFile: string;
  IsDefault?: boolean;
  ModPackEntry?: unknown | null;
}
export interface TtmpModOptionJson {
  Name: string;
  Description: string;
  ImagePath: string;
  ModsJsons: TtmpModsJson[];
  GroupName: string;
  SelectionType: string;
}
export interface TtmpModGroupJson {
  GroupName: string;
  SelectionType: string;
  OptionList: TtmpModOptionJson[];
}
export interface TtmpModPackPageJson {
  PageIndex: number;
  ModGroups: TtmpModGroupJson[];
}
export interface ModPackJson {
  TTMPVersion: string;
  Name: string;
  Author: string;
  Version: string;
  Description: string;
  Url: string;
  MinimumFrameworkVersion?: string;
  ModPackPages?: TtmpModPackPageJson[] | null;
  SimpleModsList?: TtmpModsJson[] | null;
}

// Legacy v1 .ttmp NDJSON line — reference/.../DataContainers/OriginalModPackJson.cs
export interface OriginalModPackJson {
  Name: string;
  Category: string;
  FullPath: string;
  ModOffset: number;
  ModSize: number;
  DatFile: string;
}

// Mirrors reference/.../Mods/FileTypes/PMP.cs:1400-1525
export interface PmpMetaJson {
  FileVersion: number;
  Name: string;
  Author: string;
  Description: string;
  Version: string;
  Website: string;
  Image: string;
  ModTags?: string[];
}
export interface PmpOptionJson {
  Name?: string;
  Description?: string;
  Image?: string;
  Priority?: number;
  Files?: Record<string, string>; // game path -> zip path (backslashes on disk)
  FileSwaps?: Record<string, string>;
  Manipulations?: unknown[];
  Version?: number; // present in default_mod.json
}
export interface PmpGroupJson {
  Version?: number;
  Name: string;
  Description: string;
  Image?: string;
  Page?: number;
  Priority?: number;
  Type: string;
  DefaultSettings?: number;
  Options: PmpOptionJson[];
  [extra: string]: unknown; // carry Imc/Combining-only fields opaquely
}
/** In-memory PMP bundle: parsed JSON + raw file bytes keyed by zip path (forward slashes). */
export interface PmpJson {
  meta: PmpMetaJson;
  defaultMod: PmpOptionJson;
  groups: PmpGroupJson[];
  groupFileNames: string[]; // e.g. "group_001_Foo.json", index-aligned with groups
  files: Map<string, Uint8Array>; // zip path -> raw bytes
}
