import { readZip } from "../zip/zip";
import {
  FileStorageType, ModpackFormat,
  type ModpackData, type ModpackFile, type ModpackGroup, type ModpackOption,
} from "../model/modpack";
import type { ModPackJson, TtmpModsJson } from "./manifest-types";

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
