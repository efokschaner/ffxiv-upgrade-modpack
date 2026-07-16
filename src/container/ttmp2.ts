// TTMP2 container reader/writer, ported from xivModdingFramework Mods/FileTypes/TTMP.cs.
// readTtmp2 mirrors GetModpackList / UnzipTtmp (TTMP.cs:378, :488); writeTtmp2 mirrors
// CreateWizardModPack / CreateSimpleModPack (TTMP.cs:267, :302); buildBlob assembles the .mpd
// data blob those writers emit.
import {
  allFiles,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
} from "../model/modpack";
import { concatBytes, fnv1aKey } from "../util/binary";
import { readZip, writeZip } from "../zip/zip";
import type {
  ModPackJson,
  TtmpModGroupJson,
  TtmpModPackPageJson,
  TtmpModsJson,
} from "./manifest-types";

function fileFromMod(m: TtmpModsJson, mpd: Uint8Array): ModpackFile {
  return {
    gamePath: m.FullPath,
    data: mpd.slice(m.ModOffset, m.ModOffset + m.ModSize),
    storage: FileStorageType.SqPackCompressed,
    ttmp: {
      name: m.Name,
      category: m.Category,
      datFile: m.DatFile,
      isDefault: m.IsDefault ?? false,
    },
  };
}

// Build the option's file map in ModsJsons order. Map.set on a repeated FullPath overwrites the
// earlier entry, reproducing C#'s last-write-wins collapse (WizardData.cs:729-737).
function filesFromMods(
  mods: TtmpModsJson[],
  mpd: Uint8Array,
): Map<string, ModpackFile> {
  const files = new Map<string, ModpackFile>();
  for (const m of mods) files.set(m.FullPath, fileFromMod(m, mpd));
  return files;
}

export function readTtmp2(bytes: Uint8Array): ModpackData {
  const entries = readZip(bytes);
  const mplName = [...entries.keys()].find((k) =>
    k.toLowerCase().endsWith(".mpl"),
  );
  const mpdName = [...entries.keys()].find((k) =>
    k.toLowerCase().endsWith(".mpd"),
  );
  if (!mplName || !mpdName)
    throw new Error("ttmp2: missing TTMPL.mpl or TTMPD.mpd");
  const mpl = JSON.parse(
    new TextDecoder().decode(entries.get(mplName)!),
  ) as ModPackJson;
  const mpd = entries.get(mpdName)!;

  const meta = {
    name: mpl.Name ?? "",
    author: mpl.Author ?? "",
    version: mpl.Version ?? "",
    description: mpl.Description ?? "",
    url: mpl.Url ?? "",
    image: "",
    tags: [],
    minimumFrameworkVersion: mpl.MinimumFrameworkVersion ?? "1.0.0.0",
    sourceTtmpVersion: mpl.TTMPVersion,
  };

  if (mpl.SimpleModsList) {
    const option: ModpackOption = {
      name: "Default",
      description: "",
      image: "",
      priority: 0,
      fileSwaps: {},
      manipulations: [],
      files: filesFromMods(mpl.SimpleModsList, mpd),
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
      sourceFormat: ModpackFormat.Ttmp2,
      isSimple: true,
      meta,
      groups: [group],
    };
  }

  const groups: ModpackGroup[] = [];
  for (const page of mpl.ModPackPages ?? []) {
    for (const g of page.ModGroups) {
      groups.push({
        name: g.GroupName,
        description: "",
        image: "",
        page: page.PageIndex,
        priority: 0,
        // WizardData.cs:652 — `tGroup.SelectionType == "Single" ? Single : Multi`. The comparison is
        // against "Single" only, so every other value — including an absent one — is Multi.
        selectionType: g.SelectionType === "Single" ? "Single" : "Multi",
        defaultSettings: 0,
        options: g.OptionList.map((o) => ({
          name: o.Name,
          description: o.Description ?? "",
          image: o.ImagePath ?? "",
          priority: 0,
          fileSwaps: {},
          manipulations: [],
          files: filesFromMods(o.ModsJsons, mpd),
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

function buildBlob(files: ModpackFile[]): {
  blob: Uint8Array;
  place: Map<ModpackFile, { off: number; size: number }>;
} {
  const parts: Uint8Array[] = [];
  const place = new Map<ModpackFile, { off: number; size: number }>();
  const seen = new Map<
    string,
    Array<{ pos: { off: number; size: number }; data: Uint8Array }>
  >();
  let off = 0;
  for (const f of files) {
    if (!f.data) {
      // Unreachable: absent files are PMP-only (they come from a PMP `Files` value with no zip
      // member) and /upgrade never converts formats. TTMP's own importer skips such files
      // (TTMP.cs:1067), but we have no golden for a TTMP *write* of one, so we fail loud rather
      // than guess. See the absent-file design spec §3.4.
      throw new Error(
        `ttmp2: cannot write a file with no bytes: ${f.gamePath}`,
      );
    }
    const data = f.data; // narrow once: TS does not retain the `!f.data` guard across the closure below
    const key = fnv1aKey(data);
    const bucket = seen.get(key) ?? [];
    let pos = bucket.find((e) => bytesEqual(e.data, data))?.pos;
    if (!pos) {
      pos = { off, size: data.length };
      bucket.push({ pos, data });
      seen.set(key, bucket);
      parts.push(data);
      off += data.length;
    }
    place.set(f, pos);
  }
  return { blob: concatBytes(parts), place };
}

export function writeTtmp2(data: ModpackData): Uint8Array {
  // A PMP source can carry ExtraFiles (previews, readmes — PMP.cs:213-215); TTMP has no analogous
  // container member (its payloads are byte offsets into a single .mpd, not zip members), and
  // /upgrade never converts formats, so no golden exists for what a TTMP write of one should do.
  // Fail loud rather than silently drop it, consistent with buildBlob's absent-file guard below.
  if (data.extraFiles && data.extraFiles.size > 0) {
    throw new Error(
      `ttmp2: cannot write ExtraFiles (${data.extraFiles.size}) — TTMP has no equivalent container member`,
    );
  }
  const files = allFiles(data);
  const { blob, place } = buildBlob(files);

  const modOf = (f: ModpackFile) => ({
    Name: f.ttmp?.name ?? "",
    Category: f.ttmp?.category ?? "",
    FullPath: f.gamePath,
    ModOffset: place.get(f)!.off,
    ModSize: place.get(f)!.size,
    DatFile: f.ttmp?.datFile ?? "",
    IsDefault: f.ttmp?.isDefault ?? false,
  });

  const mpl: ModPackJson = {
    TTMPVersion: data.isSimple ? "2.1s" : "2.1w",
    Name: data.meta.name,
    Author: data.meta.author,
    Version: data.meta.version,
    Description: data.meta.description,
    Url: data.meta.url,
    MinimumFrameworkVersion: data.meta.minimumFrameworkVersion,
  };

  if (data.isSimple) {
    mpl.SimpleModsList = files.map(modOf);
  } else {
    const byPage = new Map<number, TtmpModGroupJson[]>();
    for (const g of data.groups) {
      // WizardData.cs:868-871 — ToModGroup throws InvalidDataException("TTMP Does not support IMC
      // Groups.") as its first statement, before it builds the ModGroup or visits any option.
      // `selectionType === "Imc"` stands in for GroupType == EGroupType.Imc (:609-618), as at
      // option-prefix.ts:288 and pmp.ts:485. Only a PMP source carries an Imc group, and /upgrade
      // never converts formats, so this is unreachable today.
      if (g.selectionType === "Imc") {
        throw new Error("ttmp2: TTMP Does not support IMC Groups.");
      }
      // WizardData.cs:877 (group) / :419 (option) — `SelectionType = OptionType.ToString()` over
      // EOptionType { Single, Multi } (:25-29), the enum both readers collapse the raw string into at
      // load (:652 TTMP, :769 PMP). So any non-"Single" value — "Combining" included — writes as
      // "Multi". An option has no type of its own: it delegates to its group (:335-341), so the same
      // value is written at both levels.
      const selectionType = g.selectionType === "Single" ? "Single" : "Multi";
      const list = byPage.get(g.page) ?? [];
      list.push({
        GroupName: g.name,
        SelectionType: selectionType,
        OptionList: g.options.map((o) => ({
          Name: o.name,
          Description: o.description,
          ImagePath: o.image,
          GroupName: g.name,
          SelectionType: selectionType,
          ModsJsons: [...o.files.values()].map(modOf),
        })),
      });
      byPage.set(g.page, list);
    }
    const pages: TtmpModPackPageJson[] = [...byPage.keys()]
      .sort((a, b) => a - b)
      .map((p) => ({ PageIndex: p, ModGroups: byPage.get(p)! }));
    mpl.ModPackPages = pages;
  }

  const entries = new Map<string, Uint8Array>([
    ["TTMPL.mpl", new TextEncoder().encode(JSON.stringify(mpl))],
    ["TTMPD.mpd", blob],
  ]);
  return writeZip(entries, { store: true });
}
