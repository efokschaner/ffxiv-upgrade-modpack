import { describe, expect, it } from "vitest";
import { readTtmp2 } from "../src/container/ttmp2";
import { allFiles, FileStorageType } from "../src/model/modpack";
import { makeTtmp2Simple, makeTtmp2Wizard } from "./helpers/make-packs";

describe("readTtmp2", () => {
  it("reads a simple pack with byte-exact opaque blobs", () => {
    const pack = makeTtmp2Simple();
    const data = readTtmp2(pack.bytes);
    expect(data.isSimple).toBe(true);
    expect(data.meta.name).toBe("Synth Simple");
    const byPath = new Map(allFiles(data).map((f) => [f.gamePath, f]));
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
});
