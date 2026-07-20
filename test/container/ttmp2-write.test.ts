import { describe, expect, it } from "vitest";
import { readTtmp2, writeTtmp2 } from "../../src/container/ttmp2";
import {
  allFiles,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
} from "../../src/model/modpack";
import { readZip } from "../../src/zip/zip";
import {
  filesMap,
  makeTtmp2Simple,
  makeTtmp2Wizard,
} from "../helpers/make-packs";

function roundTrip(bytes: Uint8Array) {
  const data = readTtmp2(bytes);
  return readTtmp2(writeTtmp2(data));
}

describe("writeTtmp2 round-trip", () => {
  it("preserves every inner file byte-for-byte (simple)", () => {
    const pack = makeTtmp2Simple();
    const out = roundTrip(pack.bytes);
    const byPath = new Map(
      allFiles(out).map(({ gamePath, file }) => [gamePath, file.data]),
    );
    for (const [path, bytes] of Object.entries(pack.expectedFiles)) {
      expect(byPath.get(path)).toEqual(bytes);
    }
  });

  it("preserves structure and files (wizard)", () => {
    const pack = makeTtmp2Wizard();
    const out = roundTrip(pack.bytes);
    expect(out.isSimple).toBe(false);
    expect(out.groups[0]!.options.map((o) => o.name)).toEqual(["A", "B"]);
    const byPath = new Map(
      allFiles(out).map(({ gamePath, file }) => [gamePath, file.data]),
    );
    expect(byPath.get(Object.keys(pack.expectedFiles)[0]!)).toEqual(
      Object.values(pack.expectedFiles)[0],
    );
  });

  it("dedupes identical payloads into one blob region", () => {
    const data = readTtmp2(makeTtmp2Simple().bytes);
    // Force two files to share identical bytes.
    const files = allFiles(data);
    // TTMP files always carry bytes (fileFromMod slices them from the .mpd blob); only a PMP
    // Files entry can be absent (absent-file design spec §3.1).
    files[1]!.file.data = files[0]!.file.data!.slice();
    const reread = readTtmp2(writeTtmp2(data));
    const rf = allFiles(reread);
    expect(rf[0]!.file.data).toEqual(rf[1]!.file.data);
  });

  it("throws when a file has no bytes (structurally PMP-only; unreachable in practice — design spec §3.4)", () => {
    const data: ModpackData = {
      sourceFormat: ModpackFormat.Ttmp2,
      isSimple: true,
      meta: {
        name: "M",
        author: "A",
        version: "1",
        description: "",
        url: "",
        image: "",
        tags: [],
        minimumFrameworkVersion: "1.0.0.0",
      },
      groups: [
        {
          name: "Default",
          description: "",
          image: "",
          page: 0,
          priority: 0,
          selectionType: "Single",
          defaultSettings: 0,
          options: [
            {
              name: "Default",
              description: "",
              image: "",
              priority: 0,
              selected: false,
              fileSwaps: {},
              manipulations: [],
              files: filesMap([
                // Deliberately violates the SqPackCompressed-always-has-bytes invariant to drive
                // writeTtmp2's defensive runtime guard; structurally unreachable through any real
                // reader (design spec §3.4), hence the cast.
                [
                  "chara/x.mtrl",
                  { storage: FileStorageType.SqPackCompressed } as ModpackFile,
                ],
              ]),
            },
          ],
        },
      ],
    };
    expect(() => writeTtmp2(data)).toThrow(/cannot write a file with no bytes/);
  });
});

function mpl(bytes: Uint8Array): Record<string, unknown> {
  const entries = readZip(bytes);
  const name = [...entries.keys()].find((k) =>
    k.toLowerCase().endsWith(".mpl"),
  )!;
  // biome-ignore lint/suspicious/noExplicitAny: a raw manifest document, asserted key by key
  return JSON.parse(new TextDecoder().decode(entries.get(name)!)) as any;
}

describe("writeTtmp2 .mpl fidelity", () => {
  it("writes IsChecked on every option", () => {
    const data = readTtmp2(makeTtmp2Wizard().bytes);
    data.groups[0]!.options[0]!.selected = true;
    data.groups[0]!.options[1]!.selected = false;
    // biome-ignore lint/suspicious/noExplicitAny: raw manifest document
    const out = mpl(writeTtmp2(data)) as any;
    expect(
      // biome-ignore lint/suspicious/noExplicitAny: raw manifest document
      out.ModPackPages[0].ModGroups[0].OptionList.map((o: any) => o.IsChecked),
    ).toEqual([true, false]);
  });

  it("writes ModPackEntry: null on every mods json", () => {
    // biome-ignore lint/suspicious/noExplicitAny: raw manifest document
    const out = mpl(writeTtmp2(readTtmp2(makeTtmp2Wizard().bytes))) as any;
    const mods = out.ModPackPages[0].ModGroups[0].OptionList.flatMap(
      // biome-ignore lint/suspicious/noExplicitAny: raw manifest document
      (o: any) => o.ModsJsons,
    );
    expect(mods.length).toBeGreaterThan(0);
    for (const m of mods) {
      expect(m).toHaveProperty("ModPackEntry");
      expect(m.ModPackEntry).toBeNull();
    }
  });

  it("spells the unused list as an explicit null (both directions)", () => {
    const wizard = mpl(writeTtmp2(readTtmp2(makeTtmp2Wizard().bytes)));
    expect(wizard).toHaveProperty("SimpleModsList");
    expect(wizard.SimpleModsList).toBeNull();
    expect(Array.isArray(wizard.ModPackPages)).toBe(true);

    const simple = mpl(writeTtmp2(readTtmp2(makeTtmp2Simple().bytes)));
    expect(simple).toHaveProperty("ModPackPages");
    expect(simple.ModPackPages).toBeNull();
    expect(Array.isArray(simple.SimpleModsList)).toBe(true);
  });

  // Newtonsoft emits members in reflection order, so the golden .mpl spells each object in the
  // C# class's DECLARATION order. Pinned here because the corpus harness compares the manifest
  // semantically (parsed JSON, test/helpers/upgrade-archive-diff.ts), so no golden diff would
  // ever catch a key-order regression. Expected values transcribed from ModPackJson.cs —
  // ModOptionJson :159-198 and ModsJson :222-262 — and confirmed against a real cached
  // ConsoleTools /upgrade golden.
  it("spells option and mods-json keys in the C# declaration order", () => {
    // biome-ignore lint/suspicious/noExplicitAny: raw manifest document
    const out = mpl(writeTtmp2(readTtmp2(makeTtmp2Wizard().bytes))) as any;
    const option = out.ModPackPages[0].ModGroups[0].OptionList[0];
    expect(Object.keys(option)).toEqual([
      "Name",
      "Description",
      "ImagePath",
      "ModsJsons",
      "GroupName",
      "SelectionType",
      "IsChecked",
    ]);
    expect(Object.keys(option.ModsJsons[0])).toEqual([
      "Name",
      "Category",
      "FullPath",
      "ModOffset",
      "ModSize",
      "DatFile",
      "IsDefault",
      "ModPackEntry",
    ]);
  });
});
