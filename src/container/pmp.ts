import { readZip, writeZip } from "../zip/zip";
import {
  FileStorageType, ModpackFormat, allFiles,
  type ModpackData, type ModpackGroup, type ModpackOption,
} from "../model/modpack";
import type { PmpGroupJson, PmpMetaJson, PmpOptionJson } from "./manifest-types";

const dec = new TextDecoder();

function optionFromJson(o: PmpOptionJson, files: Map<string, Uint8Array>): ModpackOption {
  const modFiles = Object.entries(o.Files ?? {}).map(([gamePath, zipPathRaw]) => {
    const zipPath = zipPathRaw.replace(/\\/g, "/");
    const data = files.get(zipPath);
    if (!data) throw new Error(`pmp: missing file entry ${zipPath}`);
    return { gamePath, data, storage: FileStorageType.RawUncompressed, pmpPath: zipPath };
  });
  return {
    name: o.Name ?? "", description: o.Description ?? "", image: o.Image ?? "", priority: o.Priority ?? 0,
    files: modFiles, fileSwaps: o.FileSwaps ?? {}, manipulations: o.Manipulations ?? [],
  };
}

export function readPmp(bytes: Uint8Array): ModpackData {
  const entries = readZip(bytes);
  const meta = JSON.parse(dec.decode(entries.get("meta.json")!)) as PmpMetaJson;
  const defaultMod = JSON.parse(dec.decode(entries.get("default_mod.json")!)) as PmpOptionJson;

  const groupNames = [...entries.keys()]
    .filter((k) => /^group_\d+.*\.json$/i.test(k))
    .sort();

  const groups: ModpackGroup[] = [];
  // default_mod.json -> a leading single-option group named "Default".
  groups.push({
    name: "Default", description: "", image: "", page: 0, priority: 0,
    selectionType: "Single", defaultSettings: 0,
    options: [optionFromJson(defaultMod, entries)],
  });

  for (const name of groupNames) {
    const g = JSON.parse(dec.decode(entries.get(name)!)) as PmpGroupJson;
    const { Version, Name, Description, Image, Page, Priority, Type, DefaultSettings, Options, ...rest } = g;
    groups.push({
      name: Name, description: Description ?? "", image: Image ?? "",
      page: Page ?? 0, priority: Priority ?? 0, selectionType: Type, defaultSettings: DefaultSettings ?? 0,
      options: (Options ?? []).map((o) => optionFromJson(o, entries)),
      raw: Object.keys(rest).length ? rest : undefined,
    });
  }

  return {
    sourceFormat: ModpackFormat.Pmp, isSimple: false,
    meta: {
      name: meta.Name ?? "", author: meta.Author ?? "", version: meta.Version ?? "",
      description: meta.Description ?? "", url: meta.Website ?? "", image: meta.Image ?? "",
      tags: meta.ModTags ?? [], minimumFrameworkVersion: "1.0.0.0",
    },
    groups,
  };
}

function safeName(s: string): string {
  return (s || "_").replace(/[^A-Za-z0-9._-]/g, "_");
}

function optionToJson(o: ModpackOption, includeMeta: boolean): PmpOptionJson {
  const Files: Record<string, string> = {};
  for (const f of o.files) {
    const zip = (f.pmpPath ?? f.gamePath);            // forward slashes (zip entry name)
    Files[f.gamePath] = zip.replace(/\//g, "\\");     // backslashes in JSON value
  }
  const base: PmpOptionJson = { Files, FileSwaps: o.fileSwaps, Manipulations: o.manipulations };
  if (includeMeta) { base.Name = o.name; base.Description = o.description; base.Image = o.image; }
  return base;
}

export function writePmp(data: ModpackData): Uint8Array {
  const enc = new TextEncoder();
  const entries = new Map<string, Uint8Array>();

  const meta: PmpMetaJson = {
    FileVersion: 3, Name: data.meta.name, Author: data.meta.author,
    Description: data.meta.description, Version: data.meta.version,
    Website: data.meta.url, Image: data.meta.image, ModTags: data.meta.tags,
  };
  entries.set("meta.json", enc.encode(JSON.stringify(meta, null, 2)));

  const [defaultGroup, ...rest] = data.groups;
  const defaultOption: ModpackOption = defaultGroup?.options[0] ?? {
    name: "", description: "", image: "", priority: 0, files: [], fileSwaps: {}, manipulations: [],
  };
  const defaultMod: PmpOptionJson = { Version: 0, ...optionToJson(defaultOption, false) };
  entries.set("default_mod.json", enc.encode(JSON.stringify(defaultMod, null, 2)));

  rest.forEach((g, i) => {
    const groupJson: PmpGroupJson = {
      Version: 0, Name: g.name, Description: g.description, Image: g.image,
      Page: g.page, Priority: g.priority, Type: g.selectionType, DefaultSettings: g.defaultSettings,
      ...(g.raw && typeof g.raw === "object" ? (g.raw as Record<string, unknown>) : {}),
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
