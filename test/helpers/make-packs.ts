import type {
  ModPackJson,
  OriginalModPackJson,
} from "../../src/container/manifest-types";
import type { ModpackFile } from "../../src/model/modpack";
import { writeZip } from "../../src/zip/zip";

const enc = new TextEncoder();

/** Build an option's files Map from ordered [gamePath, file] entries, insertion order preserved. */
export function filesMap(
  entries: Array<[string, ModpackFile]>,
): Map<string, ModpackFile> {
  return new Map(entries);
}

export interface SyntheticPack {
  name: string;
  bytes: Uint8Array;
  expectedFiles: Record<string, Uint8Array>; // gamePath -> exact inner bytes
}

// Fake SQPack-ish blobs; opaque to our code, so any distinct bytes work.
const FILE_A = new Uint8Array([0xaa, 0x01, 0x02, 0x03, 0x04]);
const FILE_B = new Uint8Array([0xbb, 0x10, 0x20, 0x30]);
const PATH_A = "chara/human/c0101/obj/body/b0001/model/c0101b0001.mdl";
const PATH_B =
  "chara/human/c0101/obj/body/b0001/material/v0001/mt_c0101b0001_a.mtrl";

function mpd(...parts: Uint8Array[]): {
  blob: Uint8Array;
  offsets: number[];
  sizes: number[];
} {
  const offsets: number[] = [];
  const sizes: number[] = [];
  let off = 0;
  const out: number[] = [];
  for (const p of parts) {
    offsets.push(off);
    sizes.push(p.length);
    out.push(...p);
    off += p.length;
  }
  return { blob: new Uint8Array(out), offsets, sizes };
}

export function makeTtmp2Simple(): SyntheticPack {
  const { blob, offsets, sizes } = mpd(FILE_A, FILE_B);
  const mpl: ModPackJson = {
    TTMPVersion: "2.1s",
    Name: "Synth Simple",
    Author: "test",
    Version: "1.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    SimpleModsList: [
      {
        Name: "Body",
        Category: "Body",
        FullPath: PATH_A,
        ModOffset: offsets[0]!,
        ModSize: sizes[0]!,
        DatFile: "040000.win32.dat0",
        IsDefault: false,
      },
      {
        Name: "Mat",
        Category: "Material",
        FullPath: PATH_B,
        ModOffset: offsets[1]!,
        ModSize: sizes[1]!,
        DatFile: "040000.win32.dat0",
        IsDefault: false,
      },
    ],
  };
  const entries = new Map<string, Uint8Array>([
    ["TTMPL.mpl", enc.encode(JSON.stringify(mpl))],
    ["TTMPD.mpd", blob],
  ]);
  return {
    name: "synth-simple.ttmp2",
    bytes: writeZip(entries),
    expectedFiles: { [PATH_A]: FILE_A, [PATH_B]: FILE_B },
  };
}

export function makeTtmp2Wizard(): SyntheticPack {
  const { blob, offsets, sizes } = mpd(FILE_A, FILE_B);
  const mpl: ModPackJson = {
    TTMPVersion: "2.1w",
    Name: "Synth Wizard",
    Author: "test",
    Version: "1.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    ModPackPages: [
      {
        PageIndex: 0,
        ModGroups: [
          {
            GroupName: "Choice",
            SelectionType: "Single",
            OptionList: [
              {
                Name: "A",
                Description: "",
                ImagePath: "",
                GroupName: "Choice",
                SelectionType: "Single",
                ModsJsons: [
                  {
                    Name: "Body",
                    Category: "Body",
                    FullPath: PATH_A,
                    ModOffset: offsets[0]!,
                    ModSize: sizes[0]!,
                    DatFile: "040000.win32.dat0",
                    IsDefault: false,
                  },
                ],
              },
              {
                Name: "B",
                Description: "",
                ImagePath: "",
                GroupName: "Choice",
                SelectionType: "Single",
                ModsJsons: [
                  {
                    Name: "Mat",
                    Category: "Material",
                    FullPath: PATH_B,
                    ModOffset: offsets[1]!,
                    ModSize: sizes[1]!,
                    DatFile: "040000.win32.dat0",
                    IsDefault: false,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const entries = new Map<string, Uint8Array>([
    ["TTMPL.mpl", enc.encode(JSON.stringify(mpl))],
    ["TTMPD.mpd", blob],
  ]);
  return {
    name: "synth-wizard.ttmp2",
    bytes: writeZip(entries),
    expectedFiles: { [PATH_A]: FILE_A, [PATH_B]: FILE_B },
  };
}

/** A 2-option **Single**-group (`G`, options `A`/`B`) wizard pack whose options' `IsChecked` is set
 *  per `checked`; an `undefined` entry omits the key entirely, so the C# `bool` field stays at its
 *  `false` default (ModPackJson.cs:189-198). Same file/blob construction as `makeTtmp2Wizard`. */
export function makeTtmp2WizardWithChecked(
  checked: Array<boolean | undefined>,
): SyntheticPack {
  const { blob, offsets, sizes } = mpd(FILE_A, FILE_B);
  const paths = [PATH_A, PATH_B];
  const names = ["A", "B"];
  const cats = ["Body", "Material"];
  const mpl: ModPackJson = {
    TTMPVersion: "2.1w",
    Name: "Synth Wizard Checked",
    Author: "test",
    Version: "1.0",
    Description: "",
    Url: "",
    MinimumFrameworkVersion: "1.3.0.0",
    ModPackPages: [
      {
        PageIndex: 0,
        ModGroups: [
          {
            GroupName: "G",
            SelectionType: "Single",
            OptionList: checked.map((isChecked, i) => ({
              Name: names[i]!,
              Description: "",
              ImagePath: "",
              GroupName: "G",
              SelectionType: "Single",
              // Omit the key entirely when `undefined` — the point of the fixture.
              ...(isChecked === undefined ? {} : { IsChecked: isChecked }),
              ModsJsons: [
                {
                  Name: names[i]!,
                  Category: cats[i]!,
                  FullPath: paths[i]!,
                  ModOffset: offsets[i]!,
                  ModSize: sizes[i]!,
                  DatFile: "040000.win32.dat0",
                  IsDefault: false,
                },
              ],
            })),
          },
        ],
      },
    ],
  };
  const entries = new Map<string, Uint8Array>([
    ["TTMPL.mpl", enc.encode(JSON.stringify(mpl))],
    ["TTMPD.mpd", blob],
  ]);
  return {
    name: "synth-wizard-checked.ttmp2",
    bytes: writeZip(entries),
    expectedFiles: { [PATH_A]: FILE_A, [PATH_B]: FILE_B },
  };
}

/** A minimal .pmp carrying one `group_001_G.json` of `optionCount` payload-less options named
 *  `O0..On`, with the given `Type` / `DefaultSettings`. `readPmp` always prepends the synthetic
 *  `Default` group from default_mod.json, so the group under test is `groups[1]`. */
export function makePmpWithGroup(opts: {
  Type: string;
  DefaultSettings: number;
  optionCount: number;
}): Uint8Array {
  const meta = {
    FileVersion: 3,
    Name: "Synth PMP Group",
    Author: "test",
    Description: "",
    Version: "1.0",
    Website: "",
    Image: "",
    ModTags: [],
  };
  const defaultMod = {
    Version: 0,
    Files: { [PATH_A]: PATH_A.replace(/\//g, "\\") },
    FileSwaps: {},
    Manipulations: [],
  };
  const group = {
    Version: 0,
    Name: "G",
    Description: "",
    Type: opts.Type,
    Priority: 0,
    DefaultSettings: opts.DefaultSettings,
    Options: Array.from({ length: opts.optionCount }, (_, i) => ({
      Name: `O${i}`,
      Description: "",
      Image: "",
      Files: {},
      FileSwaps: {},
      Manipulations: [],
    })),
  };
  const entries = new Map<string, Uint8Array>([
    ["meta.json", enc.encode(JSON.stringify(meta, null, 2))],
    ["default_mod.json", enc.encode(JSON.stringify(defaultMod, null, 2))],
    ["group_001_G.json", enc.encode(JSON.stringify(group, null, 2))],
    [PATH_A, FILE_A],
  ]);
  return writeZip(entries);
}

// A legacy .ttmp carries no TTMPVersion, so DoesModpackNeedFix treats it as pre-2.x and loadModpack
// now runs FixOldModel/FixOldTexData on its files at load. FILE_A/FILE_B are opaque garbage blobs
// (deliberately not real SQPack payloads), so a `.mdl`/`.tex` path here would be DROPPED by the fix
// (FixOldModel/FixOldTexData throw on garbage -> C# catch { continue }) — correct behaviour, but it
// would defeat this container round-trip fixture. Two material paths keep the fix a no-op so the
// reader->writer->reader round-trip still exercises every file.
const LEGACY_PATH_A =
  "chara/human/c0101/obj/body/b0001/material/v0001/mt_c0101b0001_top_a.mtrl";
const LEGACY_PATH_B =
  "chara/human/c0101/obj/body/b0001/material/v0001/mt_c0101b0001_top_b.mtrl";

export function makeLegacyTtmp(): SyntheticPack {
  const { blob, offsets, sizes } = mpd(FILE_A, FILE_B);
  const line1: OriginalModPackJson = {
    Name: "MatA",
    Category: "Material",
    FullPath: LEGACY_PATH_A,
    ModOffset: offsets[0]!,
    ModSize: sizes[0]!,
    DatFile: "040000.win32.dat0",
  };
  const line2: OriginalModPackJson = {
    Name: "MatB",
    Category: "Material",
    FullPath: LEGACY_PATH_B,
    ModOffset: offsets[1]!,
    ModSize: sizes[1]!,
    DatFile: "040000.win32.dat0",
  };
  const ndjson = `${JSON.stringify(line1)}\n${JSON.stringify(line2)}`;
  const entries = new Map<string, Uint8Array>([
    ["TTMPL.mpl", enc.encode(ndjson)],
    ["TTMPD.mpd", blob],
  ]);
  return {
    name: "synth.ttmp",
    bytes: writeZip(entries),
    expectedFiles: { [LEGACY_PATH_A]: FILE_A, [LEGACY_PATH_B]: FILE_B },
  };
}

export function makePmpZip(): SyntheticPack {
  const zipA = PATH_A.replace(/\//g, "\\");
  const zipB = PATH_B.replace(/\//g, "\\");
  const meta = {
    FileVersion: 3,
    Name: "Synth PMP",
    Author: "test",
    Description: "",
    Version: "1.0",
    Website: "",
    Image: "",
    ModTags: [],
  };
  const defaultMod = {
    Version: 0,
    Files: { [PATH_A]: zipA },
    FileSwaps: {},
    Manipulations: [],
  };
  const group = {
    Version: 0,
    Name: "Choice",
    Description: "",
    Type: "Single",
    Priority: 0,
    DefaultSettings: 0,
    Options: [
      {
        Name: "B",
        Description: "",
        Image: "",
        Files: { [PATH_B]: zipB },
        FileSwaps: {},
        Manipulations: [],
      },
    ],
  };
  const entries = new Map<string, Uint8Array>([
    ["meta.json", enc.encode(JSON.stringify(meta, null, 2))],
    ["default_mod.json", enc.encode(JSON.stringify(defaultMod, null, 2))],
    ["group_001_Choice.json", enc.encode(JSON.stringify(group, null, 2))],
    [PATH_A, FILE_A],
    [PATH_B, FILE_B],
  ]);
  return {
    name: "synth.pmp",
    bytes: writeZip(entries),
    expectedFiles: { [PATH_A]: FILE_A, [PATH_B]: FILE_B },
  };
}
