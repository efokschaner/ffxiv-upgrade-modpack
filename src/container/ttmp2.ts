// TTMP2 container reader/writer, ported from xivModdingFramework Mods/FileTypes/TTMP.cs.
// readTtmp2 mirrors GetModpackList / UnzipTtmp (TTMP.cs:378, :488); writeTtmp2 mirrors
// CreateWizardModPack / CreateSimpleModPack (TTMP.cs:267, :302); buildBlob assembles the .mpd
// data blob those writers emit.
import {
  allFiles,
  allPages,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
  type ModpackGroup,
  type ModpackOption,
  type ModpackPage,
} from "../model/modpack";
import { ttmpNeedsMdlFix } from "../upgrade/model";
import { ttmpNeedsTexFix } from "../upgrade/texfix";
import { concatBytes, fnv1aKey } from "../util/binary";
import { reformatDotnetVersion } from "../util/dotnet-version";
import { UnportedGapError } from "../util/errors";
import { readZip, writeZip } from "../zip/zip";
import { clearNulls, pageHasData } from "./clear-nulls";
import { EGroupType, groupType } from "./group-type";
import type { LoadFix, LoadFixFactory } from "./load-fix";
import type {
  ModPackJson,
  ModPackJsonWrite,
  TtmpModGroupJsonWrite,
  TtmpModPackPageJsonWrite,
  TtmpModsJson,
  TtmpModsJsonWrite,
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
// loop (WizardData.cs:678-743): per entry, apply the load fix FIRST, then collapse. `loadFix`
// returning null DROPS the file (the C# `catch { continue }`), so it never reaches the collapse
// `.set` and a dropped later duplicate cannot overwrite an earlier survivor. `.set` on a repeated
// FullPath is C#'s last-write-wins collapse (:735-743). With no `loadFix` (a unit test reading
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
// `FromWizardTtmp` (WizardData.cs:1182-1205) does NOT call `ClearNulls` — only `FromPmp` (:1178)
// does. Reproduced by omission: readTtmp2 never calls clearNulls (src/container/clear-nulls.ts).
// It doesn't need to anyway — `FromWizardModpackPage` discards a null group at the call site
// itself (`if (g == null) continue;`, :997), so the wizard branch below never admits one, and the
// simple branch's synthesized group always carries exactly one option (see its own comment).
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
  // (WizardData.cs:662-663), from the same version we just parsed. `makeLoadFix` omitted -> no fix.
  const loadFix = makeLoadFix?.({
    needsTexFix: ttmpNeedsTexFix(mpl.TTMPVersion),
    needsMdlFix: ttmpNeedsMdlFix(mpl.TTMPVersion),
  });

  // WizardMetaEntry.FromTtmp (WizardData.cs:1063-1080) assigns Name/Author/Url/Description VERBATIM
  // — no `?? ""` — and the `= ""` initializers on those fields (:1026-1031) are overwritten by these
  // very assignments, so a `.mpl` that spells `null` (or omits the key: an uninitialized C# `string`
  // deserializes to `null`) keeps a null all the way to the write. `?? null` normalizes our
  // `undefined`-for-absent to C#'s `null`-for-absent. `version` is the exception: WriteWizardPack
  // forces it non-null (:1354-1356), so it keeps its coalesce.
  const meta = {
    name: mpl.Name ?? null,
    author: mpl.Author ?? null,
    version: mpl.Version ?? "",
    description: mpl.Description ?? null,
    url: mpl.Url ?? null,
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
      // WizardData.cs:1237-1240 — FromSimpleTtmp synthesizes its one fake ModOptionJson with
      // `IsChecked = true`, which FromWizardGroup then copies to Selected (:674).
      selected: true,
      fileSwaps: {},
      manipulations: [],
      files: filesFromMods(mpl.SimpleModsList, mpd, loadFix),
    };
    const group: ModpackGroup = {
      name: "Default",
      description: "",
      image: "",
      priority: 0,
      selectionType: "Single",
      defaultSettings: 0,
      options: [option],
    };
    return {
      sourceFormat: ModpackFormat.Ttmp2,
      isSimple: true,
      meta,
      // WizardData.cs · FromSimpleTtmp · 1223-1250 — one hand-built page holding one hand-built
      // group, added UNCONDITIONALLY (:1249) with no ClearNulls call. FromWizardGroup's zero-option
      // early return (:755-759) cannot fire on it: the group is constructed with exactly one option
      // (:1237-1244), so the null this add would otherwise leak is unreachable.
      pages: [{ groups: [group] }],
    };
  }

  const pages: ModpackPage[] = [];
  for (const page of mpl.ModPackPages ?? []) {
    // WizardData.cs · WizardPageEntry.FromWizardModpackPage · 988-1001 — one page per ModPackPages
    // element, in array order. WizardPageEntry itself carries no page-index field; page identity is
    // positional and the writer re-derives PageIndex with a dense counter at write time
    // (WriteWizardPack:1367-1376).
    const builtPage: ModpackPage = {
      groups: [],
    };
    for (const g of page.ModGroups) {
      const built: ModpackGroup = {
        name: g.GroupName,
        description: "",
        image: "",
        priority: 0,
        // WizardData.cs:658 — `tGroup.SelectionType == "Single" ? Single : Multi`. The comparison is
        // against "Single" only, so every other value — including an absent one — is Multi.
        selectionType: g.SelectionType === "Single" ? "Single" : "Multi",
        defaultSettings: 0,
        options: g.OptionList.map((o) => ({
          name: o.Name,
          // WizardData.cs:669 — `wizOp.Description = o.Description;`, verbatim, no coalesce. An
          // ABSENT key is `undefined` here but `null` in C# (an uninitialized `string` field,
          // ModPackJson.cs · ModOptionJson · 159-198), so normalize to null rather than to "".
          description: o.Description ?? null,
          image: o.ImagePath ?? "",
          priority: 0,
          // WizardData.cs:674 — `wizOp.Selected = o.IsChecked;`, verbatim, with no clamping. An
          // absent key leaves C#'s plain `bool` field at its `false` default
          // (ModOptionJson.IsChecked, ModPackJson.cs:189-198).
          selected: o.IsChecked ?? false,
          fileSwaps: {},
          manipulations: [],
          files: filesFromMods(o.ModsJsons, mpd, loadFix),
        })),
      };
      // WizardData.cs · FromWizardGroup · 755-759 — `if (group.Options.Count == 0) return null;`,
      // BEFORE the Single "none selected" backstop at :761-763. The caller,
      // WizardPageEntry.FromWizardModpackPage (:994-999), discards the null at the call site
      // (`if (g == null) continue;`, :997) — so a skip-the-push here is the honest transcription.
      if (built.options.length === 0) continue;
      // WizardData.cs:761-763 — FromWizardGroup's tail, AFTER every option is in the list. This is
      // a "none selected" backstop ONLY: it never corrects a Single group carrying more than one
      // selected option.
      if (
        built.selectionType === "Single" &&
        !built.options.some((o) => o.selected)
      ) {
        built.options[0]!.selected = true;
      }
      builtPage.groups.push(built);
    }
    pages.push(builtPage);
  }
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: false,
    meta,
    pages,
  };
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
      // (TTMP.cs:1069), but we have no golden for a TTMP *write* of one, so we fail loud rather
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

/** MUTATES `data`: `allPages(data)` returns `data.pages` by reference, and the wizard branch's
 *  `clearNulls(dataPages)` call below splices dead pages/groups out of it in place. Faithful —
 *  `ClearNulls` mutates `this.DataPages` in the C# too (WizardData.cs:1353) — but currently inert
 *  for any caller that only ever writes once. */
export function writeTtmp2(data: ModpackData): Uint8Array {
  // A PMP source can carry ExtraFiles (previews, readmes — PMP.cs:278-280); TTMP has no analogous
  // container member (its payloads are byte offsets into a single .mpd, not zip members), and
  // /upgrade never converts formats, so no golden exists for what a TTMP write of one should do.
  // Fail loud rather than silently drop it, consistent with buildBlob's absent-file guard below.
  if (data.extraFiles && data.extraFiles.size > 0) {
    throw new Error(
      `ttmp2: cannot write ExtraFiles (${data.extraFiles.size}) — TTMP has no equivalent container member`,
    );
  }
  // Computed BEFORE `clearNulls` runs below (the `clearNulls(dataPages)` call in the wizard arm of
  // the `data.isSimple` split — named rather than line-numbered, since it moves), inverting
  // `WriteWizardPack`'s order (`ClearNulls()` is its first statement, WizardData.cs:1353). Verified inert: every
  // page/group `clearNulls` can remove is, by construction, one with zero surviving options
  // (`groupHasData`/`pageHasData`, src/container/clear-nulls.ts), so it contributes zero entries to
  // `allFiles` either way — pruning it after the fact changes nothing this blob build reads.
  const files = allFiles(data);
  const { blob, place } = buildBlob(files.map((e) => e.file));

  // Key order is ModsJson's C# declaration order (ModPackJson.cs · ModsJson · 222-262), which is
  // the order Newtonsoft emits (reflection order). See manifest-types.ts's write-view note.
  const modOf = (gamePath: string, f: ModpackFile): TtmpModsJsonWrite => ({
    Name: f.ttmp?.name ?? "",
    Category: f.ttmp?.category ?? "",
    FullPath: gamePath,
    ModOffset: place.get(f)!.off,
    ModSize: place.get(f)!.size,
    DatFile: f.ttmp?.datFile ?? "",
    IsDefault: f.ttmp?.isDefault ?? false,
    // Never assigned by either TTMPWriter.AddFile overload (:168-177, :198-207), so always null —
    // and present rather than omitted, per Newtonsoft's default NullValueHandling.Include (:324).
    ModPackEntry: null,
  });

  const mpl: ModPackJsonWrite = {
    TTMPVersion: data.isSimple ? "2.1s" : "2.1w",
    Name: data.meta.name,
    Author: data.meta.author,
    // WriteWizardPack normalizes the version through .NET Version semantics BEFORE the
    // ModPackData it hands to the TTMPWriter ctor is stringified
    // (`Version.TryParse(MetaPage.Version, out var ver); ver ??= new Version("1.0")`,
    // WizardData.cs · WriteWizardPack · 1354-1356, assigned at :1362; `Version = version.ToString()`,
    // TTMPWriter.cs · TTMPWriter · 61-69), so a source spelling "1" is written "1.0". Every .ttmp2
    // write in the oracle routes through WriteWizardPack (WizardData.cs · WriteModpack · 1337-1340),
    // so this applies to the simple and wizard shapes alike.
    // NOTE: the ctor's own `modPackData.Version ?? new Version(1, 0, 0, 0)` (TTMPWriter.cs:61) is
    // UNREACHABLE from this path — `ver ??=` already guaranteed non-null — so it changes no output
    // here. It matters only to TTMPWriter's other callers (TTMP.cs:319, :359).
    Version: reformatDotnetVersion(data.meta.version),
    Description: data.meta.description,
    Url: data.meta.url,
    MinimumFrameworkVersion: data.meta.minimumFrameworkVersion,
    // TTMPWriter's ctor initializes exactly ONE of these (TTMPWriter.cs · TTMPWriter · 74-77) and
    // leaves the other at null; the bare JsonConvert.SerializeObject at :324 uses Newtonsoft's
    // default NullValueHandling.Include, so BOTH names always appear, one of them as `null`.
    // Initialized here so the unused one is written; the branch below overwrites its own.
    ModPackPages: null,
    SimpleModsList: null,
  };

  if (data.isSimple) {
    // No `clearNulls` call on this branch, though `WriteWizardPack:1353` calls it unconditionally.
    // Not a gap: C# never reaches WriteWizardPack for a simple pack at all (`isSimple` write is a
    // wholly separate C# path, TTMP.CreateSimpleModPack/SimpleModPackData — a different class
    // hierarchy this port merges into one module, see this file's own citations), so `ClearNulls`
    // simply doesn't apply here. Inert either way: a simple pack's one hand-built page/group/option
    // (readTtmp2's simple path, mirroring FromSimpleTtmp:1223-1250 — see
    // docs/superpowers/specs/2026-08-04-datapages-model-and-empty-group-design.md §4) can never be
    // the zero-option/zero-group case `clearNulls` prunes.
    mpl.SimpleModsList = files.map((e) => modOf(e.gamePath, e.file));
  } else {
    // WizardData.cs · WriteWizardPack · 1353 — the first statement of the WHOLE FUNCTION, not of a
    // "wizard branch" within it: WriteWizardPack has no isSimple/wizard split of its own (that split
    // is this port's; see the comment above). It runs before anything else in this function reads
    // DataPages.
    const dataPages = allPages(data);
    clearNulls(dataPages);
    // WizardData.cs · WriteWizardPack · 1367-1376 — pages are emitted in DataPages ORDER with a
    // DENSE counter, not by the source PageIndex, and a page with no data is skipped entirely.
    // Measured against ConsoleTools /resave 2026-08-04: a sparse source index (3) emits as 0; two
    // pages sharing an index stay two pages; source array order is preserved rather than sorted.
    const pages: TtmpModPackPageJsonWrite[] = [];
    for (const page of dataPages) {
      if (!pageHasData(page)) continue; // :1370
      const modGroups: TtmpModGroupJsonWrite[] = [];
      for (const g of page.groups) {
        // Narrow rather than assert: ClearNulls has already run (just above), so no page reaching
        // here holds a null.
        if (g === null) continue;
        // WizardData.cs:874-877 — ToModGroup throws InvalidDataException("TTMP Does not support IMC
        // Groups.") as its first statement, before it builds the ModGroup or visits any option.
        // `groupType(g)` is the port of GroupType (WizardData.cs · WizardGroupEntry.GroupType ·
        // 611-625; src/container/group-type.ts). Only a PMP source carries an Imc group, and
        // /upgrade never converts formats, so this is unreachable today.
        if (groupType(g) === EGroupType.Imc) {
          throw new Error("ttmp2: TTMP Does not support IMC Groups.");
        }
        // PORT GAP — the sibling refusal for a COMBINING group, which the C# performs one level down
        // and with a different message. `ToModGroup` (WizardData.cs · ToModGroup · 872-893) guards
        // ONLY `ImcData != null` (:874-877), so a Combining group passes it, `mg` is built (:879-884)
        // and the per-option loop (:886-890) calls `WizardOptionEntry.ToModOption`
        // (WizardData.cs · ToModOption · 406-…), whose `if (StandardData == null) throw new
        // NotImplementedException("TTMP Export does not support one or more of the selected Option
        // types.");` (:425-428) fires on the FIRST option — `StandardData`'s getter returns null for
        // any non-Standard group (:376-388).
        //
        // We do NOT reproduce that: it is an OPTION-level guard keyed on a `StandardData` concept
        // this flattened port does not carry, and its message would have to be right at a seam no
        // oracle run exercises. So this is `UnportedGapError`, not the C# string — the opposite call
        // from `writePmp`'s Combining refusal (src/container/pmp.ts), which IS a faithful
        // reproduction of a throw the C# performs at the seam we port.
        //
        // It must be LOUD rather than a comment, even though nothing reaches it today. Falling
        // through emits the group as an ordinary `"Multi"` (see the SelectionType collapse just
        // below) with its options' empty file lists — silently wrong output, the exact class the
        // fail-loud principle exists to prevent. And it only became reachable at all when this branch
        // taught `parsePmpGroup` to ACCEPT a Combining group: before that the pack could not load.
        //
        // The reachability argument that used to sit here — "`writeModpack` rejects cross-format
        // writes" — is WRONG, and is why this guard exists. That check (src/index.ts:87-98) is
        // PER-FILE: it scans `allFiles(data)` for a storage mismatch, so a pack carrying NO files
        // (a Combining group with empty containers, an empty default_mod) has nothing to mismatch and
        // sails straight through into `writeTtmp2`. Measured, 2026-08-08: such a PMP wrote a 605-byte
        // .ttmp2 before this guard. Filed as docs/backlog/2026-08-08-writemodpack-per-file-format-guard.md.
        if (groupType(g) === EGroupType.Combining) {
          throw new UnportedGapError(
            `ttmp2: writing a Combining group ("${g.name}") into a TTMP is unported — the C# refuses ` +
              "it per-option in WizardOptionEntry.ToModOption (WizardData.cs:425-428, " +
              '"TTMP Export does not support one or more of the selected Option types."), a seam ' +
              "this port does not reproduce. Emitting it as a Multi group would silently drop the " +
              "group's data.",
          );
        }
        // WizardData.cs:883 (group) / :421 (option) — `SelectionType = OptionType.ToString()` over
        // EOptionType { Single, Multi } (:26-30), the enum both readers collapse the raw string into
        // at load (:658 TTMP, :775 PMP). So in the C# any non-"Single" value — "Combining" and "Imc"
        // included — collapses to "Multi". That describes the C#, NOT this line: both of those types
        // are refused by the two guards above before reaching here, so the only values this writer
        // ever collapses are "Single" and "Multi" themselves. An option has no type of its own: it
        // delegates to its group (:337-343), so the same value is written at both levels.
        const selectionType = g.selectionType === "Single" ? "Single" : "Multi";
        modGroups.push({
          GroupName: g.name,
          SelectionType: selectionType,
          // Key order is ModOptionJson's C# declaration order (ModPackJson.cs · ModOptionJson ·
          // 159-198) — note ModsJsons sits FOURTH, before GroupName/SelectionType.
          OptionList: g.options.map((o) => ({
            Name: o.name,
            Description: o.description,
            ImagePath: o.image,
            ModsJsons: [...o.files].map(([gamePath, f]) => modOf(gamePath, f)),
            GroupName: g.name,
            SelectionType: selectionType,
            // TTMPWriter.cs · AddOption · 148 — `IsChecked = modOption.IsChecked`, itself the
            // verbatim counterpart of the read at WizardData.cs:674. No write-time derivation.
            IsChecked: o.selected,
          })),
        });
      }
      pages.push({ PageIndex: pages.length, ModGroups: modGroups }); // :1374-1375
    }
    mpl.ModPackPages = pages;
  }

  const entries = new Map<string, Uint8Array>([
    ["TTMPL.mpl", new TextEncoder().encode(JSON.stringify(mpl))],
    ["TTMPD.mpd", blob],
  ]);
  return writeZip(entries, { store: true });
}
