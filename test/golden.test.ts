import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { oracleAvailable, corpusInputs, resave } from "./helpers/oracle";
import { compareInnerFilesByteIdentical } from "./helpers/compare";
import { loadModpack } from "../src/index";

describe("corpus differential (skips without ConsoleTools/corpus)", () => {
  const packs = oracleAvailable() ? corpusInputs() : [];

  it.runIf(packs.length > 0).each(packs)(
    "our reader matches ConsoleTools /resave inner files: %s",
    (packPath) => {
      const tmp = mkdtempSync(join(tmpdir(), "golden-"));
      const dest = join(tmp, basename(packPath).replace(/\.[^.]+$/, ".ttmp2"));
      resave(packPath, dest);

      const ours = loadModpack(packPath, readFileSync(packPath));
      const golden = loadModpack(dest, readFileSync(dest));
      const result = compareInnerFilesByteIdentical(ours, golden);
      if (!result.ok) console.error("mismatched files:", result.mismatches);
      expect(result.ok).toBe(true);
    },
  );

  it("reports when nothing ran", () => {
    if (packs.length === 0) console.warn("corpus differential skipped: no ConsoleTools and/or empty test/corpus/inputs");
    expect(true).toBe(true);
  });
});
