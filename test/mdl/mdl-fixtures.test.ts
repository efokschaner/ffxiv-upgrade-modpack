import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMdl, serializeMdl } from "../../src/mdl/mdl";
import { bytesEqual } from "../helpers/compare";

const FIXTURES = join(__dirname, "fixtures");

function fixtureFiles(): string[] {
  if (!existsSync(FIXTURES)) return [];
  return readdirSync(FIXTURES)
    .filter((f) => f.toLowerCase().endsWith(".mdl"))
    .map((f) => join(FIXTURES, f));
}

const files = fixtureFiles();

describe.skipIf(files.length === 0)("mdl extracted fixtures", () => {
  for (const path of files) {
    it(`round-trips ${path} byte-exact`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      expect(bytesEqual(serializeMdl(parseMdl(bytes, path)), bytes)).toBe(true);
    });
  }
});
