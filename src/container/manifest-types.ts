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

// Mirrors reference/.../Mods/FileTypes/PMP.cs:1369-1543
//
// TWO LAYERS, mirroring what Newtonsoft gives C#:
//
//   `Pmp*Json`     — the object AFTER deserialization: what C# code actually holds. Every field of
//                    PMPMetaJson (:1372-1377), PMPGroupJson (:1390-1404) and PMPOptionJson
//                    (:1490-1494) carries an initializer, so these fields are always present.
//   `Pmp*JsonRaw`  — the JSON DOCUMENT on disk. Any key may be absent: Newtonsoft simply leaves the
//                    field at its initialized default, and Penumbra-authored packs really do omit
//                    keys (`Image` in particular).
//   `parsePmp*`    — the port of those field initializers: Raw -> parsed, applying each default.
//                    This is the ONLY place PMP defaults live; consumers of the parsed type never
//                    need `?? ""`.
//
// Writing goes the other way and deals in Raw, deliberately: writePmp re-emits a source document
// verbatim (an absent key must stay absent — our synthetic packs round-trip byte-exact because of
// it), and C#'s ShouldSerialize* (:1499-1501) omits Name/Description/Image entirely for
// default_mod.json. A document we AUTHOR from scratch instead carries the full set, since Newtonsoft
// serializes every initialized field — writePmp expresses that by building a parsed-type object.

export interface PmpMetaJson {
  FileVersion: number; // C# `public int FileVersion;` — a bare int, so absent -> 0
  Name: string;
  Author: string;
  Description: string;
  Version: string;
  Website: string;
  Image: string;
  ModTags: string[] | null; // C# `List<string> ModTags;` — uninitialized, so absent -> null
}
export type PmpMetaJsonRaw = Partial<PmpMetaJson>;

/** Applies PMPMetaJson's field initializers (PMP.cs:1369-1381). */
export function parsePmpMeta(raw: PmpMetaJsonRaw): PmpMetaJson {
  return {
    FileVersion: raw.FileVersion ?? 0,
    Name: raw.Name ?? "",
    Author: raw.Author ?? "",
    Description: raw.Description ?? "",
    Version: raw.Version ?? "",
    Website: raw.Website ?? "",
    Image: raw.Image ?? "",
    ModTags: raw.ModTags ?? null,
  };
}

// NOTE ON SUBTYPES: C# resolves groups/options polymorphically off `Type` (JsonSubtypes, :1383-1386)
// into Single/Multi/Imc classes; we flatten those into one interface each. So only the fields the
// COMMON base initializes are required below — subtype-only fields (Imc's Identifier/DefaultEntry/…,
// a multi-option's Priority, default_mod's Version) stay optional and ride through the index
// signature. Fields required here are exactly the ones every subtype inherits an initializer for.
export interface PmpOptionJson {
  Name: string;
  Description: string;
  Image: string;
  // PmpStandardOptionJson initializes these (`= new()`, :1507-1511). PmpImcOptionJson has no such
  // fields at all — for an Imc option parse yields the empty defaults, which is precisely what it
  // contributes to the domain model anyway.
  Files: Record<string, string>; // game path -> zip path (backslashes on disk)
  FileSwaps: Record<string, string>;
  Manipulations: unknown[];
  Priority?: number; // multi-option only
  Version?: number; // default_mod.json only
  // PmpImcOptionJson-only (PMP.cs:1544-1551), ShouldSerialize-gated on write — see optionToJson
  // (src/container/pmp.ts): IsDisableSubMod only when true; AttributeMask only when !IsDisableSubMod.
  IsDisableSubMod?: boolean;
  AttributeMask?: number;
}
export type PmpOptionJsonRaw = Partial<PmpOptionJson>;

/** Applies PMPOptionJson (:1485-1502) + PmpStandardOptionJson (:1504-1511) field initializers. */
export function parsePmpOption(raw: PmpOptionJsonRaw): PmpOptionJson {
  return {
    ...raw, // keep subtype-only extras (AttributeMask, IsDisableSubMod, Priority, …)
    Name: raw.Name ?? "",
    Description: raw.Description ?? "",
    Image: raw.Image ?? "",
    Files: raw.Files ?? {},
    FileSwaps: raw.FileSwaps ?? {},
    Manipulations: raw.Manipulations ?? [],
  };
}

export interface PmpGroupJson {
  Version: number;
  Name: string;
  Description: string;
  Image: string;
  Page: number;
  Priority: number;
  Type: string;
  DefaultSettings: number;
  // Left as RAW documents on purpose: readPmp parses each option individually so it can also carry
  // the untouched option JSON through for verbatim re-emit.
  Options: PmpOptionJsonRaw[];
  [extra: string]: unknown; // carry Imc/Combining-only fields opaquely
}
export type PmpGroupJsonRaw = Partial<PmpGroupJson>;

/** Applies PMPGroupJson's field initializers (:1387-1404). `Options` defaults to `[]`: each subtype
 * initializes `OptionData = new()` (:1413/:1421/:1434), though note the base's virtual `Options`
 * THROWS for an unrecognized `Type` (:1407) — we do not reproduce that throw (pre-existing). */
export function parsePmpGroup(raw: PmpGroupJsonRaw): PmpGroupJson {
  return {
    ...raw, // keep Imc/Combining-only extras (Identifier, DefaultEntry, AllVariants, …)
    Version: raw.Version ?? 0,
    Name: raw.Name ?? "",
    Description: raw.Description ?? "",
    Image: raw.Image ?? "",
    Page: raw.Page ?? 0,
    Priority: raw.Priority ?? 0,
    Type: raw.Type ?? "",
    DefaultSettings: raw.DefaultSettings ?? 0,
    Options: raw.Options ?? [],
  };
}
/** In-memory PMP bundle: parsed JSON + raw file bytes keyed by zip path (forward slashes). */
export interface PmpJson {
  meta: PmpMetaJson;
  defaultMod: PmpOptionJson;
  groups: PmpGroupJson[];
  groupFileNames: string[]; // e.g. "group_001_Foo.json", index-aligned with groups
  files: Map<string, Uint8Array>; // zip path -> raw bytes
}
