import { describe, expect, it } from "vitest";
import { readZip, writeZip } from "../../src/zip/zip";
import { diffArchives } from "./upgrade-archive-diff";

const enc = new TextEncoder();
function pmp(members: Record<string, unknown | Uint8Array>): Uint8Array {
  const m = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(members)) {
    m.set(k, v instanceof Uint8Array ? v : enc.encode(JSON.stringify(v)));
  }
  return writeZip(m, { store: true });
}

const META = { FileVersion: 3, Name: "X" };
const DEF = { Files: {}, FileSwaps: {}, Manipulations: [] };

describe("diffArchives", () => {
  it("returns no diffs when manifests are semantically equal despite formatting", () => {
    const a = pmp({ "meta.json": META, "default_mod.json": DEF });
    // same data, different key order + whitespace
    const b = new Map<string, Uint8Array>([
      ["meta.json", enc.encode('{\n  "Name":"X",\n  "FileVersion":3\n}')],
      ["default_mod.json", enc.encode(JSON.stringify(DEF))],
    ]);
    expect(diffArchives(a, writeZip(b, { store: true }))).toEqual([]);
  });

  it("flags a structure diff when a group_*.json name differs (F1 class)", () => {
    const g = { Name: "G", Type: "Single", Options: [] };
    const ours = pmp({
      "meta.json": META,
      "default_mod.json": DEF,
      "group_001_G.json": g,
    });
    const golden = pmp({
      "meta.json": META,
      "default_mod.json": DEF,
      "group_001_g.json": g,
    });
    const diffs = diffArchives(ours, golden);
    expect(diffs).toContainEqual({
      kind: "structure",
      gamePath: "group_001_G.json",
      index: 0,
      status: "removed",
      detail: undefined,
    });
    expect(diffs).toContainEqual({
      kind: "structure",
      gamePath: "group_001_g.json",
      index: 0,
      status: "added",
      detail: undefined,
    });
  });

  it("flags a manifest content mismatch (wrong option assignment / metadata)", () => {
    const ours = pmp({
      "meta.json": { ...META, Name: "WRONG" },
      "default_mod.json": DEF,
    });
    const golden = pmp({ "meta.json": META, "default_mod.json": DEF });
    expect(diffArchives(ours, golden)).toContainEqual({
      kind: "manifest",
      gamePath: "meta.json#/Name",
      index: 0,
      status: "mismatch",
      detail: undefined,
    });
  });

  it("reports each differing manifest key separately, so one blessed diff cannot hide another", () => {
    const ours = pmp({ "meta.json": { Name: "a", Version: "1" } });
    const golden = pmp({ "meta.json": { Name: "b", Version: "2" } });
    const diffs = diffArchives(ours, golden);
    expect(diffs.map((d) => d.gamePath).sort()).toEqual([
      "meta.json#/Name",
      "meta.json#/Version",
    ]);
  });

  it("normalizes ModOffset/ModSize out of the TTMPL.mpl before comparing", () => {
    const mplOurs = {
      TTMPVersion: "2.1s",
      SimpleModsList: [{ FullPath: "a.tex", ModOffset: 0, ModSize: 100 }],
    };
    const mplGolden = {
      TTMPVersion: "2.1s",
      SimpleModsList: [{ FullPath: "a.tex", ModOffset: 4096, ModSize: 128 }],
    };
    const ours = pmp({
      "TTMPL.mpl": mplOurs,
      "TTMPD.mpd": new Uint8Array([1, 2, 3]),
    });
    const golden = pmp({
      "TTMPL.mpl": mplGolden,
      "TTMPD.mpd": new Uint8Array([9]),
    });
    expect(diffArchives(ours, golden)).toEqual([]); // offsets/sizes AND the .mpd blob are ignored here
  });
});

// Regression coverage for the hole the (now-removed) orphan-payload-member heuristic used to patch:
// `dropConfirmedAbsentKeys` only ever inspects `Files` KEYS, so a payload member silently lost for
// any other reason — e.g. an `ExtraFile` (PMP.cs:213-215, a preview image or readme no `Files`/`Image`
// field ever names) that a reader/writer bug drops from the archive without touching any manifest —
// was invisible to the manifest-only comparison. Before `checkPayloadMembers` existed, `diffArchives`
// never looked at non-manifest member NAMES at all, so this scenario returned `[]`.
describe("diffArchives payload-member comparison (replaces the orphan-payload-member guard)", () => {
  it("catches a silently-lost unreferenced (ExtraFile) payload member on a no-op golden", () => {
    const golden = pmp({
      "meta.json": META,
      "default_mod.json": DEF,
      "preview.png": new Uint8Array([9, 9, 9]), // an ExtraFile: no Files/Image field names it
    });
    // Simulates a writer/reader bug silently dropping the extra — nothing about `Files` changed.
    const ours = pmp({ "meta.json": META, "default_mod.json": DEF });
    expect(diffArchives(ours, golden, /* checkPayloadMembers */ true)).toEqual([
      {
        kind: "structure",
        gamePath: "preview.png",
        index: 0,
        status: "added",
        detail: undefined,
      },
    ]);
  });

  it("is inert on a non-noop (real-golden) comparison, per BACKLOG's writer-regenerates-names divergence", () => {
    // Same silent loss, but with checkPayloadMembers left off (the non-noop branch) — deliberately
    // not compared there; see diffArchives' doc comment.
    const golden = pmp({
      "meta.json": META,
      "default_mod.json": DEF,
      "preview.png": new Uint8Array([9, 9, 9]),
    });
    const ours = pmp({ "meta.json": META, "default_mod.json": DEF });
    expect(diffArchives(ours, golden)).toEqual([]);
  });

  it("does not flag legitimate ExtraFiles present on both sides (e.g. many preview images)", () => {
    const golden = pmp({
      "meta.json": META,
      "default_mod.json": DEF,
      "Images/1.png": new Uint8Array([1]),
      "Images/2.png": new Uint8Array([2]),
    });
    const ours = pmp({
      "meta.json": META,
      "default_mod.json": DEF,
      "Images/1.png": new Uint8Array([1]),
      "Images/2.png": new Uint8Array([2]),
    });
    expect(diffArchives(ours, golden, true)).toEqual([]);
  });

  it("tolerates a spelling-only difference in a payload member name (looseKey), not a real loss", () => {
    const golden = pmp({
      "meta.json": META,
      "default_mod.json": DEF,
      "Read Me.txt": new Uint8Array([1]),
    });
    const ours = pmp({
      "meta.json": META,
      "default_mod.json": DEF,
      "readme.txt": new Uint8Array([1]), // same file, case + space differ
    });
    expect(diffArchives(ours, golden, true)).toEqual([]);
  });
});

describe("diffArchives absent-file drop (PMP.cs:883-888)", () => {
  const enc = new TextEncoder();
  const PRESENT = "chara/equipment/e0001/model/c0101e0001_top.mdl";
  const ABSENT = "chara/equipment/e0002/model/c0101e0002_top.mdl";

  /** `files` is the option's Files map; `members` the payload members actually in the archive. */
  function archive(
    files: Record<string, string>,
    members: Record<string, Uint8Array>,
  ): Uint8Array {
    const meta = { FileVersion: 3, Name: "A", Author: "t", ModTags: [] };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      [
        "default_mod.json",
        enc.encode(
          JSON.stringify({
            Version: 0,
            Files: files,
            FileSwaps: {},
            Manipulations: [],
          }),
        ),
      ],
    ]);
    for (const [name, bytes] of Object.entries(members))
      entries.set(name, bytes);
    return writeZip(entries);
  }

  const payload = new Uint8Array([1, 2, 3]);
  const bothKeys = {
    [PRESENT]: `on\\${PRESENT.replace(/\//g, "\\")}`,
    [ABSENT]: `on\\${ABSENT.replace(/\//g, "\\")}`,
  };
  const oneKey = { [PRESENT]: `on\\${PRESENT.replace(/\//g, "\\")}` };

  it("confirms a dropped key whose payload is genuinely absent from the golden", () => {
    // Golden = the noop reference (the input pack): lists ABSENT but never contained its member.
    const golden = archive(bothKeys, { [`on/${PRESENT}`]: payload });
    const ours = archive(oneKey, { [`on/${PRESENT}`]: payload });
    expect(diffArchives(ours, golden)).toEqual([]);
  });

  it("REJECTS a dropped key whose payload IS present in the golden", () => {
    const golden = archive(bothKeys, {
      [`on/${PRESENT}`]: payload,
      [`on/${ABSENT}`]: payload,
    });
    const ours = archive(oneKey, { [`on/${PRESENT}`]: payload });
    expect(diffArchives(ours, golden)).toHaveLength(1);
  });

  it("REJECTS a dropped key that only LOOKS absent (resolves under the confirmation's own looseKey)", () => {
    // The member is stored with display case + a trailing dot stripped — a correct reader would
    // resolve it, so it is NOT absent and dropping it is a real bug, not the PMP.cs:883 drop. This
    // scenario is exactly the one a SHARED reader/confirmation key function could never catch: the
    // "ours" side here is constructed directly (standing in for whatever a reader — buggy or not —
    // produced), so the confirmation's OWN resolution has to reject it independently. Because
    // dropConfirmedAbsentKeys uses `looseKey`, not the reader's `windowsPathKey`, this holds even if
    // a future regression breaks windowsPathKey's case-fold/trailing-dot handling in the reader.
    const value = `On.\\${ABSENT.replace(/\//g, "\\")}`;
    const golden = archive(
      { ...oneKey, [ABSENT]: value },
      { [`on/${PRESENT}`]: payload, [`On/${ABSENT}`]: payload },
    );
    const ours = archive(oneKey, { [`on/${PRESENT}`]: payload });
    expect(diffArchives(ours, golden)).toHaveLength(1);
  });

  it("REJECTS an added key: ours has a Files key the golden lacks", () => {
    // The inverse direction: ours carries an EXTRA Files key (and payload member) the golden never
    // had at all. dropConfirmedAbsentKeys only prunes GOLDEN entries missing from ours, so this must
    // still surface as a mismatch rather than being silently accepted.
    const golden = archive(oneKey, { [`on/${PRESENT}`]: payload });
    const ours = archive(bothKeys, {
      [`on/${PRESENT}`]: payload,
      [`on/${ABSENT}`]: payload,
    });
    expect(diffArchives(ours, golden)).toHaveLength(1);
  });

  it("REJECTS a changed value even when another key is a confirmed drop", () => {
    const golden = archive(bothKeys, { [`on/${PRESENT}`]: payload });
    const ours = archive(
      { [PRESENT]: "somewhere\\else.mdl" },
      { [`on/${PRESENT}`]: payload },
    );
    expect(diffArchives(ours, golden)).toHaveLength(1);
  });

  it("REJECTS an unrelated field difference alongside a confirmed drop", () => {
    const golden = archive(bothKeys, { [`on/${PRESENT}`]: payload });
    const ours = readZip(archive(oneKey, { [`on/${PRESENT}`]: payload }));
    ours.set(
      "default_mod.json",
      enc.encode(
        JSON.stringify({
          Version: 1, // <- differs
          Files: oneKey,
          FileSwaps: {},
          Manipulations: [],
        }),
      ),
    );
    expect(diffArchives(writeZip(ours), golden)).toHaveLength(1);
  });
});

// group_NNN.json coverage: the option() helper is shared with default_mod.json but pairs options
// by index inside an Options array. Regression coverage for the argument-inversion bug where the
// group branch called option(golden, ours) instead of option(ours, golden) — the swap made the
// group check compare `ours` against itself (always equal), silently disabling it entirely.
describe("diffArchives absent-file drop — group_NNN.json (PMP.cs:883-888)", () => {
  const PRESENT = "chara/equipment/e0001/model/c0101e0001_top.mdl";
  const ABSENT = "chara/equipment/e0002/model/c0101e0002_top.mdl";
  const payload = new Uint8Array([1, 2, 3]);

  const zipVal = (p: string) => `on\\${p.replace(/\//g, "\\")}`;
  const bothKeys = { [PRESENT]: zipVal(PRESENT), [ABSENT]: zipVal(ABSENT) };
  const oneKey = { [PRESENT]: zipVal(PRESENT) };

  function option(
    name: string,
    priority: number,
    files: Record<string, string>,
  ) {
    return {
      Name: name,
      Description: "",
      Image: "",
      Priority: priority,
      Files: files,
      FileSwaps: {},
      Manipulations: [],
    };
  }

  /** Two-option group_001_G.json plus meta.json; `members` are the payload entries in the zip. */
  function groupArchive(
    options: unknown[],
    members: Record<string, Uint8Array>,
  ): Uint8Array {
    const meta = { FileVersion: 3, Name: "A", Author: "t", ModTags: [] };
    const group = {
      Name: "G",
      Description: "",
      Image: "",
      Page: 0,
      Priority: 0,
      Type: "Single",
      DefaultSettings: 0,
      Options: options,
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["group_001_G.json", enc.encode(JSON.stringify(group))],
    ]);
    for (const [name, bytes] of Object.entries(members))
      entries.set(name, bytes);
    return writeZip(entries);
  }

  it("CONFIRM: a genuinely-absent Files key dropped from one option ⇒ no diff", () => {
    const goldenOpts = [
      option("Opt A", 0, bothKeys), // ABSENT never has a payload member on either side
      option("Opt B", 1, oneKey),
    ];
    const oursOpts = [option("Opt A", 0, oneKey), option("Opt B", 1, oneKey)];
    const golden = groupArchive(goldenOpts, { [`on/${PRESENT}`]: payload });
    const ours = groupArchive(oursOpts, { [`on/${PRESENT}`]: payload });
    expect(diffArchives(ours, golden)).toEqual([]);
  });

  it("REJECT: a dropped key whose payload IS present in the golden", () => {
    const goldenOpts = [
      option("Opt A", 0, bothKeys),
      option("Opt B", 1, oneKey),
    ];
    const oursOpts = [option("Opt A", 0, oneKey), option("Opt B", 1, oneKey)];
    const golden = groupArchive(goldenOpts, {
      [`on/${PRESENT}`]: payload,
      [`on/${ABSENT}`]: payload, // ABSENT's payload actually exists in the golden
    });
    const ours = groupArchive(oursOpts, { [`on/${PRESENT}`]: payload });
    expect(diffArchives(ours, golden)).toHaveLength(1);
  });

  it("REJECT: a Files value we changed", () => {
    const goldenOpts = [option("Opt A", 0, oneKey), option("Opt B", 1, oneKey)];
    const oursOpts = [
      option("Opt A", 0, { [PRESENT]: "somewhere\\else.mdl" }),
      option("Opt B", 1, oneKey),
    ];
    const golden = groupArchive(goldenOpts, { [`on/${PRESENT}`]: payload });
    const ours = groupArchive(oursOpts, { [`on/${PRESENT}`]: payload });
    expect(diffArchives(ours, golden)).toHaveLength(1);
  });

  it("REJECT: a sibling option that differs (Name)", () => {
    const goldenOpts = [option("Opt A", 0, oneKey), option("Opt B", 1, oneKey)];
    const oursOpts = [
      option("Opt A", 0, oneKey),
      option("Opt B WRONG", 1, oneKey),
    ];
    const golden = groupArchive(goldenOpts, { [`on/${PRESENT}`]: payload });
    const ours = groupArchive(oursOpts, { [`on/${PRESENT}`]: payload });
    expect(diffArchives(ours, golden)).toHaveLength(1);
  });

  it("REJECT: a sibling option whose Files differs", () => {
    const goldenOpts = [option("Opt A", 0, oneKey), option("Opt B", 1, oneKey)];
    const oursOpts = [
      option("Opt A", 0, oneKey),
      option("Opt B", 1, { [PRESENT]: "somewhere\\else.mdl" }),
    ];
    const golden = groupArchive(goldenOpts, { [`on/${PRESENT}`]: payload });
    const ours = groupArchive(oursOpts, { [`on/${PRESENT}`]: payload });
    expect(diffArchives(ours, golden)).toHaveLength(1);
  });

  it("REJECT: a non-Files field differing (Priority)", () => {
    const goldenOpts = [option("Opt A", 0, oneKey), option("Opt B", 1, oneKey)];
    const oursOpts = [option("Opt A", 0, oneKey), option("Opt B", 2, oneKey)];
    const golden = groupArchive(goldenOpts, { [`on/${PRESENT}`]: payload });
    const ours = groupArchive(oursOpts, { [`on/${PRESENT}`]: payload });
    expect(diffArchives(ours, golden)).toHaveLength(1);
  });
});
