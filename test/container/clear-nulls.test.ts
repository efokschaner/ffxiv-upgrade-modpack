import { describe, expect, it } from "vitest";
import { clearNulls } from "../../src/container/clear-nulls";
import type { ModpackGroup, ModpackPage } from "../../src/model/modpack";

const group = (name: string, optionCount: number): ModpackGroup => ({
  name,
  description: "",
  image: "",
  priority: 0,
  selectionType: "Single",
  defaultSettings: 0,
  options: Array.from({ length: optionCount }, (_, i) => ({
    name: `o${i}`,
    description: "",
    image: "",
    priority: 0,
    selected: false,
    files: new Map(),
    fileSwaps: {},
    manipulations: [],
  })),
});

describe("clearNulls (WizardData.cs:1253-1285)", () => {
  it("removes a null group but keeps the page (:1268)", () => {
    const pages: ModpackPage[] = [{ groups: [group("Real", 1), null] }];
    clearNulls(pages);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.groups.map((g) => g?.name)).toEqual(["Real"]);
  });

  it("removes a page left with no data (:1259-1263)", () => {
    const pages: ModpackPage[] = [
      { groups: [null] },
      { groups: [group("Real", 1)] },
    ];
    clearNulls(pages);
    expect(pages.map((p) => p.groups.map((g) => g?.name))).toEqual([["Real"]]);
  });

  it("DIVERGES: a leading null does not crash (docs/TEXTOOLS_BUGS.md #22)", () => {
    const pages: ModpackPage[] = [{ groups: [null, group("Real", 1)] }];
    expect(() => clearNulls(pages)).not.toThrow();
    expect(pages[0]!.groups.map((g) => g?.name)).toEqual(["Real"]);
  });

  it("keeps a content-free group that has at least one option", () => {
    const pages: ModpackPage[] = [{ groups: [group("Contentless", 1)] }];
    clearNulls(pages);
    expect(pages[0]!.groups).toHaveLength(1);
  });

  it("removes a zero-option group (HasData reduces to Options.Count > 0)", () => {
    const pages: ModpackPage[] = [
      { groups: [group("Real", 1), group("Empty", 0)] },
    ];
    clearNulls(pages);
    expect(pages[0]!.groups.map((g) => g?.name)).toEqual(["Real"]);
  });
});
