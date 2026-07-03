import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createVitest } from "vitest/node";
import { corpusUnitsPlugin } from "./corpus-units-plugin";
import type { enumerateUnits as EnumerateUnits } from "../test/helpers/corpus-units";

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
    await vitest.standalone();
    const project = vitest.getRootProject();
    const { enumerateUnits } = await vitest.import<{ enumerateUnits: typeof EnumerateUnits }>(
      resolve(here, "../test/helpers/corpus-units.ts"),
    );
    const unitCount = enumerateUnits().length;
    const indices =
      single !== undefined ? [Number(single)] : Array.from({ length: unitCount }, (_, i) => i);
    const corpusSpecs = indices.map((i) => project.createSpecification(`\0virtual:corpus-unit:${i}`));
    const normalSpecs = single !== undefined ? [] : await vitest.globTestSpecifications();
    await vitest.runTestSpecifications([...normalSpecs, ...corpusSpecs], true);
    const modules = vitest.state.getTestModules();
    // Zero modules counts as failure (matches Vitest's own hasFailed()): if nothing ran at all,
    // something went wrong — never report a false green.
    process.exitCode = modules.length === 0 || modules.some((m) => !m.ok()) ? 1 : 0;
  } finally {
    await vitest.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
