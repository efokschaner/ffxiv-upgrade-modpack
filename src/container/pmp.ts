import { readZip } from "../zip/zip";
import {
  FileStorageType, ModpackFormat,
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
