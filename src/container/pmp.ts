import {
  allFiles,
  FileStorageType,
  type ModpackData,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../model/modpack";
import { readZip, writeZip } from "../zip/zip";
import type {
  PmpGroupJson,
  PmpMetaJson,
  PmpOptionJson,
} from "./manifest-types";

const dec = new TextDecoder();

function optionFromJson(
  o: PmpOptionJson,
  files: Map<string, Uint8Array>,
): ModpackOption {
  const modFiles = Object.entries(o.Files ?? {}).map(
    ([gamePath, zipPathRaw]) => {
      const zipPath = zipPathRaw.replace(/\\/g, "/");
      const data = files.get(zipPath);
      if (!data) throw new Error(`pmp: missing file entry ${zipPath}`);
      return {
        gamePath,
        data,
        storage: FileStorageType.RawUncompressed,
        pmpPath: zipPath,
      };
    },
  );
  return {
    name: o.Name ?? "",
    description: o.Description ?? "",
    image: o.Image ?? "",
    priority: o.Priority ?? 0,
    files: modFiles,
    fileSwaps: o.FileSwaps ?? {},
    manipulations: o.Manipulations ?? [],
    // Carry the full original option JSON so Imc/Combining extras (AttributeMask,
    // IsDisableSubMod, ...), Priority, and absent Files/Image round-trip verbatim.
    raw: o,
  };
}

export function readPmp(bytes: Uint8Array): ModpackData {
  const entries = readZip(bytes);
  const metaBytes = entries.get("meta.json");
  if (!metaBytes) throw new Error("pmp: missing meta.json");
  const defaultBytes = entries.get("default_mod.json");
  if (!defaultBytes) throw new Error("pmp: missing default_mod.json");
  const meta = JSON.parse(dec.decode(metaBytes)) as PmpMetaJson;
  const defaultMod = JSON.parse(dec.decode(defaultBytes)) as PmpOptionJson;

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
    options: [optionFromJson(defaultMod, entries)],
  });

  for (const name of groupNames) {
    const g = JSON.parse(dec.decode(entries.get(name)!)) as PmpGroupJson;
    groups.push({
      name: g.Name,
      description: g.Description ?? "",
      image: g.Image ?? "",
      page: g.Page ?? 0,
      priority: g.Priority ?? 0,
      selectionType: g.Type,
      defaultSettings: g.DefaultSettings ?? 0,
      options: (g.Options ?? []).map((o) => optionFromJson(o, entries)),
      // Carry the full original group JSON so group-level extras (Imc Identifier/
      // DefaultEntry/AllVariants/OnlyAttributes, etc.) round-trip verbatim.
      raw: g,
    });
  }

  return {
    sourceFormat: ModpackFormat.Pmp,
    isSimple: false,
    meta: {
      name: meta.Name ?? "",
      author: meta.Author ?? "",
      version: meta.Version ?? "",
      description: meta.Description ?? "",
      url: meta.Website ?? "",
      image: meta.Image ?? "",
      tags: meta.ModTags ?? [],
      minimumFrameworkVersion: "1.0.0.0",
      raw: meta, // carries FileVersion, DefaultPreferredItems, and any other meta fields
    },
    groups,
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

/** Reconstruct a PMP option JSON. Prefers the carried-through original (`raw`) for
 * full fidelity; falls back to building from modeled fields (non-PMP sources). */
function optionToJson(o: ModpackOption, includeMeta: boolean): PmpOptionJson {
  if (isObj(o.raw)) return o.raw as PmpOptionJson;
  const Files: Record<string, string> = {};
  for (const f of o.files) {
    const zip = f.pmpPath ?? f.gamePath; // forward slashes (zip entry name)
    Files[f.gamePath] = zip.replace(/\//g, "\\"); // backslashes in JSON value
  }
  const base: PmpOptionJson = {
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

  const meta: PmpMetaJson = isObj(data.meta.raw)
    ? (data.meta.raw as unknown as PmpMetaJson)
    : {
        FileVersion: 3,
        Name: data.meta.name,
        Author: data.meta.author,
        Description: data.meta.description,
        Version: data.meta.version,
        Website: data.meta.url,
        Image: data.meta.image,
        ModTags: data.meta.tags,
      };
  entries.set("meta.json", enc.encode(JSON.stringify(meta, null, 2)));

  const [defaultGroup, ...rest] = data.groups;
  const defaultOption: ModpackOption | undefined = defaultGroup?.options[0];
  const defaultMod: PmpOptionJson = defaultOption
    ? optionToJson(defaultOption, false)
    : { Version: 0, Files: {}, FileSwaps: {}, Manipulations: [] };
  entries.set(
    "default_mod.json",
    enc.encode(JSON.stringify(defaultMod, null, 2)),
  );

  rest.forEach((g, i) => {
    const groupJson: PmpGroupJson = isObj(g.raw)
      ? // Re-emit the original group verbatim, but let the model's option list drive
        // count/order (each option re-emitted from its own carried-through raw).
        ({
          ...(g.raw as Record<string, unknown>),
          Options: g.options.map((o) => optionToJson(o, true)),
        } as PmpGroupJson)
      : {
          Version: 0,
          Name: g.name,
          Description: g.description,
          Image: g.image,
          Page: g.page,
          Priority: g.priority,
          Type: g.selectionType,
          DefaultSettings: g.defaultSettings,
          Options: g.options.map((o) => optionToJson(o, true)),
        };
    const fileName = `group_${String(i + 1).padStart(3, "0")}_${safeName(g.name)}.json`;
    entries.set(fileName, enc.encode(JSON.stringify(groupJson, null, 2)));
  });

  for (const f of allFiles(data)) {
    const zipPath = (f.pmpPath ?? f.gamePath).replace(/\\/g, "/");
    if (!entries.has(zipPath)) entries.set(zipPath, f.data);
  }

  return writeZip(entries, { store: false });
}
