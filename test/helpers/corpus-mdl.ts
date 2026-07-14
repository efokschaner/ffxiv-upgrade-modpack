import { describe, expect, it } from "vitest";
import { parseMdl, serializeMdl } from "../../src/mdl/mdl";
import { SqPackType } from "../../src/sqpack/sqpack";
import { bytesEqual } from "./compare";
import {
  decodedOfType,
  legacySkippedCount,
  type PackContext,
} from "./corpus-decode";

// Correctness gate for the MDL codec over real SE/TexTools models. serializeMdl(parseMdl(x)) === x is
// byte-exact for any decodable .mdl, and parseMdl additionally asserts its walk consumes exactly
// modelDataSize (a layout error throws). We skip ONLY models whose SQPack Type-3 decode fails (the
// same legacy files the shared decode tolerates). Any decodable .mdl that does not round-trip
// byte-exact, or whose sections do not sum to modelDataSize, is a hard failure.
export function registerMdlChecks(ctx: PackContext): void {
  const { name } = ctx;
  describe(`mdl corpus: ${name}`, () => {
    it(`serializeMdl(parseMdl(x)) === x for every decodable .mdl in ${name}`, () => {
      // Models are Type 3; the shared decode already ran (corpus-decode.ts).
      const files = decodedOfType(ctx, SqPackType.Model, ".mdl");
      const legacySkipped = legacySkippedCount(ctx, ".mdl");
      let exact = 0;
      let trailingTotal = 0;
      for (const { f, d: decoded } of files) {
        const parsed = parseMdl(decoded.data, f.gamePath);
        const re = serializeMdl(parsed);
        expect(bytesEqual(re, decoded.data)).toBe(true);
        exact++;
        trailingTotal += parsed.sections.trailing.length;
      }
      console.log(
        `[mdl] ${name}: ${exact} byte-exact, ${legacySkipped} legacy-skipped, ${trailingTotal} trailing-bytes (of ${files.length + legacySkipped})`,
      );
    }, 1_200_000);
  });
}
