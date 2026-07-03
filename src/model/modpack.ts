export enum ModpackFormat {
  Ttmp2 = "ttmp2",
  TtmpLegacy = "ttmp",
  Pmp = "pmp",
  PmpFolder = "pmpFolder",
}
export enum FileStorageType {
  SqPackCompressed = "sqpack",
  RawUncompressed = "raw",
}

/** TTMP carries per-file display metadata with no PMP equivalent; preserved for round-trip. */
export interface TtmpFileMeta {
  name: string;
  category: string;
  datFile: string;
  isDefault: boolean;
}

export interface ModpackFile {
  gamePath: string; // internal game path, forward slashes
  data: Uint8Array; // OPAQUE: SQPack blob (ttmp) or raw file (pmp)
  storage: FileStorageType;
  ttmp?: TtmpFileMeta; // present iff sourced from a TTMP container
  pmpPath?: string; // original PMP zip path (forward slashes) iff sourced from PMP
}

export interface ModpackOption {
  name: string;
  description: string;
  image: string;
  priority: number;
  files: ModpackFile[];
  fileSwaps: Record<string, string>; // PMP only; {} for TTMP
  manipulations: unknown[]; // PMP only; opaque JSON, [] for TTMP
  raw?: unknown; // opaque carry-through: full original PMP option JSON (Imc/Combining
  // extras, Priority, absent Files/Image, etc.). Re-emitted verbatim.
}

export interface ModpackGroup {
  name: string;
  description: string;
  image: string;
  page: number;
  priority: number;
  selectionType: string; // "Single" | "Multi" | "Imc" | "Combining"
  defaultSettings: number; // PMP; 0 for TTMP
  options: ModpackOption[];
  raw?: unknown; // opaque carry-through: full original PMP group JSON. Re-emitted verbatim.
}

export interface ModpackMeta {
  name: string;
  author: string;
  version: string;
  description: string;
  url: string;
  image: string;
  tags: string[];
  minimumFrameworkVersion: string;
  raw?: unknown; // opaque carry-through: full original PMP meta.json (e.g.
  // DefaultPreferredItems, FileVersion). Re-emitted verbatim.
}

export interface ModpackData {
  sourceFormat: ModpackFormat;
  isSimple: boolean; // TTMP simple (flat SimpleModsList) vs wizard/grouped
  meta: ModpackMeta;
  groups: ModpackGroup[];
}

export function emptyMeta(): ModpackMeta {
  return {
    name: "",
    author: "",
    version: "",
    description: "",
    url: "",
    image: "",
    tags: [],
    minimumFrameworkVersion: "1.0.0.0",
  };
}

export function allFiles(data: ModpackData): ModpackFile[] {
  return data.groups.flatMap((g) => g.options.flatMap((o) => o.files));
}
