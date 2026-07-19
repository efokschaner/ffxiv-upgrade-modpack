import { describe, expect, it } from "vitest";
import { readZip, writeZip } from "../../src/zip/zip";
import { diffArchives, diffPayloadSemantic } from "./upgrade-archive-diff";

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

  it("does not compare payload member names when checkPayloadMembers is off (the TTMP branch)", () => {
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

// diffPayloadSemantic compares the redirect table resolveRedirects builds (archive-redirects.ts),
// keyed PER OPTION as `${manifestName}#${optionIndex}|${gamePath}` (redirectKey) rather than by bare
// gamePath — see that module's doc comment for why an archive-wide merge would silently hide a
// divergence between two mutually exclusive options that define the same gamePath. These fixtures
// all use a single option (group_001_g.json, index 0), so every reported key has the fixed prefix
// "group_001_g.json#0|" ahead of the gamePath under test.
describe("diffPayloadSemantic (layout-equivalent payload comparison)", () => {
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  const b = (...v: number[]) => new Uint8Array(v);
  const key = (gamePath: string) => `group_001_g.json#0|${gamePath}`;

  /** Members for a one-group pack whose single option maps `files` (gamePath -> member name). */
  function members(
    files: Record<string, string>,
    payload: Record<string, Uint8Array>,
  ): Map<string, Uint8Array> {
    const m = new Map<string, Uint8Array>();
    m.set("meta.json", enc({ FileVersion: 3, Name: "t" }));
    m.set(
      "group_001_g.json",
      enc({ Options: [{ Name: "On", Files: files, FileSwaps: {} }] }),
    );
    for (const [k, v] of Object.entries(payload)) m.set(k, v);
    return m;
  }

  it("accepts a common/N renumbering when the redirect table is identical", () => {
    const ours = members(
      { "chara/a.tex": "common\\1\\a.tex" },
      { "common/1/a.tex": b(1, 2) },
    );
    const golden = members(
      { "chara/a.tex": "common\\2\\a.tex" },
      { "common/2/a.tex": b(1, 2) },
    );
    expect(diffPayloadSemantic(ours, golden)).toEqual([]);
  });

  it("REJECTS differing content for a shared gamePath", () => {
    const ours = members(
      { "chara/a.tex": "common\\1\\a.tex" },
      { "common/1/a.tex": b(1, 2) },
    );
    const golden = members(
      { "chara/a.tex": "common\\2\\a.tex" },
      { "common/2/a.tex": b(9, 9) },
    );
    const d = diffPayloadSemantic(ours, golden);
    expect(d).toHaveLength(1);
    expect(d[0]!.status).toBe("mismatch");
    expect(d[0]!.gamePath).toBe(key("chara/a.tex"));
  });

  it("REJECTS a gamePath the golden has and we do not", () => {
    const ours = members({}, {});
    const golden = members(
      { "chara/a.tex": "common\\2\\a.tex" },
      { "common/2/a.tex": b(1) },
    );
    const d = diffPayloadSemantic(ours, golden);
    expect(d).toHaveLength(1);
    expect(d[0]!.status).toBe("added");
    expect(d[0]!.gamePath).toBe(key("chara/a.tex"));
  });

  it("REJECTS a NON-common member name differing, even when content matches", () => {
    // A writer bug that misnames an ordinary member must still be caught: only common/N
    // renumbering is free. Both sides resolve "chara/a.tex" to the SAME bytes (b(1)) through
    // their own member, so the redirect-table comparison (part 1) sees no divergence at all —
    // only the payload member-NAME comparison (part 2, outside the common/ namespace) catches it.
    const ours = members(
      { "chara/a.tex": "g\\on\\a.tex" },
      { "g/on/a.tex": b(1) },
    );
    const golden = members(
      { "chara/a.tex": "g\\off\\a.tex" },
      { "g/off/a.tex": b(1) },
    );
    const d = diffPayloadSemantic(ours, golden);
    expect(
      d.some((x) => x.status === "removed" && x.gamePath === "g/on/a.tex"),
    ).toBe(true);
    expect(
      d.some((x) => x.status === "added" && x.gamePath === "g/off/a.tex"),
    ).toBe(true);
  });

  it("consults confirmDivergence for a shared gamePath's content mismatch", () => {
    const ours = members(
      { "chara/a.tex": "common\\1\\a.tex" },
      { "common/1/a.tex": b(1) },
    );
    const golden = members(
      { "chara/a.tex": "common\\2\\a.tex" },
      { "common/2/a.tex": b(2) },
    );
    expect(diffPayloadSemantic(ours, golden, () => true)).toEqual([]);
  });

  // Regression for the Important finding against 86ed4b5: part 2 matched names via `looseKey` and
  // compared with Set membership (`.has`/`.includes`), which can only record that a key is PRESENT.
  // Two genuinely distinct real member names that share a `looseKey` (here "extra.tex" and
  // "extra .tex" both normalize to "extratex") then collapse into one Set entry, so an extra,
  // unpaired member on either side is silently lost — the Set-based check returned `[]` for this
  // exact input. Fixed by bucketing names by `looseKey` and pairing positionally within each
  // bucket (mirroring `diffPayloadMembers`), so the comparison is count-aware, not just
  // presence-aware. No manifest/option document is needed here: with no `group_*.json` /
  // `default_mod.json` entries, `resolveRedirects` (part 1) yields empty tables for both sides, so
  // this isolates part 2 (the payload member NAME multiset) exactly.
  it("catches an extra real member name that collapses onto an already-matched looseKey", () => {
    const ours = new Map<string, Uint8Array>([
      ["extra.tex", b(9)],
      ["extra .tex", b(9)],
    ]);
    const golden = new Map<string, Uint8Array>([["extra.tex", b(9)]]);
    const d = diffPayloadSemantic(ours, golden);
    expect(d).toHaveLength(1);
    expect(d[0]!.status).toBe("removed");
    // Positional pairing within the shared looseKey bucket ("extra .tex" < "extra.tex" in sort
    // order, since ' ' < '.'): the first sorted name on each side is treated as the matched pair,
    // leaving the SECOND sorted "ours" name ("extra.tex") as the unpaired overflow that gets
    // reported — same positional-pairing behaviour as `diffPayloadMembers`'s sibling regression
    // test above, not an attempt to guess which literal member is "the extra" one.
    expect(d[0]!.gamePath).toBe("extra.tex");
  });
});

// diffArchives' fifth parameter (layoutEquivalent) swaps the payload comparison for
// diffPayloadSemantic instead of diffPayloadMembers — see diffArchives' doc comment and the
// FileSwap-preservation spec §5.2. Reuses the file's own `pmp` helper (writeZip, src/zip/zip.ts),
// not a new zip-building helper — the file already has one.
describe("diffArchives layoutEquivalent parameter", () => {
  const zipOf = (
    files: Record<string, string>,
    payload: Record<string, Uint8Array>,
  ) =>
    pmp({
      "meta.json": { FileVersion: 3, Name: "t" },
      "group_001_g.json": {
        Options: [{ Name: "On", Files: files, FileSwaps: {} }],
      },
      ...payload,
    });

  it("uses member-name comparison by default and semantic only when asked", () => {
    const ours = zipOf(
      { "chara/a.tex": "common\\1\\a.tex" },
      { "common/1/a.tex": new Uint8Array([1]) },
    );
    const golden = zipOf(
      { "chara/a.tex": "common\\2\\a.tex" },
      { "common/2/a.tex": new Uint8Array([1]) },
    );

    // Default: the member-name shift IS reported.
    const strict = diffArchives(ours, golden, true);
    expect(strict.some((d) => d.kind === "structure")).toBe(true);

    // layoutEquivalent: the same shift is accepted, because the redirect tables agree.
    const relaxed = diffArchives(ours, golden, true, undefined, true);
    expect(relaxed.filter((d) => d.kind === "structure")).toEqual([]);
  });
});

// Closes the gap left by the `layoutEquivalent` structural (member-name) fix above: a `Files`
// map's VALUE is a zip path too, so `dropConfirmedAbsentKeys` must also stop reporting a `Files`
// value difference that is purely a `common/N` renumbering — otherwise the exact same shift
// reappears as a manifest (`jsonPointerDiff`) diff instead of a structure diff. See the
// FileSwap-preservation spec, §5.2, and PMP.cs:1104-1137 -> PmpExtensions.cs:509-514 for why the
// renumbering happens at all. `Files` KEYS (the gamePath) are the effective result and are never
// exempted here — only the VALUE (the zip path) is layout.
describe("diffArchives layoutEquivalent: Files VALUE common/N exemption", () => {
  const FILE_DEF = { FileSwaps: {}, Manipulations: [] };

  it("does not report a Files value differing only by common/N renumbering", () => {
    const ours = pmp({
      "meta.json": META,
      "default_mod.json": {
        ...FILE_DEF,
        Files: { "chara/a.tex": "common\\1\\a.bin" },
      },
      "common/1/a.bin": new Uint8Array([1, 2, 3]),
    });
    const golden = pmp({
      "meta.json": META,
      "default_mod.json": {
        ...FILE_DEF,
        Files: { "chara/a.tex": "common\\2\\a.bin" },
      },
      "common/2/a.bin": new Uint8Array([1, 2, 3]),
    });
    expect(diffArchives(ours, golden, false, undefined, true)).toEqual([]);
  });

  it("still reports a Files value difference outside the common/ namespace", () => {
    const ours = pmp({
      "meta.json": META,
      "default_mod.json": {
        ...FILE_DEF,
        Files: { "chara/a.tex": "g\\on\\a.tex" },
      },
      "g/on/a.tex": new Uint8Array([1]),
    });
    const golden = pmp({
      "meta.json": META,
      "default_mod.json": {
        ...FILE_DEF,
        Files: { "chara/a.tex": "g\\off\\a.tex" },
      },
      "g/off/a.tex": new Uint8Array([1]),
    });
    const diffs = diffArchives(ours, golden, false, undefined, true);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      kind: "manifest",
      status: "mismatch",
    });
  });

  it("still reports a Files KEY present in golden but missing from ours, unaffected by layoutEquivalent", () => {
    // The missing key's own payload genuinely exists in the golden archive (a resolvable member),
    // so this is NOT the PMP.cs:883 confirmed-absent-drop case — it must stay a reported diff.
    const ours = pmp({
      "meta.json": META,
      "default_mod.json": {
        ...FILE_DEF,
        Files: { "chara/a.tex": "common\\1\\a.bin" },
      },
      "common/1/a.bin": new Uint8Array([1]),
    });
    const golden = pmp({
      "meta.json": META,
      "default_mod.json": {
        ...FILE_DEF,
        Files: {
          "chara/a.tex": "common\\1\\a.bin",
          "chara/b.tex": "common\\3\\b.bin",
        },
      },
      "common/1/a.bin": new Uint8Array([1]),
      "common/3/b.bin": new Uint8Array([9]),
    });
    const diffs = diffArchives(ours, golden, false, undefined, true);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      kind: "manifest",
      status: "added",
    });
  });

  it("reports the common/N renumbering when layoutEquivalent is NOT set (must not leak into normal packs)", () => {
    const ours = pmp({
      "meta.json": META,
      "default_mod.json": {
        ...FILE_DEF,
        Files: { "chara/a.tex": "common\\1\\a.bin" },
      },
      "common/1/a.bin": new Uint8Array([1, 2, 3]),
    });
    const golden = pmp({
      "meta.json": META,
      "default_mod.json": {
        ...FILE_DEF,
        Files: { "chara/a.tex": "common\\2\\a.bin" },
      },
      "common/2/a.bin": new Uint8Array([1, 2, 3]),
    });
    const diffs = diffArchives(ours, golden); // layoutEquivalent defaults to false
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      kind: "manifest",
      status: "mismatch",
    });
  });

  it("still reports a Files value where only ONE side is inside common/", () => {
    const ours = pmp({
      "meta.json": META,
      "default_mod.json": {
        ...FILE_DEF,
        Files: { "chara/a.tex": "common\\1\\a.bin" },
      },
      "common/1/a.bin": new Uint8Array([1]),
    });
    const golden = pmp({
      "meta.json": META,
      "default_mod.json": {
        ...FILE_DEF,
        Files: { "chara/a.tex": "g\\off\\a.bin" },
      },
      "g/off/a.bin": new Uint8Array([1]),
    });
    const diffs = diffArchives(ours, golden, false, undefined, true);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      kind: "manifest",
      status: "mismatch",
    });
  });
});
