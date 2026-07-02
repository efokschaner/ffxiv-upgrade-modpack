import { readZip, writeZip } from "../zip/zip";
import { concatBytes, fnv1aKey } from "../util/binary";
import {
  FileStorageType, ModpackFormat, allFiles,
  type ModpackData, type ModpackFile, type ModpackGroup, type ModpackOption,
} from "../model/modpack";
import type { ModPackJson, TtmpModsJson, TtmpModPackPageJson, TtmpModGroupJson } from "./manifest-types";

function fileFromMod(m: TtmpModsJson, mpd: Uint8Array): ModpackFile {
  return {
    gamePath: m.FullPath,
    data: mpd.slice(m.ModOffset, m.ModOffset + m.ModSize),
    storage: FileStorageType.SqPackCompressed,
    ttmp: { name: m.Name, category: m.Category, datFile: m.DatFile, isDefault: m.IsDefault ?? false },
  };
}

export function readTtmp2(bytes: Uint8Array): ModpackData {
  const entries = readZip(bytes);
  const mplName = [...entries.keys()].find((k) => k.toLowerCase().endsWith(".mpl"));
  const mpdName = [...entries.keys()].find((k) => k.toLowerCase().endsWith(".mpd"));
  if (!mplName || !mpdName) throw new Error("ttmp2: missing TTMPL.mpl or TTMPD.mpd");
  const mpl = JSON.parse(new TextDecoder().decode(entries.get(mplName)!)) as ModPackJson;
  const mpd = entries.get(mpdName)!;

  const meta = {
    name: mpl.Name ?? "", author: mpl.Author ?? "", version: mpl.Version ?? "",
    description: mpl.Description ?? "", url: mpl.Url ?? "", image: "", tags: [],
    minimumFrameworkVersion: mpl.MinimumFrameworkVersion ?? "1.0.0.0",
  };

  if (mpl.SimpleModsList) {
    const option: ModpackOption = {
      name: "Default", description: "", image: "", priority: 0, fileSwaps: {}, manipulations: [],
      files: mpl.SimpleModsList.map((m) => fileFromMod(m, mpd)),
    };
    const group: ModpackGroup = {
      name: "Default", description: "", image: "", page: 0, priority: 0,
      selectionType: "Single", defaultSettings: 0, options: [option],
    };
    return { sourceFormat: ModpackFormat.Ttmp2, isSimple: true, meta, groups: [group] };
  }

  const groups: ModpackGroup[] = [];
  for (const page of mpl.ModPackPages ?? []) {
    for (const g of page.ModGroups) {
      groups.push({
        name: g.GroupName, description: "", image: "", page: page.PageIndex, priority: 0,
        selectionType: g.SelectionType === "Multi Selection" ? "Multi" : "Single",
        defaultSettings: 0,
        options: g.OptionList.map((o) => ({
          name: o.Name, description: o.Description ?? "", image: o.ImagePath ?? "",
          priority: 0, fileSwaps: {}, manipulations: [],
          files: o.ModsJsons.map((m) => fileFromMod(m, mpd)),
        })),
      });
    }
  }
  return { sourceFormat: ModpackFormat.Ttmp2, isSimple: false, meta, groups };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function buildBlob(files: ModpackFile[]): { blob: Uint8Array; place: Map<ModpackFile, { off: number; size: number }> } {
  const parts: Uint8Array[] = [];
  const place = new Map<ModpackFile, { off: number; size: number }>();
  const seen = new Map<string, Array<{ pos: { off: number; size: number }; data: Uint8Array }>>();
  let off = 0;
  for (const f of files) {
    const key = fnv1aKey(f.data);
    const bucket = seen.get(key) ?? [];
    let pos = bucket.find((e) => bytesEqual(e.data, f.data))?.pos;
    if (!pos) {
      pos = { off, size: f.data.length };
      bucket.push({ pos, data: f.data });
      seen.set(key, bucket);
      parts.push(f.data);
      off += f.data.length;
    }
    place.set(f, pos);
  }
  return { blob: concatBytes(parts), place };
}

export function writeTtmp2(data: ModpackData): Uint8Array {
  const files = allFiles(data);
  const { blob, place } = buildBlob(files);

  const modOf = (f: ModpackFile) => ({
    Name: f.ttmp?.name ?? "", Category: f.ttmp?.category ?? "", FullPath: f.gamePath,
    ModOffset: place.get(f)!.off, ModSize: place.get(f)!.size,
    DatFile: f.ttmp?.datFile ?? "", IsDefault: f.ttmp?.isDefault ?? false,
  });

  const mpl: ModPackJson = {
    TTMPVersion: data.isSimple ? "2.1s" : "2.1w",
    Name: data.meta.name, Author: data.meta.author, Version: data.meta.version,
    Description: data.meta.description, Url: data.meta.url,
    MinimumFrameworkVersion: data.meta.minimumFrameworkVersion,
  };

  if (data.isSimple) {
    mpl.SimpleModsList = files.map(modOf);
  } else {
    const byPage = new Map<number, TtmpModGroupJson[]>();
    for (const g of data.groups) {
      const list = byPage.get(g.page) ?? [];
      list.push({
        GroupName: g.name,
        SelectionType: g.selectionType === "Multi" ? "Multi Selection" : "Single Selection",
        OptionList: g.options.map((o) => ({
          Name: o.name, Description: o.description, ImagePath: o.image,
          GroupName: g.name, SelectionType: g.selectionType === "Multi" ? "Multi Selection" : "Single Selection",
          ModsJsons: o.files.map(modOf),
        })),
      });
      byPage.set(g.page, list);
    }
    const pages: TtmpModPackPageJson[] = [...byPage.keys()].sort((a, b) => a - b)
      .map((p) => ({ PageIndex: p, ModGroups: byPage.get(p)! }));
    mpl.ModPackPages = pages;
  }

  const entries = new Map<string, Uint8Array>([
    ["TTMPL.mpl", new TextEncoder().encode(JSON.stringify(mpl))],
    ["TTMPD.mpd", blob],
  ]);
  return writeZip(entries, { store: true });
}
