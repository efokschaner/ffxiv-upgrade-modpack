import { describe, expect, it } from "vitest";
import type {
  PmpGroupJsonRaw,
  PmpMetaJsonRaw,
  PmpOptionJsonRaw,
} from "../../src/container/manifest-types";
import { readPmp } from "../../src/container/pmp";
import { allFiles, allGroups } from "../../src/model/modpack";
import { writeZip } from "../../src/zip/zip";

const enc = new TextEncoder();
const j = (v: unknown): Uint8Array => enc.encode(JSON.stringify(v, null, 2));

const PAYLOAD = new Uint8Array([1, 2, 3]);
const GAME_PATH = "chara/equipment/e0001/texture/v01_c0101e0001_top_d.tex";
const ZIP_PATH = "on/chara/equipment/e0001/texture/v01_c0101e0001_top_d.tex";

function v4Group(): PmpGroupJsonRaw {
  return {
    Version: 0,
    Name: "Inline Group",
    Description: "",
    Image: "",
    Page: 0,
    Priority: 0,
    Type: "Single",
    DefaultSettings: 0,
    Identifier: "3042888a-1c24-405a-934b-8465061e5162",
    Options: [
      {
        Name: "On",
        Description: "",
        Image: "",
        Files: { [GAME_PATH]: ZIP_PATH.replace(/\//g, "\\") },
      } satisfies PmpOptionJsonRaw,
    ],
  };
}

function v4Meta(over: PmpMetaJsonRaw = {}): PmpMetaJsonRaw {
  return {
    FileVersion: 4,
    Name: "V4 Pack",
    Author: "synthetic",
    Description: "",
    Version: "1.0.0",
    Website: "",
    Image: "",
    Identifier: "5ffd6e85-ae4c-4446-8ed3-ca556ad6bcf3",
    LastWrite: "2026-08-06T04:41:11.0160172-07:00",
    ModTags: [],
    Groups: [v4Group()],
    DefaultData: { Version: 0 },
    ...over,
  };
}

/** A v4 archive: meta.json + payload only. No default_mod.json, no group_NNN.json — exactly what
 *  PMP.WritePmp (PMP.cs:908-962) emits now that :946-955 is commented out. */
function v4Archive(meta: PmpMetaJsonRaw = v4Meta()): Uint8Array {
  return writeZip(
    new Map<string, Uint8Array>([
      ["meta.json", j(meta)],
      [ZIP_PATH, PAYLOAD],
    ]),
  );
}

describe("readPmp v4 (PMP.cs · LoadPMP · 159-291)", () => {
  it("loads a v4 pack with no default_mod.json (PMP.cs:182 File.Exists guard)", () => {
    const groups = allGroups(readPmp(v4Archive()));
    expect(groups.map((g) => g.name)).toEqual(["Inline Group"]);
    expect(groups[0]!.options.map((o) => o.name)).toEqual(["On"]);
  });

  it("resolves an inline group's payload through the pull-back (PMP.cs:217-225)", () => {
    const byPath = new Map(
      allFiles(readPmp(v4Archive())).map(({ gamePath, file }) => [
        gamePath,
        file.data,
      ]),
    );
    expect(byPath.get(GAME_PATH)).toEqual(PAYLOAD);
  });

  it("synthesizes the Default page from meta.DefaultData, not default_mod.json", () => {
    const meta = v4Meta({
      DefaultData: {
        Version: 0,
        Files: { [GAME_PATH]: ZIP_PATH.replace(/\//g, "\\") },
      },
    });
    // WizardData.cs:1137-1157 unshifts the synthesized "Default" group onto the FRONT.
    expect(allGroups(readPmp(v4Archive(meta))).map((g) => g.name)).toEqual([
      "Default",
      "Inline Group",
    ]);
  });

  it("branches on CONTENT, not FileVersion: a v4-numbered pack with empty Groups and null DefaultData takes the v3 path (PMP.cs:217)", () => {
    const archive = writeZip(
      new Map<string, Uint8Array>([
        ["meta.json", j(v4Meta({ Groups: [], DefaultData: null }))],
        ["group_001_disk.json", j({ ...v4Group(), Name: "Disk Group" })],
        [ZIP_PATH, PAYLOAD],
      ]),
    );
    expect(allGroups(readPmp(archive)).map((g) => g.name)).toEqual([
      "Disk Group",
    ]);
  });

  it("discards on-disk group_*.json when the pull-back fires (PMP.cs:220 replaces pmp.Groups wholesale)", () => {
    const archive = writeZip(
      new Map<string, Uint8Array>([
        ["meta.json", j(v4Meta())],
        ["group_001_disk.json", j({ ...v4Group(), Name: "Disk Group" })],
        [ZIP_PATH, PAYLOAD],
      ]),
    );
    expect(allGroups(readPmp(archive)).map((g) => g.name)).toEqual([
      "Inline Group",
    ]);
  });

  it("throws LoadPMP's compatibility message when enforceCompatibility is set (PMP.cs:176-179)", () => {
    expect(() => readPmp(v4Archive(), { enforceCompatibility: true })).toThrow(
      "Cannot ingest PMP File Version in enforced compatibility mode 4+.",
    );
  });

  it("does NOT throw for a v3 pack under enforceCompatibility (the gate is `> 3`, PMP.cs:176)", () => {
    expect(() =>
      readPmp(v4Archive(v4Meta({ FileVersion: 3 })), {
        enforceCompatibility: true,
      }),
    ).not.toThrow();
  });

  it("still validates a DISCARDED group file's Type (PMP.cs:252 touches g.Options -> :1517 throws)", () => {
    const archive = writeZip(
      new Map<string, Uint8Array>([
        ["meta.json", j(v4Meta())],
        ["group_001_broken.json", j({ ...v4Group(), Type: "Nonsense" })],
        [ZIP_PATH, PAYLOAD],
      ]),
    );
    expect(() => readPmp(archive)).toThrow(
      "Unimplemented PMP group type: Nonsense",
    );
  });
});

// ---- INTENTIONAL DIVERGENCE from TexTools bug #23 (operator ruling, 2026-08-06) ----
// See docs/TEXTOOLS_BUGS.md #23 and the divergence block in readPmp (src/container/pmp.ts). These
// cases PIN the divergence's shape; they do not DISCHARGE AGENTS.md's evidence bar for it — the
// golden-harness confirmation rule and the in-game verification are both still outstanding.
describe("readPmp v4 ExtraFiles — the #23 divergence", () => {
  it("does NOT classify an inline group's payload as an ExtraFile (TexTools does; we read pmp.Groups, not the stale list)", () => {
    expect(readPmp(v4Archive()).extraFiles).toBeUndefined();
  });

  it("does NOT classify meta.DefaultData's payload as an ExtraFile either (PMP.cs:267-276 gets this right)", () => {
    const meta = v4Meta({
      Groups: [],
      DefaultData: {
        Version: 0,
        Files: { [GAME_PATH]: ZIP_PATH.replace(/\//g, "\\") },
      },
    });
    expect(readPmp(v4Archive(meta)).extraFiles).toBeUndefined();
  });

  it("still reports a genuinely unreferenced member as an ExtraFile", () => {
    const archive = writeZip(
      new Map<string, Uint8Array>([
        ["meta.json", j(v4Meta())],
        [ZIP_PATH, PAYLOAD],
        ["images/preview.png", new Uint8Array([9])],
      ]),
    );
    expect([...(readPmp(archive).extraFiles?.keys() ?? [])]).toEqual([
      "images/preview.png",
    ]);
  });

  it("does NOT count a DISCARDED on-disk group's Files as referenced — the other arm of the same stale-list read", () => {
    const archive = writeZip(
      new Map<string, Uint8Array>([
        ["meta.json", j(v4Meta())],
        [
          "group_001_disk.json",
          j({
            ...v4Group(),
            Name: "Disk Group",
            Options: [
              { Name: "D", Files: { "chara/other.tex": "disk\\other.tex" } },
            ],
          }),
        ],
        [ZIP_PATH, PAYLOAD],
        ["disk/other.tex", new Uint8Array([9])],
      ]),
    );
    // TexTools counts the discarded group (PMP.cs:234) and would NOT list this member; we do,
    // because the group it belongs to was thrown away and nothing in the loaded pack names it.
    expect([...(readPmp(archive).extraFiles?.keys() ?? [])]).toEqual([
      "disk/other.tex",
    ]);
  });
});
