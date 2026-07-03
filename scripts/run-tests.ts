import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createVitest } from "vitest/node";
import type { enumerateUnits as EnumerateUnits } from "../test/helpers/corpus-units";
import { corpusUnitsPlugin } from "./corpus-units-plugin";

// Custom test runner: runs the normal *.test.ts specs PLUS one fileless virtual spec per corpus
// (pack × check) work unit, so Vitest's forks pool schedules them dynamically across cores.
// CORPUS_UNIT=<i> runs a single corpus unit (and nothing else) as a plumbing/debug aid.
//
// Bootstrap note: corpus-units.ts references `__dirname`, which only exists once the file is
// transformed by Vite's SSR module runner (as it is for every real test file). This script itself
// runs under a plain ESM loader (tsx / vite-node), so a normal top-level `import` of corpus-units.ts
// would hit `__dirname` before Vite ever touches it. We instead load it through `vitest.import()`
// (the Vite module runner) so it gets the same transform/shim as worker-loaded test files.
const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const single = process.env.CORPUS_UNIT;
  const vitest = await createVitest(
    "test",
    // Force the "default" reporter. Vitest 4 auto-selects the "agent"/"minimal" reporter when
    // std-env detects an agent/coding-CLI environment (as this one is), and that reporter's
    // printLeaksSummary() throws ("Cannot read properties of undefined (reading 'state')") when
    // driven through the Node API here — an upstream reporter-init ordering bug, not something in
    // our runner. Pinning the reporter sidesteps it.
    { watch: false, reporters: ["default"] },
    { plugins: [corpusUnitsPlugin()] }, // viteOverrides — where Vite plugins go
  );
  try {
    // `runTestSpecifications()` alone never fires reporter `onInit` (only `.start()`/`.standalone()`
    // do), so without this the reporters' `this.ctx` stays undefined and they throw when printing
    // the end-of-run summary. `standalone()` is the public Node-API entry point meant for exactly
    // this "I'll drive runTestSpecifications myself" usage.
    //
    // Note: `standalone()` internally calls `globTestSpecifications()` once, and we call it again
    // below to build `normalSpecs`, so the test dir is globbed twice. That redundant glob is
    // deliberately accepted: it is negligible (a fast-glob over ~28 test files, single-digit ms),
    // and the only ways to avoid it — reusing standalone's cached specs (no public accessor; the
    // getters re-glob) or firing `onInit` directly (vitest's `report()` isn't on the public Vitest
    // type) — reach past the public API into internals we don't want to depend on across upgrades.
    await vitest.standalone();
    const project = vitest.getRootProject();
    const { enumerateUnits } = await vitest.import<{
      enumerateUnits: typeof EnumerateUnits;
    }>(resolve(here, "../test/helpers/corpus-units.ts"));
    const unitCount = enumerateUnits().length;
    let indices: number[];
    if (single !== undefined) {
      const idx = Number(single);
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error(
          `CORPUS_UNIT must be a non-negative integer unit index, got ${JSON.stringify(single)}`,
        );
      }
      indices = [idx];
    } else {
      indices = Array.from({ length: unitCount }, (_, i) => i);
    }
    const corpusSpecs = indices.map((i) =>
      project.createSpecification(`\0virtual:corpus-unit:${i}`),
    );
    const normalSpecs =
      single !== undefined ? [] : await vitest.globTestSpecifications();
    const specs = [...normalSpecs, ...corpusSpecs];
    await vitest.runTestSpecifications(specs, true);
    const modules = vitest.state.getTestModules();
    // Correctness gate for a parallel run: every submitted spec must yield exactly one passing
    // TestModule. A worker that hard-crashes (e.g. OOM on a 200–457 MB pack — the very failure mode
    // the worker cap guards against) drops its virtual spec silently: that spec simply never appears
    // in getTestModules(), so a `.some(!ok)` check alone would report a false green. Comparing the
    // observed module count against the specs we submitted turns a silently-dropped unit into a red.
    // Also fail on any unhandled error surfaced outside a module. (`modules.length !== specs.length`
    // subsumes the zero-modules case: with specs present, 0 modules is a count mismatch.)
    const failed =
      modules.length !== specs.length ||
      modules.some((m) => !m.ok()) ||
      vitest.state.getUnhandledErrors().length > 0;
    process.exitCode = failed ? 1 : 0;
  } finally {
    // A close() failure must not flip an already-computed exit code (a green run to red). Log and
    // swallow — the test result, already reflected in process.exitCode, is what matters.
    try {
      await vitest.close();
    } catch (err) {
      console.error("vitest.close() failed (ignored):", err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
