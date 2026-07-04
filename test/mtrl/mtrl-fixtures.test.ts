import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMtrl, serializeMtrl } from "../../src/mtrl/mtrl";

const dir = join(__dirname, "fixtures");
const cases = [
  { name: "default_material.mtrl", label: "Endwalker-format" },
  { name: "default_material_dt.mtrl", label: "Dawntrail-format" },
];

for (const c of cases) {
  const path = join(dir, c.name);
  describe.skipIf(!existsSync(path))(`mtrl fixture (${c.label})`, () => {
    it(`self round-trips ${c.name} byte-identical`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const out = serializeMtrl(parseMtrl(bytes, c.name));
      expect(out).toEqual(bytes);
    });
  });
}
