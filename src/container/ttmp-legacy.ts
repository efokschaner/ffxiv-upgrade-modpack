import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../model/modpack";
import { readZip } from "../zip/zip";
import type { OriginalModPackJson } from "./manifest-types";

export function readLegacyTtmp(bytes: Uint8Array): ModpackData {
  const entries = readZip(bytes);
  const mplName = [...entries.keys()].find((k) =>
    k.toLowerCase().endsWith(".mpl"),
  );
  const mpdName = [...entries.keys()].find((k) =>
    k.toLowerCase().endsWith(".mpd"),
  );
  if (!mplName || !mpdName) throw new Error("ttmp(v1): missing .mpl or .mpd");
  const text = new TextDecoder().decode(entries.get(mplName)!);
  const mpd = entries.get(mpdName)!;

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length > 0 && lines[0]!.toLowerCase().includes("version"))
    lines.shift();

  const files: ModpackFile[] = lines.map((line) => {
    const m = JSON.parse(line) as OriginalModPackJson;
    return {
      gamePath: m.FullPath,
      data: mpd.slice(m.ModOffset, m.ModOffset + m.ModSize),
      storage: FileStorageType.SqPackCompressed,
      ttmp: {
        name: m.Name,
        category: m.Category,
        datFile: m.DatFile,
        isDefault: false,
      },
    };
  });

  const option: ModpackOption = {
    name: "Default",
    description: "",
    image: "",
    priority: 0,
    fileSwaps: {},
    manipulations: [],
    files,
  };
  const group: ModpackGroup = {
    name: "Default",
    description: "",
    image: "",
    page: 0,
    priority: 0,
    selectionType: "Single",
    defaultSettings: 0,
    options: [option],
  };
  return {
    sourceFormat: ModpackFormat.TtmpLegacy,
    isSimple: true,
    meta: {
      name: "",
      author: "Unknown",
      version: "1.0",
      description: "",
      url: "",
      image: "",
      tags: [],
      minimumFrameworkVersion: "1.0.0.0",
    },
    groups: [group],
  };
}
