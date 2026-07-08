import { describe, expect, it } from "vitest";
import { writeZip } from "../../src/zip/zip";
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
      gamePath: "meta.json",
      index: 0,
      status: "mismatch",
      detail: undefined,
    });
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
