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

  it("throws when no archive entry matches under any casing", () => {
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

    expect(() => readPmp(writeZip(entries))).toThrow(
      /missing file entry files\/missing\.mtrl/,
    );
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
