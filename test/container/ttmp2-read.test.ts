import { describe, expect, it } from "vitest";
import type { ModPackJson } from "../../src/container/manifest-types";
import { readTtmp2 } from "../../src/container/ttmp2";
import { allFiles, FileStorageType } from "../../src/model/modpack";
import { writeZip } from "../../src/zip/zip";
import { makeTtmp2Simple, makeTtmp2Wizard } from "../helpers/make-packs";

describe("readTtmp2", () => {
  it("reads a simple pack with byte-exact opaque blobs", () => {
    const pack = makeTtmp2Simple();
    const data = readTtmp2(pack.bytes);
    expect(data.isSimple).toBe(true);
    expect(data.meta.name).toBe("Synth Simple");
    const byPath = new Map(
      allFiles(data).map(({ gamePath, file }) => [gamePath, file]),
    );
    for (const [path, bytes] of Object.entries(pack.expectedFiles)) {
      expect(byPath.get(path)!.data).toEqual(bytes);
      expect(byPath.get(path)!.storage).toBe(FileStorageType.SqPackCompressed);
    }
  });

  it("reads a wizard pack into page/group/option tree", () => {
    const data = readTtmp2(makeTtmp2Wizard().bytes);
    expect(data.isSimple).toBe(false);
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]!.options).toHaveLength(2);
    expect(data.groups[0]!.options.map((o) => o.name)).toEqual(["A", "B"]);
  });

  it("collapses a duplicate FullPath within one option last-write-wins (WizardData.cs:729-737)", () => {
    const enc = new TextEncoder();
    const bytesA = new Uint8Array([1, 1, 1]);
    const bytesB = new Uint8Array([2, 2, 2]);
    const blob = new Uint8Array([...bytesA, ...bytesB]);
    const mpl: ModPackJson = {
      TTMPVersion: "2.1w",
      Name: "Dup",
      Author: "test",
      Version: "1.0",
      Description: "",
      Url: "",
      MinimumFrameworkVersion: "1.3.0.0",
      ModPackPages: [
        {
          PageIndex: 0,
          ModGroups: [
            {
              GroupName: "G",
              SelectionType: "Single",
              OptionList: [
                {
                  Name: "O",
                  Description: "",
                  ImagePath: "",
                  GroupName: "G",
                  SelectionType: "Single",
                  ModsJsons: [
                    {
                      Name: "A",
                      Category: "",
                      FullPath: "chara/dup.tex",
                      ModOffset: 0,
                      ModSize: bytesA.length,
                      DatFile: "040000.win32.dat0",
                      IsDefault: false,
                    },
                    {
                      Name: "B",
                      Category: "",
                      FullPath: "chara/dup.tex",
                      ModOffset: bytesA.length,
                      ModSize: bytesB.length,
                      DatFile: "040000.win32.dat0",
                      IsDefault: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const entries = new Map<string, Uint8Array>([
      ["TTMPL.mpl", enc.encode(JSON.stringify(mpl))],
      ["TTMPD.mpd", blob],
    ]);
    const ttmp = writeZip(entries);
    const data = readTtmp2(ttmp);
    const files = data.groups[0]!.options[0]!.files;
    expect(files.size).toBe(1);
    expect(files.get("chara/dup.tex")!.data).toEqual(bytesB);
  });
});
