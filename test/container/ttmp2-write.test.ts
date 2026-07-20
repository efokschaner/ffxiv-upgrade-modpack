import { describe, expect, it } from "vitest";
import { readTtmp2, writeTtmp2 } from "../../src/container/ttmp2";
import {
  allFiles,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
} from "../../src/model/modpack";
import { readZip, writeZip } from "../../src/zip/zip";
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

  // The `.mpl` is JSON, read back by JsonConvert.DeserializeObject<ModPackJson> (TTMP.cs:143,395,
  // 600) and by Penumbra's parser — so the key SET is load-bearing (a missing or extra key changes
  // what every consumer sees) while the key ORDER is not observable to any of them. This asserts
  // the set only, deliberately order-insensitive; see AGENTS.md, "JSON manifests are compared
  // semantically, not by byte". Expected members transcribed from ModPackJson.cs — ModOptionJson
  // :159-198 and ModsJson :222-262.
  it("emits exactly the C# member set for option and mods-json objects", () => {
    // biome-ignore lint/suspicious/noExplicitAny: raw manifest document
    const out = mpl(writeTtmp2(readTtmp2(makeTtmp2Wizard().bytes))) as any;
    const option = out.ModPackPages[0].ModGroups[0].OptionList[0];
    expect(Object.keys(option).sort()).toEqual(
      [
        "Name",
        "Description",
        "ImagePath",
        "ModsJsons",
        "GroupName",
        "SelectionType",
        "IsChecked",
      ].sort(),
    );
    expect(Object.keys(option.ModsJsons[0]).sort()).toEqual(
      [
        "Name",
        "Category",
        "FullPath",
        "ModOffset",
        "ModSize",
        "DatFile",
        "IsDefault",
        "ModPackEntry",
      ].sort(),
    );
  });
});

/** Rebuild a `.ttmp2` with its `.mpl` document mutated — the only way to exercise the READ seam,
 *  which is where the coalescing lived. */
function withMpl(
  bytes: Uint8Array,
  // biome-ignore lint/suspicious/noExplicitAny: raw manifest document
  mutate: (doc: any) => void,
): Uint8Array {
  const entries = readZip(bytes);
  const name = [...entries.keys()].find((k) =>
    k.toLowerCase().endsWith(".mpl"),
  )!;
  const doc = JSON.parse(new TextDecoder().decode(entries.get(name)!));
  mutate(doc);
  entries.set(name, new TextEncoder().encode(JSON.stringify(doc)));
  return writeZip(entries, { store: true });
}

// TexTools' TTMP path never coalesces these strings, and `JsonConvert.SerializeObject` runs with
// Newtonsoft defaults (NullValueHandling.Include, TTMPWriter.cs · Write · 324), so a source `.mpl`
// that spells `null` round-trips as `null` rather than being flattened to `""`. Our readers used to
// normalize everything to `""`, which diverged from the golden on exactly those packs.
describe("writeTtmp2 null fidelity", () => {
  // Load copies verbatim (`wizOp.Description = o.Description`, WizardData.cs · FromWizardGroup ·
  // 663), export copies verbatim (`Description = Description`, · ToModOption · 414), and the writer
  // copies verbatim again (`Description = modOption.Description`, TTMPWriter.cs · AddOption · 144).
  // So a null in, a null out — no `?? ""` anywhere along that chain.
  it("round-trips a null option Description as null, and '' as ''", () => {
    const src = withMpl(makeTtmp2Wizard().bytes, (doc) => {
      const list = doc.ModPackPages[0].ModGroups[0].OptionList;
      list[0].Description = null;
      list[1].Description = "";
    });
    // biome-ignore lint/suspicious/noExplicitAny: raw manifest document
    const out = mpl(writeTtmp2(readTtmp2(src))) as any;
    const list = out.ModPackPages[0].ModGroups[0].OptionList;
    expect(list[0].Description).toBeNull();
    expect(list[1].Description).toBe("");
  });

  // An ABSENT Description key is a different input with the same outcome: C#'s `string` field has no
  // initializer on ModOptionJson (ModPackJson.cs · ModOptionJson · 159-198), so Newtonsoft leaves it
  // `null` and the same verbatim chain writes `null`.
  it("writes an absent option Description as null", () => {
    const src = withMpl(makeTtmp2Wizard().bytes, (doc) => {
      // biome-ignore lint/suspicious/noExplicitAny: raw manifest document
      for (const o of doc.ModPackPages[0].ModGroups[0].OptionList as any[]) {
        delete o.Description;
      }
    });
    // biome-ignore lint/suspicious/noExplicitAny: raw manifest document
    const out = mpl(writeTtmp2(readTtmp2(src))) as any;
    expect(
      out.ModPackPages[0].ModGroups[0].OptionList[0].Description,
    ).toBeNull();
  });

  // WizardMetaEntry.FromTtmp (WizardData.cs · FromTtmp · 1052-1069) assigns all five verbatim with
  // no `?? ""`; WriteWizardPack (· WriteWizardPack · 1332-1346) passes Name/Author/Url/Description
  // straight through. `ClearNulls()` at :1334 touches only pages/groups/options, never a string, and
  // the `= ""` field initializers (:1015-1020) are overwritten by the load assignments.
  it("round-trips null top-level Name/Author/Description/Url", () => {
    const src = withMpl(makeTtmp2Wizard().bytes, (doc) => {
      doc.Name = null;
      doc.Author = null;
      doc.Description = null;
      doc.Url = null;
    });
    const out = mpl(writeTtmp2(readTtmp2(src)));
    expect(out.Name).toBeNull();
    expect(out.Author).toBeNull();
    expect(out.Description).toBeNull();
    expect(out.Url).toBeNull();
  });

  // `Version` is the exception: WriteWizardPack forces it non-null via `Version.TryParse(...)` +
  // `ver ??= new Version("1.0")` (WizardData.cs:1335-1337), re-guarded in the TTMPWriter ctor
  // (TTMPWriter.cs · TTMPWriter · 61). It must never come out null.
  it("never writes a null Version", () => {
    const src = withMpl(makeTtmp2Wizard().bytes, (doc) => {
      doc.Version = null;
    });
    const out = mpl(writeTtmp2(readTtmp2(src)));
    expect(out.Version).not.toBeNull();
  });

  // The .NET Version round-trip is not a null guard only: WriteWizardPack RE-RENDERS the version
  // through `Version.TryParse` + `ver ??= new Version("1.0")` + `ToString()` (WizardData.cs ·
  // WriteWizardPack · 1335-1337, stringified at TTMPWriter.cs · TTMPWriter · 61-69). A bare "1" has
  // too few components for TryParse, so the fallback applies and the .mpl says "1.0"; "01.2"
  // normalizes to "1.2". Pinned end-to-end because ttmp2.ts writing `data.meta.version` raw would
  // otherwise pass every other test here — the PMP side has its own pin in pmp-manifest.test.ts.
  it("normalizes Version through .NET Version semantics", () => {
    const bare = withMpl(makeTtmp2Wizard().bytes, (doc) => {
      doc.Version = "1";
    });
    expect(mpl(writeTtmp2(readTtmp2(bare))).Version).toBe("1.0");

    const padded = withMpl(makeTtmp2Wizard().bytes, (doc) => {
      doc.Version = "01.2";
    });
    expect(mpl(writeTtmp2(readTtmp2(padded))).Version).toBe("1.2");
  });
});
