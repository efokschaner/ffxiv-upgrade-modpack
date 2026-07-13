import { describe, expect, it } from "vitest";
import { readPmp } from "../../src/container/pmp";
import {
  allFiles,
  FileStorageType,
  ModpackFormat,
} from "../../src/model/modpack";
import { writeZip } from "../../src/zip/zip";
import { makePmpZip } from "../helpers/make-packs";

const enc = new TextEncoder();

describe("readPmp", () => {
  it("reads meta, default mod, and groups with raw files", () => {
    const pack = makePmpZip();
    const data = readPmp(pack.bytes);
    expect(data.sourceFormat).toBe(ModpackFormat.Pmp);
    expect(data.meta.name).toBe("Synth PMP");
    const byPath = new Map(allFiles(data).map((f) => [f.gamePath, f]));
    for (const [path, bytes] of Object.entries(pack.expectedFiles)) {
      expect(byPath.get(path)!.data).toEqual(bytes);
      expect(byPath.get(path)!.storage).toBe(FileStorageType.RawUncompressed);
    }
  });
});

describe("readPmp case-insensitive Files resolution", () => {
  // Penumbra lowercases the Files VALUE; the archive keeps the option-folder DISPLAY case.
  // TexTools resolves this via a case-insensitive NTFS read (PMP.cs:1080); we must too.
  it("resolves a lowercased Files value against a display-case zip entry", () => {
    const gamePath =
      "chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl";
    const displayEntry = `Holographic Options/Dyeable Holo/${gamePath}`;
    const filesValue = displayEntry.toLowerCase().replace(/\//g, "\\");
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

    const meta = {
      FileVersion: 3,
      Name: "Case",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = {
      Version: 0,
      Files: {},
      FileSwaps: {},
      Manipulations: [],
    };
    const group = {
      Version: 0,
      Name: "Holographic Options",
      Description: "",
      Type: "Single",
      Priority: 0,
      DefaultSettings: 0,
      Options: [
        {
          Name: "Dyeable Holo",
          Description: "",
          Image: "",
          Files: { [gamePath]: filesValue },
          FileSwaps: {},
          Manipulations: [],
        },
      ],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
      ["group_001_holographic options.json", enc.encode(JSON.stringify(group))],
      [displayEntry, payload],
    ]);

    const data = readPmp(writeZip(entries));
    const f = allFiles(data).find((x) => x.gamePath === gamePath);
    expect(f).toBeDefined();
    expect(f!.storage).toBe(FileStorageType.RawUncompressed);
    expect(f!.data).toEqual(payload);
    expect(data.sourceFormat).toBe(ModpackFormat.Pmp);
  });

  // A Files value naming a path the archive genuinely does not contain (under ANY Windows
  // normalization) is TOLERATED, not fatal: LoadPMP does no existence check (PMP.cs:124) and
  // UnpackPmpOption builds a FileStorageInformation whose RealPath simply does not exist
  // (PMP.cs:1071-1102). The entry STAYS in the option — the upgrade rounds gate on
  // files.ContainsKey (EndwalkerUpgrade.cs:1840/:1852/:1867), which is true for it.
  it("tolerates a Files value absent from the archive: entry kept, no bytes", () => {
    const gamePath =
      "chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl";
    const meta = {
      FileVersion: 3,
      Name: "Absent",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    // Files references files/missing.mtrl, which is present under NO casing.
    const defaultMod = {
      Version: 0,
      Files: { [gamePath]: "files\\missing.mtrl" },
      FileSwaps: {},
      Manipulations: [],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
    ]);

    const data = readPmp(writeZip(entries));
    const f = allFiles(data).find((x) => x.gamePath === gamePath);
    expect(f).toBeDefined();
    expect(f!.data).toBeUndefined();
    expect(f!.pmpPath).toBe("files/missing.mtrl");
    expect(f!.storage).toBe(FileStorageType.RawUncompressed);
  });
});

describe("readPmp Windows path-normalization (trailing dots/spaces)", () => {
  // Windows strips trailing dots/spaces from each path segment; Penumbra keeps them in the
  // lowercased Files VALUE while the archive stores the stripped name. TexTools resolves this via
  // an NTFS Path.Combine read (PMP.cs:1080) after a LoadPMP that never checks existence (PMP.cs:124).
  function buildPmp(
    gamePath: string,
    displayEntry: string,
    filesValue: string,
    payload: Uint8Array,
  ): Uint8Array {
    const meta = {
      FileVersion: 3,
      Name: "Norm",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = {
      Version: 0,
      Files: {},
      FileSwaps: {},
      Manipulations: [],
    };
    const group = {
      Version: 0,
      Name: "Options",
      Description: "",
      Type: "Single",
      Priority: 0,
      DefaultSettings: 0,
      Options: [
        {
          Name: "On",
          Description: "",
          Image: "",
          Files: { [gamePath]: filesValue },
          FileSwaps: {},
          Manipulations: [],
        },
      ],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
      ["group_001_options.json", enc.encode(JSON.stringify(group))],
      [displayEntry, payload],
    ]);
    return writeZip(entries);
  }

  it("resolves a trailing-dot Files value against a stripped zip entry", () => {
    const gamePath =
      "chara/equipment/e6069/material/v0007/mt_c0101e6069_glv_b.mtrl";
    // Archive stores the folder WITHOUT the trailing dot; value KEEPS it (Penumbra's lowercased form).
    const strippedEntry = `Optional/Rose acc/${gamePath}`;
    const filesValue = `optional\\rose acc.\\${gamePath.replace(/\//g, "\\")}`;
    const payload = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
    const data = readPmp(
      buildPmp(gamePath, strippedEntry, filesValue, payload),
    );
    const f = allFiles(data).find((x) => x.gamePath === gamePath);
    expect(f).toBeDefined();
    expect(f!.data).toEqual(payload);
  });

  it("resolves a trailing-space Files value against a stripped zip entry", () => {
    const gamePath = "chara/equipment/e6069/model/c0201e6069_glv.mdl";
    const strippedEntry = `Optional/Rose acc/${gamePath}`;
    const filesValue = `optional\\rose acc \\${gamePath.replace(/\//g, "\\")}`;
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const data = readPmp(
      buildPmp(gamePath, strippedEntry, filesValue, payload),
    );
    const f = allFiles(data).find((x) => x.gamePath === gamePath);
    expect(f).toBeDefined();
    expect(f!.data).toEqual(payload);
  });
});

// Port of LoadPMP's ExtraFiles scan (PMP.cs:213-215): a zip member neither referenced by any
// option's Files value nor a manifest json (IsPmpJsonFile, PMP.cs:228-241) is preserved as an
// "extra" (preview images, readmes, ...) rather than silently dropped.
describe("readPmp ExtraFiles (PMP.cs:213-215)", () => {
  const gamePath =
    "chara/equipment/e0834/material/v0001/mt_c0201e0834_top_a.mtrl";
  const filePayload = new Uint8Array([1, 2, 3, 4]);
  const extraPayload = new Uint8Array([9, 9, 9]);

  function buildBaseEntries(): Map<string, Uint8Array> {
    const meta = {
      FileVersion: 3,
      Name: "Extras",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = {
      Version: 0,
      Files: { [gamePath]: gamePath.replace(/\//g, "\\") },
      FileSwaps: {},
      Manipulations: [],
    };
    return new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
      [gamePath, filePayload],
    ]);
  }

  it("collects an archive member referenced by no option as an extra", () => {
    const entries = buildBaseEntries();
    entries.set("images/preview.png", extraPayload);

    const data = readPmp(writeZip(entries));
    expect(data.extraFiles?.get("images/preview.png")).toEqual(extraPayload);
    // The payload file itself must NOT be treated as an extra.
    expect(data.extraFiles?.has(gamePath)).toBe(false);
  });

  it("does not treat a Files-referenced member as an extra", () => {
    const entries = buildBaseEntries();
    const data = readPmp(writeZip(entries));
    expect(data.extraFiles).toBeUndefined();
  });

  it("does not treat a member referenced only via case-folding as an extra", () => {
    // Mirrors the "case-insensitive Files resolution" describe block above: the archive keeps the
    // option-folder DISPLAY case, Files lowercases it. windowsPathKey resolves the reference, so
    // the member must NOT show up as an extra even though its literal name never appears in Files.
    const displayEntry = `Holographic Options/Dyeable Holo/${gamePath}`;
    const filesValue = displayEntry.toLowerCase().replace(/\//g, "\\");
    const meta = {
      FileVersion: 3,
      Name: "ExtrasCase",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = {
      Version: 0,
      Files: { [gamePath]: filesValue },
      FileSwaps: {},
      Manipulations: [],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
      [displayEntry, extraPayload],
    ]);

    const data = readPmp(writeZip(entries));
    expect(data.extraFiles).toBeUndefined();
  });

  it("does not treat a member referenced only via a trailing-dot Files value as an extra", () => {
    const strippedEntry = `Optional/Rose acc/${gamePath}`;
    const filesValue = `optional\\rose acc.\\${gamePath.replace(/\//g, "\\")}`;
    const meta = {
      FileVersion: 3,
      Name: "ExtrasDot",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = {
      Version: 0,
      Files: { [gamePath]: filesValue },
      FileSwaps: {},
      Manipulations: [],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
      [strippedEntry, extraPayload],
    ]);

    const data = readPmp(writeZip(entries));
    expect(data.extraFiles).toBeUndefined();
  });

  it("never treats meta.json/default_mod.json/group_*.json as extras", () => {
    const entries = buildBaseEntries();
    entries.set(
      "group_001_choice.json",
      enc.encode(
        JSON.stringify({
          Version: 0,
          Name: "Choice",
          Description: "",
          Type: "Single",
          Priority: 0,
          DefaultSettings: 0,
          Options: [],
        }),
      ),
    );

    const data = readPmp(writeZip(entries));
    expect(data.extraFiles).toBeUndefined();
  });

  it("an absent Files entry (member does not exist) does not turn a real extra member into referenced", () => {
    // The Files value names a member the archive genuinely lacks (tolerated per the describe block
    // above); this must not consume/hide an unrelated real extra member.
    const meta = {
      FileVersion: 3,
      Name: "ExtrasAbsent",
      Author: "t",
      Description: "",
      Version: "1.0",
      Website: "",
      Image: "",
      ModTags: [],
    };
    const defaultMod = {
      Version: 0,
      Files: { [gamePath]: "files\\missing.mtrl" },
      FileSwaps: {},
      Manipulations: [],
    };
    const entries = new Map<string, Uint8Array>([
      ["meta.json", enc.encode(JSON.stringify(meta))],
      ["default_mod.json", enc.encode(JSON.stringify(defaultMod))],
      ["images/preview.png", extraPayload],
    ]);

    const data = readPmp(writeZip(entries));
    expect(data.extraFiles?.get("images/preview.png")).toEqual(extraPayload);
  });
});
