// Generates src/upgrade/reference/index-path-overrides.ts.
//
// The EW->DT material transform derives the index (_id.tex) sampler path from the normal texture
// by naming convention (_n.tex -> _id.tex). For most materials that matches ConsoleTools. But when a
// mod overwrites a BASE-GAME material, TexTools' idPath refinement (EndwalkerUpgrade.cs:923-936)
// instead steals the base-game material's OWN index-sampler path — which for equipment carries the
// canonical `v{NN}_` version prefix and drops the material-variant letter (e.g. a mod normal
// c0201e0194_top_n.tex yields golden index v01_c0201e0194_top_id.tex). That path cannot be derived
// from the mod's own bytes, so we bundle it: for every corpus material whose ONLY divergence from the
// golden is the index-sampler path, we read the real path from the base-game material via ConsoleTools
// and emit a { materialPath -> indexPath } table. Regenerate via `npx tsx scripts/extract-index-overrides.ts`.

import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModpack, upgradeModpack } from "../src/index";
import { allFiles, FileStorageType } from "../src/model/modpack";
import { parseMtrl, serializeMtrl } from "../src/mtrl/mtrl";
import { samplerIdToTexUsage, XivTexType } from "../src/mtrl/shader";
import type { XivMtrl } from "../src/mtrl/types";
import { decodeSqPackFile } from "../src/sqpack/sqpack";

// oracle.ts reads __dirname at module scope (Vite-only global); shim it before importing. See
// scripts/extract-shader-params.ts for the rationale.
(globalThis as unknown as { __dirname: string }).__dirname = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "helpers",
);
const { extractGameFile } = await import("../test/helpers/oracle");

const CORPUS = "test/corpus";
const cacheDir = `${CORPUS}/.upgrade-cache`;

function uncompressed(f: {
  data: Uint8Array;
  storage: FileStorageType;
}): Uint8Array {
  return f.storage === FileStorageType.SqPackCompressed
    ? decodeSqPackFile(f.data).data
    : f.data;
}

function mtrlPayloads(
  data: ReturnType<typeof loadModpack>,
): Map<string, Uint8Array[]> {
  const m = new Map<string, Uint8Array[]>();
  for (const f of allFiles(data)) {
    if (!f.gamePath.endsWith(".mtrl")) continue;
    const list = m.get(f.gamePath) ?? [];
    list.push(uncompressed(f));
    m.set(f.gamePath, list);
  }
  return m;
}

function indexSampler(mtrl: XivMtrl) {
  return mtrl.textures.find(
    (t) =>
      t.sampler &&
      samplerIdToTexUsage(t.sampler.samplerIdRaw, mtrl) === XivTexType.Index,
  );
}

// Serialize a material with its index-sampler path blanked, so two materials that differ ONLY in the
// index path serialize identically. Returns the blanked bytes + the real index path (if any).
function blankIndexPath(raw: Uint8Array, path: string) {
  const mtrl = parseMtrl(raw, path);
  const idx = indexSampler(mtrl);
  const realPath = idx?.texturePath;
  if (idx) idx.texturePath = "__IDX__";
  return { bytes: serializeMtrl(mtrl), realPath };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Read the base-game material's own index-sampler path via ConsoleTools /extract (raw bytes; no
// SqPack unwrap — matches extract-shader-params.ts).
function baseGameIndexPath(materialPath: string): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), "idxover-"));
  const dest = join(dir, "m.mtrl");
  try {
    extractGameFile(materialPath, dest);
  } catch {
    return undefined; // not a base-game material
  }
  const mtrl = parseMtrl(new Uint8Array(readFileSync(dest)), materialPath);
  return indexSampler(mtrl)?.texturePath;
}

const overrides = new Map<string, string>();
const problems: string[] = [];

for (const name of readdirSync(`${CORPUS}/inputs`)) {
  const bytes = new Uint8Array(readFileSync(`${CORPUS}/inputs/${name}`));
  const key = createHash("sha256").update(bytes).digest("hex");
  const goldenFile = readdirSync(cacheDir).find(
    (f) => f.startsWith(key) && !f.endsWith(".noop"),
  );
  if (!goldenFile) continue; // no-op pack: nothing upgraded

  const ours = mtrlPayloads(upgradeModpack(loadModpack(name, bytes)));
  const gold = mtrlPayloads(
    loadModpack(
      name,
      new Uint8Array(readFileSync(`${cacheDir}/${goldenFile}`)),
    ),
  );

  for (const [path, oList] of ours) {
    const gList = (gold.get(path) ?? []).slice();
    for (const o of oList) {
      // ignore exact matches
      if (gList.some((g) => bytesEqual(o, g))) continue;
      const ob = blankIndexPath(o, path);
      // find a golden payload that is identical once the index path is blanked
      const g = gList.find((gp) =>
        bytesEqual(blankIndexPath(gp, path).bytes, ob.bytes),
      );
      if (!g) {
        problems.push(`${name} :: ${path} (diff is NOT index-path-only)`);
        continue;
      }
      const goldenIdx = blankIndexPath(g, path).realPath;
      if (!goldenIdx) continue;
      // Principled source: the base-game material's own index sampler. Cross-check it equals the
      // golden's index path (validates the C# refinement mechanism).
      const base = baseGameIndexPath(path);
      if (base === undefined) {
        problems.push(
          `${name} :: ${path} (golden diverged but material not extractable from game)`,
        );
        continue;
      }
      if (base !== goldenIdx) {
        problems.push(
          `${name} :: ${path} (base-game index ${base} != golden index ${goldenIdx})`,
        );
        continue;
      }
      const existing = overrides.get(path);
      if (existing && existing !== base) {
        problems.push(
          `${name} :: ${path} (conflicting override ${existing} vs ${base})`,
        );
      }
      overrides.set(path, base);
    }
  }
}

const sorted = [...overrides.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
const body = sorted
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join("\n");
writeFileSync(
  "src/upgrade/reference/index-path-overrides.ts",
  "// GENERATED — regenerate via `npx tsx scripts/extract-index-overrides.ts`. Do not edit by hand.\n" +
    "// Base-game material path -> its canonical index (_id.tex) sampler path, for materials where\n" +
    "// TexTools' idPath refinement (EndwalkerUpgrade.cs:923-936) overrides the naming convention.\n" +
    "export const INDEX_PATH_OVERRIDES: Record<string, string> = {\n" +
    body +
    "\n};\n",
);

console.log(`wrote ${sorted.length} index-path overrides`);
if (problems.length) {
  console.log(`\n${problems.length} PROBLEMS (not recorded):`);
  for (const p of problems) console.log(`  ${p}`);
}
