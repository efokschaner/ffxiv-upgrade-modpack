import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";

const dir = join(__dirname, "fixtures");
const cases = [
  { name: "default_material.mtrl", label: "Endwalker-format" },
  { name: "default_material_dt.mtrl", label: "Dawntrail-format" },
];

// Fixtures are committed alongside this test (test/mtrl/fixtures/), so these
// always run — no skipIf. A missing fixture is a real failure, not a silent skip.
for (const c of cases) {
  describe(`mtrl fixture (${c.label})`, () => {
    it(`self round-trips ${c.name} byte-identical`, () => {
      const bytes = new Uint8Array(readFileSync(join(dir, c.name)));
      const out = serializeMtrl(parseMtrl(bytes, c.name));
      expect(out).toEqual(bytes);
    });
  });
}
