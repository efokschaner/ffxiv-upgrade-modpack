// scripts/extract-shader-params.ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMtrl } from "../src/mtrl/mtrl";

// test/helpers/oracle.ts reads `__dirname` at module scope. That global is only injected
// by Vite's SSR runner (as happens for real Vitest test files); a plain `tsx` script has
// no such shim, so a static import throws `__dirname is not defined`. Fake it (bare
// identifiers resolve through globalThis) before dynamically importing oracle.ts, so the
// shared test helper itself stays untouched.
(globalThis as unknown as { __dirname: string }).__dirname = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "helpers",
);
const { extractGameFile } = await import("../test/helpers/oracle");

const HAIR =
  "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl";
const GLASS = "chara/equipment/e5001/material/v0001/mt_c0101e5001_met_b.mtrl";

function load(gamePath: string) {
  const dir = mkdtempSync(join(tmpdir(), "shparam-"));
  const dest = join(dir, "f.mtrl");
  // dest's extension matches gamePath's, so ConsoleTools' /extract (oracle.ts's
  // extractGameFile) already yields raw uncompressed bytes — no SqPack unwrap needed.
  extractGameFile(gamePath, dest);
  const raw = new Uint8Array(readFileSync(dest));
  return parseMtrl(raw, gamePath);
}

const banner =
  "// GENERATED — regenerate via `npx tsx scripts/extract-shader-params.ts`. Do not edit by hand.\n";
const consts = (name: string, cs: { constantId: number; values: number[] }[]) =>
  `export const ${name}: { constantId: number; values: number[] }[] = ${JSON.stringify(
    cs.map((c) => ({ constantId: c.constantId, values: c.values })),
  )};\n`;

const hair = load(HAIR);
writeFileSync(
  "src/upgrade/reference/hair-shader-params.ts",
  banner +
    consts("HAIR_SHADER_CONSTANTS", hair.shaderConstants) +
    `export const HAIR_ADDITIONAL_DATA: number[] = ${JSON.stringify([...hair.additionalData])};\n`,
);

const glass = load(GLASS);
writeFileSync(
  "src/upgrade/reference/glass-shader-params.ts",
  banner +
    `export const GLASS_SHADER_KEYS: { keyId: number; value: number }[] = ${JSON.stringify(
      glass.shaderKeys.map((k) => ({ keyId: k.keyId, value: k.value })),
    )};\n` +
    consts("GLASS_SHADER_CONSTANTS", glass.shaderConstants) +
    `export const GLASS_ADDITIONAL_DATA: number[] = ${JSON.stringify([...glass.additionalData])};\n`,
);

console.log("wrote hair-shader-params.ts and glass-shader-params.ts");
