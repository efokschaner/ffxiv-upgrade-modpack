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

interface ModpackFileBase {
  gamePath: string; // internal game path, forward slashes
  ttmp?: TtmpFileMeta; // present iff sourced from a TTMP container
  pmpPath?: string; // original PMP zip path (forward slashes) iff sourced from PMP
}

/** OPAQUE payload: an SQPack blob (ttmp) or a raw file (pmp).
 *  ABSENT (undefined) when the PMP's `Files` map named a zip member the archive does not
 *  contain — TexTools' analogue is a FileStorageInformation whose RealPath does not exist
 *  (PMP.cs:1071-1102, after a LoadPMP that never checks existence, PMP.cs:124). The entry is
 *  still a member of the option: the upgrade rounds gate on files.ContainsKey
 *  (EndwalkerUpgrade.cs:1840/:1852/:1867), which is true for it. We do NOT substitute empty
 *  bytes — an empty buffer would decode-fail inside a codec instead of being skipped.
 *
 *  Only `RawUncompressed` (a PMP file) can be byte-less; `SqPackCompressed` always has bytes
 *  (its only producers — ttmp2.ts, ttmp-legacy.ts, texture.ts's writeGeneratedTex — always set
 *  `data`, and `readPmp` always stamps `RawUncompressed`), so the union below makes that
 *  compiler-enforced instead of comment-enforced. */
export type ModpackFile =
  | (ModpackFileBase & {
      storage: FileStorageType.SqPackCompressed;
      data: Uint8Array;
    })
  | (ModpackFileBase & {
      storage: FileStorageType.RawUncompressed;
      data?: Uint8Array;
    });

/** `ModpackFile` narrowed to its always-has-bytes variant. */
export type SqPackCompressedFile = Extract<
  ModpackFile,
  { storage: FileStorageType.SqPackCompressed }
>;
/** `ModpackFile` narrowed to its possibly-byte-less variant. */
export type RawUncompressedFile = Extract<
  ModpackFile,
  { storage: FileStorageType.RawUncompressed }
>;

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
  sourceTtmpVersion?: string;
  raw?: unknown; // opaque carry-through: full original PMP meta.json (e.g.
  // DefaultPreferredItems, FileVersion). Re-emitted verbatim.
}

export interface ModpackData {
  sourceFormat: ModpackFormat;
  isSimple: boolean; // TTMP simple (flat SimpleModsList) vs wizard/grouped
  meta: ModpackMeta;
  groups: ModpackGroup[];
  /** PMP-only: archive members that are neither a manifest json (meta.json / default_mod.json /
   *  group_*.json) nor referenced by any option's `Files` value — preview images, readmes, etc.
   *  Keyed by the archive path (forward slashes) after the same NTFS-equivalent normalization
   *  readPmp applies to `Files` resolution (lowercase, trailing dot/space trimmed per segment):
   *  LoadPMP builds this set from the actual unzipped-to-disk folder listing (PMP.cs:213-215,
   *  after the PMP.cs:76 unzip), so a name Windows would have normalized on write is already
   *  normalized by the time it's read back. TTMP has no equivalent (its payloads are byte offsets
   *  into an .mpd, not zip members), so a TTMP-sourced pack simply carries none. Undefined (rather
   *  than an empty Map) when there are none. */
  extraFiles?: Map<string, Uint8Array>;
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
