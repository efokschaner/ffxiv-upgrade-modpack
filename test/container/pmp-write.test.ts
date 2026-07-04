import { describe, expect, it } from "vitest";
import { readPmp, writePmp } from "../../src/container/pmp";
import { allFiles } from "../../src/model/modpack";
import { readZip } from "../../src/zip/zip";
import { makePmpZip } from "../helpers/make-packs";

describe("writePmp round-trip", () => {
  it("preserves inner files byte-for-byte and re-reads structurally", () => {
    const pack = makePmpZip();
    const out = writePmp(readPmp(pack.bytes));
    const reread = readPmp(out);
    const byPath = new Map(allFiles(reread).map((f) => [f.gamePath, f.data]));
    for (const [path, bytes] of Object.entries(pack.expectedFiles)) {
      expect(byPath.get(path)).toEqual(bytes);
    }
  });

  it("emits meta.json, default_mod.json and a numbered group file", () => {
    const out = writePmp(readPmp(makePmpZip().bytes));
    const names = [...readZip(out).keys()];
    expect(names).toContain("meta.json");
    expect(names).toContain("default_mod.json");
    expect(names.some((n) => /^group_001_.*\.json$/.test(n))).toBe(true);
  });
});
