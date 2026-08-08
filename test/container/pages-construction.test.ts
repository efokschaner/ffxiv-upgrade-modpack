import { describe, expect, it } from "vitest";
import { readPmp } from "../../src/container/pmp";
import { allGroups } from "../../src/model/modpack";
import { buildTestPmp } from "../helpers/pmp-fixture";

describe("readPmp page construction (WizardData.FromPmp:1137-1178)", () => {
  it("omits the Default page when default_mod.json is an empty option (:1137)", () => {
    const data = readPmp(
      buildTestPmp({
        defaultModFiles: {},
        groups: [{ name: "G", page: 0, optionNames: ["On"] }],
      }),
    );
    expect(allGroups(data).map((g) => g.name)).toEqual(["G"]);
  });

  it("puts the synthesized Default group first when default_mod.json is non-empty (:1155)", () => {
    const data = readPmp(
      buildTestPmp({
        defaultModFiles: { "chara/dummy/a.bin": "files\\a.bin" },
        groups: [{ name: "G", page: 0, optionNames: ["On"] }],
      }),
    );
    expect(allGroups(data).map((g) => g.name)).toEqual(["Default", "G"]);
  });

  it("reproduces the page off-by-one: a Page-0 group joins the Default page (#7)", () => {
    const data = readPmp(
      buildTestPmp({
        defaultModFiles: { "chara/dummy/a.bin": "files\\a.bin" },
        groups: [{ name: "G", page: 0, optionNames: ["On"] }],
      }),
    );
    // WizardData.cs:1161-1169 unconditionally creates one NEW page per page-index 0..pageMax (here
    // just "page 0"), APPENDED after the already-unshifted Default page — so DataPages would hold 2
    // entries were it not for ClearNulls (WizardData.cs:1253-1263, `WizardData.cs · FromPmp · 1178`),
    // which readPmp now calls on its way out (src/container/clear-nulls.ts) and which drops the
    // always-empty orphan page the assignment loop below never reaches. So only ONE page survives.
    expect(data.pages).toHaveLength(1);
    // WizardData.cs:1171-1176 — `data.DataPages[g.Page]` indexes into a list that ALREADY has the
    // Default page unshifted onto the front, so the group meant for "page 0" (the now-pruned orphan)
    // lands on data.pages[0] (the Default page) instead — the off-by-one itself, observable here as
    // both groups sharing the one surviving page.
    expect(data.pages![0]!.groups.map((g) => g?.name)).toEqual([
      "Default",
      "G",
    ]);
  });
});
