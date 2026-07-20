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
  // NULLABLE all the way to serialization. `ModOptionJson.Description` (ModPackJson.cs ·
  // ModOptionJson · 159-198) is an uninitialized C# `string`, so an absent key deserializes to
  // `null`; nothing coalesces it thereafter — load copies it verbatim (`wizOp.Description =
  // o.Description`, WizardData.cs · FromWizardGroup · 663), TTMP export copies it verbatim
  // (`Description = Description`, · WizardOptionEntry.ToModOption · 414) and TTMPWriter copies it
  // verbatim again (`Description = modOption.Description`, TTMPWriter.cs · AddOption · 144). With
  // Newtonsoft's default NullValueHandling.Include (see the write-view note below) that `null`
  // reaches the output `.mpl` as an explicit `null`. Only the PMP path coalesces, and it does so at
  // its own seam (`op.Description = Description ?? ""`, WizardData.cs · ToPmpOption · 543-544).
  Description: string | null;
  ImagePath: string;
  ModsJsons: TtmpModsJson[];
  GroupName: string;
  SelectionType: string;
  // ModOptionJson.IsChecked (ModPackJson.cs:189-198) — a plain C# `bool` behind a
  // NotifyPropertyChanged setter, so an absent key deserializes to `false`. Optional here to
  // model that absence; FromWizardGroup copies it to WizardOptionEntry.Selected verbatim
  // (WizardData.cs:668).
  IsChecked?: boolean;
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
  // Name/Author/Description/Url are NULLABLE for the same reason as ModOptionJson.Description
  // above: uninitialized C# `string` members of `ModPackJson` (ModPackJson.cs · ModPackJson ·
  // 24-118), read verbatim into WizardMetaEntry (WizardData.cs · WizardMetaEntry.FromTtmp ·
  // 1052-1069 — the `= ""` field initializers at :1015-1020 are OVERWRITTEN by those assignments,
  // so they offer no protection), written back verbatim (· WriteWizardPack · 1332-1346; the
  // `ClearNulls()` at :1334 prunes empty pages/groups/options and touches no string but
  // `FolderPath`, :1239/:1254), and
  // emitted as explicit `null` by Newtonsoft's default NullValueHandling.Include.
  Name: string | null;
  Author: string | null;
  // `Version` is the ONE exception — never null. WriteWizardPack forces it non-null with
  // `Version.TryParse(MetaPage.Version, out var ver); ver ??= new Version("1.0")`
  // (WizardData.cs:1335-1337) and the TTMPWriter ctor re-guards it
  // (`modPackData.Version ?? new Version(1, 0, 0, 0)`, TTMPWriter.cs · TTMPWriter · 61).
  Version: string;
  Description: string | null;
  Url: string | null;
  MinimumFrameworkVersion?: string;
  ModPackPages?: TtmpModPackPageJson[] | null;
  SimpleModsList?: TtmpModsJson[] | null;
}

// WRITE-SIDE VIEW of the types above.
//
// WHY A SEPARATE LAYER, rather than making these keys required on the interfaces above: those
// interfaces model the READ-PATH DOCUMENT — the `.mpl` as it arrives from an arbitrary pack, where
// a genuinely old or third-party file may legitimately omit any of these keys, and `readTtmp2` has
// to answer for that absence (`mpl.MinimumFrameworkVersion ?? "1.0.0.0"`, `o.IsChecked ?? false`,
// ttmp2.ts). Tightening them there would misdescribe what we may be handed on read. The write path
// has the opposite obligation — it always emits the full key set — so it gets its own view.
// `TTMPWriter` is not so loose: it serializes real C# class INSTANCES with a bare
// `JsonConvert.SerializeObject(_modPackJson)` (TTMPWriter.cs · Write · 324) — Newtonsoft
// defaults, so `NullValueHandling.Include`. An unassigned member is therefore written as an
// explicit `"Field": null`, never omitted, and `ModPackJson.cs` carries no `[JsonProperty]`,
// `[JsonIgnore]` or `ShouldSerialize*` anywhere to change that. So TexTools' key SET is fixed:
// every member of every class is present in the output, whatever its value.
//
// These aliases restate that as types — each key TexTools always writes is REQUIRED here, so the
// writer cannot silently drop one — while leaving the tolerant document types (and their other
// consumers) untouched. Same two-layer split as the `Pmp*Json` / `Pmp*JsonRaw` pair below, in the
// other direction: there the extra layer models what may be ABSENT on read, here what must be
// PRESENT on write.
//
// NOTE ON THE INTERSECTIONS BELOW: each one narrows an OPTIONAL base key to a required, more
// specific type, which works only while the base key stays optional. If a base key were ever
// re-typed as required with a different type, the intersection would silently collapse that
// member to `never` rather than erroring here — the failure would surface as a confusing
// assignability error at the `writeTtmp2` literal instead.
//
// NOTE: these types fix the key set, not the key ORDER. Newtonsoft emits members in reflection
// order, i.e. the C# DECLARATION order, so `writeTtmp2`'s object literals are spelled in that
// order deliberately; `test/container/ttmp2-write.test.ts` pins it, since the corpus harness
// compares manifests semantically (parsed JSON) and would never catch a reordering.

/** ModsJson (ModPackJson.cs · ModsJson · 217-263) as TTMPWriter emits it. */
export type TtmpModsJsonWrite = TtmpModsJson & {
  // ModPackJson.cs · ModsJson.ModPackEntry · 259-262 — `public ModPack? ModPackEntry { get; set; }`.
  // NEITHER `AddFile` overload assigns it (TTMPWriter.cs · AddFile · 168-177, the wizard overload;
  // · AddFile · 198-207, the simple/backup one), and nothing else touches the ModsJson afterwards
  // except `_writeMPD`, which sets only ModSize/ModOffset (:278-279). So it is always null on
  // write — and, per the NullValueHandling note above, always physically present as `null`.
  ModPackEntry: null;
};

/** ModOptionJson (ModPackJson.cs · ModOptionJson · 154-215) as TTMPWriter emits it. */
export type TtmpModOptionJsonWrite = TtmpModOptionJson & {
  ModsJsons: TtmpModsJsonWrite[];
  // TTMPWriter.cs · AddOption · 141-150 — `IsChecked = modOption.IsChecked`, a verbatim copy with
  // no write-time derivation, mirroring the verbatim read at WizardData.cs:668.
  IsChecked: boolean;
};

/** ModGroupJson (ModPackJson.cs · ModGroupJson · 133-152) as TTMPWriter emits it. */
export type TtmpModGroupJsonWrite = TtmpModGroupJson & {
  OptionList: TtmpModOptionJsonWrite[];
};

/** ModPackPageJson (ModPackJson.cs · ModPackPageJson · 120-131) as TTMPWriter emits it. */
export type TtmpModPackPageJsonWrite = TtmpModPackPageJson & {
  ModGroups: TtmpModGroupJsonWrite[];
};

/** ModPackJson (ModPackJson.cs · ModPackJson · 24-118) as TTMPWriter emits it. */
export type ModPackJsonWrite = ModPackJson & {
  // TTMPWriter's ctor initializes exactly ONE of these — `ModPackPages = new()` for a wizard pack,
  // else `SimpleModsList = new()` (TTMPWriter.cs · TTMPWriter · 74-77) — and leaves the other at
  // its `null` default. Both names therefore always appear in the output, one of them as `null`.
  // Required (not optional) here so the writer must spell BOTH, whichever branch it takes.
  ModPackPages: TtmpModPackPageJsonWrite[] | null;
  SimpleModsList: TtmpModsJsonWrite[] | null;
};

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
// Writing goes the other way and deals in Raw, deliberately: writePmp REGENERATES every typed field
// from the domain model (Files/FileSwaps/Manipulations from the option's own files, Name/Description/
// Image trimmed and copied over, DefaultSettings recomputed, ...) rather than re-emitting the source
// document verbatim — TexTools' own writer does the same (PopulatePmpStandardOption, PMP.cs:871-928;
// WizardGroupEntry.ToPmpGroup, WizardData.cs:889-956), so a foreign key or a value the typed model
// doesn't own cannot survive a round-trip (see optionToJson's doc comment, pmp.ts). `o.raw`/`g.raw`
// are consulted ONLY for the genuinely untyped extras those typed classes still carry via
// [JsonExtensionData]-equivalent fields (Imc's Identifier/DefaultEntry/AllVariants/OnlyAttributes,
// an Imc option's IsDisableSubMod/AttributeMask) — never for a field the base classes already type.
// C#'s ShouldSerialize* (:1499-1501) omits Name/Description/Image entirely for default_mod.json,
// which `includeMeta=false` reproduces. A document built from the model with no `raw` at all (e.g. a
// TTMP source) carries the full set the same way, since both paths build a parsed-type object.

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

/** WRITE-SIDE VIEW of `PmpMetaJson`, in the same spirit as the `Ttmp*JsonWrite` aliases above.
 *
 * `PmpMetaJson` describes the document as READ, where `parsePmpMeta`'s `?? ""` has already applied
 * the C# field initializers — so nothing downstream of a read ever sees a null. The WRITE path can:
 * `WizardData.WritePmp` assigns `pmp.Meta.Name/Author/Website/Description` VERBATIM from the
 * WizardMetaEntry (WizardData.cs · WritePmp · 1490-1493) with no `?? ""` — unlike the per-OPTION and
 * per-GROUP seams, which do coalesce (`op.Description = Description ?? ""` · ToPmpOption · 543-544;
 * `pg.Name = (Name ?? "").Trim()` · ToPmpGroup · 946-947) — and `SavePMP` serializes meta.json with a
 * bare `JsonConvert.SerializeObject(pmp.Meta, Formatting.Indented)` (PMP.cs · SavePMP · 850), i.e.
 * Newtonsoft defaults, so NullValueHandling.Include. A null therefore reaches meta.json as an
 * explicit `null` rather than being omitted or flattened to `""`.
 *
 * Only a TTMP-sourced model can carry those nulls in the first place: LoadPMP deserializes meta.json
 * with `NullValueHandling.Ignore` (PMP.cs:137-139), which leaves an explicit null at the field
 * initializer's `""`, exactly as `parsePmpMeta` models. */
export type PmpMetaJsonWrite = Omit<
  PmpMetaJson,
  "Name" | "Author" | "Description" | "Website"
> & {
  Name: string | null;
  Author: string | null;
  Description: string | null;
  Website: string | null;
};

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

/** The three `Type` discriminators JsonSubtypes resolves to a real subtype (PMP.cs:1384-1386).
 * Anything else — including an absent key — leaves the BASE `PMPGroupJson`, whose `Options` throws. */
const KNOWN_PMP_GROUP_TYPES = new Set(["Single", "Multi", "Imc"]);

/** Applies PMPGroupJson's field initializers (:1387-1404). `Options` defaults to `[]`: each subtype
 * initializes `OptionData = new()` (:1413/:1421/:1434).
 *
 * An unrecognized `Type` is a LOAD FAILURE, not an empty group. JsonSubtypes has no
 * `FallBackSubType` here (contrast PmpManipulation.cs:21), so an unknown or absent discriminator
 * deserializes into the base class rather than throwing at deserialization — and the base's virtual
 * `Options` throws `NotImplementedException($"Unimplemented PMP group type: {Type}")` (:1407) at the
 * first access. Two unconditional accesses follow inside `LoadPMP` itself — `GetHeaderImage`'s group
 * loop (:1351-1357, short-circuits on an earlier Image, so not always the reporting frame) and the
 * `allPmpFiles` scan (:185-187, no short-circuit) — so the load ALWAYS fails, before any transform.
 * Empirically confirmed against ConsoleTools /upgrade for both an unknown and an absent `Type`; the
 * synthetic packs that pin it are `pmp-group-type-{unknown,absent}.pmp` (test/corpus/upgrade-error).
 *
 * We throw here, at parse, rather than at a lazily-flattened `Options` access: the port flattens the
 * subtype hierarchy into one interface, so parse IS our subtype-resolution seam, and `readPmp` calls
 * this for every group — same outcome (load refuses the pack), one frame earlier. The message is
 * byte-identical to the C# one, which `assertMatchedUpgradeFailure` requires: it substring-matches
 * our thrown message against the oracle's captured trace. An absent `Type` yields the trailing-colon
 * message because the C# field initializes to `""` (:1397) — and `LoadPMP` deserializes groups with
 * `NullValueHandling.Ignore` (:160-163), so an explicitly-null `Type` is skipped and keeps that `""`
 * too. Our `?? ""` reproduces both. */
export function parsePmpGroup(raw: PmpGroupJsonRaw): PmpGroupJson {
  const type = raw.Type ?? "";
  if (!KNOWN_PMP_GROUP_TYPES.has(type)) {
    throw new Error(`Unimplemented PMP group type: ${type}`);
  }
  return {
    ...raw, // keep Imc/Combining-only extras (Identifier, DefaultEntry, AllVariants, …)
    Version: raw.Version ?? 0,
    Name: raw.Name ?? "",
    Description: raw.Description ?? "",
    Image: raw.Image ?? "",
    Page: raw.Page ?? 0,
    Priority: raw.Priority ?? 0,
    Type: type,
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
