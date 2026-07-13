// Scans one or more directories (recursively) for modpacks (.ttmp2/.ttmp2/.pmp) and reports every
// one our `loadModpack` pipeline cannot load, with its error and a taxonomy summary. This is the
// end-to-end validation of the loader against real-world mods: point it at a modpack library and
// see what still fails loud.
//
// Usage: npx tsx scripts/scan-modpack-loads.ts <dir> [dir...]
//
// Run over the operator's full local library (three directories, 1117 packs) after the PMP
// absent-file-tolerance work landed
// (docs/superpowers/specs/2026-07-12-pmp-absent-file-tolerance-design.md): **0** failures. Before
// that work — i.e. before the case-insensitive-resolution, trailing-dot/space-normalization, and
// absent-file-tolerance fixes — the same scan over the same library found **47**
// (docs/superpowers/specs/2026-07-11-pmp-windows-path-normalization-design.md §1).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadModpack } from "../src/index";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: npx tsx scripts/scan-modpack-loads.ts <dir> [dir...]");
  process.exit(1);
}

const PACK_RE = /\.(ttmp2?|pmp)$/i;
const MAX = 500 * 1024 * 1024;

function walk(dir: string): string[] {
  const out: string[] = [];
  let ents: import("node:fs").Dirent[];
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (PACK_RE.test(e.name)) out.push(p);
  }
  return out;
}

const packs = roots.flatMap(walk);
type Fail = { path: string; sizeMB: string; error: string };
const fails: Fail[] = [];
let scanned = 0;
let skippedBig = 0;

for (const pk of packs) {
  let sz = 0;
  try {
    sz = statSync(pk).size;
  } catch {
    continue;
  }
  if (sz > MAX) {
    skippedBig++;
    continue;
  }
  scanned++;
  try {
    loadModpack(pk, new Uint8Array(readFileSync(pk)));
  } catch (e) {
    fails.push({
      path: pk,
      sizeMB: (sz / 1048576).toFixed(1),
      error: (e as Error).message.split("\n")[0] ?? String(e),
    });
  }
}

// group by error message for a quick taxonomy
const byError = new Map<string, number>();
for (const f of fails) byError.set(f.error, (byError.get(f.error) ?? 0) + 1);

console.log(
  `Scanned ${scanned} packs across: ${roots.join(", ")} (skipped ${skippedBig} over ${MAX / 1048576}MB).`,
);
console.log(`${fails.length} failed to load.`);
console.log("");
console.log("Failure taxonomy (error -> count):");
for (const [err, c] of [...byError].sort((a, b) => b[1] - a[1]))
  console.log(`  ${c}x  ${err}`);
console.log("");
console.log("Full list:");
for (const f of fails.sort((a, b) => (a.path < b.path ? -1 : 1)))
  console.log(`  ${f.path} (${f.sizeMB} MB) -- ${f.error}`);
