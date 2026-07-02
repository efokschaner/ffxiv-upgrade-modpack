import { describe, it } from "vitest";
import { corpusInputs, assertCorpusPresent } from "./helpers/oracle";
import { registerGoldenCheck } from "./helpers/corpus-golden";

const inputs = corpusInputs();

describe("corpus round-trip", () => {
  it("requires the local corpus (fails if test/corpus/inputs is empty)", () => {
    assertCorpusPresent(inputs);
  });
  for (const pack of inputs) registerGoldenCheck(pack);
});
