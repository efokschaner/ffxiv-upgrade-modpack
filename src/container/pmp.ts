// PMP (Penumbra Mod Pack) container reader/writer, ported from xivModdingFramework
// Mods/FileTypes/PMP.cs. readPmp mirrors LoadPMP (PMP.cs:124); writePmp mirrors WritePmp
// (PMP.cs:830) / CreateSimplePmp (:777). optionFromJson/optionToJson map the PMPOptionJson /
// PMPGroupJson / PMPMetaJson manifest structs (PMP.cs:1485 / :1387 / :1369).
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../model/modpack";
import { readZip, writeZip } from "../zip/zip";
import {
  type PmpGroupJsonRaw,
  type PmpMetaJson,
  type PmpMetaJsonRaw,
  type PmpOptionJsonRaw,
  parsePmpGroup,
  parsePmpMeta,
  parsePmpOption,
} from "./manifest-types";
import { buildPages, optionPrefixes } from "./option-prefix";
import { normalizeImcEntry, normalizeManipulations } from "./pmp-manipulation";
import { resolveDuplicates } from "./resolve-duplicates";

const dec = new TextDecoder();

// Emulates the subset of Win32 path normalization that TexTools' NTFS filesystem applies on BOTH
// sides of a PMP load. ResolvePMPBasePath unzips the whole archive to a temp folder
// (PMP.cs:76 -> IOUtil.UnzipFiles), where NTFS strips each written ENTRY name; files are then read
// back by Path.Combine(unzipPath, file.Value) (PMP.cs:1080), which LoadPMP never guards with an
// existence check (PMP.cs:124). That normalization is lowercase (case-insensitive filesystem) plus
// TrimEnd('.', ' ') on each path segment (Windows drops trailing dots/spaces from every name
// component). readZip already normalizes '\' -> '/', so segments split on '/'. Penumbra lowercases
// the Files value and can retain a trailing dot/space the archive/on-disk name drops; normalizing
// both sides the same way resolves them (see the PMP Windows path-normalization design spec).
function windowsPathKey(path: string): string {
  return path
    .toLowerCase()
    .split("/")
    .map((seg) => seg.replace(/[. ]+$/, ""))
    .join("/");
}

// Port of the ExtraFiles-scan "referenced" comparison (PMP.cs:196/:209 build allPmpFiles, :214
// compare it against the on-disk listing). Deliberately NOT windowsPathKey: allPmpFiles is built
// from the RAW `Files` value with only `.ToLower()` applied (backslashes and all, no trailing
// dot/space trim), and PMP.cs:214 compares it against `IOUtil.GetFilesInFolder(path)` — the
// on-disk relative path, which NTFS already trimmed when PMP.cs:76 unzipped the archive before this
// scan ever runs. So a `Files` value that keeps a trailing dot/space on a folder segment (e.g.
// `optional\rose acc.\…`) never matches the (already-trimmed) on-disk name, even though the SAME
// file resolves as a payload one section up via the looser, NTFS-read-equivalent windowsPathKey
// lookup (optionFromJson, below): that file is BOTH a resolved payload AND an ExtraFile in
// TexTools. We reproduce that by using plain case-fold here, not the trimming windowsPathKey.
function looseCaseKey(path: string): string {
  return path.toLowerCase();
}

/** Port of IsPmpJsonFile (PMP.cs:228-241): matches on the lowercased BASENAME only (a manifest
 *  json nested in a subfolder would still count — we don't reproduce that beyond mirroring the
 *  basename-only check, since PMP manifests are never actually written into subfolders). Used by
 *  LoadPMP's extras scan (PMP.cs:214) to exclude meta.json/default_mod.json/group_* from
 *  ExtraFiles; deliberately looser than the `groupNames` group-parsing regex above (that one
 *  requires a numeric suffix to actually parse a group — this one only decides what counts as
 *  "manifest" for extras purposes, matching the C# exactly). */
function isPmpJsonFile(zipPath: string): boolean {
  const base = zipPath.split("/").pop()!.toLowerCase();
  if (!base.endsWith(".json")) return false;
  return (
    base === "meta.json" ||
    base === "default_mod.json" ||
    base.startsWith("group_")
  );
}

// Port of CanImport (PMP.cs:752-770), called from UnpackPmpOption's Files loop (PMP.cs:1075-1078): a
// Files entry whose gamePath does not start with any recognized XivDataFile folder key is skipped
// ENTIRELY on load — dropped from the option's Files map altogether (unlike an absent-bytes entry,
// which is KEPT with no data), so it never becomes a ModpackFile and is never assigned a zip path on
// write, burning no dedup `idx` in resolveDuplicates either. The C# loop checks all ~30 XivDataFile
// variants (XivDataFile.cs:35-91), but every extension-specific sub-prefix (e.g. "bg/ex1/01_") is
// already covered by its own general prefix ("bg/"), so checking the 11 general prefixes alone is
// equivalent.
//
// Confirmed empirically NECESSARY, not just cosmetic (2026-07-13, `Groove 001.pmp`): its
// default_mod.json carries garbage gamePath keys ("Ear Physics/Off/chara/...", not a real game path)
// that still RESOLVE to real archive bytes (via windowsPathKey) — byte-identical to the real "Ear
// Physics" group's own "On"/"Off" option content. Left unfiltered, those garbage entries are still fed
// into resolveDuplicates' shared idx counter (PmpExtensions.cs:528-551) AHEAD of the real group's
// options (default_mod's synthesized "Default" group is always visited first, WizardData.cs:1118-1138),
// so their spurious hash-collision with the real content swaps which of "On"/"Off" lands on
// common/1 vs common/2 — a genuine payload-content divergence, not a cosmetic manifest one.
const KNOWN_GAME_FOLDER_PREFIXES = [
  "common/",
  "bgcommon/",
  "bg/",
  "cut/",
  "chara/",
  "shader/",
  "ui/",
  "sound/",
  "vfx/",
  "exd/",
  "music/",
] as const;
function canImport(gamePath: string): boolean {
  return KNOWN_GAME_FOLDER_PREFIXES.some((p) => gamePath.startsWith(p));
}

function optionFromJson(
  raw: PmpOptionJsonRaw,
  filesByKey: Map<string, Uint8Array>,
  referencedKeys: Set<string>,
): ModpackOption {
  const o = parsePmpOption(raw);
  const modFiles: ModpackFile[] = [];
  for (const [gamePath, zipPathRaw] of Object.entries(o.Files)) {
    const zipPath = zipPathRaw.replace(/\\/g, "/");
    // PMP.cs:196/:209 build the ExtraFiles "referenced" set from the RAW Files value directly,
    // independently of (and earlier than) UnpackPmpOption/CanImport — so a rejected gamePath's zip
    // path still counts as referenced (its member must not become an ExtraFile) even though the
    // entry itself never reaches the model below. See readPmp's ExtraFiles-scan comment.
    referencedKeys.add(looseCaseKey(zipPath));
    if (!canImport(gamePath)) continue; // PMP.cs:752-770/:1075-1078 — dropped, not "absent"
    // Windows-filesystem-equivalent resolution. Penumbra lowercases the Files value and may keep a
    // trailing dot/space on a folder segment that the archive/NTFS name drops; TexTools reads
    // Path.Combine(unzipPath, file.Value) from the unzipped folder (PMP.cs:1080) after a LoadPMP
    // that never verifies existence (PMP.cs:124). Look up the windowsPathKey; pmpPath keeps the
    // manifest value verbatim so the writer/golden are unaffected.
    //
    // A miss is NOT an error: the file is genuinely not packed. TexTools tolerates that at load —
    // UnpackPmpOption still adds the entry, with a RealPath that does not exist (PMP.cs:1071-1102)
    // — and defers the consequences to each read seam (ResolveFile, EndwalkerUpgrade.cs:1758) and
    // to the writer, which drops it (PMP.cs:883-888). So we emit the file with NO bytes.
    const data = filesByKey.get(windowsPathKey(zipPath));
    modFiles.push({
      gamePath,
      data,
      storage: FileStorageType.RawUncompressed,
    });
  }
  return {
    name: o.Name,
    description: o.Description,
    image: o.Image,
    priority: o.Priority ?? 0, // multi-option-only field; absent on other subtypes
    files: modFiles,
    fileSwaps: o.FileSwaps,
    manipulations: o.Manipulations,
    // Carry the full original option JSON so Imc/Combining extras (AttributeMask,
    // IsDisableSubMod, ...), Priority, and absent Files/Image round-trip verbatim.
    raw,
  };
}

export function readPmp(bytes: Uint8Array): ModpackData {
  const entries = readZip(bytes);
  // windowsPathKey-keyed index of archive entries, so option Files values (which Penumbra lowercases
  // and may keep trailing dots/spaces on) resolve the way TexTools' NTFS reads do. On NTFS two
  // entries can't share a normalized name in one folder, so a key collision cannot occur for a pack
  // that unzips (matching the filesystem TexTools relies on); last-write-wins otherwise.
  const filesByKey = new Map<string, Uint8Array>();
  for (const [name, data] of entries)
    filesByKey.set(windowsPathKey(name), data);

  const metaBytes = entries.get("meta.json");
  if (!metaBytes) throw new Error("pmp: missing meta.json");
  const defaultBytes = entries.get("default_mod.json");
  if (!defaultBytes) throw new Error("pmp: missing default_mod.json");
  const metaRaw = JSON.parse(dec.decode(metaBytes)) as PmpMetaJsonRaw;
  const meta = parsePmpMeta(metaRaw);
  const defaultMod = JSON.parse(dec.decode(defaultBytes)) as PmpOptionJsonRaw;

  const groupNames = [...entries.keys()]
    .filter((k) => /^group_\d+.*\.json$/i.test(k))
    .sort();

  // Port of the ExtraFiles scan (PMP.cs:213-215): every archive member that is neither a manifest
  // json nor referenced by an option's `Files` value is preserved verbatim so writePmp can re-emit
  // it (WizardData.WritePmp, WizardData.cs:1477-1488). "Referenced" is decided the way PMP.cs
  // itself decides it — `looseCaseKey`, NOT `windowsPathKey` — so a member referenced only via
  // case-folding is still NOT an extra (case-fold is part of both), but a member referenced only
  // via a trailing dot/space Files value IS still an extra (see `looseCaseKey`'s doc comment):
  // that mismatch between the payload lookup's looser key and this scan's tighter one is the
  // faithfully-reproduced TexTools behaviour, not a bug. Populated by optionFromJson itself (from
  // every RAW Files value, canImport-rejected ones included — see its own comment) rather than
  // read back from the model afterward, since a canImport-rejected entry never becomes part of the
  // model's `files` array at all but must still count as referenced here.
  const referencedKeys = new Set<string>();

  const groups: ModpackGroup[] = [];
  // default_mod.json -> a leading single-option group named "Default".
  groups.push({
    name: "Default",
    description: "",
    image: "",
    page: 0,
    priority: 0,
    selectionType: "Single",
    defaultSettings: 0,
    options: [optionFromJson(defaultMod, filesByKey, referencedKeys)],
  });

  for (const name of groupNames) {
    const gRaw = JSON.parse(dec.decode(entries.get(name)!)) as PmpGroupJsonRaw;
    const g = parsePmpGroup(gRaw);
    groups.push({
      name: g.Name,
      description: g.Description,
      image: g.Image,
      page: g.Page,
      priority: g.Priority,
      selectionType: g.Type,
      defaultSettings: g.DefaultSettings,
      options: g.Options.map((o) =>
        optionFromJson(o, filesByKey, referencedKeys),
      ),
      // Carry the full original group JSON so group-level extras (Imc Identifier/
      // DefaultEntry/AllVariants/OnlyAttributes, etc.) round-trip verbatim.
      raw: gRaw,
    });
  }

  const extraFiles = new Map<string, Uint8Array>();
  for (const [name, data] of entries) {
    if (isPmpJsonFile(name)) continue;
    if (referencedKeys.has(looseCaseKey(name))) continue;
    extraFiles.set(windowsPathKey(name), data);
  }

  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: {
      name: meta.Name,
      author: meta.Author,
      version: meta.Version,
      description: meta.Description,
      url: meta.Website,
      image: meta.Image,
      tags: meta.ModTags ?? [], // C# leaves an absent ModTags null; the domain model wants []
      minimumFrameworkVersion: "1.0.0.0",
      raw: metaRaw, // carries FileVersion, DefaultPreferredItems, and any other meta fields
    },
    groups,
    extraFiles: extraFiles.size > 0 ? extraFiles : undefined,
  };
}

// Port of PMP.MakePMPPathSafe (PMP.cs:1316-1326) -> IOUtil.MakePathSafe (IOUtil.cs:738-759).
// QUIRK: Path.GetInvalidFileNameChars() is platform-dependent; goldens are generated on Windows,
// so we reproduce the WINDOWS set — control chars 0x00-0x1F plus these nine. (Unix would be just
// \0 and /.) Replace invalid chars with '_' (_PMPSafeNameReplacement, PMP.cs:47), lowercase the
// rest (makeLowercase=true), then Trim(). "." -> "_", ".." -> "__" (PMP.cs:1319-1323).
const WINDOWS_INVALID_FILENAME_CHARS = new Set<number>([
  0x22,
  0x3c,
  0x3e,
  0x7c,
  0x3a,
  0x2a,
  0x3f,
  0x5c,
  0x2f, // " < > | : * ? \ /
]);
function isInvalidFileNameChar(code: number): boolean {
  return code <= 0x1f || WINDOWS_INVALID_FILENAME_CHARS.has(code);
}
// Shared by both C# path-safety helpers below — they use the SAME invalid-char set
// (Path.GetInvalidFileNameChars(), IOUtil.cs:49) and both lowercase+Trim(), differing only in the
// replacement char and PMP.MakePMPPathSafe's extra "."/".." special-casing (see safeName).
function makePathSafe(name: string, rep: string): string {
  // IOUtil.MakePathSafe iterates UTF-16 chars; match that (not code points) for fidelity.
  // NOTE: C#'s Char.ToLower uses CurrentCulture; we use JS's locale-invariant toLowerCase.
  // These agree for the ASCII/BMP names in practice; a cased non-ASCII letter under a
  // non-invariant culture (e.g. Turkish dotless-i) could in theory diverge — negligible here.
  let out = "";
  for (let i = 0; i < name.length; i++) {
    out += isInvalidFileNameChar(name.charCodeAt(i))
      ? rep
      : name[i]!.toLowerCase();
  }
  return out.trim();
}
/** Port of PMP.MakePMPPathSafe (PMP.cs:1316-1326): used ONLY for the `group_NNN_<name>.json`
 * MANIFEST FILENAME (WritePmp, PMP.cs:830-869). NFKC-normalizes first, replaces an invalid char
 * with '_' (_PMPSafeNameReplacement, PMP.cs:47), and special-cases "." -> "_" / ".." -> "__"
 * (PMP.cs:1319-1323) — none of which the Files-value folder-prefix helper below does. */
export function safeName(s: string): string {
  if (s === ".") return "_";
  if (s === "..") return "__";
  return makePathSafe(s.normalize("NFKC"), "_");
}
/** Port of IOUtil.MakePathSafe's DEFAULT overload (IOUtil.cs:733-736 -> :738-759): used for the
 * Files-value FOLDER PREFIX inside MakeGroupPrefix/MakeOptionPrefix (WizardData.cs:1390/1432,
 * `option-prefix.ts`) — a DIFFERENT function from `safeName` above, confirmed empirically
 * (2026-07-13, `[Nyameru]Cute Loop.pmp`): group name `"Which Dance?"` folder-prefixes to
 * `"which dance-/"` in the /resave golden, not `"which dance_/"`. No NFKC normalization and no
 * "."/".." special-casing; the invalid-char replacement is `'-'`, not `'_'`. */
export function folderSafeName(s: string): string {
  return makePathSafe(s, "-");
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Port of WizardData.WritePmp's Version reformat (WizardData.cs:1474-1475 + :1494):
 * `Version.TryParse(MetaPage.Version, out var ver); ver ??= new Version("1.0"); pmp.Meta.Version =
 * ver.ToString();`. .NET's `Version.TryParse` requires AT LEAST `major.minor` — a bare `"1"` fails
 * to parse — and accepts up to 4 dot-separated non-negative-integer components
 * (`major.minor[.build[.revision]]`); anything else (blank, extra text, a negative/non-numeric
 * component) fails too. A failed parse falls back to `new Version("1.0")`, i.e. `"1.0"`.
 * `Version.ToString()` re-renders exactly the components that were present in the parsed value —
 * `"1.2"` stays 2-field, `"1.2.3"` stays 3-field, etc. — it does not pad to 4 fields. */
export function reformatPmpVersion(source: string): string {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(source.trim());
  if (!m) return "1.0";
  return [m[1], m[2], m[3], m[4]].filter((p) => p !== undefined).join(".");
}

/** Port of `WizardGroupEntry.Selection` (WizardData.cs:578-604), reconstructed from the read-time
 * derivation `FromPMPGroup` performs per option (`Selected`, WizardData.cs:805-813) plus its
 * Single-type "nothing selected" fixup (WizardData.cs:857-860). `ToPmpGroup` writes
 * `pg.DefaultSettings = Selection` (:949) rather than the source value: our domain model has no
 * per-option `Selected` flag -- only the group's raw `defaultSettings` source value -- so this
 * recomputes exactly what those two C# passes would have left on `Options[i].Selected` before
 * `Selection`'s getter reads it back.
 *
 * `defaultSettings` -> ulong: `CustomUInt64Converter` (PMP.cs:1558-1571) reinterprets a JSON token
 * Newtonsoft parsed as a negative number as its 64-bit two's-complement UNSIGNED value (the
 * documented "-1 meant 2^64-1" bug-compatibility shim, PMP.cs:1564-1565) -- reproduced here via
 * `BigInt.asUintN(64, ...)` rather than JS's 32-bit `|`, since a real ulong can exceed 32 bits.
 * `optionType` mirrors `group.OptionType = pGroup.Type == "Single" ? Single : Multi`
 * (WizardData.cs:769) -- an Imc (or hypothetical "Combining") group's Type is never "Single", so it
 * takes the Multi/bitmask branch exactly like a real Multi group.
 *
 * Caps at Number precision (2^53) for the Multi/bitmask accumulator: a real PMP group is never
 * remotely close to 53 options, so `Number(total)` staying exact for any input this codebase's
 * corpus/tests can produce is a safe simplification, not a silently-wrong answer for a case that
 * actually occurs -- and the domain model types `defaultSettings`/`DefaultSettings` as `number`
 * throughout, not `bigint`, so returning a `bigint` here would just push the same cap elsewhere. */
function computeSelection(
  defaultSettings: number,
  optionType: string,
  optionCount: number,
): number {
  const raw = BigInt.asUintN(64, BigInt(Math.trunc(defaultSettings)));
  if (optionType === "Single") {
    // FromPMPGroup: Selected[i] = (raw == i) for i in 0..optionCount-1 (WizardData.cs:807). The
    // read-time fixup forces Options[0].Selected when NONE matched (WizardData.cs:857-860), so an
    // out-of-range (or negative) source value always regenerates 0 here, matching Selection's
    // `FirstOrDefault` "-> return 0" branch (WizardData.cs:585-588) applied to Options[0].
    return raw < BigInt(optionCount) ? Number(raw) : 0;
  }
  // Multi (and Imc/Combining, which also get OptionType=Multi -- see this function's doc comment):
  // Selection ORs bit i only for i < Options.Count (WizardData.cs:594-601) -- every bit at or past
  // the option count is masked off, however wide the source value was.
  let total = 0n;
  for (let i = 0; i < optionCount; i++) {
    if ((raw & (1n << BigInt(i))) !== 0n) total |= 1n << BigInt(i);
  }
  return Number(total);
}

/** Reconstruct a PMP option JSON document, regenerating `Files`/`FileSwaps`/`Manipulations` from the
 * model. TexTools NEVER round-trips these: PopulatePmpStandardOption (PMP.cs:871-928) builds `Files`
 * fresh from the typed model (`opt.Files.Add(fi.Path, fi.PmpPath.Replace("/", "\\"))`, :914), and
 * `WizardStandardOptionData` types `FileSwaps`/`Manipulations` the same way (WizardData.cs:71-73;
 * `Manipulations` is further re-typed per entry, see pmp-manipulation.ts). We used to re-emit `o.raw`'s
 * `Files` map (and `FileSwaps`/`Manipulations`) verbatim, which made any file the pipeline ADDED (a
 * generated index map) unnameable and any file it REPOINTED (a regenerated hair normal) dangle, on top
 * of carrying stale/foreign keys forward. Regenerating removes that whole class of bug: a file with no
 * zip path contributes no `Files` key AND no payload member, reproducing the absent-file drop
 * (PMP.cs:883-888) for free.
 *
 * `hasStandardFields` is false for an Imc-type group's options: `PmpImcOptionJson` (PMP.cs:1544-1551)
 * carries no Files/FileSwaps/Manipulations at all (unlike `PmpStandardOptionJson`, PMP.cs:1504-1511),
 * so those three keys must not be added there even as empty containers.
 *
 * `includeMeta=false` (the default option only) omits Name/Description/Image, mirroring C#'s
 * `ShouldSerialize*` on `IsDataContainerOnly` for default_mod.json (PMP.cs:1496-1501).
 * `includeMeta=true` (every other option, Standard or Imc alike — the base class's ShouldSerialize*
 * default to true) always (re)writes them, even when the source omitted `Image` — confirmed
 * empirically (`[DVNO] DMBX Shoes 1.pmp` /resave golden: every group option gains `"Image": ""`).
 *
 * `o.raw` is consulted ONLY for the genuinely untyped Imc/Combining GROUP extras (Identifier/
 * DefaultEntry/AllVariants/OnlyAttributes — handled at the group level, below) and, for an Imc
 * OPTION, its two typed-but-`ShouldSerialize`-gated fields (`IsDisableSubMod`/`AttributeMask`,
 * `PmpImcOptionJson`, PMP.cs:1544-1551). Every OTHER field of `o.raw` is a foreign key the typed
 * model does not own and must NOT survive: for a Standard option, `PmpStandardOptionJson`
 * (PMP.cs:1504-1517) owns exactly Name/Description/Image/Files/FileSwaps/Manipulations(/Priority on
 * the Multi subtype) and nothing else, the same class of drop already proven for `meta.json`'s
 * `DefaultPreferredItems`. `Priority` only exists on `PmpMultiOptionJson` (PMP.cs:1538-1542, always
 * serialized — `o.priority` already defaults to 0 when the source omits it, `optionFromJson` above)
 * — a Single/Imc/default_mod option gets no `Priority` key at all, confirmed empirically
 * (`Flower Child - by Solona.pmp`'s Single-type "Size" group drops a stray source `Priority`). */
function optionToJson(
  o: ModpackOption,
  includeMeta: boolean,
  hasStandardFields: boolean,
  isMultiOption: boolean,
  zipPaths: Map<ModpackFile, string>,
): PmpOptionJsonRaw {
  // Build fresh — do NOT spread `o.raw` — so a foreign key on the source document cannot survive
  // the typed round-trip (see this function's doc comment).
  const base: PmpOptionJsonRaw = {};

  if (includeMeta) {
    base.Name = o.name.trim(); // WizardData.cs:928 -- `option.Name = option.Name.Trim();`
    base.Description = o.description;
    // WizardHelpers.WriteImage (WizardData.cs:545/:953/:1497) re-encodes a REFERENCED image into a
    // fresh 16-bit PNG under a new name (or "" if the source path doesn't exist) rather than
    // passing the source value through — unported (no image encoder here; see
    // docs/backlog/2026-07-13-pmp-writer-image-reencode.md). This
    // carries the SOURCE Image value/zip-path verbatim, which diverges from the golden whenever an
    // option actually carries an image (every corpus option that has NO image round-trips "" -> ""
    // either way, which is why the corpus alone doesn't expose this).
    base.Image = o.image;
  }
  // else: IsDataContainerOnly (default_mod.json) — ShouldSerializeName/.../Image all false
  // (PMP.cs:1499-1501), so Name/Description/Image stay absent.

  if (hasStandardFields) {
    const Files: Record<string, string> = {};
    for (const f of o.files) {
      const zip = zipPaths.get(f);
      if (zip === undefined) continue; // absent: no member, no key (PMP.cs:883-888)
      Files[f.gamePath] = zip.replace(/\//g, "\\"); // PMP.cs:914
    }
    base.Files = Files;
    base.FileSwaps = o.fileSwaps;
    base.Manipulations = normalizeManipulations(o.manipulations);
    if (isMultiOption) {
      base.Priority = o.priority; // PmpMultiOptionJson.Priority, always serialized (PMP.cs:1540-1541)
    }
  } else {
    // Imc: PmpImcOptionJson (PMP.cs:1544-1551) — IsDisableSubMod/AttributeMask, both
    // ShouldSerialize-gated (PMP.cs:1549-1550). Neither is modeled on ModpackOption, so read them
    // off the source raw directly; a foreign/absent value defaults to the C# field's own default
    // (`false`/`0`) exactly like a real typed deserialize of a document that omits the key.
    const raw = isObj(o.raw) ? (o.raw as PmpOptionJsonRaw) : {};
    const isDisableSubMod = raw.IsDisableSubMod === true;
    if (isDisableSubMod) {
      base.IsDisableSubMod = true;
    } else {
      base.AttributeMask =
        typeof raw.AttributeMask === "number" ? raw.AttributeMask : 0;
    }
  }

  return base;
}

/**
 * `store` writes the zip members uncompressed (level 0) instead of DEFLATE-ing them.
 *
 * The DEFAULT (`false` — DEFLATE) is the faithful one and is what we ship: TexTools writes a PMP
 * with `System.IO.Compression.ZipFile.CreateFromDirectory` (PMP.cs:867), whose default is
 * `CompressionLevel.Optimal`. Do not change that default.
 *
 * `store: true` exists purely as a TEST-SPEED knob, and it is sound because the compressed
 * REPRESENTATION is not part of any assertion we make: the golden harness compares zip member
 * NAMES and DECOMPRESSED content (upgrade-archive-diff.ts / upgrade-diff.ts), never the deflated
 * bytes — it cannot, since our fflate output never matches .NET's DeflateStream byte-for-byte
 * anyway. The corpus checks re-read the archive they just wrote, so level-6 deflate there is work
 * whose only consumer immediately inflates it again (measured: 17.7s -> 2.6s on a 232 MB pack).
 * Everything the checks DO assert — member naming, content dedup, manifest regeneration — is
 * unaffected by the level.
 */
export function writePmp(
  data: ModpackData,
  opts: { store?: boolean } = {},
): Uint8Array {
  const enc = new TextEncoder();
  const entries = new Map<string, Uint8Array>();

  // Regenerate every zip path from the typed model, the way TexTools does: optionPrefix + gamePath,
  // then content-dedup into common/{idx}/ (WizardData.cs:1526 -> PmpExtensions.cs:476-566). The
  // source pack's own member names are NOT reused — that round-trip is what made a generated file
  // unnameable (see optionToJson's doc comment).
  const prefixes = optionPrefixes(data);

  // Port of the blank-name guard in WritePmp's assembly loop (WizardData.cs:1520-1523): a
  // Standard-type option (an Imc-type group's options are skipped first, WizardData.cs:1513-1516)
  // whose name, or whose owning group's name, is blank throws BEFORE any prefix is put to use. Only
  // options that SURVIVED pruning are checked (`prefixes.has(o)`) — the C# loop only ever visits
  // `DataPages`, so a blank name on an option pruned for carrying no data is never reached at all.
  // The synthesized Default group (data.groups[0]) is exempt: FromPmp hardcodes both its group and
  // option name to the literal "Default" (WizardData.cs:1122/1128) rather than reading them from
  // default_mod.json (whose Name field is virtually always blank/absent — ShouldSerializeName is
  // false for it, PMP.cs:1499), so it can never trip this check in the real C#. Our reader does not
  // reproduce that hardcoding (defaultOption.name comes straight from default_mod.json's Name field,
  // see optionFromJson above) — but since includeMeta=false always drops Name from ITS OUTPUT anyway,
  // this check is the only place the mismatch could matter, so the Default group is skipped here
  // rather than misfiring on nearly every PMP (whose default_mod.json has no Name at all).
  for (const g of data.groups.slice(1)) {
    if (g.selectionType === "Imc") continue; // WizardData.cs:1513-1516
    for (const o of g.options) {
      if (!prefixes.has(o)) continue; // pruned — WritePmp's own loop never reaches it either
      if (o.name.trim() === "" || g.name.trim() === "") {
        throw new Error(
          "pmp: PMP Files must have valid group and option names (WizardData.cs:1520-1523): " +
            `group "${g.name}" option "${o.name}"`,
        );
      }
    }
  }

  const zipPaths = resolveDuplicates(data, prefixes);

  // PopulatePmpStandardOption turns a .meta into Manipulations and a .rgsp into Manipulations
  // (PMP.cs:891-900 -> PMPExtensions.MetadataToManipulations / RgspToManipulations,
  // PmpExtensions.cs:417) rather than writing either as a zip member. We do NOT port that: a
  // PMP-sourced model holds no .meta at all (the upgrade load path passes mergeManipulations=false,
  // WizardData.cs:818, so manipulations stay opaque), and a TTMP-sourced one can only reach here
  // through a format conversion that no upgrade flow performs (WriteModpack dispatches on the
  // destination extension and the GUI reuses the source's, WizardData.cs:1312-1326) — and which
  // writeModpack already rejects outright (src/index.ts). Fail loud instead of silently emitting a
  // member TexTools would never write. See docs/backlog/2026-07-13-pmp-write-meta-rgsp-manipulations.md.
  for (const f of zipPaths.keys()) {
    if (/\.(meta|rgsp)$/.test(f.gamePath)) {
      throw new Error(
        `pmp: writing a ${f.gamePath.endsWith(".meta") ? ".meta" : ".rgsp"} file into a PMP is ` +
          `unported (PMP.cs:891-900 converts it to Manipulations): ${f.gamePath}`,
      );
    }
  }

  // PopulatePmpStandardOption's THIRD skip (PMP.cs:901-905, checked after the absent-file and
  // .meta/.rgsp branches above): `else if (IOUtil.IsMetaInternalFile(fi.Path)) { continue; }` — a
  // raw .cmp/.eqp/.eqdp/.gmp/.est/.imc file gets NEITHER a payload member NOR a `Files` key
  // (IOUtil.cs:577-592 for the exact extension set). Order matters: ResolveDuplicates
  // (PmpExtensions.cs:476-566, our `resolveDuplicates` above) runs BEFORE this skip in WritePmp's own
  // pipeline (WizardData.cs:1502/:1526 -> PMP.cs:871-928), so the file must still be hashed and still
  // claim/burn its zip path (already done, above) — this drop is purely at the EMISSION step: delete
  // it from `zipPaths` now, after resolveDuplicates ran, so optionToJson's Files-loop and the payload
  // -write loop below both skip it exactly like an absent file (PMP.cs:883-888) already does.
  const META_INTERNAL_EXTENSIONS = new Set([
    ".cmp",
    ".eqp",
    ".eqdp",
    ".gmp",
    ".est",
    ".imc",
  ]);
  function isMetaInternalFile(gamePath: string): boolean {
    const base = gamePath.slice(gamePath.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    if (dot === -1) return false;
    return META_INTERNAL_EXTENSIONS.has(base.slice(dot).toLowerCase());
  }
  for (const f of [...zipPaths.keys()]) {
    if (isMetaInternalFile(f.gamePath)) zipPaths.delete(f);
  }

  // meta.json is always regenerated from the model: PMPMetaJson (PMP.cs:1369-1381) is a flat, fully
  // typed class with no extension-data capture, so ANY key the source carries outside its 8 fields
  // (e.g. Penumbra's own `DefaultPreferredItems`) is silently dropped by a real typed round-trip —
  // confirmed empirically (`[DVNO] DMBX Shoes 1.pmp` /resave golden drops it). FileVersion is
  // hard-forced to PMP._WriteFileVersion regardless of source (WizardData.cs:1496).
  //
  // Image: WizardHelpers.WriteImage (WizardData.cs:1497) re-encodes a REFERENCED image into a fresh
  // 16-bit PNG under a new name (or "" if the source path doesn't exist) rather than passing the
  // source value through — unported (no image encoder here; see
  // docs/backlog/2026-07-13-pmp-writer-image-reencode.md). This carries the
  // source value verbatim, which diverges from the golden whenever meta actually carries an image
  // (no corpus pack does, so the corpus alone doesn't expose this).
  const meta: PmpMetaJson = {
    FileVersion: 3, // PMP._WriteFileVersion (PMP.cs:45)
    Name: data.meta.name,
    Author: data.meta.author,
    Description: data.meta.description,
    Version: reformatPmpVersion(data.meta.version),
    Website: data.meta.url,
    Image: data.meta.image,
    ModTags: data.meta.tags,
  };
  entries.set("meta.json", enc.encode(JSON.stringify(meta, null, 2)));

  const defaultGroup = data.groups[0];

  // Port of WizardData.WritePmp's "synthesize a PMP default mod from wizard data" absorption
  // (WizardData.cs:1548-1600): searches `DataPages` — page 0..N, each page's groups in order — for
  // the FIRST Standard-type group (Single or Multi, not Imc) named literally "Default"/"Default
  // Group" with exactly ONE option named "Default"/"Default Option", and MOVES its regenerated
  // Files/FileSwaps/Manipulations into default_mod.json instead of writing it as its own
  // group_NNN.json (`break` in the C#, WizardData.cs:1571).
  //
  // CRITICAL: `DataPages` is not "the real groups" — FromPmp UNSHIFTS a synthesized Default group
  // onto the FRONT of `DataPages` whenever the source default_mod.json is non-empty
  // (WizardData.cs:1118-1138), with Name/Options[0].Name hardcoded to the literal "Default"
  // (:1122/:1128) regardless of what default_mod.json's own (near-always-absent, ShouldSerializeName
  // false, PMP.cs:1499) Name field said. That synthesized group therefore ALWAYS satisfies the
  // predicate structurally whenever it exists, and — being DataPages[0] — is always checked FIRST,
  // so it ALWAYS wins the search whenever it survives ClearNulls (WizardData.cs:1234-1263, ported as
  // `buildPages` in option-prefix.ts). A real "Default"/"Default Group" group elsewhere in the pack
  // can only ever be selected when the synthesized group does NOT survive (default_mod.json was
  // empty or carried no HasData). Searching only the real groups (as this used to) re-creates the
  // orphan-member bug the writer regeneration fixed: the real group's data would win the JSON slot
  // while the synthesized Default option's OWN payload member — already written via `zipPaths`,
  // unconditionally, like any other option — is named by no `Files` key anywhere.
  //
  // `pages` is `buildPages`'s DataPages-equivalent, pruned/ordered list (option-prefix.ts) —
  // reused below for the group_NNN emission + Page renumbering too (WizardData.cs:1583-1600).
  const pages = buildPages(data);
  const orderedGroups = pages.flatMap((p) => p.groups);
  // `g.name` is compared TRIMMED: WizardData.cs:1510 (`g.Name = g.Name.Trim();`) mutates every
  // group's Name in place, in the SAME loop that builds `allFiles`/`identifiers`, which runs to
  // completion (across ALL pages) BEFORE this absorption search (:1553-1578) ever looks at it — so
  // by the time the search runs, every group's Name is already trimmed, structurally: a real group
  // literally named "Default " (trailing space) DOES match here in the real C#.
  //
  // `g.options[0]!.name`, by contrast, is compared UNTRIMMED: an option's Name is only ever trimmed
  // inside ToPmpGroup (WizardData.cs:928), which this search calls AFTER its own name comparison has
  // already succeeded or failed (:1562, `g.ToPmpGroup(...)`) — so the search itself never sees a
  // trimmed option name. Trimming it here would falsely absorb a group whose sole option is named
  // e.g. " Default" (leading space), which the real C# does NOT absorb.
  const defaultModGroup = orderedGroups.find((g) =>
    g === defaultGroup
      ? true // hardcoded Name="Default"/Options[0].Name="Default" (WizardData.cs:1122/1128)
      : g.selectionType !== "Imc" &&
        (g.name.trim() === "Default" || g.name.trim() === "Default Group") &&
        g.options.length === 1 &&
        (g.options[0]!.name === "Default" ||
          g.options[0]!.name === "Default Option"),
  );

  const defaultMod: PmpOptionJsonRaw = defaultModGroup
    ? {
        ...optionToJson(
          defaultModGroup.options[0]!,
          false,
          true,
          false,
          zipPaths,
        ),
        Version: 0, // PmpDefaultMod.Version is a hardcoded 0 (PMP.cs:1530), not sourced from the model
      }
    : // No candidate survived: `pmp.DefaultMod` is never touched beyond `new PmpDefaultMod()`'s own
      // field initializers (empty Files/FileSwaps/Manipulations, PmpStandardOptionJson, PMP.cs:1507-1511).
      { Version: 0, Files: {}, FileSwaps: {}, Manipulations: [] };
  entries.set(
    "default_mod.json",
    enc.encode(JSON.stringify(defaultMod, null, 2)),
  );

  // Port of WizardData.WritePmp's group_NNN.json assembly (WizardData.cs:1583-1600), run over the
  // SAME pruned `pages` the absorption search used above — i.e. `ClearNulls`' group-level pruning
  // (a group with `!HasData` never becomes a group_NNN.json — see `buildPages`) is now applied here
  // too, not just at the option-prefix level. `page` is a LOCAL counter, incremented once per
  // DataPages entry that contributed at least one non-absorbed group — NOT the source `g.page` —
  // so a page that contributed nothing (all its groups absorbed or pruned) does not consume a page
  // number, exactly mirroring the C#'s `numGroupsThisPage > 0` gate. group_NNN's numeric prefix is a
  // flat counter across the whole (pruned, absorption-excluded) sequence, matching `pmp.Groups`'
  // own list-index numbering in `PMP.WritePmp` (PMP.cs:856-862).
  let pageCounter = 0;
  let groupNumber = 0;
  for (const page of pages) {
    let numGroupsThisPage = 0;
    for (const g of page.groups) {
      if (g === defaultModGroup) continue; // absorbed into default_mod.json above

      // PmpImcOptionJson has no Files/FileSwaps/Manipulations (PMP.cs:1544-1551) — see optionToJson.
      const hasStandardFields = g.selectionType !== "Imc";
      const isMultiOption = g.selectionType === "Multi"; // Priority only exists on PmpMultiOptionJson
      const rawObj = isObj(g.raw) ? (g.raw as Record<string, unknown>) : {};
      // PMPGroupJson (PMP.cs:1387-1408) is fully typed with NO [JsonExtensionData], and
      // SelectedSettings is [JsonIgnore] (:1400) -- a real typed round-trip therefore drops every
      // foreign key on the source document, exactly like meta.json's DefaultPreferredItems and an
      // option's own foreign keys (see optionToJson's doc comment). Filter `rawObj` down to the
      // known typed keys BEFORE spreading, instead of the old blanket `...rawObj`, so an unrecognized
      // key (e.g. a stray SelectedSettings some tool wrote, or literally anything else) cannot
      // survive into the output. Filtering (not rebuilding from scratch) preserves whatever KEY
      // ORDER the source document had for a real PMP: Json.NET's default member order for a type
      // without explicit [JsonProperty(Order=...)] sorts DERIVED class members before INHERITED base
      // members (see PMP.cs:1487-1488's own comment on why PMPOptionJson.Name/Description/Image
      // need Order=-10 for exactly this reason), so an
      // Imc group's real order is Identifier/DefaultEntry/AllVariants/OnlyAttributes THEN the base
      // Version/Name/.../DefaultSettings THEN Options (Order=99) -- exactly the order a genuine
      // ConsoleTools-written document has, and exactly what filtering (not rebuilding) reproduces.
      const KNOWN_GROUP_KEYS = new Set([
        "Version",
        "Name",
        "Description",
        "Image",
        "Page",
        "Priority",
        "Type",
        "DefaultSettings",
        "Options",
        "Identifier", // PMPImcGroupJson-only (PMP.cs:1426-1436)
        "DefaultEntry",
        "AllVariants",
        "OnlyAttributes",
      ]);
      const filteredRaw: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawObj)) {
        if (KNOWN_GROUP_KEYS.has(k)) filteredRaw[k] = v;
      }
      // PMPImcGroupJson.DefaultEntry (PMP.cs:1429) is a PMPImcEntry — the SAME struct as a per-
      // manipulation Imc `Entry` (PmpManipulation.cs:311-321) — so its `AttributeAndSound` field is
      // dropped by the SAME [JsonIgnore] (:318) on write. Override it (not passed through verbatim)
      // so it survives the typed round-trip the same way `Manipulations`' own Imc entries already do
      // (pmp-manipulation.ts). Positioned via the object-literal spread order below, not appended,
      // so it lands where `DefaultEntry` already sat in the (filtered) source document.
      const defaultEntryOverride: Record<string, unknown> =
        g.selectionType === "Imc" && isObj(filteredRaw.DefaultEntry)
          ? {
              DefaultEntry: normalizeImcEntry(
                filteredRaw.DefaultEntry as Record<string, unknown>,
                "Imc group DefaultEntry",
              ),
            }
          : {};
      // PMPGroupJson's 8 base fields (Version/Name/Description/Image/Page/Priority/Type/
      // DefaultSettings, PMP.cs:1387-1404) are ALWAYS regenerated from the model, never raw-carried —
      // confirmed empirically (`Flower Child - by Solona.pmp`'s source "Size" group spells
      // `"Description": null`, but the /resave golden writes `""`: TexTools' JSON settings use
      // NullValueHandling.Ignore, so a literal `null` deserializes as ABSENT, leaving the C# field
      // at its own initializer default — exactly what `g.description` (parsePmpGroup's `?? ""`)
      // already models. Version has no source at all; it is hard-forced to 0 (PMP.cs:1389 field
      // initializer, never reassigned). `filteredRaw` is kept ONLY for genuinely untyped subtype
      // extras — Imc's Identifier/AllVariants/OnlyAttributes (PMP.cs:1426-1436) and (overridden
      // above) DefaultEntry.
      //
      // Image: same WizardHelpers.WriteImage caveat as meta.json's Image and an option's Image
      // above (WizardData.cs:953) — carried through verbatim, unported; see
      // docs/backlog/2026-07-13-pmp-writer-image-reencode.md.
      const groupJson: PmpGroupJsonRaw = {
        ...filteredRaw,
        ...defaultEntryOverride,
        Version: 0,
        // WizardData.cs:946 (`pg.Name = (Name ?? "").Trim();`) -- redundant with :1510's earlier
        // in-place mutation for a real PMP group's Name (both trims are idempotent), but this is
        // the ONLY trim a model-built (no-`raw`) group's Name ever goes through.
        Name: g.name.trim(),
        Description: g.description,
        Image: g.image,
        Page: pageCounter,
        Priority: g.priority,
        Type: g.selectionType,
        // WizardData.cs:949 (`pg.DefaultSettings = Selection;`) -- regenerated, not carried through
        // verbatim; see computeSelection's doc comment.
        DefaultSettings: computeSelection(
          g.defaultSettings,
          g.selectionType,
          g.options.length,
        ),
        Options: g.options.map((o) =>
          optionToJson(o, true, hasStandardFields, isMultiOption, zipPaths),
        ),
      };
      groupNumber++;
      const fileName = `group_${String(groupNumber).padStart(3, "0")}_${safeName(g.name)}.json`;
      entries.set(fileName, enc.encode(JSON.stringify(groupJson, null, 2)));
      numGroupsThisPage++;
    }
    if (numGroupsThisPage > 0) pageCounter++;
  }

  // Port of PopulatePmpStandardOption's payload write (PMP.cs:908-910) followed by WritePmp's
  // directory zip (PMP.cs:864-868): TexTools writes every option's payload via
  // `File.WriteAllBytes(Path.Combine(workingPath, fi.PmpPath), data)` into a *working directory*,
  // and only zips that directory afterward (`ZipFile.CreateFromDirectory`). A Windows directory
  // cannot hold two names differing only by case (or a trailing dot/space): NTFS resolves the
  // second WriteAllBytes call's name case-insensitively to the SAME directory entry the first
  // call created. Collapse by windowsPathKey — the same NTFS-equivalent key the reader resolves
  // Files values with — same as before. But names are now REGENERATED from the model rather than
  // round-tripped, so two distinct files landing on the same windowsPathKey should be genuinely
  // impossible unless their content is identical (resolveDuplicates content-dedups identical bytes
  // onto one shared path already): throw if a collision ever carries DIFFERENT bytes, since that
  // means the naming scheme itself is wrong, not a legitimate NTFS collapse to reproduce.
  const payloadByKey = new Map<string, { zipPath: string; data: Uint8Array }>();
  for (const [f, zipPath] of zipPaths) {
    const key = windowsPathKey(zipPath);
    const payload = f.data!; // resolveDuplicates never returns an entry for an absent file
    const existing = payloadByKey.get(key);
    if (existing) {
      if (!bytesEqual(existing.data, payload)) {
        throw new Error(
          `pmp: two files collapsed onto the same zip member (NTFS-equivalent key "${key}") with ` +
            `DIFFERENT bytes: "${existing.zipPath}" vs "${zipPath}". Regenerated names should only ` +
            "ever collide for identical content (resolveDuplicates content-dedups that already) — " +
            "a differing-content collision here means the naming scheme is wrong.",
        );
      }
      // Identical bytes: NTFS would collapse these into one directory entry too; keep the
      // first-seen zip path, matching the reader's windowsPathKey lookup.
    } else {
      payloadByKey.set(key, { zipPath, data: payload });
    }
  }
  for (const { zipPath, data: payload } of payloadByKey.values()) {
    entries.set(zipPath, payload);
  }

  // Re-emit ExtraFiles verbatim (WizardData.WritePmp, WizardData.cs:1477-1488 — both /upgrade and
  // /resave pass saveExtraFiles=true). A payload member of the same name always wins; readPmp's
  // referencedKeys check means the two sets can't actually collide, but guard explicitly rather
  // than rely on that — via windowsPathKey (not an exact-string check), matching the same
  // NTFS case-folding the payload collapse above applies, so a same-file collision differing
  // only by case (or a trailing dot/space) is still caught.
  for (const [zipPath, bytes] of data.extraFiles ?? []) {
    if (payloadByKey.has(windowsPathKey(zipPath))) continue;
    entries.set(zipPath, bytes);
  }

  return writeZip(entries, { store: opts.store ?? false });
}
