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
  // The game path is not a field here: it lives solely as the key in
  // ModpackOption.files, mirroring C#'s FileStorageInformation, which carries
  // no path (reference/.../SqPack/FileTypes/TransactionDataHandler.cs:42-47).
  ttmp?: TtmpFileMeta; // present iff sourced from a TTMP container
}

/** OPAQUE payload: an SQPack blob (ttmp) or a raw file (pmp).
 *  ABSENT (undefined) when the PMP's `Files` map named a zip member the archive does not
 *  contain — TexTools' analogue is a FileStorageInformation whose RealPath does not exist
 *  (PMP.cs:1169-1200, after a LoadPMP that never checks existence, PMP.cs:159). The entry is
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
  /** `string | null`, because the TTMP path copies it verbatim end to end with no coalesce — load
   *  (`wizOp.Description = o.Description`, WizardData.cs · FromWizardGroup · 663), export
   *  (`Description = Description`, · WizardOptionEntry.ToModOption · 414) and write
   *  (`Description = modOption.Description`, TTMPWriter.cs · AddOption · 144) — and the manifest
   *  serializer includes nulls, so a null description survives a TexTools round-trip as a literal
   *  `"Description": null`. The PMP path is deliberately NOT symmetric: it coalesces at its own seam
   *  (`op.Description = Description ?? ""`, WizardData.cs · WizardOptionEntry.ToPmpOption · 543-544),
   *  which `optionToJson` (src/container/pmp.ts) reproduces — so the model does not force a value
   *  here and flatten the TTMP side to match. */
  description: string | null;
  image: string;
  priority: number;
  /** Mirrors `WizardOptionEntry.Selected` (WizardData.cs:283-323) — a plain `bool` field with no
   *  initializer, so `false` by default. NOT an exclusivity flag: the C# setter does IMC-only
   *  mutual exclusion (:297-319) and nothing at all for Single groups (Single radio behaviour is a
   *  WPF binding, not a model invariant), so a Single group CAN legally carry several selected
   *  options. The only fixup either reader applies is the "none selected" backstop
   *  (WizardData.cs:761-763 / :857-860), which never clamps a group that has more than one. */
  selected: boolean;
  files: Map<string, ModpackFile>; // keyed by gamePath, insertion order (mirrors C#'s
  // WizardStandardOptionData.Files = Dictionary<string, FileStorageInformation>, WizardData.cs:73)
  fileSwaps: Record<string, string>; // PMP only; {} for TTMP
  manipulations: unknown[]; // PMP only; opaque JSON, [] for TTMP
  raw?: unknown; // opaque carry-through: full original PMP option JSON (Imc/Combining
  // extras, Priority, absent Files/Image, etc.). Re-emitted verbatim.
}

export interface ModpackGroup {
  name: string;
  description: string;
  image: string;
  priority: number;
  selectionType: string; // "Single" | "Multi" | "Imc" | "Combining"
  defaultSettings: number; // PMP; 0 for TTMP
  options: ModpackOption[];
  raw?: unknown; // opaque carry-through: full original PMP group JSON. Re-emitted verbatim.
}

/** Mirrors WizardPageEntry (reference/.../Mods/WizardData.cs · WizardPageEntry · 963-990). A `null`
 *  entry is deliberate and load-bearing: WizardData.FromPmp adds FromPMPGroup's result to
 *  page.Groups UNCONDITIONALLY at both its call sites (:1136, :1156), and that result is `null` for
 *  a zero-option group (FromPMPGroup:851-855). ClearNulls prunes them afterwards. The TTMP path
 *  never admits one — FromWizardModpackPage discards it at the call site (:986). */
export interface ModpackPage {
  groups: (ModpackGroup | null)[];
}
// `WizardPageEntry.FolderPath` (WizardData.cs:978) has no field here. It is a per-COMPUTATION memo
// (`WizardData.cs:1394` writes it, `:1239`/`:1462`/`:1334` null it before every recompute), not
// model state a caller ever reads back — `optionPrefixes` (src/container/option-prefix.ts) owns the
// only consumer, `makePagePrefix`, and keeps its own local memo across its own two passes instead
// (code review, 2026-08-05: a `ModpackPage.folderPath` field existed here briefly, but
// `optionPrefixes` computes over a SHALLOW COPY of `data.pages`, so every write to it landed on a
// throwaway object and the field was permanently `undefined` on any real `ModpackData` — dead field,
// not a bug in the copy).

export interface ModpackMeta {
  // Name/Author/Description/Url are `string | null`: WizardMetaEntry.FromTtmp assigns all four
  // verbatim from the `.mpl` (WizardData.cs · WizardMetaEntry.FromTtmp · 1052-1069) and
  // WriteWizardPack passes them straight back out (· WriteWizardPack · 1332-1346). The `= ""` field
  // initializers on WizardMetaEntry (:1015-1020) are OVERWRITTEN by that load, so they give no
  // protection, and `ClearNulls()` (:1234-1266, called at :1334) prunes pages/groups/options and
  // nulls only the `FolderPath` strings (:1239, :1254) — never one of these. So a null spelled in
  // the source survives to serialization.
  name: string | null;
  author: string | null;
  // `version` is NOT nullable: WriteWizardPack forces it non-null via
  // `Version.TryParse(MetaPage.Version, out var ver); ver ??= new Version("1.0")`
  // (WizardData.cs:1354-1356), re-guarded in the TTMPWriter ctor (TTMPWriter.cs · TTMPWriter · 61).
  version: string;
  description: string | null;
  url: string | null;
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
  /** Mirrors WizardData.DataPages (WizardData.cs:1090). There is no flat group list in the C# —
   *  use `allGroups` to iterate every group in page order. */
  pages: ModpackPage[];
  /** PMP-only: archive members that are neither a manifest json (meta.json / default_mod.json /
   *  group_*.json) nor referenced by any option's `Files` value — preview images, readmes, etc.
   *  Keyed by the archive path (forward slashes) after the same NTFS-equivalent normalization
   *  readPmp applies to `Files` resolution (lowercase, trailing dot/space trimmed per segment):
   *  LoadPMP builds this set from the actual unzipped-to-disk folder listing (PMP.cs:278-280,
   *  after the PMP.cs:78 unzip), so a name Windows would have normalized on write is already
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

/** `data.pages`. A thin accessor kept so every pages-consuming function (`allGroups` below;
 *  `cloneModpack`, `writePmp`, `writeTtmp2`, `optionPrefixes` elsewhere) reads pages through one
 *  named seam rather than each spelling `data.pages` independently. */
export function allPages(data: ModpackData): ModpackPage[] {
  return data.pages;
}

/** Every non-null group across every page, in page order — the order WritePmp's own loops use
 *  (WizardData.cs:1525-1561, :1583-1600). Nulls are skipped rather than thrown on: ClearNulls has
 *  already removed them from any page this walks (see src/container/clear-nulls.ts). */
export function allGroups(data: ModpackData): ModpackGroup[] {
  return allPages(data).flatMap((p) =>
    p.groups.filter((g): g is ModpackGroup => g !== null),
  );
}

/** Every file across every option, in `allGroups` order — i.e. page order, not group-declaration
 *  order (see `allGroups`'s own doc comment). This ordering is byte-visible: it feeds `buildBlob`'s
 *  .mpd offsets (ttmp2.ts) and `resolveDuplicates`' `common/N` numbering (resolve-duplicates.ts), so
 *  switching it from the old flat `data.groups` walk to page order is Phase 1's one behaviour-risking
 *  change (design spec §3.1) — argued byte-neutral because both write paths already use page order,
 *  proven only by the corpus, not by this comment. */
export function allFiles(
  data: ModpackData,
): { gamePath: string; file: ModpackFile }[] {
  return allGroups(data).flatMap((g) =>
    g.options.flatMap((o) =>
      [...o.files].map(([gamePath, file]) => ({ gamePath, file })),
    ),
  );
}
