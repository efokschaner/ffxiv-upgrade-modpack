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

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "corpus",
  "synthetic",
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
}

/** Writes a one-page wizard .ttmp2 into test/corpus/synthetic/ (gitignored, like the real corpus).
 * Every group gets one option carrying the same dummy payload. */
export function writeTtmp2Pack(
  fileName: string,
  packName: string,
  groups: SyntheticTtmpGroup[],
): void {
  const modsJson = {
    Name: "Dummy",
    Category: "Unknown",
    FullPath: DUMMY_GAME_PATH,
    ModOffset: 0,
    ModSize: DUMMY_PAYLOAD.length,
    DatFile: "040000",
    IsDefault: false,
  };
  const modGroups = groups.map((g) => {
    const sel =
      g.selectionType === undefined ? {} : { SelectionType: g.selectionType };
    return {
      GroupName: g.name,
      ...sel,
      OptionList: [
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
  const mpl = {
    TTMPVersion: "2.1w",
    Name: packName,
    Author: "synthetic",
    Version: "1.0.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    ModPackPages: [{ PageIndex: 0, ModGroups: modGroups }],
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, fileName);
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
 *  ModsJson (TTMP.cs:378/:488). Same pinned mtime and key order as writeTtmp2Pack, and for the
 *  same reasons — see this file's header. */
export function writeTtmp2Files(
  fileName: string,
  packName: string,
  files: { gamePath: string; data: Uint8Array }[],
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
    TTMPVersion: "2.1w",
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

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, fileName);
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
