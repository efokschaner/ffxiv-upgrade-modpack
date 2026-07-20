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
import { ttmpNeedsMdlFix } from "../upgrade/model";
import { ttmpNeedsTexFix } from "../upgrade/texfix";
import { concatBytes, fnv1aKey } from "../util/binary";
import { readZip, writeZip } from "../zip/zip";
import type { LoadFix, LoadFixFactory } from "./load-fix";
import type {
  ModPackJson,
  TtmpModGroupJson,
  TtmpModPackPageJson,
  TtmpModsJson,
} from "./manifest-types";

function fileFromMod(
  m: TtmpModsJson,
  mpd: Uint8Array,
): ModpackFile & { storage: FileStorageType.SqPackCompressed } {
  return {
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

// Build the option's file map in ModsJsons order, reproducing WizardData.FromWizardGroup's inner
// loop (WizardData.cs:672-737): per entry, apply the load fix FIRST, then collapse. `loadFix`
// returning null DROPS the file (the C# `catch { continue }`), so it never reaches the collapse
// `.set` and a dropped later duplicate cannot overwrite an earlier survivor. `.set` on a repeated
// FullPath is C#'s last-write-wins collapse (:729-737). With no `loadFix` (a unit test reading
// directly), the reader collapses naively with no fix.
function filesFromMods(
  mods: TtmpModsJson[],
  mpd: Uint8Array,
  loadFix?: LoadFix,
): Map<string, ModpackFile> {
  const files = new Map<string, ModpackFile>();
  for (const m of mods) {
    const built = fileFromMod(m, mpd);
    if (!loadFix) {
      files.set(m.FullPath, built);
      continue;
    }
    const fixed = loadFix(m.FullPath, built);
    if (fixed === null) continue; // dropped — never reaches the collapse `.set`
    files.set(m.FullPath, fixed);
  }
  return files;
}

// `makeLoadFix` (an upgrade-layer factory injected by loadModpack) keeps the reader independent of
// the upgrade layer's fix logic: the reader computes the tex/mdl gates from the version it parsed
// (via the pure gate predicates it does import, `ttmpNeedsTexFix` / `ttmpNeedsMdlFix`), builds the
// fix, and applies it at the read seam. Omitted (a direct unit-test read) -> no load fix.
export function readTtmp2(
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
  if (!mplName || !mpdName)
    throw new Error("ttmp2: missing TTMPL.mpl or TTMPD.mpd");
  const mpl = JSON.parse(
    new TextDecoder().decode(entries.get(mplName)!),
  ) as ModPackJson;
  const mpd = entries.get(mpdName)!;

  // FromWizardGroup computes the tex/mdl gates once, just before its per-option loop
  // (WizardData.cs:656-657), from the same version we just parsed. `makeLoadFix` omitted -> no fix.
  const loadFix = makeLoadFix?.({
    needsTexFix: ttmpNeedsTexFix(mpl.TTMPVersion),
    needsMdlFix: ttmpNeedsMdlFix(mpl.TTMPVersion),
  });

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
      // WizardData.cs:1218-1221 — FromSimpleTtmp synthesizes its one fake ModOptionJson with
      // `IsChecked = true`, which FromWizardGroup then copies to Selected (:668).
      selected: true,
      fileSwaps: {},
      manipulations: [],
      files: filesFromMods(mpl.SimpleModsList, mpd, loadFix),
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
      const built: ModpackGroup = {
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
          // WizardData.cs:668 — `wizOp.Selected = o.IsChecked;`, verbatim, with no clamping. An
          // absent key leaves C#'s plain `bool` field at its `false` default
          // (ModOptionJson.IsChecked, ModPackJson.cs:189-198).
          selected: o.IsChecked ?? false,
          fileSwaps: {},
          manipulations: [],
          files: filesFromMods(o.ModsJsons, mpd, loadFix),
        })),
      };
      groups.push(built);
      // WizardData.cs:755-757 — FromWizardGroup's tail, AFTER every option is in the list. This is
      // a "none selected" backstop ONLY: it never corrects a Single group carrying more than one
      // selected option. The `length > 0` guard stands in for the zero-option early return at
      // :749-753 (C# returns null for an empty group; we do not port that pruning yet), so an
      // option-less group cannot crash here.
      if (
        built.selectionType === "Single" &&
        built.options.length > 0 &&
        !built.options.some((o) => o.selected)
      ) {
        built.options[0]!.selected = true;
      }
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
      throw new Error("ttmp2: cannot write a file with no bytes");
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
  const { blob, place } = buildBlob(files.map((e) => e.file));

  const modOf = (gamePath: string, f: ModpackFile) => ({
    Name: f.ttmp?.name ?? "",
    Category: f.ttmp?.category ?? "",
    FullPath: gamePath,
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
    mpl.SimpleModsList = files.map((e) => modOf(e.gamePath, e.file));
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
          ModsJsons: [...o.files].map(([gamePath, f]) => modOf(gamePath, f)),
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
