import { describe, it } from "vitest";
import { corpusInputs, assertCorpusPresent } from "./helpers/oracle";
import { registerSqpackChecks } from "./helpers/corpus-sqpack";

const inputs = corpusInputs();

describe("sqpack corpus", () => {
  it("requires the local corpus (fails if test/corpus/inputs is empty)", () => {
    assertCorpusPresent(inputs);
  });
  for (const pack of inputs) registerSqpackChecks(pack);
});
