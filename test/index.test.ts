import { describe, it, expect } from "vitest";
import { loadModpack, writeModpack } from "../src/index";
import { allFiles } from "../src/model/modpack";
import { makeTtmp2Simple, makeLegacyTtmp, makePmpZip } from "./helpers/make-packs";

describe("public API", () => {
  it("loads each format and rewrites preserving inner files", () => {
    const cases = [
      { pack: makeTtmp2Simple(), target: "ttmp2" as const },
      { pack: makeLegacyTtmp(), target: "ttmp2" as const },
      { pack: makePmpZip(), target: "pmp" as const },
    ];
    for (const { pack, target } of cases) {
      const data = loadModpack(pack.name, pack.bytes);
      const out = writeModpack(data, target);
      const reread = loadModpack(`out.${target}`, out);
      const byPath = new Map(allFiles(reread).map((f) => [f.gamePath, f.data]));
      for (const [path, bytes] of Object.entries(pack.expectedFiles)) {
        expect(byPath.get(path)).toEqual(bytes);
      }
    }
  });

  it("throws on unknown extension", () => {
    expect(() => loadModpack("x.zip", new Uint8Array())).toThrow();
  });
});
