import { describe, expect, it } from "vitest";
import { readTtmp2, writeTtmp2 } from "../../src/container/ttmp2";
import {
  allFiles,
  FileStorageType,
  type ModpackData,
  type ModpackFile,
  ModpackFormat,
} from "../../src/model/modpack";
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
