import { describe, it } from "vitest";
import { corpusInputs, assertCorpusPresent } from "./helpers/oracle";

// Fail-on-absent policy lives here (a real file that is ALWAYS discovered) rather than inside the
// per-unit virtual specs: an empty corpus yields zero corpus units, so the guard must not depend on
// any unit existing. Same assertions/messages as the pre-parallelization corpus files.
describe("corpus presence", () => {
  const inputs = corpusInputs();
  it("requires the local corpus (fails if test/corpus/inputs is empty)", () => {
    assertCorpusPresent(inputs);
  });
  it("requires .pmp packs in the local corpus (fails if none present)", () => {
    assertCorpusPresent(inputs.filter((p) => p.toLowerCase().endsWith(".pmp")), ".pmp corpus inputs");
  });
});
