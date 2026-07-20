// Legacy (v1) TTMP reader, ported from xivModdingFramework Mods/FileTypes/TTMP.cs
// GetLegacyModpackMpl (TTMP.cs:408).
import {
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../model/modpack";
import { ttmpNeedsMdlFix } from "../upgrade/model";
import { ttmpNeedsTexFix } from "../upgrade/texfix";
import { readZip } from "../zip/zip";
import type { LoadFixFactory } from "./load-fix";
import type { OriginalModPackJson } from "./manifest-types";

export function readLegacyTtmp(
  bytes: Uint8Array,
  makeLoadFix?: LoadFixFactory,
): ModpackData {
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

  // A legacy .ttmp carries no TTMPVersion; DoesModpackNeedFix treats that as pre-2.x, so both gates
  // fire (major < 2). `makeLoadFix` omitted -> no fix.
  const loadFix = makeLoadFix?.({
    needsTexFix: ttmpNeedsTexFix(undefined),
    needsMdlFix: ttmpNeedsMdlFix(undefined),
  });

  // Build the option's file map in line order, reproducing FromWizardGroup's fix-then-collapse
  // (WizardData.cs:700-737): apply the load fix FIRST, then `.set`. A dropped file (loadFix -> null,
  // the C# `catch { continue }`) never reaches the collapse, so it cannot overwrite an earlier
  // duplicate; `.set` on a repeated FullPath is C#'s last-write-wins collapse (:729-737).
  const files = new Map<string, ModpackFile>();
  for (const line of lines) {
    const m = JSON.parse(line) as OriginalModPackJson;
    const built: ModpackFile & {
      storage: FileStorageType.SqPackCompressed;
    } = {
      data: mpd.slice(m.ModOffset, m.ModOffset + m.ModSize),
      storage: FileStorageType.SqPackCompressed,
      ttmp: {
        name: m.Name,
        category: m.Category,
        datFile: m.DatFile,
        isDefault: false,
      },
    };
    if (!loadFix) {
      files.set(m.FullPath, built);
      continue;
    }
    const fixed = loadFix(m.FullPath, built);
    if (fixed === null) continue; // dropped — never reaches the collapse `.set`
    files.set(m.FullPath, fixed);
  }

  const option: ModpackOption = {
    name: "Default",
    description: "",
    image: "",
    priority: 0,
    // GetLegacyModpackMpl synthesizes a "0.1s" ModPackJson carrying a SimpleModsList
    // (TTMP.cs:453-462), so a legacy pack loads through FromSimpleTtmp, whose one fake option is
    // built with `IsChecked = true` (WizardData.cs:1218-1221) and copied to Selected at :668.
    selected: true,
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
