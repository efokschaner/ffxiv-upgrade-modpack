import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_PACK_DIAGNOSTICS } from "./helpers/corpus-upgrade";
import { assertCorpusPresent, corpusInputs } from "./helpers/oracle";

// Fail-on-absent policy lives here (a real file that is ALWAYS discovered) rather than inside the
// per-unit virtual specs: an empty corpus yields zero corpus units, so the guard must not depend on
// any unit existing. Same assertions/messages as the pre-parallelization corpus files.
describe("corpus presence", () => {
  const inputs = corpusInputs();
  it("requires the local corpus (fails if test/corpus/real is empty)", () => {
    assertCorpusPresent(inputs);
  });
  it("requires .pmp packs in the local corpus (fails if none present)", () => {
    assertCorpusPresent(
      inputs.filter((p) => p.toLowerCase().endsWith(".pmp")),
      ".pmp corpus inputs",
    );
  });

  // Same fail-on-absent policy, narrowed to the packs that carry an EXACT diagnostic expectation
  // (EXPECTED_PACK_DIAGNOSTICS, test/helpers/corpus-upgrade.ts). Those assertions are the only thing
  // pinning the "diagnostic" DiffKind's ratchet wiring — the subset-based ratchet cannot notice a
  // diagnostic that stops being produced — and they run inside the per-pack `upgrade` unit, which is
  // registered only if the pack exists. Without this guard, deleting or failing to rebuild the pack
  // would retire the pin in silence. Every listed pack is a SYNTHETIC one, so the fix is always
  // `npm run synthetics`.
  it("requires every pack with an exact diagnostic expectation to be present", () => {
    const present = new Set(inputs.map((p) => basename(p).toLowerCase()));
    const missing = [...EXPECTED_PACK_DIAGNOSTICS.keys()].filter(
      (n) => !present.has(n),
    );
    expect(
      missing,
      `Missing corpus packs named in EXPECTED_PACK_DIAGNOSTICS — run \`npm run synthetics\`.`,
    ).toEqual([]);
  });
});
