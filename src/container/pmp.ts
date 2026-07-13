// PMP (Penumbra Mod Pack) container reader/writer, ported from xivModdingFramework
// Mods/FileTypes/PMP.cs. readPmp mirrors LoadPMP (PMP.cs:124); writePmp mirrors WritePmp
// (PMP.cs:830) / CreateSimplePmp (:777). optionFromJson/optionToJson map the PMPOptionJson /
// PMPGroupJson / PMPMetaJson manifest structs (PMP.cs:1485 / :1387 / :1369).
import {
  allFiles,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../model/modpack";
import { readZip, writeZip } from "../zip/zip";
import {
  type PmpGroupJson,
  type PmpGroupJsonRaw,
  type PmpMetaJson,
  type PmpMetaJsonRaw,
  type PmpOptionJsonRaw,
  parsePmpGroup,
  parsePmpMeta,
  parsePmpOption,
} from "./manifest-types";

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

function optionFromJson(
  raw: PmpOptionJsonRaw,
  filesByKey: Map<string, Uint8Array>,
): ModpackOption {
  const o = parsePmpOption(raw);
  const modFiles: ModpackFile[] = Object.entries(o.Files).map(
    ([gamePath, zipPathRaw]) => {
      const zipPath = zipPathRaw.replace(/\\/g, "/");
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
      return {
        gamePath,
        data,
        storage: FileStorageType.RawUncompressed,
        pmpPath: zipPath,
      };
    },
  );
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
    options: [optionFromJson(defaultMod, filesByKey)],
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
      options: g.Options.map((o) => optionFromJson(o, filesByKey)),
      // Carry the full original group JSON so group-level extras (Imc Identifier/
      // DefaultEntry/AllVariants/OnlyAttributes, etc.) round-trip verbatim.
      raw: gRaw,
    });
  }

  // Port of the ExtraFiles scan (PMP.cs:213-215): every archive member that is neither a manifest
  // json nor referenced by an option's `Files` value is preserved verbatim so writePmp can re-emit
  // it (WizardData.WritePmp, WizardData.cs:1477-1488). "Referenced" is decided the same way the
  // reader itself resolves a Files value — windowsPathKey — so a member referenced only under
  // case-folding (or a trailing dot/space the archive's real name lacks) is NOT an extra; every
  // option's `pmpPath` already carries the forward-slashed zip path a Files value named, whether or
  // not that name resolved to a real member (an absent one references nothing further).
  const referencedKeys = new Set<string>();
  for (const g of groups) {
    for (const o of g.options) {
      for (const f of o.files) {
        if (f.pmpPath) referencedKeys.add(windowsPathKey(f.pmpPath));
      }
    }
  }
  const extraFiles = new Map<string, Uint8Array>();
  for (const [name, data] of entries) {
    if (isPmpJsonFile(name)) continue;
    const key = windowsPathKey(name);
    if (referencedKeys.has(key)) continue;
    extraFiles.set(key, data);
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
function makePathSafe(name: string): string {
  // IOUtil.MakePathSafe iterates UTF-16 chars; match that (not code points) for fidelity.
  // NOTE: C#'s Char.ToLower uses CurrentCulture; we use JS's locale-invariant toLowerCase.
  // These agree for the ASCII/BMP names in practice; a cased non-ASCII letter under a
  // non-invariant culture (e.g. Turkish dotless-i) could in theory diverge — negligible here.
  let out = "";
  for (let i = 0; i < name.length; i++) {
    out += isInvalidFileNameChar(name.charCodeAt(i))
      ? "_"
      : name[i]!.toLowerCase();
  }
  return out.trim();
}
export function safeName(s: string): string {
  if (s === ".") return "_";
  if (s === "..") return "__";
  return makePathSafe(s.normalize("NFKC"));
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Port of the absent-file drop in PopulatePmpStandardOption (PMP.cs:883-888): a file whose
 *  RealPath does not exist is skipped by `continue`, which bypasses BOTH File.WriteAllBytes (:910)
 *  AND opt.Files.Add (:914) — so the written pack carries neither the payload member nor the
 *  `Files` key. ("Sometimes poorly behaved penumbra folders don't actually have the files they
 *  claim they do. Remove them in this case.") We re-emit the source option JSON verbatim, so the
 *  key has to be pruned out of a COPY of it; the map is keyed by gamePath, so the pruning is exact.
 *  Returns `raw` itself when nothing is absent, keeping the common path byte-for-byte verbatim. */
function pruneAbsentFiles(
  o: ModpackOption,
  raw: PmpOptionJsonRaw,
): PmpOptionJsonRaw {
  const absent = new Set(o.files.filter((f) => !f.data).map((f) => f.gamePath));
  if (absent.size === 0) return raw;
  const files = raw.Files;
  if (!isObj(files)) return raw;
  return {
    ...raw,
    // Object.entries preserves insertion order, so the surviving keys keep their original
    // order — the emitted JSON bytes are unchanged apart from the dropped keys.
    Files: Object.fromEntries(
      Object.entries(files).filter(([gamePath]) => !absent.has(gamePath)),
    ),
  };
}

/** Reconstruct a PMP option JSON DOCUMENT. Prefers the carried-through original (`raw`) for
 * full fidelity; falls back to building from modeled fields (non-PMP sources). Raw, not parsed:
 * `includeMeta=false` deliberately omits Name/Description/Image, mirroring C#'s ShouldSerialize*
 * on IsDataContainerOnly for default_mod.json (PMP.cs:1496-1501). */
function optionToJson(
  o: ModpackOption,
  includeMeta: boolean,
): PmpOptionJsonRaw {
  if (isObj(o.raw)) return pruneAbsentFiles(o, o.raw as PmpOptionJsonRaw);
  const Files: Record<string, string> = {};
  for (const f of o.files) {
    if (!f.data) continue; // absent -> no Files key (PMP.cs:883-888)
    const zip = f.pmpPath ?? f.gamePath; // forward slashes (zip entry name)
    Files[f.gamePath] = zip.replace(/\//g, "\\"); // backslashes in JSON value
  }
  const base: PmpOptionJsonRaw = {
    Files,
    FileSwaps: o.fileSwaps,
    Manipulations: o.manipulations,
  };
  if (includeMeta) {
    base.Name = o.name;
    base.Description = o.description;
    base.Image = o.image;
  }
  return base;
}

export function writePmp(data: ModpackData): Uint8Array {
  const enc = new TextEncoder();
  const entries = new Map<string, Uint8Array>();

  // Re-emit the source document verbatim when we have it (it may legitimately omit keys — Penumbra
  // writes no `Image`), else author one from scratch. The authored branch is typed as the PARSED
  // type: Newtonsoft serializes every initialized field, so a meta.json TexTools writes always
  // carries the full set. Dropping a key there is thus a divergence — and now a type error.
  const meta: PmpMetaJsonRaw = isObj(data.meta.raw)
    ? (data.meta.raw as PmpMetaJsonRaw)
    : ({
        FileVersion: 3,
        Name: data.meta.name,
        Author: data.meta.author,
        Description: data.meta.description,
        Version: data.meta.version,
        Website: data.meta.url,
        Image: data.meta.image,
        ModTags: data.meta.tags,
      } satisfies PmpMetaJson);
  entries.set("meta.json", enc.encode(JSON.stringify(meta, null, 2)));

  const [defaultGroup, ...rest] = data.groups;
  const defaultOption: ModpackOption | undefined = defaultGroup?.options[0];
  const defaultMod: PmpOptionJsonRaw = defaultOption
    ? optionToJson(defaultOption, false)
    : { Version: 0, Files: {}, FileSwaps: {}, Manipulations: [] };
  entries.set(
    "default_mod.json",
    enc.encode(JSON.stringify(defaultMod, null, 2)),
  );

  rest.forEach((g, i) => {
    const groupJson: PmpGroupJsonRaw = isObj(g.raw)
      ? // Re-emit the original group verbatim, but let the model's option list drive
        // count/order (each option re-emitted from its own carried-through raw).
        ({
          ...(g.raw as Record<string, unknown>),
          Options: g.options.map((o) => optionToJson(o, true)),
        } as PmpGroupJsonRaw)
      : // Authored from scratch -> the full initialized set (see the meta branch above).
        ({
          Version: 0,
          Name: g.name,
          Description: g.description,
          Image: g.image,
          Page: g.page,
          Priority: g.priority,
          Type: g.selectionType,
          DefaultSettings: g.defaultSettings,
          Options: g.options.map((o) => optionToJson(o, true)),
        } satisfies PmpGroupJson);
    const fileName = `group_${String(i + 1).padStart(3, "0")}_${safeName(g.name)}.json`;
    entries.set(fileName, enc.encode(JSON.stringify(groupJson, null, 2)));
  });

  // Port of PopulatePmpStandardOption's payload write (PMP.cs:908-910) followed by WritePmp's
  // directory zip (PMP.cs:864-868): TexTools writes every option's payload via
  // `File.WriteAllBytes(Path.Combine(workingPath, fi.PmpPath), data)` into a *working directory*,
  // and only zips that directory afterward (`ZipFile.CreateFromDirectory`). A Windows directory
  // cannot hold two names differing only by case (or a trailing dot/space): NTFS resolves the
  // second WriteAllBytes call's name case-insensitively to the SAME directory entry the first
  // call created, so that entry keeps its FIRST name but ends up holding the LAST call's bytes.
  // A pack whose Files JSON spells the same physical zip member under two different casings
  // (several gamePaths deduped onto one payload — e.g. Groove 001.pmp) must therefore collapse
  // to exactly ONE member here too. Collapse by windowsPathKey — the same NTFS-equivalent key
  // the reader resolves Files values with — first-name-wins, last-data-wins, instead of the
  // exact-string `entries.has` check this used to be (which let two casings of the same path
  // both survive as separate members).
  const payloadByKey = new Map<string, { zipPath: string; data: Uint8Array }>();
  for (const f of allFiles(data)) {
    if (!f.data) continue; // absent: no member AND no Files key (PMP.cs:883-888) — see optionToJson
    const zipPath = (f.pmpPath ?? f.gamePath).replace(/\\/g, "/");
    const key = windowsPathKey(zipPath);
    const existing = payloadByKey.get(key);
    if (existing) {
      existing.data = f.data; // NTFS: same directory entry as the first write, content overwritten
    } else {
      payloadByKey.set(key, { zipPath, data: f.data });
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

  return writeZip(entries, { store: false });
}
