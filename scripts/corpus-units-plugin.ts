import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Plugin } from "vite";

// Turns `virtual:corpus-unit:<index>` into a tiny module that registers that unit's checks inside a
// worker. Uses the Rollup null-byte convention (\0-prefixed resolved id) so no other plugin or the
// filesystem tries to handle it. The generated code imports registerUnit by an absolute file URL so
// it resolves from a virtual module that has no real path (and works on Windows).
const PREFIX = "virtual:corpus-unit:";
const RESOLVED = "\0" + PREFIX;

export function corpusUnitsPlugin(): Plugin {
  const here = dirname(fileURLToPath(import.meta.url));
  const registerModule = pathToFileURL(resolve(here, "../test/helpers/corpus-register.ts")).href;
  return {
    name: "corpus-units",
    enforce: "pre",
    resolveId(id) {
      if (id.startsWith(RESOLVED)) return id;      // already resolved (what the runner passes)
      if (id.startsWith(PREFIX)) return "\0" + id; // tolerate the un-prefixed form too
      return null;
    },
    load(id) {
      if (!id.startsWith(RESOLVED)) return null;
      const index = Number(id.slice(RESOLVED.length));
      return `import { registerUnit } from ${JSON.stringify(registerModule)};\nregisterUnit(${index});\n`;
    },
  };
}
