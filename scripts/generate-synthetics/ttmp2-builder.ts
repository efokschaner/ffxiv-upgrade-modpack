// Shared scaffolding for the synthetic TTMP2 builders in this directory. Emits the minimal wizard
// .ttmp2 shape TexTools reads — TTMPL.mpl + TTMPD.mpd (TTMP.cs:378/:488, WizardData.cs:645). This is
// test scaffolding, not ported business logic; each builder supplies only what makes its repro
// distinct. The PMP equivalent is pmp-builder.ts.
//
// Two things here are load-bearing and must not be "tidied":
//   - the JSON key order below fixes the .mpl bytes the golden harness compares;
//   - the pinned mtime keeps a pack byte-reproducible, so rebuilding it keeps its cached golden
//     (the cache is keyed by sha256(input pack)). Same reasoning as pmp-builder.ts.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { encodeSqPackFile, SqPackType } from "../../src/sqpack/sqpack";
import type { SyntheticRoot } from "./pmp-builder";

const CORPUS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "corpus",
);

/** See pmp-builder.ts: fflate stamps Date.now() into every entry unless pinned, which would make
 * each rebuild miss the sha256-keyed golden cache. */
const FIXED_MTIME = new Date("2024-01-01T00:00:00");

/** A gamePath /upgrade ignores, so ConsoleTools no-ops and the /upgrade harness compares our output
 * against the input pack. /resave writes regardless, and IS the oracle for these packs. */
const DUMMY_GAME_PATH = "chara/dummy/selection_type_dummy.bin";

/** Unlike a PMP's raw zip members, TTMP payloads live in the .mpd as SQPACK-COMPRESSED blobs, so a
 * bare byte string will not decode. This is a real Type 2 entry. */
const DUMMY_PAYLOAD = encodeSqPackFile(
  new Uint8Array([0, 1, 2, 3]),
  SqPackType.Standard,
);

export interface SyntheticTtmpGroup {
  name: string;
  /** Written verbatim. `undefined` OMITS the key entirely — a case the typed TtmpModGroupJson
   * cannot express, and one WizardData.cs:652 still has to answer for. */
  selectionType?: string;
  /** `true` emits `OptionList: []` — the zero-option shape `WizardGroupEntry.FromWizardGroup`
   * (WizardData.cs:749-753) bails out on and returns `null` for. Unlike the PMP analogue
   * (`FromPMPGroup:851-855`), the null this produces is discarded at the ADD site
   * (`WizardPageEntry.FromWizardModpackPage:986`, `if (g == null) continue;`), so it never reaches
   * `ClearNulls`' unguarded page-level check — see `docs/TEXTOOLS_BUGS.md` #22's "TTMP wizard path
   * is unaffected" note. Default `false`/absent: every existing caller keeps building one option. */
  optionless?: boolean;
}

/** The one ModsJson every group's sole option points at across every pack `writeTtmp2Pack` builds —
 * the page/group STRUCTURE is what these fixtures probe, never the payload content, so one shared
 * dummy entry (same gamePath, same offset into the shared `DUMMY_PAYLOAD` blob) is deliberately
 * reused everywhere, including across multiple groups in the same pack. Kept EXACTLY as it always
 * was (do not edit `Name`, see `MULTI_PAGE_MODS_JSON` below) — every existing single-page fixture's
 * bytes, and cached golden, are keyed off it. */
const DUMMY_MODS_JSON = {
  Name: "Dummy",
  Category: "Unknown",
  FullPath: DUMMY_GAME_PATH,
  ModOffset: 0,
  ModSize: DUMMY_PAYLOAD.length,
  DatFile: "040000",
  IsDefault: false,
};

/** Same shape as `DUMMY_MODS_JSON`, `Name` only, for `writeTtmp2MultiPage`'s fixtures instead.
 * `WriteWizardPack`'s `AddFile` (TTMPWriter.cs) RE-DERIVES `ModsJson.Name`/`.Category` from the
 * game path on write (docs/backlog/2026-07-13-resave-ttmp2-name-category.md — a real, unrelated
 * writer gap our port doesn't reproduce, so we round-trip the source's declared value instead). For
 * `DUMMY_GAME_PATH`, an unresolvable path, that re-derivation lands on `"Unknown"` — empirically
 * confirmed against the ConsoleTools /resave golden for all four page-renumbering fixtures,
 * 2026-08-04. Declaring it here up front means these structure-only fixtures don't inherit that
 * unrelated gap's diff at all, rather than needing a baseline entry for it. */
const MULTI_PAGE_MODS_JSON = { ...DUMMY_MODS_JSON, Name: "Unknown" };

/** Shared by `writeTtmp2Pack` and `writeTtmp2MultiPage` — same object-literal shape either always
 * built inline before this was extracted, so hoisting it changes no emitted byte. */
function buildModGroups(
  groups: SyntheticTtmpGroup[],
  modsJson = DUMMY_MODS_JSON,
) {
  return groups.map((g) => {
    const sel =
      g.selectionType === undefined ? {} : { SelectionType: g.selectionType };
    return {
      GroupName: g.name,
      ...sel,
      OptionList: g.optionless
        ? []
        : [
            {
              Name: "On",
              Description: "",
              ImagePath: "",
              GroupName: g.name,
              ...sel,
              IsChecked: false,
              ModsJsons: [modsJson],
            },
          ],
    };
  });
}

/** Writes a one-page wizard .ttmp2 into test/corpus/<root>/ (gitignored, like the real corpus;
 * `root` defaults to "synthetic" — see pmp-builder.ts's SyntheticRoot). Every group gets one
 * option carrying the same dummy payload (unless `optionless`, see `SyntheticTtmpGroup`). */
export function writeTtmp2Pack(
  fileName: string,
  packName: string,
  groups: SyntheticTtmpGroup[],
  root: SyntheticRoot = "synthetic",
): void {
  const mpl = {
    TTMPVersion: "2.1w",
    Name: packName,
    Author: "synthetic",
    Version: "1.0.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    ModPackPages: [{ PageIndex: 0, ModGroups: buildModGroups(groups) }],
  };

  const outDir = join(CORPUS_DIR, root);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, fileName);
  writeFileSync(
    out,
    zipSync(
      {
        "TTMPL.mpl": new TextEncoder().encode(JSON.stringify(mpl)),
        "TTMPD.mpd": DUMMY_PAYLOAD,
      },
      { mtime: FIXED_MTIME },
    ),
  );
  console.log("wrote", out);
}

export interface SyntheticTtmpPage {
  /** The DECLARED `ModPackPageJson.PageIndex` (:39 above). For a TTMP source this is decorative —
   * `WizardPageEntry.FromWizardModpackPage` (WizardData.cs:977-990) reads it only to build a
   * display name — so a sparse, duplicated, or out-of-array-order value is legal input and exactly
   * what the fixtures in build-synthetic-empty-group.ts (design spec §1.3) probe. */
  pageIndex: number;
  groups: SyntheticTtmpGroup[];
}

/** Writes a MULTI-page wizard .ttmp2. Page IDENTITY for a TTMP source is POSITIONAL, not the
 * declared `pageIndex`: `WizardData.FromWizardTtmp` (:1180-1184) appends one `DataPages` entry per
 * `ModPackPages` array element in ARRAY order, and `WriteWizardPack` (:1332-1357) then calls
 * `ClearNulls()`, skips `!page.HasData` survivors, and renumbers what's left with a dense counter
 * over `DataPages` in that same order — never sorting and never consulting the declared value. So
 * `pages` here is emitted in exactly the array order given, whatever each entry's `pageIndex` claims
 * — see this module's four `pageIndex`-probe fixtures for what that does and does not preserve. */
export function writeTtmp2MultiPage(
  fileName: string,
  packName: string,
  pages: SyntheticTtmpPage[],
  root: SyntheticRoot = "synthetic",
): void {
  const mpl = {
    TTMPVersion: "2.1w",
    Name: packName,
    Author: "synthetic",
    Version: "1.0.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    ModPackPages: pages.map((p) => ({
      PageIndex: p.pageIndex,
      ModGroups: buildModGroups(p.groups, MULTI_PAGE_MODS_JSON),
    })),
  };

  const outDir = join(CORPUS_DIR, root);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, fileName);
  writeFileSync(
    out,
    zipSync(
      {
        "TTMPL.mpl": new TextEncoder().encode(JSON.stringify(mpl)),
        "TTMPD.mpd": DUMMY_PAYLOAD,
      },
      { mtime: FIXED_MTIME },
    ),
  );
  console.log("wrote", out);
}

/** Writes a one-page, one-group, one-option wizard .ttmp2 carrying arbitrary payloads, for
 *  fixtures whose point is the FILE CONTENT rather than the group structure writeTtmp2Pack
 *  exercises. Each file's bytes are SQPACK-compressed into the .mpd and pointed at by its own
 *  ModsJson (TTMP.cs:378/:488). Same pinned mtime, key order, and `root` parameter as
 *  writeTtmp2Pack, and for the same reasons — see this file's header. */
export function writeTtmp2Files(
  fileName: string,
  packName: string,
  files: { gamePath: string; data: Uint8Array }[],
  root: SyntheticRoot = "synthetic",
  /** Gates TexTools' LOAD-time fixes: `TTMP.cs · DoesModpackNeedFix · 918-932` returns
   *  NeedsTexFix|NeedsMdlFix for major < 2, NeedsTexFix alone for exactly "2.0", and None for
   *  anything newer. Defaults to the modern "2.1w" every other fixture uses — do NOT change that
   *  default, their cached goldens are keyed on sha256(pack bytes). */
  ttmpVersion = "2.1w",
): void {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const modsJsons = files.map((f) => {
    const blob = encodeSqPackFile(f.data, SqPackType.Standard);
    const entry = {
      Name: "Dummy",
      Category: "Unknown",
      FullPath: f.gamePath,
      ModOffset: offset,
      ModSize: blob.length,
      DatFile: "040000",
      IsDefault: false,
    };
    chunks.push(blob);
    offset += blob.length;
    return entry;
  });
  const mpd = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) {
    mpd.set(c, o);
    o += c.length;
  }
  const mpl = {
    TTMPVersion: ttmpVersion,
    Name: packName,
    Author: "synthetic",
    Version: "1.0.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    ModPackPages: [
      {
        PageIndex: 0,
        ModGroups: [
          {
            GroupName: "Main",
            OptionList: [
              {
                Name: "On",
                Description: "",
                ImagePath: "",
                GroupName: "Main",
                IsChecked: false,
                ModsJsons: modsJsons,
              },
            ],
          },
        ],
      },
    ],
  };

  const outDir = join(CORPUS_DIR, root);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, fileName);
  writeFileSync(
    out,
    zipSync(
      {
        "TTMPL.mpl": new TextEncoder().encode(JSON.stringify(mpl)),
        "TTMPD.mpd": mpd,
      },
      { mtime: FIXED_MTIME },
    ),
  );
  console.log("wrote", out);
}
