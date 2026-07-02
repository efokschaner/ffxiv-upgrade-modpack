import { describe, it } from "vitest";
import { corpusInputs, assertCorpusPresent } from "./helpers/oracle";
import { registerMtrlChecks } from "./helpers/corpus-mtrl";

const inputs = corpusInputs();

describe("mtrl corpus", () => {
  it("requires the local corpus (fails if test/corpus/inputs is empty)", () => {
    assertCorpusPresent(inputs);
  });
  for (const pack of inputs) registerMtrlChecks(pack);
});
