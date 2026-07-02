import { describe, it, expect } from "vitest";
import { readLegacyTtmp } from "../src/container/ttmp-legacy";
import { writeTtmp2, readTtmp2 } from "../src/container/ttmp2";
import { allFiles, ModpackFormat } from "../src/model/modpack";
import { makeLegacyTtmp } from "./helpers/make-packs";

describe("readLegacyTtmp", () => {
  it("parses NDJSON mpl and slices the mpd", () => {
    const pack = makeLegacyTtmp();
    const data = readLegacyTtmp(pack.bytes);
    expect(data.sourceFormat).toBe(ModpackFormat.TtmpLegacy);
    expect(data.isSimple).toBe(true);
    const byPath = new Map(allFiles(data).map((f) => [f.gamePath, f.data]));
    for (const [path, bytes] of Object.entries(pack.expectedFiles)) {
      expect(byPath.get(path)).toEqual(bytes);
    }
  });

  it("upgrades to ttmp2 preserving inner files", () => {
    const pack = makeLegacyTtmp();
    const out = readTtmp2(writeTtmp2(readLegacyTtmp(pack.bytes)));
    const byPath = new Map(allFiles(out).map((f) => [f.gamePath, f.data]));
    for (const [path, bytes] of Object.entries(pack.expectedFiles)) {
      expect(byPath.get(path)).toEqual(bytes);
    }
  });
});
