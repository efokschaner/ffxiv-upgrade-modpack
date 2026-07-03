import { describe, expect, it } from "vitest";
import { readPmp } from "../src/container/pmp";
import { allFiles, FileStorageType, ModpackFormat } from "../src/model/modpack";
import { makePmpZip } from "./helpers/make-packs";

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
